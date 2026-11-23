-- =====================================================================
-- Migración 2026-11-23 — Cancelar pedidos
-- Ejecutar UNA vez en SQL Editor, después de 20261120_wholesale_12_units.sql
-- y ANTES de 20261121_billing.sql (esa migración ya cuenta con estas columnas).
-- (setup.sql ya incluye estos cambios para instalaciones nuevas.)
--
-- Los pedidos no se borran: se marcan como cancelados con fecha, usuario y
-- motivo. Quién puede cancelar (RPC cancel_order):
--   - Administrador y Facturación: cualquier pedido.
--   - Vendedor dueño: solo si todos sus productos siguen pendientes.
-- Un pedido cancelado ya no admite cambios de estado de producción.
-- =====================================================================

-- ---------- 0. Respaldo (ejecutar primero; se puede borrar tras validar) ----------
CREATE TABLE IF NOT EXISTS public.backup_orders_20261123 AS SELECT * FROM public.orders;
ALTER TABLE public.backup_orders_20261123 ENABLE ROW LEVEL SECURITY;  -- sin políticas: solo service_role
REVOKE ALL ON public.backup_orders_20261123 FROM anon, authenticated;

BEGIN;

-- ---------- 1. Columnas ----------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by  uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- ---------- 2. RPC cancel_order ----------
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order public.orders%ROWTYPE;
  v_can_bill boolean; v_is_owner boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la cancelación'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_order.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'El pedido ya está cancelado'; END IF;

  v_can_bill := public.is_admin() OR public.has_role('billing');
  v_is_owner := v_order.seller_id = v_uid AND public.has_role('seller');
  IF NOT v_can_bill THEN
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'No tienes permiso para cancelar este pedido' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND status <> 'pending') THEN
      RAISE EXCEPTION 'El pedido ya está en producción: pide a Administración que lo cancele';
    END IF;
  END IF;

  UPDATE public.orders
     SET cancelled_at = now(), cancelled_by = v_uid, cancel_reason = trim(p_reason)
   WHERE id = p_order_id;
END; $$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;

-- ---------- 3. set_order_item_status: rechaza pedidos cancelados ----------
-- Misma firma y permisos (se retira sales_production, rol que deja de existir).
CREATE OR REPLACE FUNCTION public.set_order_item_status(p_item_id uuid, p_status public.production_status)
RETURNS public.production_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status public.production_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (public.is_admin() OR public.has_role('production'))
  THEN RAISE EXCEPTION 'No tienes permiso para cambiar estados de producción' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL THEN RAISE EXCEPTION 'Estado requerido' USING ERRCODE = '22004'; END IF;
  IF EXISTS (SELECT 1 FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
              WHERE i.id = p_item_id AND o.cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'El pedido está cancelado';
  END IF;
  UPDATE public.order_items SET status = p_status WHERE id = p_item_id RETURNING status INTO v_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto del pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
  RETURN v_status;
END; $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'orders' AND column_name LIKE 'cancel%';             -- 3 filas
-- SELECT count(*) FROM public.backup_orders_20261123;                      -- = pedidos actuales

-- =====================================================================
-- MARCHA ATRÁS (solo si hay que deshacer; ejecutar como bloque)
-- =====================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.cancel_order(uuid, text);
-- CREATE OR REPLACE FUNCTION public.set_order_item_status(p_item_id uuid, p_status public.production_status)
-- RETURNS public.production_status
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
-- DECLARE v_status public.production_status;
-- BEGIN
--   IF (SELECT auth.uid()) IS NULL OR NOT (
--        public.is_admin() OR public.has_role('production') OR public.has_role('sales_production'))
--   THEN RAISE EXCEPTION 'No tienes permiso para cambiar estados de producción' USING ERRCODE = '42501'; END IF;
--   IF p_status IS NULL THEN RAISE EXCEPTION 'Estado requerido' USING ERRCODE = '22004'; END IF;
--   UPDATE public.order_items SET status = p_status WHERE id = p_item_id RETURNING status INTO v_status;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Producto del pedido no encontrado' USING ERRCODE = 'P0002'; END IF;
--   RETURN v_status;
-- END; $$;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS cancel_reason,
--   DROP COLUMN IF EXISTS cancelled_by, DROP COLUMN IF EXISTS cancelled_at;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
-- -- Cuando todo esté validado: DROP TABLE public.backup_orders_20261123;
