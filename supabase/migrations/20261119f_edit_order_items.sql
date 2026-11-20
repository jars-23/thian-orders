-- =====================================================================
-- Migración 2026-11-19 (f) — Modificar los productos de un pedido
-- Ejecutar UNA vez en SQL Editor, después de 20261119e_update_order.sql.
-- (setup.sql ya incluye estos cambios para instalaciones nuevas.)
--
-- update_order(...) recibe además p_items (lista completa deseada):
--   [{ "id": <uuid existente o null>, "product_id", "quantity", "notes" }]
--   - Ítem existente que no viene en la lista: se quita.
--   - Ítem existente: se puede cambiar cantidad y personalización.
--   - Sin id: producto nuevo, con el precio vigente (general o mayorista).
--   Solo se modifican/quitan ítems en estado "Pendiente"; los que están en
--   proceso o finalizados quedan bloqueados para no perder producción.
--   Si el pedido llega a 10+ unidades pasa a precio mayorista y se
--   recalculan todos los precios. El estado de pago se recalcula con el
--   nuevo total; si lo abonado supera el total hay que ajustar el pago.
-- Permisos: igual que el resto de la edición (Administrador, Facturación
-- o el vendedor dueño del pedido); el pago sigue siendo solo de
-- Administrador y Facturación.
-- El trigger de order_items admite cambios hechos por update_order
-- (marca local de la transacción); los demás siguen bloqueados.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_order_item_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('thian.order_edit', true) = 'on' THEN RETURN NEW; END IF;
  IF NOT public.is_admin() AND (SELECT auth.uid()) IS NOT NULL AND (
     NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR
     NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.quantity IS DISTINCT FROM OLD.quantity OR
     NEW.notes IS DISTINCT FROM OLD.notes OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR
     NEW.created_at IS DISTINCT FROM OLD.created_at)
  THEN RAISE EXCEPTION 'Producción solo puede modificar el estado'; END IF;
  RETURN NEW;
END; $$;

DROP FUNCTION IF EXISTS public.update_order(uuid, text, text, text, text, text, integer);

CREATE FUNCTION public.update_order(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text,
  p_payment_status text DEFAULT NULL, p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL, p_items jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_wholesale_min_units constant integer := 10;  -- mantener igual que la app
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

    -- Regla mayorista: 10+ unidades -> precio mayorista para todo el pedido
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

REVOKE ALL ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer,jsonb) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación (debe terminar en "p_amount_paid integer, p_items jsonb"):
-- SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'update_order';
