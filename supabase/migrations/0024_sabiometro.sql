-- 0024_sabiometro.sql
-- Sabiómetro (Índice de Valor Real): voto ponderado por reputación + frescura temporal,
-- límite inferior de Wilson (z = 1.645), factor de rechazo grave y circuit breaker anti-brigading.
-- Nota: purchase_verifications (Nivel 2 QR DIAN) queda CREADO pero marcado como pendiente de activación.

CREATE TABLE IF NOT EXISTS public.purchase_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    cufe VARCHAR(120) NOT NULL UNIQUE,
    issuer_nit VARCHAR(20),
    store_id VARCHAR(30) REFERENCES public.stores(id) ON DELETE SET NULL,
    invoice_total NUMERIC(14,2),
    issued_at TIMESTAMPTZ,
    verified_master_product_ids UUID[] NOT NULL DEFAULT '{}',
    verification_method VARCHAR(20) NOT NULL CHECK (verification_method IN ('qr_dian', 'xml_upload', 'ocr_receipt', 'manual_admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'module_pending' CHECK (status IN ('pending', 'verified', 'rejected', 'module_pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    master_product_id UUID NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
    satisfaction NUMERIC(3,2) NOT NULL CHECK (satisfaction IN (1.00, 0.75, 0.25, 0.00)),
    yield_factor NUMERIC(3,2) NOT NULL CHECK (yield_factor IN (0.50, 1.00, 1.50)),
    comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 500),
    verified_purchase_id UUID REFERENCES public.purchase_verifications(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, master_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_votes_master_updated
    ON public.product_votes (master_product_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.user_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('price_report', 'comparison_report', 'photo', 'review_helpful', 'plant_evidence')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reference_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.sabiometro_scores (
    master_product_id UUID PRIMARY KEY REFERENCES public.master_products(id) ON DELETE CASCADE,
    vote_mass NUMERIC(10,4) NOT NULL DEFAULT 0,
    p_hat NUMERIC(6,5),
    r_bad NUMERIC(6,5),
    f_yield NUMERIC(6,5),
    wilson_lower NUMERIC(6,5),
    value_index NUMERIC(5,2),
    status VARCHAR(30) NOT NULL DEFAULT 'insufficient' CHECK (status IN ('insufficient', 'published', 'under_review')),
    consensus_label VARCHAR(30),
    support_label VARCHAR(30),
    votes_count INT NOT NULL DEFAULT 0,
    under_review BOOLEAN NOT NULL DEFAULT FALSE,
    frozen_at TIMESTAMPTZ,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_kind VARCHAR(30) NOT NULL CHECK (entity_kind IN ('sabiometro_spike', 'plant_evidence', 'verification')),
    reference_id UUID NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Nivel de reputación actual (Nivel 0 vs Nivel 1); el nivel se evalúa al calcular para promover votos previos
CREATE OR REPLACE FUNCTION public.workspace_reputation_level(p_workspace_id UUID)
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_created TIMESTAMPTZ;
    v_phone TIMESTAMPTZ;
    v_email TIMESTAMPTZ;
    v_approved INT := 0;
BEGIN
    SELECT w.created_at, up.phone_verified_at, up.email_verified_at
    INTO v_created, v_phone, v_email
    FROM public.sync_workspaces w
    LEFT JOIN public.user_profiles up ON up.workspace_id = w.id
    WHERE w.id = p_workspace_id;

    IF v_created IS NULL THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*) INTO v_approved
    FROM public.user_contributions uc
    WHERE uc.workspace_id = p_workspace_id AND uc.status = 'approved';

    IF (NOW() - v_created > INTERVAL '15 days')
       AND (v_phone IS NOT NULL OR v_email IS NOT NULL)
       AND v_approved >= 2 THEN
        RETURN 1;
    END IF;

    RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_reputation_level(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_reputation_level(UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vote_effective_weight(
    p_workspace_id UUID,
    p_master_product_id UUID,
    p_verified_purchase_id UUID,
    p_updated_at TIMESTAMPTZ
)
RETURNS NUMERIC(8,4)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_base NUMERIC(6,2) := 0.05;
    v_fresh NUMERIC(4,2);
    v_verified_ok BOOLEAN := FALSE;
BEGIN
    IF p_verified_purchase_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.purchase_verifications pv
            WHERE pv.id = p_verified_purchase_id
              AND pv.status = 'verified'
              AND p_master_product_id = ANY(pv.verified_master_product_ids)
        ) INTO v_verified_ok;
    END IF;

    IF v_verified_ok THEN
        v_base := 3.00;
    ELSIF public.workspace_reputation_level(p_workspace_id) = 1 THEN
        v_base := 1.00;
    ELSE
        v_base := 0.05;
    END IF;

    v_fresh := CASE WHEN (NOW() - COALESCE(p_updated_at, NOW())) <= INTERVAL '365 days' THEN 1.00 ELSE 0.50 END;
    RETURN v_base * v_fresh;
END;
$$;

REVOKE ALL ON FUNCTION public.vote_effective_weight(UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vote_effective_weight(UUID, UUID, UUID, TIMESTAMPTZ) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_vote_velocity(p_master_product_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_votes_24h INT := 0;
    v_votes_prev_30d INT := 0;
    v_avg_daily NUMERIC := 0;
    v_threshold NUMERIC := 10;
BEGIN
    SELECT COUNT(*) INTO v_votes_24h
    FROM public.product_votes
    WHERE master_product_id = p_master_product_id
      AND updated_at > NOW() - INTERVAL '24 hours';

    SELECT COUNT(*) INTO v_votes_prev_30d
    FROM public.product_votes
    WHERE master_product_id = p_master_product_id
      AND updated_at <= NOW() - INTERVAL '24 hours'
      AND updated_at > NOW() - INTERVAL '31 days';

    v_avg_daily := v_votes_prev_30d::NUMERIC / 30.0;
    v_threshold := GREATEST(10.0, 5.0 * v_avg_daily);

    IF v_votes_24h > v_threshold THEN
        IF NOT COALESCE((SELECT under_review FROM public.sabiometro_scores WHERE master_product_id = p_master_product_id), FALSE) THEN
            INSERT INTO public.admin_review_queue (entity_kind, reference_id, reason)
            VALUES (
                'sabiometro_spike',
                p_master_product_id,
                format('Freno anti-brigading activado: %s votos en 24h (umbral %s)', v_votes_24h, ROUND(v_threshold, 1))
            );
        END IF;

        INSERT INTO public.sabiometro_scores (master_product_id, status, under_review, frozen_at, computed_at)
        VALUES (p_master_product_id, 'under_review', TRUE, NOW(), NOW())
        ON CONFLICT (master_product_id) DO UPDATE
        SET status = 'under_review',
            under_review = TRUE,
            frozen_at = COALESCE(public.sabiometro_scores.frozen_at, NOW()),
            computed_at = NOW();

        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.check_vote_velocity(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recompute_sabiometro(p_master_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_frozen BOOLEAN := FALSE;
    v_z CONSTANT DOUBLE PRECISION := 1.645;
    v_w DOUBLE PRECISION := 0;
    v_w_sat DOUBLE PRECISION := 0;
    v_w_bad DOUBLE PRECISION := 0;
    v_w_yield DOUBLE PRECISION := 0;
    v_count INT := 0;
    v_p DOUBLE PRECISION;
    v_r_bad DOUBLE PRECISION;
    v_f_yield DOUBLE PRECISION;
    v_rad DOUBLE PRECISION;
    v_wilson DOUBLE PRECISION;
    v_index DOUBLE PRECISION;
    v_consensus VARCHAR(30);
    v_support VARCHAR(30);
    r RECORD;
    v_wi DOUBLE PRECISION;
BEGIN
    SELECT under_review INTO v_frozen
    FROM public.sabiometro_scores
    WHERE master_product_id = p_master_product_id;

    IF COALESCE(v_frozen, FALSE) THEN
        RETURN;
    END IF;

    FOR r IN
        SELECT workspace_id, master_product_id, verified_purchase_id, updated_at, satisfaction, yield_factor
        FROM public.product_votes
        WHERE master_product_id = p_master_product_id
    LOOP
        v_wi := public.vote_effective_weight(r.workspace_id, r.master_product_id, r.verified_purchase_id, r.updated_at)::DOUBLE PRECISION;
        v_count := v_count + 1;
        v_w := v_w + v_wi;
        v_w_sat := v_w_sat + v_wi * r.satisfaction::DOUBLE PRECISION;
        IF r.satisfaction = 0.00 THEN
            v_w_bad := v_w_bad + v_wi;
        END IF;
        v_w_yield := v_w_yield + v_wi * r.yield_factor::DOUBLE PRECISION;
    END LOOP;

    IF v_w < 1.0 THEN
        INSERT INTO public.sabiometro_scores (
            master_product_id, vote_mass, p_hat, r_bad, f_yield, wilson_lower, value_index,
            status, consensus_label, support_label, votes_count, under_review, computed_at
        )
        VALUES (
            p_master_product_id, ROUND(v_w::NUMERIC, 4), NULL, NULL,
            CASE WHEN v_w > 0 THEN ROUND((v_w_yield / v_w)::NUMERIC, 5) ELSE NULL END,
            NULL, NULL, 'insufficient', 'Sin calificación suficiente', NULL, v_count, FALSE, NOW()
        )
        ON CONFLICT (master_product_id) DO UPDATE
        SET vote_mass = EXCLUDED.vote_mass,
            p_hat = NULL,
            r_bad = NULL,
            f_yield = EXCLUDED.f_yield,
            wilson_lower = NULL,
            value_index = NULL,
            status = 'insufficient',
            consensus_label = 'Sin calificación suficiente',
            support_label = NULL,
            votes_count = EXCLUDED.votes_count,
            computed_at = NOW();
        RETURN;
    END IF;

    v_p := v_w_sat / v_w;
    v_r_bad := v_w_bad / v_w;
    v_f_yield := v_w_yield / v_w;

    v_rad := GREATEST(0.0, (v_p * (1.0 - v_p) + ((v_z * v_z) / (4.0 * v_w))) / v_w);
    v_wilson := (v_p + ((v_z * v_z) / (2.0 * v_w)) - v_z * SQRT(v_rad)) / (1.0 + ((v_z * v_z) / v_w));
    v_wilson := LEAST(1.0, GREATEST(0.0, v_wilson));
    v_index := LEAST(100.0, GREATEST(0.0, 100.0 * v_wilson * (1.0 - 0.6 * v_r_bad)));

    v_consensus := CASE
        WHEN v_r_bad < 0.05 THEN 'Compra segura'
        WHEN v_r_bad < 0.15 THEN 'Consenso moderado'
        ELSE 'Opiniones divididas'
    END;

    v_support := CASE
        WHEN v_w < 10.0 THEN 'Pocas reseñas'
        WHEN v_w < 50.0 THEN 'Respaldado'
        ELSE 'Ampliamente probado'
    END;

    INSERT INTO public.sabiometro_scores (
        master_product_id, vote_mass, p_hat, r_bad, f_yield, wilson_lower, value_index,
        status, consensus_label, support_label, votes_count, under_review, computed_at
    )
    VALUES (
        p_master_product_id,
        ROUND(v_w::NUMERIC, 4),
        ROUND(v_p::NUMERIC, 5),
        ROUND(v_r_bad::NUMERIC, 5),
        ROUND(v_f_yield::NUMERIC, 5),
        ROUND(v_wilson::NUMERIC, 5),
        ROUND(v_index::NUMERIC, 2),
        'published',
        v_consensus,
        v_support,
        v_count,
        FALSE,
        NOW()
    )
    ON CONFLICT (master_product_id) DO UPDATE
    SET vote_mass = EXCLUDED.vote_mass,
        p_hat = EXCLUDED.p_hat,
        r_bad = EXCLUDED.r_bad,
        f_yield = EXCLUDED.f_yield,
        wilson_lower = EXCLUDED.wilson_lower,
        value_index = EXCLUDED.value_index,
        status = 'published',
        consensus_label = EXCLUDED.consensus_label,
        support_label = EXCLUDED.support_label,
        votes_count = EXCLUDED.votes_count,
        computed_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_sabiometro(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.on_product_vote_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_target UUID := COALESCE(NEW.master_product_id, OLD.master_product_id);
BEGIN
    PERFORM public.check_vote_velocity(v_target);
    PERFORM public.recompute_sabiometro(v_target);
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.on_product_vote_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_product_votes_sabiometro ON public.product_votes;
CREATE TRIGGER trg_product_votes_sabiometro
    AFTER INSERT OR UPDATE OR DELETE ON public.product_votes
    FOR EACH ROW EXECUTE FUNCTION public.on_product_vote_changed();

-- RLS estricta en tablas nuevas
ALTER TABLE public.purchase_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sabiometro_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de puntajes Sabiómetro" ON public.sabiometro_scores;
CREATE POLICY "Lectura pública de puntajes Sabiómetro"
    ON public.sabiometro_scores FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Propietario autenticado gestiona sus votos" ON public.product_votes;
CREATE POLICY "Propietario autenticado gestiona sus votos"
    ON public.product_votes FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Propietario autenticado lee sus verificaciones" ON public.purchase_verifications;
CREATE POLICY "Propietario autenticado lee sus verificaciones"
    ON public.purchase_verifications FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Propietario autenticado lee sus aportes" ON public.user_contributions;
CREATE POLICY "Propietario autenticado lee sus aportes"
    ON public.user_contributions FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Solo servicio accede a cola admin" ON public.admin_review_queue;
CREATE POLICY "Solo servicio accede a cola admin"
    ON public.admin_review_queue FOR SELECT TO service_role USING (true);

-- RPC pública para enviar voto sin login obligatorio (validada por sesión de hogar)
CREATE OR REPLACE FUNCTION public.submit_workspace_vote(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_master_product_id UUID,
    p_satisfaction NUMERIC(3,2),
    p_yield_factor NUMERIC(3,2),
    p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_score RECORD;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    INSERT INTO public.product_votes (
        workspace_id, user_id, master_product_id, satisfaction, yield_factor, comment, updated_at
    )
    VALUES (
        p_workspace_id,
        auth.uid(),
        p_master_product_id,
        p_satisfaction,
        p_yield_factor,
        NULLIF(left(btrim(COALESCE(p_comment, '')), 500), ''),
        NOW()
    )
    ON CONFLICT (workspace_id, master_product_id) DO UPDATE
    SET satisfaction = EXCLUDED.satisfaction,
        yield_factor = EXCLUDED.yield_factor,
        comment = COALESCE(EXCLUDED.comment, public.product_votes.comment),
        updated_at = NOW();

    SELECT * INTO v_score
    FROM public.sabiometro_scores
    WHERE master_product_id = p_master_product_id;

    RETURN to_jsonb(v_score);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_workspace_vote(UUID, TEXT, UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_workspace_vote(UUID, TEXT, UUID, NUMERIC, NUMERIC, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_sabiometro_scores(p_master_ids UUID[])
RETURNS SETOF public.sabiometro_scores
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    SELECT * FROM public.sabiometro_scores
    WHERE master_product_id = ANY(COALESCE(p_master_ids, '{}'));
$$;

REVOKE ALL ON FUNCTION public.get_sabiometro_scores(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sabiometro_scores(UUID[]) TO anon, authenticated, service_role;
