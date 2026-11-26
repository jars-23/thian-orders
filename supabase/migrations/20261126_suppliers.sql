-- =====================================================================
-- 20261126 · Proveedor del producto
-- - Tabla nueva suppliers (nombre único, activo).
-- - products.supplier_id (opcional): los productos actuales quedan
--   "Sin proveedor" hasta que el Administrador lo asigne.
-- - Leen los usuarios activos; solo el Administrador crea/modifica.
-- - No cambia ninguna RPC ni Edge Function.
-- MARCHA ATRÁS: 20261126_suppliers_rollback.sql
-- =====================================================================
BEGIN;

-- Respaldo (RLS activo y sin acceso para la API)
CREATE TABLE IF NOT EXISTS public.backup_products_20261126 AS TABLE public.products;
ALTER TABLE public.backup_products_20261126 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_products_20261126 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers read" ON public.suppliers FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY "suppliers admin insert" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "suppliers admin update" ON public.suppliers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS products_supplier_idx ON public.products (supplier_id);

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verificación (solo lectura):
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'supplier_id';
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.suppliers'::regclass;
-- SELECT count(*) FROM pg_policies WHERE tablename = 'suppliers';   -- 3
