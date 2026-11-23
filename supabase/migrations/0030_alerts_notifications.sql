-- 0030_alerts_notifications.sql
-- Centro de alertas deduplicadas (promociones, recompra, inflación, trampa de empaque, sync)
-- y preferencias de aviso sin requerir login obligatorio.

CREATE TABLE IF NOT EXISTS public.user_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('promo_day', 'replenish', 'inflation_report', 'price_drop', 'pack_trap', 'budget_overrun', 'sync')),
    title VARCHAR(140) NOT NULL,
    body TEXT NOT NULL,
    deep_link TEXT,
    payload JSONB,
    dedupe_key VARCHAR(160) NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_workspace_active
    ON public.user_alerts (workspace_id, scheduled_for DESC)
    WHERE dismissed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_prefs (
    workspace_id UUID PRIMARY KEY REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    promo_days BOOLEAN NOT NULL DEFAULT TRUE,
    replenish BOOLEAN NOT NULL DEFAULT TRUE,
    inflation_report BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_start SMALLINT NOT NULL DEFAULT 21 CHECK (quiet_hours_start BETWEEN 0 AND 23),
    quiet_hours_end SMALLINT NOT NULL DEFAULT 7 CHECK (quiet_hours_end BETWEEN 0 AND 23),
    max_per_week SMALLINT NOT NULL DEFAULT 4 CHECK (max_per_week BETWEEN 0 AND 21),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Propietario autenticado gestiona sus alertas" ON public.user_alerts;
CREATE POLICY "Propietario autenticado gestiona sus alertas"
    ON public.user_alerts FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Propietario autenticado gestiona sus suscripciones push" ON public.push_subscriptions;
CREATE POLICY "Propietario autenticado gestiona sus suscripciones push"
    ON public.push_subscriptions FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Propietario autenticado gestiona preferencias de alertas" ON public.notification_prefs;
CREATE POLICY "Propietario autenticado gestiona preferencias de alertas"
    ON public.notification_prefs FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.get_workspace_alerts(
    p_workspace_id UUID,
    p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_prefs JSONB;
    v_alerts JSONB;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    SELECT to_jsonb(np.*) INTO v_prefs
    FROM public.notification_prefs np
    WHERE np.workspace_id = p_workspace_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ua.id,
        'kind', ua.kind,
        'title', ua.title,
        'body', ua.body,
        'deepLink', ua.deep_link,
        'payload', ua.payload,
        'dedupeKey', ua.dedupe_key,
        'scheduledFor', ua.scheduled_for,
        'readAt', ua.read_at,
        'dismissedAt', ua.dismissed_at,
        'createdAt', ua.created_at
    ) ORDER BY ua.scheduled_for DESC), '[]'::jsonb)
    INTO v_alerts
    FROM public.user_alerts ua
    WHERE ua.workspace_id = p_workspace_id AND ua.dismissed_at IS NULL;

    RETURN jsonb_build_object('alerts', v_alerts, 'prefs', v_prefs);
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_alerts(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_alerts(UUID, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_workspace_alert(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_kind TEXT,
    p_title TEXT,
    p_body TEXT,
    p_dedupe_key TEXT,
    p_deep_link TEXT DEFAULT NULL,
    p_payload JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id UUID;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    INSERT INTO public.user_alerts (
        workspace_id, user_id, kind, title, body, deep_link, payload, dedupe_key
    )
    VALUES (
        p_workspace_id, auth.uid(), p_kind, left(p_title, 140), p_body, p_deep_link, p_payload, left(p_dedupe_key, 160)
    )
    ON CONFLICT (workspace_id, dedupe_key) DO UPDATE
    SET title = EXCLUDED.title,
        body = EXCLUDED.body,
        deep_link = EXCLUDED.deep_link,
        payload = EXCLUDED.payload
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_workspace_alert(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_workspace_alert(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_workspace_alert_state(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_alert_id UUID,
    p_read BOOLEAN DEFAULT NULL,
    p_dismiss BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    UPDATE public.user_alerts
    SET read_at = CASE WHEN p_read IS TRUE THEN COALESCE(read_at, NOW()) WHEN p_read IS FALSE THEN NULL ELSE read_at END,
        dismissed_at = CASE WHEN p_dismiss IS TRUE THEN COALESCE(dismissed_at, NOW()) ELSE dismissed_at END
    WHERE id = p_alert_id AND workspace_id = p_workspace_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_workspace_alert_state(UUID, TEXT, UUID, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_workspace_alert_state(UUID, TEXT, UUID, BOOLEAN, BOOLEAN) TO anon, authenticated, service_role;
