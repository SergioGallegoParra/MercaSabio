-- 0032_sabiometro_detail_and_lint_polish.sql
-- Agrega RPC segura para ver el detalle y distribución anónima de un producto en Sabiómetro,
-- permite desconectar dispositivos vinculados y limpia el warning menor de _generate_household_code.

CREATE OR REPLACE FUNCTION public._generate_household_code()
RETURNS VARCHAR(20)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_chars CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    v_code TEXT := 'HOGAR-';
BEGIN
    FOR idx IN 1..6 LOOP
        v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::INT, 1);
    END LOOP;
    RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public._generate_household_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_sabiometro_detail(p_master_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_score JSONB;
    v_sat JSONB;
    v_yield JSONB;
    v_comments JSONB;
BEGIN
    SELECT to_jsonb(s.*) INTO v_score
    FROM public.sabiometro_scores s
    WHERE s.master_product_id = p_master_product_id;

    SELECT jsonb_build_object(
        'fixedBuy', COUNT(*) FILTER (WHERE satisfaction = 1.00),
        'fairPrice', COUNT(*) FILTER (WHERE satisfaction = 0.75),
        'overpriced', COUNT(*) FILTER (WHERE satisfaction = 0.25),
        'badBuy', COUNT(*) FILTER (WHERE satisfaction = 0.00)
    ),
    jsonb_build_object(
        'doubleYield', COUNT(*) FILTER (WHERE yield_factor = 0.50),
        'standardYield', COUNT(*) FILTER (WHERE yield_factor = 1.00),
        'lowYield', COUNT(*) FILTER (WHERE yield_factor = 1.50)
    )
    INTO v_sat, v_yield
    FROM public.product_votes
    WHERE master_product_id = p_master_product_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'satisfaction', c.satisfaction,
        'yieldFactor', c.yield_factor,
        'comment', c.comment,
        'updatedAt', c.updated_at,
        'verifiedPurchase', c.verified_purchase_id IS NOT NULL
    ) ORDER BY c.updated_at DESC), '[]'::jsonb)
    INTO v_comments
    FROM (
        SELECT satisfaction, yield_factor, comment, updated_at, verified_purchase_id
        FROM public.product_votes
        WHERE master_product_id = p_master_product_id
          AND comment IS NOT NULL
          AND btrim(comment) <> ''
        ORDER BY updated_at DESC
        LIMIT 5
    ) c;

    RETURN jsonb_build_object(
        'score', v_score,
        'satisfactionDistribution', v_sat,
        'yieldDistribution', v_yield,
        'comments', v_comments
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sabiometro_detail(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sabiometro_detail(UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_workspace_device(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_device_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    UPDATE public.sync_workspace_sessions
    SET revoked_at = NOW()
    WHERE workspace_id = p_workspace_id AND device_id = p_device_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_workspace_device(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_workspace_device(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
