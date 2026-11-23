-- 0029_purchases_replenishment.sql
-- Historial de compras reales por hogar y familia para estimar recompra y frecuencia.

CREATE TABLE IF NOT EXISTS public.purchase_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    master_product_id UUID REFERENCES public.master_products(id) ON DELETE SET NULL,
    family_key VARCHAR(120) NOT NULL,
    product_title VARCHAR(200),
    quantity NUMERIC(8,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    net_content NUMERIC(10,2),
    unit_measure VARCHAR(10),
    price_paid_cop NUMERIC(14,2) CHECK (price_paid_cop IS NULL OR price_paid_cop >= 0),
    store_id VARCHAR(30) REFERENCES public.stores(id) ON DELETE SET NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('basket_checkoff', 'receipt', 'manual')),
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_events_workspace_family
    ON public.purchase_events (workspace_id, family_key, purchased_at DESC);

ALTER TABLE public.purchase_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Propietario autenticado gestiona sus compras" ON public.purchase_events;
CREATE POLICY "Propietario autenticado gestiona sus compras"
    ON public.purchase_events FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.record_workspace_purchase_events(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_events JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_ev JSONB;
    v_count INT := 0;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    IF jsonb_typeof(p_events) <> 'array' THEN
        RAISE EXCEPTION 'p_events debe ser un arreglo JSON';
    END IF;

    FOR v_ev IN SELECT * FROM jsonb_array_elements(p_events) LOOP
        INSERT INTO public.purchase_events (
            workspace_id, user_id, master_product_id, family_key, product_title,
            quantity, net_content, unit_measure, price_paid_cop, store_id, source, purchased_at
        )
        VALUES (
            p_workspace_id,
            auth.uid(),
            NULLIF(v_ev->>'masterProductId', '')::UUID,
            left(COALESCE(NULLIF(btrim(v_ev->>'familyKey'), ''), 'despensa'), 120),
            NULLIF(left(btrim(COALESCE(v_ev->>'productTitle', '')), 200), ''),
            GREATEST(0.01, COALESCE((v_ev->>'quantity')::NUMERIC(8,2), 1)),
            NULLIF(v_ev->>'netContent', '')::NUMERIC(10,2),
            NULLIF(v_ev->>'unitMeasure', ''),
            NULLIF(v_ev->>'pricePaidCop', '')::NUMERIC(14,2),
            NULLIF(v_ev->>'storeId', ''),
            CASE WHEN v_ev->>'source' IN ('basket_checkoff','receipt','manual') THEN v_ev->>'source' ELSE 'basket_checkoff' END,
            COALESCE(NULLIF(v_ev->>'purchasedAt', '')::TIMESTAMPTZ, NOW())
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_workspace_purchase_events(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_workspace_purchase_events(UUID, TEXT, JSONB) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_workspace_purchase_events(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_limit INT DEFAULT 120
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', pe.id,
            'masterProductId', pe.master_product_id,
            'familyKey', pe.family_key,
            'productTitle', pe.product_title,
            'quantity', pe.quantity,
            'netContent', pe.net_content,
            'unitMeasure', pe.unit_measure,
            'pricePaidCop', pe.price_paid_cop,
            'storeId', pe.store_id,
            'source', pe.source,
            'purchasedAt', pe.purchased_at
        ) ORDER BY pe.purchased_at DESC)
        FROM (
            SELECT * FROM public.purchase_events
            WHERE workspace_id = p_workspace_id
            ORDER BY purchased_at DESC
            LIMIT LEAST(GREATEST(COALESCE(p_limit, 120), 1), 300)
        ) pe
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_purchase_events(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_purchase_events(UUID, TEXT, INT) TO anon, authenticated, service_role;
