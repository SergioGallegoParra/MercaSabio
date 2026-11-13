-- 0019_curation_quality_and_admin_review.sql
-- Tablas y RPCs seguras para clasificación de calidad (gama), detección de dudas,
-- reportes ciudadanos de comparación injusta y curación visual en /admin.

CREATE TABLE IF NOT EXISTS public.product_curation_overrides (
    store_sku_id UUID PRIMARY KEY REFERENCES public.store_skus(id) ON DELETE CASCADE,
    master_product_id UUID REFERENCES public.master_products(id) ON DELETE SET NULL,
    override_subtype VARCHAR(80),
    override_broad_family VARCHAR(80),
    override_quality_tier VARCHAR(30) CHECK (
        override_quality_tier IS NULL
        OR override_quality_tier IN ('economico', 'estandar', 'premium', 'especial')
    ),
    review_status VARCHAR(30) NOT NULL DEFAULT 'verified' CHECK (
        review_status IN ('provisional_auto', 'needs_review', 'reported', 'verified', 'excluded')
    ),
    doubt_reason TEXT,
    admin_notes VARCHAR(300),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_curation_status
    ON public.product_curation_overrides (review_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.comparison_pair_rules (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sku_a_id UUID NOT NULL REFERENCES public.store_skus(id) ON DELETE CASCADE,
    sku_b_id UUID NOT NULL REFERENCES public.store_skus(id) ON DELETE CASCADE,
    rule_type VARCHAR(30) NOT NULL CHECK (
        rule_type IN ('blocked_pair', 'approved_same_tier', 'approved_substitute')
    ),
    reason VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sku_a_id, sku_b_id)
);

CREATE INDEX IF NOT EXISTS idx_comparison_pair_rules_type
    ON public.comparison_pair_rules (rule_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.comparison_reports (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    anchor_sku_id UUID NOT NULL REFERENCES public.store_skus(id) ON DELETE CASCADE,
    compared_sku_id UUID NOT NULL REFERENCES public.store_skus(id) ON DELETE CASCADE,
    report_reason VARCHAR(60) NOT NULL CHECK (
        report_reason IN ('distinta_calidad', 'distinto_producto', 'tamano_incomparable', 'otro')
    ),
    match_tier VARCHAR(30) NOT NULL DEFAULT 'direct',
    comment VARCHAR(250),
    report_count INT NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'resolved_blocked', 'resolved_tier_changed', 'dismissed')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (anchor_sku_id, compared_sku_id)
);

CREATE INDEX IF NOT EXISTS idx_comparison_reports_status
    ON public.comparison_reports (status, report_count DESC, updated_at DESC);

-- Seguridad RLS: lectura pública; escritura controlada exclusivamente vía RPCs SECURITY DEFINER
ALTER TABLE public.product_curation_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_pair_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de overrides de curación" ON public.product_curation_overrides;
CREATE POLICY "Lectura pública de overrides de curación"
    ON public.product_curation_overrides FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de reglas de pares" ON public.comparison_pair_rules;
CREATE POLICY "Lectura pública de reglas de pares"
    ON public.comparison_pair_rules FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de reportes de comparación" ON public.comparison_reports;
CREATE POLICY "Lectura pública de reportes de comparación"
    ON public.comparison_reports FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.submit_comparison_report(
    p_anchor_sku_id UUID,
    p_compared_sku_id UUID,
    p_reason TEXT,
    p_match_tier TEXT DEFAULT 'direct',
    p_comment TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_reason TEXT := left(lower(btrim(COALESCE(p_reason, 'otro'))), 60);
    v_tier TEXT := left(lower(btrim(COALESCE(p_match_tier, 'direct'))), 30);
    v_comment TEXT := NULLIF(left(btrim(COALESCE(p_comment, '')), 250), '');
    v_report_id UUID;
    v_anchor_mp UUID;
    v_compared_mp UUID;
BEGIN
    IF p_anchor_sku_id IS NULL OR p_compared_sku_id IS NULL OR p_anchor_sku_id = p_compared_sku_id THEN
        RAISE EXCEPTION 'Se requieren dos SKUs distintos para registrar el reporte';
    END IF;

    IF v_reason NOT IN ('distinta_calidad', 'distinto_producto', 'tamano_incomparable', 'otro') THEN
        v_reason := 'otro';
    END IF;

    IF v_tier NOT IN ('direct', 'similar', 'bulk', 'offer') THEN
        v_tier := 'direct';
    END IF;

    SELECT master_product_id INTO v_anchor_mp FROM public.store_skus WHERE id = p_anchor_sku_id;
    SELECT master_product_id INTO v_compared_mp FROM public.store_skus WHERE id = p_compared_sku_id;

    IF NOT FOUND OR v_anchor_mp IS NULL AND NOT EXISTS (SELECT 1 FROM public.store_skus WHERE id = p_anchor_sku_id) THEN
        RAISE EXCEPTION 'SKU ancla o comparado inexistente';
    END IF;

    INSERT INTO public.comparison_reports (
        anchor_sku_id,
        compared_sku_id,
        report_reason,
        match_tier,
        comment,
        report_count,
        status,
        updated_at
    )
    VALUES (
        p_anchor_sku_id,
        p_compared_sku_id,
        v_reason,
        v_tier,
        v_comment,
        1,
        'pending',
        NOW()
    )
    ON CONFLICT (anchor_sku_id, compared_sku_id) DO UPDATE SET
        report_reason = EXCLUDED.report_reason,
        match_tier = EXCLUDED.match_tier,
        comment = COALESCE(EXCLUDED.comment, public.comparison_reports.comment),
        report_count = public.comparison_reports.report_count + 1,
        status = 'pending',
        updated_at = NOW()
    RETURNING id INTO v_report_id;

    -- Marca ambos SKUs para revisión si aún no han sido verificados manualmente
    INSERT INTO public.product_curation_overrides (
        store_sku_id,
        master_product_id,
        review_status,
        doubt_reason,
        updated_at
    )
    VALUES
        (p_anchor_sku_id, v_anchor_mp, 'reported', 'Reportado por usuario: ' || v_reason, NOW()),
        (p_compared_sku_id, v_compared_mp, 'reported', 'Reportado por usuario: ' || v_reason, NOW())
    ON CONFLICT (store_sku_id) DO UPDATE SET
        review_status = CASE
            WHEN public.product_curation_overrides.review_status = 'verified' THEN 'verified'
            ELSE 'reported'
        END,
        doubt_reason = COALESCE(public.product_curation_overrides.doubt_reason, EXCLUDED.doubt_reason),
        updated_at = NOW();

    RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_admin_curation(
    p_action TEXT,
    p_store_sku_id UUID DEFAULT NULL,
    p_second_sku_id UUID DEFAULT NULL,
    p_quality_tier TEXT DEFAULT NULL,
    p_subtype TEXT DEFAULT NULL,
    p_broad_family TEXT DEFAULT NULL,
    p_rule_type TEXT DEFAULT NULL,
    p_report_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_action TEXT := lower(btrim(COALESCE(p_action, '')));
    v_quality_tier TEXT := NULLIF(lower(btrim(COALESCE(p_quality_tier, ''))), '');
    v_subtype TEXT := NULLIF(left(lower(btrim(COALESCE(p_subtype, ''))), 80), '');
    v_broad TEXT := NULLIF(left(lower(btrim(COALESCE(p_broad_family, ''))), 80), '');
    v_rule_type TEXT := NULLIF(lower(btrim(COALESCE(p_rule_type, ''))), '');
    v_notes TEXT := NULLIF(left(btrim(COALESCE(p_notes, '')), 300), '');
    v_mp_id UUID;
    v_sku_a UUID;
    v_sku_b UUID;
BEGIN
    IF v_quality_tier IS NOT NULL AND v_quality_tier NOT IN ('economico', 'estandar', 'premium', 'especial') THEN
        RAISE EXCEPTION 'Gama de calidad inválida: %', v_quality_tier;
    END IF;

    IF v_action = 'set_product_curation' THEN
        IF p_store_sku_id IS NULL THEN
            RAISE EXCEPTION 'p_store_sku_id es obligatorio para set_product_curation';
        END IF;

        SELECT master_product_id INTO v_mp_id
        FROM public.store_skus
        WHERE id = p_store_sku_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'store_sku_id no encontrado';
        END IF;

        INSERT INTO public.product_curation_overrides (
            store_sku_id,
            master_product_id,
            override_subtype,
            override_broad_family,
            override_quality_tier,
            review_status,
            doubt_reason,
            admin_notes,
            updated_at
        )
        VALUES (
            p_store_sku_id,
            v_mp_id,
            v_subtype,
            v_broad,
            v_quality_tier,
            'verified',
            NULL,
            v_notes,
            NOW()
        )
        ON CONFLICT (store_sku_id) DO UPDATE SET
            master_product_id = COALESCE(EXCLUDED.master_product_id, public.product_curation_overrides.master_product_id),
            override_subtype = COALESCE(EXCLUDED.override_subtype, public.product_curation_overrides.override_subtype),
            override_broad_family = COALESCE(EXCLUDED.override_broad_family, public.product_curation_overrides.override_broad_family),
            override_quality_tier = COALESCE(EXCLUDED.override_quality_tier, public.product_curation_overrides.override_quality_tier),
            review_status = 'verified',
            doubt_reason = NULL,
            admin_notes = COALESCE(EXCLUDED.admin_notes, public.product_curation_overrides.admin_notes),
            updated_at = NOW();

        IF p_report_id IS NOT NULL THEN
            UPDATE public.comparison_reports
            SET status = 'resolved_tier_changed', updated_at = NOW()
            WHERE id = p_report_id;
        END IF;

        RETURN jsonb_build_object(
            'ok', TRUE,
            'action', v_action,
            'store_sku_id', p_store_sku_id,
            'quality_tier', v_quality_tier,
            'subtype', v_subtype
        );

    ELSIF v_action = 'exclude_sku' THEN
        IF p_store_sku_id IS NULL THEN
            RAISE EXCEPTION 'p_store_sku_id es obligatorio para exclude_sku';
        END IF;

        SELECT master_product_id INTO v_mp_id FROM public.store_skus WHERE id = p_store_sku_id;

        INSERT INTO public.product_curation_overrides (
            store_sku_id, master_product_id, review_status, doubt_reason, admin_notes, updated_at
        )
        VALUES (
            p_store_sku_id, v_mp_id, 'excluded', NULL, v_notes, NOW()
        )
        ON CONFLICT (store_sku_id) DO UPDATE SET
            review_status = 'excluded',
            doubt_reason = NULL,
            admin_notes = COALESCE(EXCLUDED.admin_notes, public.product_curation_overrides.admin_notes),
            updated_at = NOW();

        RETURN jsonb_build_object('ok', TRUE, 'action', v_action, 'store_sku_id', p_store_sku_id);

    ELSIF v_action = 'set_pair_rule' THEN
        IF p_store_sku_id IS NULL OR p_second_sku_id IS NULL OR p_store_sku_id = p_second_sku_id THEN
            RAISE EXCEPTION 'Se requieren dos SKUs distintos para set_pair_rule';
        END IF;

        IF v_rule_type IS NULL OR v_rule_type NOT IN ('blocked_pair', 'approved_same_tier', 'approved_substitute') THEN
            RAISE EXCEPTION 'rule_type inválido: %', v_rule_type;
        END IF;

        v_sku_a := LEAST(p_store_sku_id, p_second_sku_id);
        v_sku_b := GREATEST(p_store_sku_id, p_second_sku_id);

        INSERT INTO public.comparison_pair_rules (sku_a_id, sku_b_id, rule_type, reason)
        VALUES (v_sku_a, v_sku_b, v_rule_type, left(COALESCE(v_notes, v_rule_type), 200))
        ON CONFLICT (sku_a_id, sku_b_id) DO UPDATE SET
            rule_type = EXCLUDED.rule_type,
            reason = EXCLUDED.reason,
            created_at = NOW();

        IF p_report_id IS NOT NULL THEN
            UPDATE public.comparison_reports
            SET
                status = CASE WHEN v_rule_type = 'blocked_pair' THEN 'resolved_blocked' ELSE 'dismissed' END,
                updated_at = NOW()
            WHERE id = p_report_id;
        END IF;

        RETURN jsonb_build_object(
            'ok', TRUE,
            'action', v_action,
            'sku_a_id', v_sku_a,
            'sku_b_id', v_sku_b,
            'rule_type', v_rule_type
        );

    ELSIF v_action = 'remove_pair_rule' THEN
        IF p_store_sku_id IS NULL OR p_second_sku_id IS NULL THEN
            RAISE EXCEPTION 'Se requieren ambos SKUs para remove_pair_rule';
        END IF;
        v_sku_a := LEAST(p_store_sku_id, p_second_sku_id);
        v_sku_b := GREATEST(p_store_sku_id, p_second_sku_id);

        DELETE FROM public.comparison_pair_rules
        WHERE (sku_a_id = v_sku_a AND sku_b_id = v_sku_b)
           OR (sku_a_id = p_store_sku_id AND sku_b_id = p_second_sku_id);

        RETURN jsonb_build_object('ok', TRUE, 'action', v_action);

    ELSIF v_action IN ('dismiss_report', 'resolve_report') THEN
        IF p_report_id IS NULL THEN
            RAISE EXCEPTION 'p_report_id es obligatorio';
        END IF;

        UPDATE public.comparison_reports
        SET
            status = CASE WHEN v_action = 'dismiss_report' THEN 'dismissed' ELSE 'resolved_tier_changed' END,
            updated_at = NOW()
        WHERE id = p_report_id;

        RETURN jsonb_build_object('ok', TRUE, 'action', v_action, 'report_id', p_report_id);
    ELSE
        RAISE EXCEPTION 'Acción de curación desconocida: %', v_action;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_comparison_report(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_comparison_report(UUID, UUID, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.apply_admin_curation(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_admin_curation(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO anon, authenticated, service_role;
