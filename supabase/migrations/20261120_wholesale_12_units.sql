-- =====================================================================
-- Migración 2026-11-20 — Precio mayorista desde 12 unidades (antes 10)
-- Ejecutar UNA vez en SQL Editor, después de 20261119f_edit_order_items.sql.
-- (setup.sql ya usa 12 para instalaciones nuevas.)
--
-- Solo cambia la constante c_wholesale_min_units en create_order y
-- update_order (mismas firmas, mismos permisos). Los pedidos ya creados
-- no se recalculan: conservan su precio.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.create_order(p_customer_name text, p_customer_phone text,
  p_delivery_date date, p_notes text, p_items jsonb, p_wholesale boolean DEFAULT false,
  p_delivery_address text DEFAULT NULL, p_delivery_time time DEFAULT NULL,
  p_payment_status text DEFAULT 'pending', p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 12;  -- mantener igual que la app
  v_id uuid; v_item jsonb; v_qty integer; v_units integer := 0;
  v_wholesale boolean; v_price integer; v_price_wholesale integer;
  v_unit integer; v_total integer := 0; v_paid integer;
  v_status text := coalesce(p_payment_status, 'pending');
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Cuenta inactiva'; END IF;
  IF nullif(trim(p_customer_name),'') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0
  THEN RAISE EXCEPTION 'Agrega productos'; END IF;

  -- 1) Unidades -> ¿precio mayorista?
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    v_units := v_units + v_qty;
  END LOOP;
  v_wholesale := coalesce(p_wholesale, false) OR v_units >= c_wholesale_min_units;

  -- 2) Total con precios de la tabla products (valida que estén activos)
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT price, price_wholesale INTO v_price, v_price_wholesale
      FROM public.products
     WHERE id = (v_item->>'product_id')::uuid AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no disponible'; END IF;
    v_unit := CASE WHEN v_wholesale THEN coalesce(v_price_wholesale, v_price) ELSE v_price END;
    v_total := v_total + coalesce(v_unit, 0) * (v_item->>'quantity')::integer;
  END LOOP;

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
                             payment_status, payment_method, amount_paid)
  VALUES ((SELECT auth.uid()), trim(p_customer_name), nullif(trim(p_customer_phone),''),
          p_delivery_date, p_delivery_time, nullif(trim(p_delivery_address),''),
          nullif(trim(p_notes),''), v_wholesale,
          v_status, CASE WHEN v_status = 'pending' THEN NULL ELSE p_payment_method END, v_paid)
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

CREATE OR REPLACE FUNCTION public.update_order(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text,
  p_payment_status text DEFAULT NULL, p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL, p_items jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 12;  -- mantener igual que la app
  v_uid uuid := (SELECT auth.uid());
  v_order public.orders%ROWTYPE;
  v_can_bill boolean; v_is_owner boolean;
  v_total integer; v_new_paid integer; v_method text; v_diff integer;
  v_item jsonb; v_old public.order_items%ROWTYPE; v_qty integer; v_units integer;
  v_keep uuid[] := '{}'; v_price integer; v_price_w integer; v_status text; v_new_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;

  v_can_bill := public.is_admin() OR public.has_role('billing');
  v_is_owner := v_order.seller_id = v_uid
                AND (public.has_role('seller') OR public.has_role('sales_production'));
  IF NOT (v_can_bill OR v_is_owner) THEN
    RAISE EXCEPTION 'No tienes permiso para editar este pedido' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_customer_name), '') IS NULL THEN RAISE EXCEPTION 'Cliente requerido'; END IF;

  UPDATE public.orders
     SET customer_name    = trim(p_customer_name),
         customer_phone   = nullif(trim(p_customer_phone), ''),
         delivery_address = nullif(trim(p_delivery_address), '')
   WHERE id = p_order_id;

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

  SELECT coalesce(sum(unit_price * quantity), 0) INTO v_total
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

  ELSIF p_items IS NOT NULL THEN
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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación (2 filas, ambas con 12):
-- SELECT proname, (regexp_match(prosrc, 'c_wholesale_min_units constant integer := (d+)'))[1]
--   FROM pg_proc WHERE proname IN ('create_order', 'update_order');
