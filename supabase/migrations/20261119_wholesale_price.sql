-- =====================================================================
-- Migración 2026-11-19 — Precio mayorista y precio guardado en el pedido
-- Ejecutar UNA vez en SQL Editor, después de 20261118c.
-- (setup.sql ya incluye estos cambios para instalaciones nuevas.)
--
-- Regla de negocio: el pedido usa precio mayorista si el vendedor marca
-- "Aplicar precio mayorista" o si el pedido suma 10 unidades o más.
-- La regla se aplica AQUÍ (servidor); la app solo la muestra.
--
-- - products.price_wholesale: precio mayorista en COP (opcional).
-- - orders.wholesale: si el pedido se cobró a precio mayorista.
-- - order_items.unit_price: precio unitario aplicado al crear el pedido
--   (queda congelado aunque luego cambie el precio del producto).
-- - create_order(...) recibe p_wholesale y calcula los precios con los
--   valores de la tabla products (no confía en precios del navegador).
-- RLS sin cambios.
-- =====================================================================
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_wholesale integer
  CHECK (price_wholesale IS NULL OR price_wholesale >= 0);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wholesale boolean NOT NULL DEFAULT false;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_price integer
  CHECK (unit_price IS NULL OR unit_price >= 0);

-- El precio aplicado tampoco lo puede cambiar quien no sea admin.
CREATE OR REPLACE FUNCTION public.guard_order_item_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_admin() AND (SELECT auth.uid()) IS NOT NULL AND (
     NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR
     NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.quantity IS DISTINCT FROM OLD.quantity OR
     NEW.notes IS DISTINCT FROM OLD.notes OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR
     NEW.created_at IS DISTINCT FROM OLD.created_at)
  THEN RAISE EXCEPTION 'Producción solo puede modificar el estado'; END IF;
  RETURN NEW;
END; $$;

-- Nueva firma (agrega p_wholesale): se reemplaza la anterior.
DROP FUNCTION IF EXISTS public.create_order(text, text, date, text, jsonb);

CREATE FUNCTION public.create_order(p_customer_name text, p_customer_phone text,
  p_delivery_date date, p_notes text, p_items jsonb, p_wholesale boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 10;  -- mantener igual que la app
  v_id uuid; v_item jsonb; v_qty integer; v_units integer := 0;
  v_wholesale boolean; v_price integer; v_price_wholesale integer;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Cuenta inactiva'; END IF;
  IF nullif(trim(p_customer_name),'') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0
  THEN RAISE EXCEPTION 'Agrega productos'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    v_units := v_units + v_qty;
  END LOOP;
  v_wholesale := coalesce(p_wholesale, false) OR v_units >= c_wholesale_min_units;

  INSERT INTO public.orders (seller_id, customer_name, customer_phone, delivery_date, notes, wholesale)
  VALUES ((SELECT auth.uid()), trim(p_customer_name), nullif(trim(p_customer_phone),''),
          p_delivery_date, nullif(trim(p_notes),''), v_wholesale)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT price, price_wholesale INTO v_price, v_price_wholesale
      FROM public.products
     WHERE id = (v_item->>'product_id')::uuid AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
    INSERT INTO public.order_items (order_id, product_id, quantity, notes, unit_price)
    VALUES (v_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::integer,
            nullif(trim(v_item->>'notes'),''),
            CASE WHEN v_wholesale THEN coalesce(v_price_wholesale, v_price) ELSE v_price END);
  END LOOP;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean) TO authenticated;

-- Precios mayoristas del Catálogo Mayorista Navideño 2026 (por referencia)
UPDATE public.products p SET price_wholesale = v.w
FROM (VALUES
  ('NAV26-01',25000),('NAV26-02',25000),('NAV26-03',18000),('NAV26-04',24000),
  ('NAV26-05', 9500),('NAV26-06', 9000),('NAV26-07',18000),('NAV26-08',17000),
  ('NAV26-09',20000),('NAV26-10',10000),('NAV26-11',10000),('NAV26-12', 6500),
  ('NAV26-13',35000),('NAV26-14',19000),('NAV26-15',10000),('NAV26-16',10000),
  ('NAV26-17',13500),('NAV26-18',13500),('NAV26-19',13500),('NAV26-20',17000),
  ('NAV26-21',17000),('NAV26-22',17000),('NAV26-23',17000),('NAV26-24',12000),
  ('NAV26-25',10000),('NAV26-26',10000),('NAV26-27',33000)
) AS v(sku, w)
WHERE p.sku = v.sku;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación:
-- SELECT count(*) AS con_mayorista FROM public.products WHERE price_wholesale IS NOT NULL;  -- 27
-- SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'create_order';
--   -> ... p_items jsonb, p_wholesale boolean
