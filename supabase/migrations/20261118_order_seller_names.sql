-- =====================================================================
-- Migración 2026-11-18 — Nombre del vendedor visible para producción
-- Ejecutar UNA vez en SQL Editor sobre una base instalada con setup.sql.
-- (setup.sql ya la incluye para instalaciones nuevas.)
--
-- Problema: la política "profiles read" solo deja leer el propio perfil o,
-- si eres admin, todos. Producción, ventas y producción, facturación y
-- supervisor veían el vendedor del pedido como "—".
--
-- Solución: función de solo lectura que entrega ÚNICAMENTE (id, full_name)
-- de los vendedores de pedidos que el usuario ya puede ver. La tabla
-- profiles y su RLS no cambian: username, estado y roles siguen ocultos.
-- =====================================================================
BEGIN;

-- La condición de pedidos replica la política "orders read".
-- Si esa política cambia, actualizar también esta función.
CREATE OR REPLACE FUNCTION public.order_seller_names()
RETURNS TABLE (seller_id uuid, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.full_name
    FROM public.profiles p
   WHERE public.is_active_user()
     AND EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.seller_id = p.id
          AND (public.is_admin()
               OR public.has_role('production') OR public.has_role('sales_production')
               OR public.has_role('billing')    OR public.has_role('supervisor')
               OR (public.has_role('seller') AND o.seller_id = (SELECT auth.uid())))
     );
$$;

REVOKE ALL ON FUNCTION public.order_seller_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_seller_names() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación (debe devolver 1 fila con prosecdef = true):
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'order_seller_names';
