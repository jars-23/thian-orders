-- =====================================================================
-- MARCHA ATRÁS de 20261126_suppliers.sql
-- Se pierde el proveedor asignado a cada producto (el resto no cambia).
-- La tabla backup_products_20261126 queda para consultar; borrarla al validar:
--   DROP TABLE public.backup_products_20261126;
-- =====================================================================
BEGIN;
DROP INDEX IF EXISTS public.products_supplier_idx;
ALTER TABLE public.products DROP COLUMN IF EXISTS supplier_id;
DROP TABLE IF EXISTS public.suppliers;
NOTIFY pgrst, 'reload schema';
COMMIT;
