-- =====================================================================
-- 20261126 · Costo de los productos (liquidación de proveedores)
-- - Tabla nueva product_costs: historial de costos por producto.
--   Cambiar un costo = fila nueva (no se sobrescribe). La liquidación usa
--   el costo vigente en la fecha de la factura.
-- - Solo el Administrador lee y escribe (los vendedores no ven costos).
-- - suppliers.own: proveedor propio (se marca Thian Factory por nombre).
-- - No cambia ninguna RPC ni Edge Function.
-- MARCHA ATRÁS: 20261126_product_costs_rollback.sql
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.product_costs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  cost       integer NOT NULL CHECK (cost >= 0),          -- COP por unidad
  valid_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_costs_product_idx
  ON public.product_costs (product_id, valid_from DESC);
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_costs admin read" ON public.product_costs FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "product_costs admin insert" ON public.product_costs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND created_by = (SELECT auth.uid()));
GRANT SELECT, INSERT ON public.product_costs TO authenticated;

-- Proveedor propio (producción de Thian): no se le paga a terceros.
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS own boolean NOT NULL DEFAULT false;
UPDATE public.suppliers SET own = true WHERE name ILIKE 'thian%';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verificación (solo lectura):
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_costs'::regclass;
-- SELECT count(*) FROM pg_policies WHERE tablename = 'product_costs';   -- 2
