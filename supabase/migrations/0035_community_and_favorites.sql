-- 0035_community_and_favorites.sql
-- Agrega:
--   1) Plan del hogar (free=1 mercado favorito, premium=10 mercados favoritos) y tabla favorite_baskets.
--   2) Comunidad de mercados recomendados (community_baskets) con publicación y copia/modificación anónima sin login obligatorio.

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(16) NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'premium'));

CREATE TABLE IF NOT EXISTS public.favorite_baskets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL DEFAULT 'Mercado favorito',
    optimize_mode VARCHAR(20) NOT NULL DEFAULT 'generic' CHECK (optimize_mode IN ('my_brands', 'generic')),
    items_count INT NOT NULL DEFAULT 0 CHECK (items_count BETWEEN 1 AND 80),
    items_payload JSONB NOT NULL,
    active_diet_filters TEXT[] NOT NULL DEFAULT '{}',
    estimated_total_cop NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_total_cop >= 0),
    estimated_savings_cop NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_savings_cop >= 0),
    store_summary VARCHAR(120) NOT NULL DEFAULT '',
    zone_label VARCHAR(80) NOT NULL DEFAULT 'Bogotá · Chapinero',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_favorite_baskets_workspace_updated
    ON public.favorite_baskets (workspace_id, updated_at DESC);

ALTER TABLE public.favorite_baskets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Propietario autenticado gestiona sus favoritos" ON public.favorite_baskets;
CREATE POLICY "Propietario autenticado gestiona sus favoritos"
    ON public.favorite_baskets FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.sync_workspaces w
            WHERE w.id = workspace_id AND w.user_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.sync_workspaces w
            WHERE w.id = workspace_id AND w.user_id = (SELECT auth.uid())
        )
    );

CREATE OR REPLACE FUNCTION public.get_workspace_favorites(
    p_workspace_id UUID,
    p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_plan_tier TEXT := 'free';
    v_limit INT := 1;
    v_rows JSONB := '[]'::jsonb;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    SELECT COALESCE(up.plan_tier, 'free') INTO v_plan_tier
    FROM public.user_profiles up
    WHERE up.workspace_id = p_workspace_id;

    v_limit := CASE WHEN v_plan_tier = 'premium' THEN 10 ELSE 1 END;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', fb.id,
            'workspaceId', fb.workspace_id,
            'title', fb.title,
            'optimizeMode', fb.optimize_mode,
            'itemsCount', fb.items_count,
            'items', fb.items_payload,
            'activeDietFilters', fb.active_diet_filters,
            'estimatedTotalCop', fb.estimated_total_cop,
            'estimatedSavingsCop', fb.estimated_savings_cop,
            'storeSummary', fb.store_summary,
            'zoneLabel', fb.zone_label,
            'createdAt', fb.created_at,
            'updatedAt', fb.updated_at
        )
        ORDER BY fb.updated_at DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.favorite_baskets fb
    WHERE fb.workspace_id = p_workspace_id;

    RETURN jsonb_build_object(
        'planTier', v_plan_tier,
        'limit', v_limit,
        'favorites', v_rows
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_favorites(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_favorites(UUID, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_workspace_favorite(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_title TEXT,
    p_optimize_mode TEXT DEFAULT 'generic',
    p_items_payload JSONB DEFAULT '[]'::jsonb,
    p_active_diet_filters TEXT[] DEFAULT '{}',
    p_estimated_total_cop NUMERIC DEFAULT 0,
    p_estimated_savings_cop NUMERIC DEFAULT 0,
    p_store_summary TEXT DEFAULT '',
    p_zone_label TEXT DEFAULT 'Bogotá · Chapinero',
    p_replace_id UUID DEFAULT NULL,
    p_limit_override INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_plan_tier TEXT := 'free';
    v_limit INT := 1;
    v_current_count INT := 0;
    v_items_count INT := 0;
    v_target_id UUID;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    IF jsonb_typeof(p_items_payload) <> 'array' THEN
        RAISE EXCEPTION 'p_items_payload debe ser un arreglo JSON';
    END IF;
    v_items_count := jsonb_array_length(p_items_payload);
    IF v_items_count < 1 OR v_items_count > 80 THEN
        RAISE EXCEPTION 'Un mercado favorito debe tener entre 1 y 80 productos';
    END IF;

    SELECT COALESCE(up.plan_tier, 'free') INTO v_plan_tier
    FROM public.user_profiles up
    WHERE up.workspace_id = p_workspace_id;

    v_limit := COALESCE(
        NULLIF(GREATEST(1, LEAST(50, COALESCE(p_limit_override, 0))), 0),
        CASE WHEN v_plan_tier = 'premium' THEN 10 ELSE 1 END
    );

    SELECT COUNT(*)::INT INTO v_current_count
    FROM public.favorite_baskets
    WHERE workspace_id = p_workspace_id;

    IF p_replace_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.favorite_baskets
        WHERE id = p_replace_id AND workspace_id = p_workspace_id
    ) THEN
        UPDATE public.favorite_baskets
        SET title = left(COALESCE(NULLIF(btrim(p_title), ''), 'Mi mercado favorito'), 120),
            optimize_mode = CASE WHEN p_optimize_mode IN ('my_brands', 'generic') THEN p_optimize_mode ELSE 'generic' END,
            items_count = v_items_count,
            items_payload = p_items_payload,
            active_diet_filters = COALESCE(p_active_diet_filters, '{}'),
            estimated_total_cop = GREATEST(0, COALESCE(p_estimated_total_cop, 0)),
            estimated_savings_cop = GREATEST(0, COALESCE(p_estimated_savings_cop, 0)),
            store_summary = left(COALESCE(btrim(p_store_summary), ''), 120),
            zone_label = left(COALESCE(NULLIF(btrim(p_zone_label), ''), 'Bogotá · Chapinero'), 80),
            updated_at = NOW()
        WHERE id = p_replace_id AND workspace_id = p_workspace_id
        RETURNING id INTO v_target_id;
    ELSE
        IF v_current_count >= v_limit THEN
            RETURN (
                public.get_workspace_favorites(p_workspace_id, p_session_token)
                || jsonb_build_object(
                    'ok', FALSE,
                    'errorCode', 'FAVORITE_LIMIT_REACHED',
                    'message', CASE
                        WHEN v_plan_tier = 'free'
                            THEN 'Tu plan gratis permite 1 mercado favorito guardado. Reemplaza el actual o pasa a Premium para guardar hasta 10.'
                        ELSE 'Alcanzaste el límite de mercados favoritos de tu plan.'
                    END
                )
            );
        END IF;

        INSERT INTO public.favorite_baskets (
            workspace_id, title, optimize_mode, items_count, items_payload,
            active_diet_filters, estimated_total_cop, estimated_savings_cop,
            store_summary, zone_label
        )
        VALUES (
            p_workspace_id,
            left(COALESCE(NULLIF(btrim(p_title), ''), 'Mi mercado favorito'), 120),
            CASE WHEN p_optimize_mode IN ('my_brands', 'generic') THEN p_optimize_mode ELSE 'generic' END,
            v_items_count,
            p_items_payload,
            COALESCE(p_active_diet_filters, '{}'),
            GREATEST(0, COALESCE(p_estimated_total_cop, 0)),
            GREATEST(0, COALESCE(p_estimated_savings_cop, 0)),
            left(COALESCE(btrim(p_store_summary), ''), 120),
            left(COALESCE(NULLIF(btrim(p_zone_label), ''), 'Bogotá · Chapinero'), 80)
        )
        RETURNING id INTO v_target_id;
    END IF;

    RETURN (
        public.get_workspace_favorites(p_workspace_id, p_session_token)
        || jsonb_build_object('ok', TRUE, 'savedId', v_target_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.save_workspace_favorite(UUID, TEXT, TEXT, TEXT, JSONB, TEXT[], NUMERIC, NUMERIC, TEXT, TEXT, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_workspace_favorite(UUID, TEXT, TEXT, TEXT, JSONB, TEXT[], NUMERIC, NUMERIC, TEXT, TEXT, UUID, INT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_workspace_favorite(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_favorite_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    DELETE FROM public.favorite_baskets
    WHERE id = p_favorite_id AND workspace_id = p_workspace_id;

    RETURN (
        public.get_workspace_favorites(p_workspace_id, p_session_token)
        || jsonb_build_object('ok', TRUE)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_workspace_favorite(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_workspace_favorite(UUID, TEXT, UUID) TO anon, authenticated, service_role;

-- =====================================================================
-- 2) COMUNIDAD DE MERCADOS RECOMENDADOS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.community_baskets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_workspace_id UUID REFERENCES public.sync_workspaces(id) ON DELETE SET NULL,
    author_alias VARCHAR(50) NOT NULL DEFAULT 'Hogar MercaSabio',
    title VARCHAR(120) NOT NULL,
    description TEXT,
    category_tag VARCHAR(40) NOT NULL DEFAULT 'general'
        CHECK (category_tag IN ('general', 'economico', 'alto_proteina', 'sin_lactosa', 'familiar', 'rapido')),
    zone_label VARCHAR(80) NOT NULL DEFAULT 'Bogotá · Chapinero',
    items_count INT NOT NULL DEFAULT 0 CHECK (items_count BETWEEN 1 AND 80),
    items_payload JSONB NOT NULL,
    active_diet_filters TEXT[] NOT NULL DEFAULT '{}',
    estimated_total_cop NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_total_cop >= 0),
    estimated_savings_cop NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_savings_cop >= 0),
    estimated_savings_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (estimated_savings_pct BETWEEN 0 AND 100),
    store_summary VARCHAR(120) NOT NULL DEFAULT 'Multi-tienda',
    avg_sabiometro NUMERIC(5,2),
    copies_count INT NOT NULL DEFAULT 0 CHECK (copies_count >= 0),
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_baskets_published
    ON public.community_baskets (is_published, category_tag, copies_count DESC, created_at DESC);

ALTER TABLE public.community_baskets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura publica de mercados de comunidad" ON public.community_baskets;
CREATE POLICY "Lectura publica de mercados de comunidad"
    ON public.community_baskets FOR SELECT
    TO anon, authenticated
    USING (is_published = TRUE);

CREATE OR REPLACE FUNCTION public.list_community_baskets(
    p_category TEXT DEFAULT 'all',
    p_limit INT DEFAULT 24
)
RETURNS TABLE (
    id UUID,
    author_alias VARCHAR(50),
    title VARCHAR(120),
    description TEXT,
    category_tag VARCHAR(40),
    zone_label VARCHAR(80),
    items_count INT,
    items_payload JSONB,
    active_diet_filters TEXT[],
    estimated_total_cop NUMERIC(14,2),
    estimated_savings_cop NUMERIC(14,2),
    estimated_savings_pct NUMERIC(5,2),
    store_summary VARCHAR(120),
    avg_sabiometro NUMERIC(5,2),
    copies_count INT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        cb.id,
        cb.author_alias,
        cb.title,
        cb.description,
        cb.category_tag,
        cb.zone_label,
        cb.items_count,
        cb.items_payload,
        cb.active_diet_filters,
        cb.estimated_total_cop,
        cb.estimated_savings_cop,
        cb.estimated_savings_pct,
        cb.store_summary,
        cb.avg_sabiometro,
        cb.copies_count,
        cb.created_at
    FROM public.community_baskets cb
    WHERE cb.is_published = TRUE
      AND (
          COALESCE(NULLIF(btrim(p_category), ''), 'all') = 'all'
          OR cb.category_tag = p_category
      )
    ORDER BY cb.copies_count DESC, cb.estimated_savings_cop DESC, cb.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 60);
$$;

REVOKE ALL ON FUNCTION public.list_community_baskets(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_community_baskets(TEXT, INT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_community_basket(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_author_alias TEXT DEFAULT 'Hogar MercaSabio',
    p_title TEXT DEFAULT 'Mi mercado recomendado',
    p_description TEXT DEFAULT '',
    p_category_tag TEXT DEFAULT 'general',
    p_zone_label TEXT DEFAULT 'Bogotá · Chapinero',
    p_items_payload JSONB DEFAULT '[]'::jsonb,
    p_active_diet_filters TEXT[] DEFAULT '{}',
    p_estimated_total_cop NUMERIC DEFAULT 0,
    p_estimated_savings_cop NUMERIC DEFAULT 0,
    p_estimated_savings_pct NUMERIC DEFAULT 0,
    p_store_summary TEXT DEFAULT 'Multi-tienda',
    p_avg_sabiometro NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_clean_alias TEXT := left(COALESCE(NULLIF(btrim(p_author_alias), ''), 'Hogar MercaSabio'), 50);
    v_clean_title TEXT := left(COALESCE(NULLIF(btrim(p_title), ''), 'Mercado recomendado'), 120);
    v_clean_desc TEXT := left(COALESCE(btrim(p_description), ''), 360);
    v_clean_tag TEXT := CASE
        WHEN p_category_tag IN ('general', 'economico', 'alto_proteina', 'sin_lactosa', 'familiar', 'rapido')
            THEN p_category_tag
        ELSE 'general'
    END;
    v_items_count INT;
    v_new_id UUID;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    IF jsonb_typeof(p_items_payload) <> 'array' THEN
        RAISE EXCEPTION 'p_items_payload debe ser un arreglo JSON';
    END IF;
    v_items_count := jsonb_array_length(p_items_payload);
    IF v_items_count < 1 OR v_items_count > 80 THEN
        RAISE EXCEPTION 'El mercado debe tener entre 1 y 80 productos para publicarse en comunidad';
    END IF;

    INSERT INTO public.community_baskets (
        source_workspace_id, author_alias, title, description, category_tag,
        zone_label, items_count, items_payload, active_diet_filters,
        estimated_total_cop, estimated_savings_cop, estimated_savings_pct,
        store_summary, avg_sabiometro
    )
    VALUES (
        p_workspace_id,
        v_clean_alias,
        v_clean_title,
        NULLIF(v_clean_desc, ''),
        v_clean_tag,
        left(COALESCE(NULLIF(btrim(p_zone_label), ''), 'Bogotá · Chapinero'), 80),
        v_items_count,
        p_items_payload,
        COALESCE(p_active_diet_filters, '{}'),
        GREATEST(0, COALESCE(p_estimated_total_cop, 0)),
        GREATEST(0, COALESCE(p_estimated_savings_cop, 0)),
        GREATEST(0, LEAST(99, COALESCE(p_estimated_savings_pct, 0))),
        left(COALESCE(NULLIF(btrim(p_store_summary), ''), 'Multi-tienda'), 120),
        p_avg_sabiometro
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'ok', TRUE,
        'id', v_new_id,
        'authorAlias', v_clean_alias,
        'title', v_clean_title,
        'categoryTag', v_clean_tag,
        'itemsCount', v_items_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_community_basket(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT[], NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_community_basket(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT[], NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_community_basket_copy(
    p_community_basket_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_row RECORD;
BEGIN
    UPDATE public.community_baskets
    SET copies_count = copies_count + 1,
        updated_at = NOW()
    WHERE id = p_community_basket_id
      AND is_published = TRUE
    RETURNING id, title, items_payload, active_diet_filters, copies_count
    INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Mercado comunitario no encontrado';
    END IF;

    RETURN jsonb_build_object(
        'ok', TRUE,
        'id', v_row.id,
        'title', v_row.title,
        'items', v_row.items_payload,
        'activeDietFilters', v_row.active_diet_filters,
        'copiesCount', v_row.copies_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_community_basket_copy(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_community_basket_copy(UUID) TO anon, authenticated, service_role;

-- Seed inicial curado de mercados comunitarios recomendados (idempotente)
INSERT INTO public.community_baskets (
    id, author_alias, title, description, category_tag, zone_label,
    items_count, items_payload, active_diet_filters,
    estimated_total_cop, estimated_savings_cop, estimated_savings_pct,
    store_summary, avg_sabiometro, copies_count
)
VALUES
(
    'c0000001-0000-4000-8000-000000000001',
    '@LauraBogotá',
    'Canasta quincenal inteligente (D1 + Olímpica)',
    'Combinación híbrida con básicos sin marca y café fijo para ahorrar sin sacrificar rendimiento.',
    'economico',
    'Bogotá · Chapinero',
    6,
    '[
      {"itemKey":"comm-arroz","label":"Arroz blanco 1 kg","subtypeFamily":"arroz_blanco","broadFamily":"arroz","targetNetContent":1000,"targetUnitMeasure":"g","quantity":2,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"medium","allowSubstitutes":true},
      {"itemKey":"comm-frijol","label":"Fríjol rojo / cargamanto","subtypeFamily":"frijol","broadFamily":"frijol","targetNetContent":500,"targetUnitMeasure":"g","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"any","allowSubstitutes":true},
      {"itemKey":"comm-aceite","label":"Aceite vegetal 900 ml","subtypeFamily":"aceite_vegetal","broadFamily":"aceite","targetNetContent":900,"targetUnitMeasure":"ml","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"medium","allowSubstitutes":true},
      {"itemKey":"comm-leche-desl","label":"Leche deslactosada","subtypeFamily":"leche_liquida","broadFamily":"leche","requiredCriticalAttribute":"deslactosada","targetNetContent":1000,"targetUnitMeasure":"ml","quantity":6,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"large","allowSubstitutes":true},
      {"itemKey":"comm-pasta","label":"Pasta espagueti 500 g","subtypeFamily":"pasta_corta_larga","broadFamily":"pasta","targetNetContent":500,"targetUnitMeasure":"g","quantity":2,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"medium","allowSubstitutes":true},
      {"itemKey":"comm-cafe","label":"Café molido 500 g","subtypeFamily":"cafe_molido","broadFamily":"cafe","targetNetContent":500,"targetUnitMeasure":"g","quantity":1,"allowedQualityTiers":["estandar","premium"],"pricePriority":"lowest_pum","sizePreference":"medium","allowSubstitutes":true}
    ]'::jsonb,
    ARRAY['lactose_free'],
    98400,
    24800,
    20.1,
    'Tiendas D1 + Olímpica',
    84,
    38
),
(
    'c0000001-0000-4000-8000-000000000002',
    '@AndrésM',
    'Mercado alto en proteína y avena',
    'Enfocado en huevos, atún, avena y lácteos con mejor PUM real por gramo de proteína.',
    'alto_proteina',
    'Bogotá · Chapinero Alto',
    5,
    '[
      {"itemKey":"comm-huevos","label":"Huevos AA/AAA ×30","subtypeFamily":"huevos_gallina","broadFamily":"huevos","targetNetContent":30,"targetUnitMeasure":"und","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"large","allowSubstitutes":true},
      {"itemKey":"comm-atun","label":"Atún en agua / aceite","subtypeFamily":"atun_lata","broadFamily":"atun","targetNetContent":160,"targetUnitMeasure":"g","quantity":3,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"any","allowSubstitutes":true},
      {"itemKey":"comm-avena","label":"Avena en hojuelas","subtypeFamily":"avena_hojuelas","broadFamily":"cereales","targetNetContent":500,"targetUnitMeasure":"g","quantity":2,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"medium","allowSubstitutes":true},
      {"itemKey":"comm-lenteja","label":"Lenteja 500 g","subtypeFamily":"lenteja","broadFamily":"granos","targetNetContent":500,"targetUnitMeasure":"g","quantity":2,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"any","allowSubstitutes":true},
      {"itemKey":"comm-leche-prot","label":"Leche entera / deslactosada","subtypeFamily":"leche_liquida","broadFamily":"leche","targetNetContent":1000,"targetUnitMeasure":"ml","quantity":4,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"large","allowSubstitutes":true}
    ]'::jsonb,
    ARRAY['high_protein'],
    86200,
    21400,
    19.9,
    'Carulla + Tiendas D1',
    88,
    29
),
(
    'c0000001-0000-4000-8000-000000000003',
    '@CamilaC',
    'Básico semanal estudiante (1–2 tiendas)',
    'Canasta corta para cocinar toda la semana gastando menos en granos, pasta y aseo.',
    'rapido',
    'Bogotá · Teusaquillo',
    4,
    '[
      {"itemKey":"comm-arroz-est","label":"Arroz blanco 1 kg","subtypeFamily":"arroz_blanco","broadFamily":"arroz","targetNetContent":1000,"targetUnitMeasure":"g","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_total","sizePreference":"medium","allowSubstitutes":true},
      {"itemKey":"comm-frijol-est","label":"Fríjol rojo 500 g","subtypeFamily":"frijol","broadFamily":"frijol","targetNetContent":500,"targetUnitMeasure":"g","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_total","sizePreference":"any","allowSubstitutes":true},
      {"itemKey":"comm-pasta-est","label":"Pasta clásica 500 g","subtypeFamily":"pasta_corta_larga","broadFamily":"pasta","targetNetContent":500,"targetUnitMeasure":"g","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_total","sizePreference":"any","allowSubstitutes":true},
      {"itemKey":"comm-aceite-est","label":"Aceite vegetal","subtypeFamily":"aceite_vegetal","broadFamily":"aceite","targetNetContent":900,"targetUnitMeasure":"ml","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"medium","allowSubstitutes":true}
    ]'::jsonb,
    '{}'::text[],
    34900,
    9200,
    20.9,
    'Tiendas D1',
    81,
    24
),
(
    'c0000001-0000-4000-8000-000000000004',
    '@FamiliaRíos',
    'Mercado familiar sin lactosa (formatos grandes)',
    'Pensado para hogar de 4 personas priorizando presentaciones rendidoras y aseo de hogar.',
    'sin_lactosa',
    'Bogotá · Cedritos',
    5,
    '[
      {"itemKey":"comm-leche-fam","label":"Leche deslactosada ×6","subtypeFamily":"leche_liquida","broadFamily":"leche","requiredCriticalAttribute":"deslactosada","targetNetContent":1000,"targetUnitMeasure":"ml","quantity":6,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"large","allowSubstitutes":true},
      {"itemKey":"comm-arroz-fam","label":"Arroz blanco familiar","subtypeFamily":"arroz_blanco","broadFamily":"arroz","targetNetContent":3000,"targetUnitMeasure":"g","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"large","allowSubstitutes":true},
      {"itemKey":"comm-detergente-fam","label":"Detergente líquido / polvo","subtypeFamily":"detergente_ropa","broadFamily":"aseo_hogar","targetNetContent":1800,"targetUnitMeasure":"g","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"medium","allowSubstitutes":true},
      {"itemKey":"comm-papel-fam","label":"Papel higiénico paquete","subtypeFamily":"papel_higienico","broadFamily":"aseo_personal","targetNetContent":12,"targetUnitMeasure":"und","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"large","allowSubstitutes":true},
      {"itemKey":"comm-huevos-fam","label":"Huevos ×30","subtypeFamily":"huevos_gallina","broadFamily":"huevos","targetNetContent":30,"targetUnitMeasure":"und","quantity":1,"allowedQualityTiers":["economico","estandar"],"pricePriority":"lowest_pum","sizePreference":"large","allowSubstitutes":true}
    ]'::jsonb,
    ARRAY['lactose_free'],
    114600,
    27900,
    19.6,
    'Olímpica + Tiendas D1',
    86,
    19
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
