-- 0023_baskets_sync.sql
-- Canastas compartidas PC <-> Móvil con control de versión, bloqueos (candados),
-- filtros de dieta por canasta y modo compra en tiempo real (Supabase Realtime).

CREATE TABLE IF NOT EXISTS public.baskets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    title VARCHAR(120) NOT NULL DEFAULT 'Mi mercado',
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'optimized', 'shopping', 'completed', 'archived')),
    is_habitual BOOLEAN NOT NULL DEFAULT FALSE,
    budget_cop NUMERIC(14,2) CHECK (budget_cop IS NULL OR budget_cop >= 0),
    optimize_mode VARCHAR(20) NOT NULL DEFAULT 'my_brands' CHECK (optimize_mode IN ('my_brands', 'generic')),
    active_diet_filters TEXT[] NOT NULL DEFAULT '{}',
    transport_mode public.transport_mode,
    max_stores SMALLINT NOT NULL DEFAULT 2 CHECK (max_stores BETWEEN 1 AND 5),
    radius_meters INT CHECK (radius_meters IS NULL OR radius_meters BETWEEN 200 AND 25000),
    last_plan JSONB,
    last_plan_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 1,
    updated_by_device VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_habitual_per_workspace
    ON public.baskets (workspace_id)
    WHERE is_habitual AND status <> 'archived';

CREATE INDEX IF NOT EXISTS idx_baskets_workspace_updated
    ON public.baskets (workspace_id, updated_at DESC)
    WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS public.basket_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    basket_id UUID NOT NULL REFERENCES public.baskets(id) ON DELETE CASCADE,
    item_key VARCHAR(120) NOT NULL,
    payload JSONB NOT NULL,
    quantity NUMERIC(8,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    chosen_store_sku_id UUID REFERENCES public.store_skus(id) ON DELETE SET NULL,
    checked_at TIMESTAMPTZ,
    checked_by_device VARCHAR(64),
    sort_order INT NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (basket_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_basket_items_basket_order
    ON public.basket_items (basket_id, sort_order, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.bump_sync_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    NEW.version := COALESCE(OLD.version, 1) + 1;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_sync_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_baskets_bump_version ON public.baskets;
CREATE TRIGGER trg_baskets_bump_version
    BEFORE UPDATE ON public.baskets
    FOR EACH ROW EXECUTE FUNCTION public.bump_sync_version();

DROP TRIGGER IF EXISTS trg_basket_items_bump_version ON public.basket_items;
CREATE TRIGGER trg_basket_items_bump_version
    BEFORE UPDATE ON public.basket_items
    FOR EACH ROW EXECUTE FUNCTION public.bump_sync_version();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'baskets'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.baskets;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'basket_items'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.basket_items;
        END IF;
    END IF;
END $$;

ALTER TABLE public.baskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basket_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Propietario autenticado gestiona sus canastas" ON public.baskets;
CREATE POLICY "Propietario autenticado gestiona sus canastas"
    ON public.baskets FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Propietario autenticado gestiona ítems de su canasta" ON public.basket_items;
CREATE POLICY "Propietario autenticado gestiona ítems de su canasta"
    ON public.basket_items FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.baskets b
            WHERE b.id = basket_id AND b.user_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.baskets b
            WHERE b.id = basket_id AND b.user_id = (SELECT auth.uid())
        )
    );

CREATE OR REPLACE FUNCTION public.get_workspace_baskets(
    p_workspace_id UUID,
    p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    RETURN COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', b.id,
                'workspaceId', b.workspace_id,
                'title', b.title,
                'status', b.status,
                'isHabitual', b.is_habitual,
                'budgetCop', b.budget_cop,
                'optimizeMode', b.optimize_mode,
                'activeDietFilters', b.active_diet_filters,
                'transportMode', b.transport_mode,
                'maxStores', b.max_stores,
                'radiusMeters', b.radius_meters,
                'lastPlan', b.last_plan,
                'lastPlanAt', b.last_plan_at,
                'version', b.version,
                'updatedByDevice', b.updated_by_device,
                'createdAt', b.created_at,
                'updatedAt', b.updated_at,
                'items', COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', bi.id,
                            'basketId', bi.basket_id,
                            'itemKey', bi.item_key,
                            'payload', bi.payload,
                            'quantity', bi.quantity,
                            'isLocked', bi.is_locked,
                            'chosenStoreSkuId', bi.chosen_store_sku_id,
                            'checkedAt', bi.checked_at,
                            'checkedByDevice', bi.checked_by_device,
                            'sortOrder', bi.sort_order,
                            'version', bi.version,
                            'updatedAt', bi.updated_at,
                            'deletedAt', bi.deleted_at
                        )
                        ORDER BY bi.sort_order ASC, bi.updated_at ASC
                    )
                    FROM public.basket_items bi
                    WHERE bi.basket_id = b.id
                ), '[]'::jsonb)
            )
            ORDER BY b.updated_at DESC
        )
        FROM public.baskets b
        WHERE b.workspace_id = p_workspace_id AND b.status <> 'archived'
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_baskets(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_baskets(UUID, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_workspace_basket_ops(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_device_id TEXT DEFAULT 'web',
    p_ops JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_op JSONB;
    v_kind TEXT;
    v_basket_id UUID;
    v_item_key TEXT;
    v_base_version BIGINT;
    v_cur_version BIGINT;
    v_conflicts JSONB := '[]'::jsonb;
    v_applied INT := 0;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    IF jsonb_typeof(p_ops) <> 'array' THEN
        RAISE EXCEPTION 'p_ops debe ser un arreglo JSON';
    END IF;

    FOR v_op IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
        v_kind := COALESCE(v_op->>'kind', '');
        IF v_kind = 'upsert_basket' THEN
            v_basket_id := COALESCE(NULLIF(v_op->>'id', '')::UUID, gen_random_uuid());
            v_base_version := NULLIF(v_op->>'baseVersion', '')::BIGINT;

            SELECT version INTO v_cur_version
            FROM public.baskets
            WHERE id = v_basket_id AND workspace_id = p_workspace_id;

            IF v_cur_version IS NOT NULL AND v_base_version IS NOT NULL AND v_base_version < v_cur_version THEN
                v_conflicts := v_conflicts || jsonb_build_object('kind', v_kind, 'id', v_basket_id, 'serverVersion', v_cur_version);
                CONTINUE;
            END IF;

            IF COALESCE((v_op->>'isHabitual')::BOOLEAN, FALSE) THEN
                UPDATE public.baskets
                SET is_habitual = FALSE
                WHERE workspace_id = p_workspace_id AND id <> v_basket_id AND is_habitual = TRUE;
            END IF;

            INSERT INTO public.baskets (
                id, workspace_id, title, status, is_habitual, budget_cop, optimize_mode,
                active_diet_filters, transport_mode, max_stores, radius_meters,
                last_plan, last_plan_at, updated_by_device
            )
            VALUES (
                v_basket_id,
                p_workspace_id,
                left(COALESCE(NULLIF(btrim(v_op->>'title'), ''), 'Mi mercado'), 120),
                CASE WHEN v_op->>'status' IN ('draft','optimized','shopping','completed','archived') THEN v_op->>'status' ELSE 'draft' END,
                COALESCE((v_op->>'isHabitual')::BOOLEAN, FALSE),
                NULLIF(v_op->>'budgetCop', '')::NUMERIC(14,2),
                CASE WHEN v_op->>'optimizeMode' IN ('my_brands','generic') THEN v_op->>'optimizeMode' ELSE 'my_brands' END,
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_op->'activeDietFilters', '[]'::jsonb))), '{}'),
                NULLIF(v_op->>'transportMode', '')::public.transport_mode,
                COALESCE(NULLIF(v_op->>'maxStores', '')::SMALLINT, 2),
                NULLIF(v_op->>'radiusMeters', '')::INT,
                v_op->'lastPlan',
                CASE WHEN v_op->'lastPlan' IS NOT NULL THEN NOW() ELSE NULL END,
                left(COALESCE(p_device_id, 'web'), 64)
            )
            ON CONFLICT (id) DO UPDATE
            SET title = EXCLUDED.title,
                status = EXCLUDED.status,
                is_habitual = EXCLUDED.is_habitual,
                budget_cop = EXCLUDED.budget_cop,
                optimize_mode = EXCLUDED.optimize_mode,
                active_diet_filters = EXCLUDED.active_diet_filters,
                transport_mode = EXCLUDED.transport_mode,
                max_stores = EXCLUDED.max_stores,
                radius_meters = EXCLUDED.radius_meters,
                last_plan = COALESCE(EXCLUDED.last_plan, public.baskets.last_plan),
                last_plan_at = COALESCE(EXCLUDED.last_plan_at, public.baskets.last_plan_at),
                updated_by_device = EXCLUDED.updated_by_device
            WHERE public.baskets.workspace_id = p_workspace_id;

            v_applied := v_applied + 1;

        ELSIF v_kind IN ('upsert_item', 'delete_item', 'toggle_check') THEN
            v_basket_id := (v_op->>'basketId')::UUID;
            v_item_key := left(btrim(COALESCE(v_op->>'itemKey', '')), 120);
            IF NOT EXISTS (SELECT 1 FROM public.baskets WHERE id = v_basket_id AND workspace_id = p_workspace_id) THEN
                CONTINUE;
            END IF;

            IF v_kind = 'delete_item' THEN
                UPDATE public.basket_items
                SET deleted_at = NOW(), updated_at = NOW()
                WHERE basket_id = v_basket_id AND item_key = v_item_key;
                v_applied := v_applied + 1;
            ELSIF v_kind = 'toggle_check' THEN
                -- checked_at gana el estado más reciente explícito (nunca pierde un chulo en tienda)
                UPDATE public.basket_items
                SET checked_at = CASE
                        WHEN (v_op->>'checked')::BOOLEAN THEN COALESCE((v_op->>'checkedAt')::TIMESTAMPTZ, NOW())
                        ELSE NULL
                    END,
                    checked_by_device = left(COALESCE(p_device_id, 'web'), 64)
                WHERE basket_id = v_basket_id AND item_key = v_item_key;
                v_applied := v_applied + 1;
            ELSE
                v_base_version := NULLIF(v_op->>'baseVersion', '')::BIGINT;
                SELECT version INTO v_cur_version
                FROM public.basket_items
                WHERE basket_id = v_basket_id AND item_key = v_item_key;

                IF v_cur_version IS NOT NULL AND v_base_version IS NOT NULL AND v_base_version < v_cur_version THEN
                    v_conflicts := v_conflicts || jsonb_build_object('kind', v_kind, 'basketId', v_basket_id, 'itemKey', v_item_key, 'serverVersion', v_cur_version);
                    CONTINUE;
                END IF;

                INSERT INTO public.basket_items (
                    basket_id, item_key, payload, quantity, is_locked,
                    chosen_store_sku_id, checked_at, checked_by_device, sort_order, deleted_at
                )
                VALUES (
                    v_basket_id,
                    v_item_key,
                    COALESCE(v_op->'payload', '{}'::jsonb),
                    GREATEST(0.01, COALESCE((v_op->>'quantity')::NUMERIC(8,2), 1)),
                    COALESCE((v_op->>'isLocked')::BOOLEAN, FALSE),
                    NULLIF(v_op->>'chosenStoreSkuId', '')::UUID,
                    NULLIF(v_op->>'checkedAt', '')::TIMESTAMPTZ,
                    NULLIF(v_op->>'checkedByDevice', ''),
                    COALESCE((v_op->>'sortOrder')::INT, 0),
                    NULL
                )
                ON CONFLICT (basket_id, item_key) DO UPDATE
                SET payload = EXCLUDED.payload,
                    quantity = EXCLUDED.quantity,
                    is_locked = EXCLUDED.is_locked,
                    chosen_store_sku_id = EXCLUDED.chosen_store_sku_id,
                    checked_at = COALESCE(EXCLUDED.checked_at, public.basket_items.checked_at),
                    checked_by_device = COALESCE(EXCLUDED.checked_by_device, public.basket_items.checked_by_device),
                    sort_order = EXCLUDED.sort_order,
                    deleted_at = NULL;

                v_applied := v_applied + 1;
            END IF;
        END IF;
    END LOOP;

    UPDATE public.sync_workspaces
    SET last_device_label = left(COALESCE(p_device_id, 'web'), 80),
        last_synced_at = NOW()
    WHERE id = p_workspace_id;

    RETURN jsonb_build_object(
        'applied', v_applied,
        'conflicts', v_conflicts,
        'baskets', public.get_workspace_baskets(p_workspace_id, p_session_token)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_workspace_basket_ops(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_workspace_basket_ops(UUID, TEXT, TEXT, JSONB) TO anon, authenticated, service_role;
