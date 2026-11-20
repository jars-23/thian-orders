-- =====================================================================
-- Migración 2026-11-19 (d) — Registrar pagos de pedidos existentes
-- Ejecutar UNA vez en SQL Editor, después de 20261119c_payment.sql.
-- (setup.sql ya incluye estos cambios para instalaciones nuevas.)
--
-- - Tabla order_payments: historial de abonos (monto, medio, quién, cuándo).
--   La lectura hereda la visibilidad del pedido; nadie inserta directo.
-- - Trigger: el abono hecho al crear el pedido queda como "Abono inicial".
-- - RPC register_payment(pedido, monto, medio): solo Administrador y
--   Facturación. Suma al abonado, no deja pasar del saldo y marca el
--   pedido como Pago parcial o Pago completo.
-- - Se cargan al historial los abonos de pedidos ya creados.
-- RLS de orders sin cambios (la RPC valida el rol explícitamente).
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  amount     integer NOT NULL CHECK (amount > 0),
  method     text NOT NULL CHECK (method IN ('transfer', 'cash')),
  note       text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_payments_order_idx ON public.order_payments (order_id, created_at);

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments read" ON public.order_payments;
CREATE POLICY "payments read" ON public.order_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id));
-- Sin políticas de escritura: solo el trigger y register_payment (SECURITY DEFINER).

REVOKE ALL ON public.order_payments FROM anon, authenticated;
GRANT SELECT ON public.order_payments TO authenticated;
GRANT ALL ON public.order_payments TO service_role;

-- Abono inicial al crear el pedido
CREATE OR REPLACE FUNCTION public.log_initial_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(NEW.amount_paid, 0) > 0 AND NEW.payment_method IS NOT NULL THEN
    INSERT INTO public.order_payments (order_id, amount, method, note, created_by, created_at)
    VALUES (NEW.id, NEW.amount_paid, NEW.payment_method, 'Abono inicial', NEW.seller_id, NEW.created_at);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS log_initial_payment ON public.orders;
CREATE TRIGGER log_initial_payment AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.log_initial_payment();

-- Registrar un pago posterior
CREATE OR REPLACE FUNCTION public.register_payment(p_order_id uuid, p_amount integer, p_method text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total integer; v_paid integer; v_new integer; v_status text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (public.is_admin() OR public.has_role('billing'))
  THEN RAISE EXCEPTION 'Solo Administración o Facturación registran pagos' USING ERRCODE = '42501'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('transfer', 'cash')
  THEN RAISE EXCEPTION 'Indica el medio de pago'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'El valor debe ser mayor a cero'; END IF;

  SELECT coalesce(amount_paid, 0) INTO v_paid FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;

  SELECT sum(unit_price * quantity) INTO v_total FROM public.order_items WHERE order_id = p_order_id;
  IF coalesce(v_total, 0) = 0 THEN RAISE EXCEPTION 'El pedido no tiene precios guardados'; END IF;
  IF v_paid >= v_total THEN RAISE EXCEPTION 'El pedido ya está pagado'; END IF;

  v_new := v_paid + p_amount;
  IF v_new > v_total THEN
    RAISE EXCEPTION 'El pago supera el saldo pendiente (%)', v_total - v_paid;
  END IF;
  v_status := CASE WHEN v_new >= v_total THEN 'paid' ELSE 'partial' END;

  UPDATE public.orders
     SET amount_paid = v_new, payment_status = v_status, payment_method = p_method
   WHERE id = p_order_id;
  INSERT INTO public.order_payments (order_id, amount, method, created_by)
  VALUES (p_order_id, p_amount, p_method, (SELECT auth.uid()));
  RETURN v_status;
END; $$;

REVOKE ALL ON FUNCTION public.log_initial_payment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_payment(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_payment(uuid, integer, text) TO authenticated;

-- Abonos de pedidos ya creados (solo si aún no tienen historial)
INSERT INTO public.order_payments (order_id, amount, method, note, created_by, created_at)
SELECT o.id, o.amount_paid, o.payment_method, 'Abono inicial', o.seller_id, o.created_at
  FROM public.orders o
 WHERE coalesce(o.amount_paid, 0) > 0 AND o.payment_method IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = o.id);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación (1 tabla con RLS, 1 política, 2 funciones):
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_payments'::regclass;  -- true
-- SELECT proname FROM pg_proc WHERE proname IN ('register_payment', 'log_initial_payment');
