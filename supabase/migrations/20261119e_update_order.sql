-- =====================================================================
-- Migración 2026-11-19 (e) — Editar datos de un pedido
-- Ejecutar UNA vez en SQL Editor, después de 20261119d_order_payments.sql.
-- (setup.sql ya incluye estos cambios para instalaciones nuevas.)
--
-- RPC update_order: edita cliente, teléfono, dirección y, opcionalmente,
-- tipo de pago, medio de pago y valor abonado.
--   - Datos del cliente: Administrador, Facturación o el vendedor que
--     creó el pedido.
--   - Pago: solo Administrador y Facturación.
--   - Si el valor abonado cambia, la diferencia queda en el historial como
--     "Corrección" (puede ser negativa), así la suma del historial siempre
--     coincide con lo abonado.
-- order_payments.amount pasa de "> 0" a "<> 0" para admitir correcciones.
-- RLS sin cambios (la RPC valida los roles explícitamente).
-- =====================================================================
BEGIN;

ALTER TABLE public.order_payments DROP CONSTRAINT IF EXISTS order_payments_amount_check;
ALTER TABLE public.order_payments ADD CONSTRAINT order_payments_amount_check CHECK (amount <> 0);

CREATE OR REPLACE FUNCTION public.update_order(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text,
  p_payment_status text DEFAULT NULL, p_payment_method text DEFAULT NULL,
  p_amount_paid integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order public.orders%ROWTYPE;
  v_can_bill boolean; v_is_owner boolean;
  v_total integer; v_new_paid integer; v_method text; v_diff integer;
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

  -- Pago (opcional): solo si se envía tipo de pago
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

    SELECT coalesce(sum(unit_price * quantity), 0) INTO v_total
      FROM public.order_items WHERE order_id = p_order_id;
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
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order(uuid,text,text,text,text,text,integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación:
-- SELECT proname FROM pg_proc WHERE proname = 'update_order';                    -- 1 fila
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conname = 'order_payments_amount_check';                               -- CHECK ((amount <> 0))
