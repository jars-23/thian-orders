-- THIAN CANDLE V1.2 — Rol "Ventas y Producción" y cambios de estado mediante RPC.
-- Ejecutar DESPUÉS de migrate_v1_1.sql, como postgres desde el SQL Editor.
-- Hacer copia de seguridad primero.
--
-- Qué hace:
--  1. Crea el rol sales_production (Ventas y Producción).
--  2. Permite a sales_production leer todos los pedidos, registrar pedidos propios
--     y gestionar estados de producción. No obtiene privilegios administrativos.
--  3. Los cambios de estado de producción pasan por la RPC set_order_item_status,
--     que solo modifica order_items.status. Producción deja de tener UPDATE directo
--     sobre order_items; el UPDATE directo queda solo para administradores.
--
-- ORDEN DE DESPLIEGUE: tras ejecutar este script, los usuarios de producción solo
-- pueden cambiar estados con el frontend nuevo (que usa la RPC). Publicar el
-- frontend inmediatamente después de ejecutar la migración.
BEGIN;

-- 1. Rol nuevo (idempotente; no depende de una restricción UNIQUE sobre code).
INSERT INTO public.roles(code,name)
SELECT 'sales_production','Ventas y Producción'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE code='sales_production');

-- 2. Lectura de pedidos: se añade sales_production a los roles con visión global.
DROP POLICY IF EXISTS "orders read" ON public.orders;
CREATE POLICY "orders read" ON public.orders FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR public.has_role('production')
  OR public.has_role('sales_production')
  OR public.has_role('billing')
  OR public.has_role('supervisor')
  OR (public.has_role('seller') AND seller_id=(SELECT auth.uid()))
);
-- order_items ("items read") hereda la visibilidad de orders mediante EXISTS, sin cambios.

-- 3. Registro de pedidos: sales_production puede vender, siempre a su nombre.
DROP POLICY IF EXISTS "orders insert" ON public.orders;
CREATE POLICY "orders insert" ON public.orders FOR INSERT TO authenticated
WITH CHECK (
  (public.is_admin() OR public.has_role('seller') OR public.has_role('sales_production'))
  AND public.is_active_user()
  AND seller_id=(SELECT auth.uid())
);
DROP POLICY IF EXISTS "items insert" ON public.order_items;
CREATE POLICY "items insert" ON public.order_items FOR INSERT TO authenticated
WITH CHECK (
  (public.is_admin() OR public.has_role('seller') OR public.has_role('sales_production'))
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id=order_id AND o.seller_id=(SELECT auth.uid()))
);

-- 4. UPDATE directo sobre order_items: solo administradores.
--    Producción y Ventas y Producción usan la RPC del punto 5.
DROP POLICY IF EXISTS "items production update" ON public.order_items;
DROP POLICY IF EXISTS "items admin update" ON public.order_items;
CREATE POLICY "items admin update" ON public.order_items FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 5. RPC protegida: cambia únicamente el estado de un producto del pedido.
--    SECURITY DEFINER para no requerir UPDATE general; valida el rol explícitamente.
--    El trigger guard_order_item_update sigue activo como segunda barrera.
CREATE OR REPLACE FUNCTION public.set_order_item_status(p_item_id uuid, p_status public.production_status)
RETURNS public.production_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status public.production_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (
       public.is_admin() OR public.has_role('production') OR public.has_role('sales_production')
     ) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar estados de producción' USING ERRCODE='42501';
  END IF;
  IF p_status IS NULL THEN
    RAISE EXCEPTION 'Estado requerido' USING ERRCODE='22004';
  END IF;
  UPDATE public.order_items SET status=p_status WHERE id=p_item_id RETURNING status INTO v_status;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto del pedido no encontrado' USING ERRCODE='P0002';
  END IF;
  RETURN v_status;
END; $$;
REVOKE ALL ON FUNCTION public.set_order_item_status(uuid, public.production_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_order_item_status(uuid, public.production_status) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_order_item_status(uuid, public.production_status) TO authenticated;

COMMIT;

-- Verificación (ejecutar por separado después del COMMIT):
-- SELECT id, code, name FROM public.roles ORDER BY id;
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename IN ('orders','order_items') ORDER BY tablename, policyname;
-- SELECT has_function_privilege('anon','public.set_order_item_status(uuid, public.production_status)','execute');  -- debe ser false
