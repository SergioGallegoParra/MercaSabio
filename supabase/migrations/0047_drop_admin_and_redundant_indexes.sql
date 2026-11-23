-- Elimina vista materializada e infraestructura exclusiva de Admin en Supabase
-- (el panel /admin pasa a ser 100% local sobre SQLite) y borra índices Trigram redundantes
-- para mantener la base holgadamente por debajo del límite gratuito de 500 MB.

DROP INDEX IF EXISTS public.idx_master_products_norm_name_trgm;
DROP INDEX IF EXISTS public.idx_store_skus_display_name_trgm;

DROP MATERIALIZED VIEW IF EXISTS public.mv_admin_store_catalog CASCADE;

DROP FUNCTION IF EXISTS public.admin_browse_store_catalog(text, text, text, text, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.admin_store_inventory_summary();
DROP FUNCTION IF EXISTS public.apply_admin_curation(text, uuid, uuid, text, text, text, text, uuid, text);

DROP TABLE IF EXISTS public.admin_review_queue CASCADE;
