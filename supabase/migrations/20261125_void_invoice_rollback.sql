-- =====================================================================
-- MARCHA ATRÁS de 20261125_void_invoice.sql
-- Si algún pedido ya tiene más de una factura (se refacturó), NO se puede
-- volver al UNIQUE(order_id): el script se detiene y no cambia nada.
-- La tabla backup_invoices_20261125 queda para consultar; borrarla al validar:
--   DROP TABLE public.backup_invoices_20261125;
-- =====================================================================
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices GROUP BY order_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Hay pedidos con más de una factura: revisar antes de deshacer';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.void_invoice(uuid, text);

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

CREATE OR REPLACE FUNCTION public.update_order(
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
                v_price)  -- el precio definitivo se fija abajo, por referencia
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

    -- Regla mayorista POR REFERENCIA: cada producto con 12+ unidades en el
    -- pedido va a precio mayorista; el resto a precio general. Solo se
    -- recalculan las líneas pendientes (las de producción conservan su precio).
    UPDATE public.order_items i
       SET unit_price = CASE WHEN q.units >= c_wholesale_min_units
                             THEN coalesce(p.price_wholesale, p.price) ELSE p.price END
      FROM public.products p,
           (SELECT product_id, sum(quantity) AS units FROM public.order_items
             WHERE order_id = p_order_id GROUP BY product_id) AS q
     WHERE i.order_id = p_order_id AND i.status = 'pending'
       AND p.id = i.product_id AND q.product_id = i.product_id;
    UPDATE public.orders
       SET wholesale = EXISTS (SELECT 1 FROM public.order_items
                                WHERE order_id = p_order_id
                                GROUP BY product_id
                               HAVING sum(quantity) >= c_wholesale_min_units)
     WHERE id = p_order_id;
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

DROP INDEX IF EXISTS public.invoices_one_active_per_order;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_order_id_key UNIQUE (order_id);
ALTER TABLE public.invoices
  DROP COLUMN IF EXISTS void_reason,
  DROP COLUMN IF EXISTS voided_by,
  DROP COLUMN IF EXISTS voided_at;

NOTIFY pgrst, 'reload schema';
COMMIT;
