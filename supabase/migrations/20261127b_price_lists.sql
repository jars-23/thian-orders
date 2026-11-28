-- =====================================================================
-- 20261127b · Listas de precios mayoristas · FASE 1 (marcar vendedores)
-- - price_lists: listas (p. ej. «Mayorista A»), nombre único, activa.
-- - seller_price_lists: qué lista tiene cada vendedor (máximo una).
-- - Leen y cambian: solo el Administrador. Cada vendedor lee su propia
--   asignación y su lista (para la fase 2: ver sus precios en el catálogo).
-- - NO cambia precios: create_order / update_order siguen igual.
-- - No cambia ninguna tabla, RPC, política ni Edge Function existente.
-- MARCHA ATRÁS: 20261127b_price_lists_rollback.sql
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.price_lists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 60),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.seller_price_lists (
  seller_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES public.price_lists(id) ON DELETE RESTRICT,
  assigned_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  assigned_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_price_lists_list_idx ON public.seller_price_lists (price_list_id);

ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_price_lists ENABLE ROW LEVEL SECURITY;

-- price_lists: admin todo; el vendedor solo lee la lista que tiene asignada
CREATE POLICY "price_lists read" ON public.price_lists FOR SELECT TO authenticated
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM public.seller_price_lists s
     WHERE s.price_list_id = price_lists.id AND s.seller_id = (SELECT auth.uid())));
CREATE POLICY "price_lists admin insert" ON public.price_lists FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "price_lists admin update" ON public.price_lists FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE ON public.price_lists TO authenticated;

-- seller_price_lists: admin todo; el vendedor solo lee su fila
CREATE POLICY "seller_price_lists read" ON public.seller_price_lists FOR SELECT TO authenticated
  USING (public.is_admin() OR seller_id = (SELECT auth.uid()));
CREATE POLICY "seller_price_lists admin insert" ON public.seller_price_lists FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "seller_price_lists admin update" ON public.seller_price_lists FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "seller_price_lists admin delete" ON public.seller_price_lists FOR DELETE TO authenticated
  USING (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_price_lists TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verificación (solo lectura):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('price_lists','seller_price_lists') ORDER BY 1, 2;  -- 3 + 4 políticas
