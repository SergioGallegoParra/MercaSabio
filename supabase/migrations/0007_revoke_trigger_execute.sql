-- 0007_revoke_trigger_execute.sql
-- Revoca EXECUTE directo sobre la función de trigger para limpiar las alertas
-- de SECURITY DEFINER en el API público (el trigger sigue operando normalmente).

REVOKE ALL ON FUNCTION public.update_product_review_stats() FROM PUBLIC, anon, authenticated;
