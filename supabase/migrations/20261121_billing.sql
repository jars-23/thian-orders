-- =====================================================================
-- Migración 2026-11-21 — Facturación por entrega y domicilio por municipio
-- Ejecutar UNA vez en SQL Editor, después de 20261123_cancel_order.sql
-- (usa la columna orders.cancelled_at). Al final está la MARCHA ATRÁS.
-- (setup.sql ya incluye estos cambios para instalaciones nuevas.)
--
-- 1. Se retiran los roles Supervisor y Ventas y Producción (se quitan
--    también de los usuarios que los tuvieran).
-- 2. delivery_zones: valor del domicilio por municipio. Se lee en la app;
--    para cambiar un valor: UPDATE public.delivery_zones SET fee = ... WHERE code = ...
-- 3. orders.delivery_zone / delivery_fee: el domicilio se escoge al crear el
--    pedido y se suma al total (el valor lo pone el servidor, no la app).
-- 4. invoices: una factura interna por pedido (consecutivo FAC-0001), con
--    copia fija de cliente, productos, domicilio, abonos y saldo. Solo
--    Administrador y Facturación la generan y la ven.
-- 5. create_order y update_order reciben el municipio; un pedido facturado ya
--    no admite cambios de productos ni de domicilio (el pago sí).
-- 6. Un pedido cancelado no se edita ni se factura.
-- =====================================================================

-- ---------- 0. Respaldo (ejecutar primero; se puede borrar tras validar) ----------
CREATE TABLE IF NOT EXISTS public.backup_roles_20261121      AS SELECT * FROM public.roles;
CREATE TABLE IF NOT EXISTS public.backup_user_roles_20261121 AS SELECT * FROM public.user_roles;
CREATE TABLE IF NOT EXISTS public.backup_orders_20261121     AS SELECT * FROM public.orders;
ALTER TABLE public.backup_roles_20261121      ENABLE ROW LEVEL SECURITY;  -- sin políticas: solo service_role
ALTER TABLE public.backup_user_roles_20261121 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_orders_20261121     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_roles_20261121, public.backup_user_roles_20261121,
              public.backup_orders_20261121 FROM anon, authenticated;

BEGIN;

-- ---------- 1. Roles retirados ----------
-- user_roles se borra en cascada (ON DELETE CASCADE).
DELETE FROM public.roles WHERE code IN ('supervisor', 'sales_production');

-- ---------- 2. Zonas de domicilio ----------
CREATE TABLE IF NOT EXISTS public.delivery_zones (
  code   text PRIMARY KEY,
  name   text NOT NULL,
  fee    integer NOT NULL CHECK (fee >= 0),   -- COP
  sort   smallint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO public.delivery_zones (code, name, fee, sort) VALUES
  ('piedecuesta',   'Piedecuesta',       6000, 1),
  ('floridablanca', 'Floridablanca',     8000, 2),
  ('bucaramanga',   'Bucaramanga',      10000, 3),
  ('giron',         'Girón',            10000, 4),
  ('pickup',        'Recoge en tienda',     0, 5)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, fee = EXCLUDED.fee, sort = EXCLUDED.sort;

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "zones read" ON public.delivery_zones;
CREATE POLICY "zones read" ON public.delivery_zones FOR SELECT TO authenticated
  USING (public.is_active_user());
REVOKE ALL ON public.delivery_zones FROM anon, authenticated;
GRANT SELECT ON public.delivery_zones TO authenticated;
GRANT ALL ON public.delivery_zones TO service_role;

-- ---------- 3. Domicilio en el pedido ----------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_zone text REFERENCES public.delivery_zones(code),
  ADD COLUMN IF NOT EXISTS delivery_fee  integer NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);

-- ---------- 4. Facturas ----------
CREATE TABLE IF NOT EXISTS public.invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number     bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  order_id           uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_number       bigint NOT NULL,
  created_by         uuid NOT NULL REFERENCES public.profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  customer_name      text NOT NULL,
  customer_phone     text,
  delivery_address   text,
  delivery_zone_name text,
  delivery_date      date,
  delivery_time      time,
  wholesale          boolean NOT NULL DEFAULT false,
  items              jsonb NOT NULL,   -- [{name, quantity, unit_price, notes}]
  subtotal           integer NOT NULL,
  delivery_fee       integer NOT NULL DEFAULT 0,
  total              integer NOT NULL,
  amount_paid        integer NOT NULL DEFAULT 0,
  balance            integer NOT NULL,
  payment_method     text
);
CREATE INDEX IF NOT EXISTS invoices_created_idx ON public.invoices (created_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices read" ON public.invoices;
CREATE POLICY "invoices read" ON public.invoices FOR SELECT TO authenticated
  USING (public.is_admin() OR public.has_role('billing'));
-- Sin políticas de escritura: solo create_invoice (SECURITY DEFINER).
REVOKE ALL ON public.invoices FROM anon, authenticated;
GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

CREATE OR REPLACE FUNCTION public.create_invoice(p_order_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_o public.orders%ROWTYPE;
  v_items jsonb; v_sub integer; v_zone text; v_total integer; v_paid integer; v_no bigint;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user()
     OR NOT (public.is_admin() OR public.has_role('billing')) THEN
    RAISE EXCEPTION 'Solo Administración o Facturación generan facturas' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_o.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'El pedido está cancelado'; END IF;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'Este pedido ya tiene factura';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', p.name, 'quantity', i.quantity,
           'unit_price', coalesce(i.unit_price, 0), 'notes', i.notes)
           ORDER BY i.created_at, p.name), '[]'::jsonb),
         coalesce(sum(coalesce(i.unit_price, 0) * i.quantity), 0)
    INTO v_items, v_sub
    FROM public.order_items i JOIN public.products p ON p.id = i.product_id
   WHERE i.order_id = p_order_id;
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'El pedido no tiene productos'; END IF;

  SELECT name INTO v_zone FROM public.delivery_zones WHERE code = v_o.delivery_zone;
  v_total := v_sub + coalesce(v_o.delivery_fee, 0);
  v_paid  := least(coalesce(v_o.amount_paid, 0), v_total);

  INSERT INTO public.invoices (order_id, order_number, created_by, customer_name, customer_phone,
    delivery_address, delivery_zone_name, delivery_date, delivery_time, wholesale, items,
    subtotal, delivery_fee, total, amount_paid, balance, payment_method)
  VALUES (p_order_id, v_o.order_number, v_uid, v_o.customer_name, v_o.customer_phone,
    v_o.delivery_address, v_zone, v_o.delivery_date, v_o.delivery_time, v_o.wholesale, v_items,
    v_sub, coalesce(v_o.delivery_fee, 0), v_total, v_paid, v_total - v_paid, v_o.payment_method)
  RETURNING invoice_number INTO v_no;
  RETURN v_no;
END; $$;

REVOKE ALL ON FUNCTION public.create_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice(uuid) TO authenticated;

-- ---------- 5a. create_order con municipio ----------
DROP FUNCTION IF EXISTS public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer);
CREATE FUNCTION public.create_order(p_customer_name text, p_customer_phone text,
  p_delivery_date date, p_notes text, p_items jsonb, p_wholesale boolean DEFAULT false,
  p_delivery_address text DEFAULT NULL, p_delivery_time time DEFAULT NULL,
  p_payment_status text DEFAULT 'pending', p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL, p_delivery_zone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 12;  -- mantener igual que la app
  v_id uuid; v_item jsonb; v_qty integer; v_units integer := 0;
  v_wholesale boolean; v_price integer; v_price_wholesale integer;
  v_unit integer; v_total integer := 0; v_paid integer; v_fee integer := 0;
  v_status text := coalesce(p_payment_status, 'pending');
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Cuenta inactiva'; END IF;
  IF nullif(trim(p_customer_name),'') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0
  THEN RAISE EXCEPTION 'Agrega productos'; END IF;

  -- 0) Domicilio: el valor sale de delivery_zones
  IF p_delivery_zone IS NOT NULL THEN
    SELECT fee INTO v_fee FROM public.delivery_zones WHERE code = p_delivery_zone AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Municipio de entrega no válido'; END IF;
  END IF;

  -- 1) Unidades -> ¿precio mayorista?
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    v_units := v_units + v_qty;
  END LOOP;
  v_wholesale := coalesce(p_wholesale, false) OR v_units >= c_wholesale_min_units;

  -- 2) Total con precios de la tabla products (valida que estén activos) + domicilio
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT price, price_wholesale INTO v_price, v_price_wholesale
      FROM public.products
     WHERE id = (v_item->>'product_id')::uuid AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
    v_unit := CASE WHEN v_wholesale THEN coalesce(v_price_wholesale, v_price) ELSE v_price END;
    v_total := v_total + coalesce(v_unit, 0) * (v_item->>'quantity')::integer;
  END LOOP;
  v_total := v_total + v_fee;

  -- 3) Pago: medio obligatorio si hay pago; parcial con abono > 0 y < total
  IF v_status NOT IN ('pending', 'partial', 'paid') THEN RAISE EXCEPTION 'Tipo de pago inválido'; END IF;
  IF v_status <> 'pending' AND p_payment_method IS NULL THEN RAISE EXCEPTION 'Indica el medio de pago'; END IF;
  IF v_status = 'partial' AND coalesce(p_amount_paid, 0) <= 0 THEN RAISE EXCEPTION 'Indica el valor abonado'; END IF;
  IF v_status = 'partial' AND v_total > 0 AND p_amount_paid >= v_total
  THEN RAISE EXCEPTION 'El abono debe ser menor al total; usa Pago completo'; END IF;
  v_paid := CASE v_status WHEN 'paid' THEN v_total WHEN 'partial' THEN p_amount_paid ELSE 0 END;

  -- 4) Pedido y productos (sin UPDATE posterior: RLS solo deja actualizar al admin)
  INSERT INTO public.orders (seller_id, customer_name, customer_phone, delivery_date,
                             delivery_time, delivery_address, notes, wholesale,
                             payment_status, payment_method, amount_paid,
                             delivery_zone, delivery_fee)
  VALUES ((SELECT auth.uid()), trim(p_customer_name), nullif(trim(p_customer_phone),''),
          p_delivery_date, p_delivery_time, nullif(trim(p_delivery_address),''),
          nullif(trim(p_notes),''), v_wholesale,
          v_status, CASE WHEN v_status = 'pending' THEN NULL ELSE p_payment_method END, v_paid,
          p_delivery_zone, v_fee)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT price, price_wholesale INTO v_price, v_price_wholesale
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    INSERT INTO public.order_items (order_id, product_id, quantity, notes, unit_price)
    VALUES (v_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::integer,
            nullif(trim(v_item->>'notes'),''),
            CASE WHEN v_wholesale THEN coalesce(v_price_wholesale, v_price) ELSE v_price END);
  END LOOP;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer,text) TO authenticated;

-- ---------- 5b. update_order con municipio y bloqueo si está facturado ----------
DROP FUNCTION IF EXISTS public.update_order(uuid,text,text,text,text,text,integer,jsonb);
CREATE FUNCTION public.update_order(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text,
  p_payment_status text DEFAULT NULL, p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL, p_items jsonb DEFAULT NULL,
  p_delivery_zone text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 12;  -- mantener igual que la app
  v_uid uuid := (SELECT auth.uid());
  v_order public.orders%ROWTYPE;
  v_can_bill boolean; v_is_owner boolean; v_invoiced boolean; v_zone_changed boolean;
  v_total integer; v_new_paid integer; v_method text; v_diff integer; v_fee integer;
  v_item jsonb; v_old public.order_items%ROWTYPE; v_qty integer; v_units integer;
  v_keep uuid[] := '{}'; v_price integer; v_price_w integer; v_status text; v_new_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_order.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'El pedido está cancelado'; END IF;

  v_can_bill := public.is_admin() OR public.has_role('billing');
  v_is_owner := v_order.seller_id = v_uid AND public.has_role('seller');
  IF NOT (v_can_bill OR v_is_owner) THEN
    RAISE EXCEPTION 'No tienes permiso para editar este pedido' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_customer_name), '') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;

  v_invoiced := EXISTS (SELECT 1 FROM public.invoices WHERE order_id = p_order_id);
  v_zone_changed := p_delivery_zone IS NOT NULL
                    AND p_delivery_zone IS DISTINCT FROM v_order.delivery_zone;
  IF v_invoiced AND (p_items IS NOT NULL OR v_zone_changed) THEN
    RAISE EXCEPTION 'El pedido ya está facturado: no se pueden cambiar productos ni domicilio';
  END IF;

  UPDATE public.orders
     SET customer_name    = trim(p_customer_name),
         customer_phone   = nullif(trim(p_customer_phone), ''),
         delivery_address = nullif(trim(p_delivery_address), '')
   WHERE id = p_order_id;

  -- ---------- Domicilio (opcional) ----------
  IF v_zone_changed THEN
    SELECT fee INTO v_fee FROM public.delivery_zones WHERE code = p_delivery_zone AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Municipio de entrega no válido'; END IF;
    UPDATE public.orders SET delivery_zone = p_delivery_zone, delivery_fee = v_fee
     WHERE id = p_order_id;
  END IF;
  SELECT delivery_fee INTO v_fee FROM public.orders WHERE id = p_order_id;

  -- ---------- Productos del pedido (opcional) ----------
  IF p_items IS NOT NULL THEN
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'El pedido debe tener al menos un producto';
    END IF;
    PERFORM set_config('thian.order_edit', 'on', true);  -- solo esta transacción

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_qty := (v_item->>'quantity')::integer;
      IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;

      IF nullif(v_item->>'id', '') IS NOT NULL THEN
        SELECT * INTO v_old FROM public.order_items
         WHERE id = (v_item->>'id')::uuid AND order_id = p_order_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Producto del pedido no encontrado'; END IF;
        v_keep := v_keep || v_old.id;
        IF v_old.quantity <> v_qty
           OR coalesce(v_old.notes, '') <> coalesce(nullif(trim(v_item->>'notes'), ''), '') THEN
          IF v_old.status <> 'pending' THEN
            RAISE EXCEPTION 'No se puede cambiar un producto que ya está en producción o finalizado';
          END IF;
          UPDATE public.order_items
             SET quantity = v_qty, notes = nullif(trim(v_item->>'notes'), '')
           WHERE id = v_old.id;
        END IF;
      ELSE
        SELECT price, price_wholesale INTO v_price, v_price_w
          FROM public.products WHERE id = (v_item->>'product_id')::uuid AND active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
        INSERT INTO public.order_items (order_id, product_id, quantity, notes, unit_price)
        VALUES (p_order_id, (v_item->>'product_id')::uuid, v_qty,
                nullif(trim(v_item->>'notes'), ''),
                CASE WHEN v_order.wholesale THEN coalesce(v_price_w, v_price) ELSE v_price END)
        RETURNING id INTO v_new_id;
        v_keep := v_keep || v_new_id;
      END IF;
    END LOOP;

    -- Quitar los que ya no vienen (solo pendientes)
    IF EXISTS (SELECT 1 FROM public.order_items
                WHERE order_id = p_order_id AND NOT (id = ANY (v_keep)) AND status <> 'pending') THEN
      RAISE EXCEPTION 'No se puede quitar un producto que ya está en producción o finalizado';
    END IF;
    DELETE FROM public.order_items WHERE order_id = p_order_id AND NOT (id = ANY (v_keep));

    -- Regla mayorista: 12+ unidades -> precio mayorista para todo el pedido
    SELECT coalesce(sum(quantity), 0) INTO v_units FROM public.order_items WHERE order_id = p_order_id;
    IF NOT v_order.wholesale AND v_units >= c_wholesale_min_units THEN
      UPDATE public.orders SET wholesale = true WHERE id = p_order_id;
      UPDATE public.order_items i
         SET unit_price = coalesce(p.price_wholesale, p.price)
        FROM public.products p
       WHERE i.order_id = p_order_id AND p.id = i.product_id;
    END IF;
  END IF;

  -- Total = productos + domicilio
  SELECT coalesce(sum(unit_price * quantity), 0) + coalesce(v_fee, 0) INTO v_total
    FROM public.order_items WHERE order_id = p_order_id;

  -- ---------- Pago (opcional): solo Administrador y Facturación ----------
  IF p_payment_status IS NOT NULL THEN
    IF NOT v_can_bill THEN
      RAISE EXCEPTION 'Solo Administración o Facturación editan el pago' USING ERRCODE = '42501';
    END IF;
    IF p_payment_status NOT IN ('pending', 'partial', 'paid') THEN
      RAISE EXCEPTION 'Tipo de pago inválido';
    END IF;
    IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('transfer', 'cash') THEN
      RAISE EXCEPTION 'Medio de pago inválido';
    END IF;
    IF p_payment_status <> 'pending' AND p_payment_method IS NULL THEN
      RAISE EXCEPTION 'Indica el medio de pago';
    END IF;
    IF p_payment_status <> 'pending' AND v_total = 0 THEN
      RAISE EXCEPTION 'El pedido no tiene precios guardados';
    END IF;

    v_new_paid := CASE p_payment_status
                    WHEN 'paid' THEN v_total
                    WHEN 'pending' THEN 0
                    ELSE p_amount_paid END;
    IF p_payment_status = 'partial'
       AND (v_new_paid IS NULL OR v_new_paid <= 0 OR v_new_paid >= v_total) THEN
      RAISE EXCEPTION 'En pago parcial el abono debe ser mayor a 0 y menor al total (%)', v_total;
    END IF;

    v_method := CASE WHEN p_payment_status = 'pending' THEN NULL ELSE p_payment_method END;
    v_diff := v_new_paid - coalesce(v_order.amount_paid, 0);
    IF v_diff <> 0 THEN
      INSERT INTO public.order_payments (order_id, amount, method, note, created_by)
      VALUES (p_order_id, v_diff,
              coalesce(p_payment_method, v_order.payment_method, 'cash'),
              'Corrección', v_uid);
    END IF;

    UPDATE public.orders
       SET payment_status = p_payment_status,
           payment_method = v_method,
           amount_paid    = v_new_paid
     WHERE id = p_order_id;

  ELSIF p_items IS NOT NULL OR v_zone_changed THEN
    -- Sin cambios de pago: el estado se ajusta al nuevo total
    v_new_paid := coalesce(v_order.amount_paid, 0);
    IF v_new_paid > v_total THEN
      RAISE EXCEPTION 'Lo abonado (%) supera el nuevo total (%): ajusta también el pago', v_new_paid, v_total;
    END IF;
    v_status := CASE WHEN v_new_paid = 0 THEN 'pending'
                     WHEN v_new_paid >= v_total THEN 'paid'
                     ELSE 'partial' END;
    UPDATE public.orders SET payment_status = v_status WHERE id = p_order_id;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb,text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación:
-- SELECT code, name, fee FROM public.delivery_zones ORDER BY sort;        -- 5 filas
-- SELECT code FROM public.roles ORDER BY id;                               -- sin supervisor ni sales_production
-- SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--  WHERE proname IN ('create_order', 'update_order', 'create_invoice');    -- 3 filas

-- =====================================================================
-- MARCHA ATRÁS (solo si hay que deshacer). Tres pasos, en orden:
-- =====================================================================
-- Paso A:
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.create_invoice(uuid);
-- DROP FUNCTION IF EXISTS public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer,text);
-- DROP FUNCTION IF EXISTS public.update_order(uuid,text,text,text,text,text,integer,jsonb,text);
-- DROP TABLE IF EXISTS public.invoices;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS delivery_fee, DROP COLUMN IF EXISTS delivery_zone;
-- DROP TABLE IF EXISTS public.delivery_zones;
-- INSERT INTO public.roles (id, code, name) OVERRIDING SYSTEM VALUE
--   SELECT id, code, name FROM public.backup_roles_20261121
--    WHERE code IN ('supervisor', 'sales_production') ON CONFLICT DO NOTHING;
-- INSERT INTO public.user_roles
--   SELECT b.* FROM public.backup_user_roles_20261121 b
--    JOIN public.backup_roles_20261121 r ON r.id = b.role_id
--    WHERE r.code IN ('supervisor', 'sales_production') ON CONFLICT DO NOTHING;
-- COMMIT;
--
-- Paso B: ejecutar de nuevo completo supabase/migrations/20261120_wholesale_12_units.sql
--         (recrea create_order y update_order con las firmas anteriores).
--
-- Paso C:
-- GRANT EXECUTE ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb) TO authenticated;
-- REVOKE ALL ON FUNCTION public.create_order(text,text,date,text,jsonb,boolean,text,time,text,text,integer) FROM PUBLIC, anon;
-- REVOKE ALL ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb) FROM PUBLIC, anon;
-- NOTIFY pgrst, 'reload schema';
--
-- Cuando todo esté validado:
-- DROP TABLE public.backup_roles_20261121, public.backup_user_roles_20261121, public.backup_orders_20261121;
