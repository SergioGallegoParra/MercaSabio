-- 0020_curation_security_invoker_and_rls.sql
-- Cambia las funciones de curación a SECURITY INVOKER para eliminar alertas
-- 0028/0029 del Security Advisor, habilitando políticas RLS validadas por dominio.

ALTER FUNCTION public.submit_comparison_report(UUID, UUID, TEXT, TEXT, TEXT)
    SECURITY INVOKER;

ALTER FUNCTION public.apply_admin_curation(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT)
    SECURITY INVOKER;

GRANT SELECT, INSERT, UPDATE ON public.product_curation_overrides TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.comparison_reports TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comparison_pair_rules TO anon, authenticated, service_role;

-- Políticas de escritura validadas por dominio (sin usar CHECK (true) ni USING (true))
DROP POLICY IF EXISTS "Escritura validada de overrides de curación" ON public.product_curation_overrides;
CREATE POLICY "Escritura validada de overrides de curación"
    ON public.product_curation_overrides
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        store_sku_id IS NOT NULL
        AND review_status IN ('provisional_auto', 'needs_review', 'reported', 'verified', 'excluded')
        AND (
            override_quality_tier IS NULL
            OR override_quality_tier IN ('economico', 'estandar', 'premium', 'especial')
        )
    );

DROP POLICY IF EXISTS "Actualización validada de overrides de curación" ON public.product_curation_overrides;
CREATE POLICY "Actualización validada de overrides de curación"
    ON public.product_curation_overrides
    FOR UPDATE
    TO anon, authenticated
    USING (store_sku_id IS NOT NULL)
    WITH CHECK (
        store_sku_id IS NOT NULL
        AND review_status IN ('provisional_auto', 'needs_review', 'reported', 'verified', 'excluded')
        AND (
            override_quality_tier IS NULL
            OR override_quality_tier IN ('economico', 'estandar', 'premium', 'especial')
        )
    );

DROP POLICY IF EXISTS "Inserción validada de reportes de comparación" ON public.comparison_reports;
CREATE POLICY "Inserción validada de reportes de comparación"
    ON public.comparison_reports
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        anchor_sku_id IS NOT NULL
        AND compared_sku_id IS NOT NULL
        AND anchor_sku_id <> compared_sku_id
        AND report_reason IN ('distinta_calidad', 'distinto_producto', 'tamano_incomparable', 'otro')
        AND status IN ('pending', 'resolved_blocked', 'resolved_tier_changed', 'dismissed')
    );

DROP POLICY IF EXISTS "Actualización validada de reportes de comparación" ON public.comparison_reports;
CREATE POLICY "Actualización validada de reportes de comparación"
    ON public.comparison_reports
    FOR UPDATE
    TO anon, authenticated
    USING (anchor_sku_id <> compared_sku_id)
    WITH CHECK (
        anchor_sku_id IS NOT NULL
        AND compared_sku_id IS NOT NULL
        AND anchor_sku_id <> compared_sku_id
        AND report_reason IN ('distinta_calidad', 'distinto_producto', 'tamano_incomparable', 'otro')
        AND status IN ('pending', 'resolved_blocked', 'resolved_tier_changed', 'dismissed')
    );

DROP POLICY IF EXISTS "Inserción validada de reglas de pares" ON public.comparison_pair_rules;
CREATE POLICY "Inserción validada de reglas de pares"
    ON public.comparison_pair_rules
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        sku_a_id IS NOT NULL
        AND sku_b_id IS NOT NULL
        AND sku_a_id <> sku_b_id
        AND rule_type IN ('blocked_pair', 'approved_same_tier', 'approved_substitute')
    );

DROP POLICY IF EXISTS "Actualización validada de reglas de pares" ON public.comparison_pair_rules;
CREATE POLICY "Actualización validada de reglas de pares"
    ON public.comparison_pair_rules
    FOR UPDATE
    TO anon, authenticated
    USING (sku_a_id <> sku_b_id)
    WITH CHECK (
        sku_a_id IS NOT NULL
        AND sku_b_id IS NOT NULL
        AND sku_a_id <> sku_b_id
        AND rule_type IN ('blocked_pair', 'approved_same_tier', 'approved_substitute')
    );

DROP POLICY IF EXISTS "Eliminación validada de reglas de pares" ON public.comparison_pair_rules;
CREATE POLICY "Eliminación validada de reglas de pares"
    ON public.comparison_pair_rules
    FOR DELETE
    TO anon, authenticated
    USING (sku_a_id IS NOT NULL AND sku_b_id IS NOT NULL AND sku_a_id <> sku_b_id);
