-- =====================================================================
-- 20261126 · Costos de Mora Factory (carga de datos)
-- Fuente: Excel del usuario productos_mora_factory.xlsx (columna "Costo (Mora)").
-- Vigencia: desde 2026-11-01 00:00 hora Colombia, para que cuenten las
-- facturas de noviembre en la Liquidación.
-- created_by: el Administrador más antiguo (en el SQL Editor auth.uid() es nulo).
-- Se detiene sin cambiar nada si alguna referencia no existe o no es de Mora.
-- Repetirlo no duplica (salta filas con el mismo producto y vigencia).
-- MARCHA ATRÁS: 20261126_mora_factory_costs_rollback.sql
-- =====================================================================
BEGIN;

CREATE TEMP TABLE _mora_costs (sku text PRIMARY KEY, cost integer NOT NULL) ON COMMIT DROP;
INSERT INTO _mora_costs (sku, cost) VALUES
  ('NAV26-20', 14500), ('NAV26-21', 14500), ('NAV26-22', 14500), ('NAV26-23', 14500),
  ('NAV26-28', 13500), ('NAV26-16',  9000), ('NAV26-18', 12500), ('NAV26-15',  9000),
  ('NAV26-19', 12500), ('NAV26-17', 12500), ('NAV26-26',  9000), ('NAV26-25',  9000),
  ('NAV26-24', 11500);

DO $$
DECLARE v_ok integer;
BEGIN
  SELECT count(*) INTO v_ok
    FROM _mora_costs m
    JOIN public.products p ON p.sku = m.sku
    JOIN public.suppliers s ON s.id = p.supplier_id AND s.name = 'Mora Factory';
  IF v_ok <> 13 THEN
    RAISE EXCEPTION 'Solo % de 13 referencias existen y son de Mora Factory: revisar', v_ok;
  END IF;
END $$;

INSERT INTO public.product_costs (product_id, cost, valid_from, created_by)
SELECT p.id, m.cost, timestamptz '2026-11-01 00:00:00-05',
       (SELECT ur.user_id FROM public.user_roles ur
          JOIN public.roles r ON r.id = ur.role_id AND r.code = 'admin'
         ORDER BY ur.created_at LIMIT 1)
  FROM _mora_costs m
  JOIN public.products p ON p.sku = m.sku
 WHERE NOT EXISTS (SELECT 1 FROM public.product_costs c
                    WHERE c.product_id = p.id
                      AND c.valid_from = timestamptz '2026-11-01 00:00:00-05');

COMMIT;

-- Verificación (solo lectura):
-- SELECT p.sku, c.cost, c.valid_from FROM public.product_costs c
--   JOIN public.products p ON p.id = c.product_id ORDER BY p.sku;
