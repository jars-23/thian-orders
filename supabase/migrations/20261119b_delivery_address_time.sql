-- =====================================================================
-- Migración 2026-11-19 (b) — Dirección y hora de entrega del pedido
-- Ejecutar UNA vez en SQL Editor, después de 20261119_wholesale_price.sql.
-- (setup.sql ya incluye estos cambios para instalaciones nuevas.)
--
-- - orders.delivery_address (texto) y orders.delivery_time (hora), opcionales.
-- - create_order(...) recibe p_delivery_address y p_delivery_time.
--   Se reemplaza la versión anterior; la regla de precio mayorista no cambia.
-- RLS sin cambios.
-- =====================================================================
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_time time,
  ADD COLUMN IF NOT EXISTS delivery_address text;

DROP FUNCTION IF EXISTS public.create_order(text, text, date, text, jsonb, boolean);

CREATE FUNCTION public.create_order(p_customer_name text, p_customer_phone text,
  p_delivery_date date, p_notes text, p_items jsonb, p_wholesale boolean DEFAULT false,
  p_delivery_address text DEFAULT NULL, p_delivery_time time DEFAULT NULL)
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

  INSERT INTO public.orders (seller_id, customer_name, customer_phone, delivery_date,
                             delivery_time, delivery_address, notes, wholesale)
  VALUES ((SELECT auth.uid()), trim(p_customer_name), nullif(trim(p_customer_phone),''),
          p_delivery_date, p_delivery_time, nullif(trim(p_delivery_address),''),
          nullif(trim(p_notes),''), v_wholesale)
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

REVOKE ALL ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación (debe terminar en "p_delivery_address text, p_delivery_time time"):
-- SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'create_order';
