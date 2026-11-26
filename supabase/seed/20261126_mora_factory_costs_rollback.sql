-- MARCHA ATRÁS de 20261126_mora_factory_costs.sql: borra solo esas 13 filas.
BEGIN;
DELETE FROM public.product_costs c
 USING public.products p
 WHERE p.id = c.product_id
   AND c.valid_from = timestamptz '2026-11-01 00:00:00-05'
   AND p.sku IN ('NAV26-20','NAV26-21','NAV26-22','NAV26-23','NAV26-28','NAV26-16','NAV26-18',
                 'NAV26-15','NAV26-19','NAV26-17','NAV26-26','NAV26-25','NAV26-24');
COMMIT;
