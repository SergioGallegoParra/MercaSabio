-- 0031_generated_reports.sql
-- Informes persistentes de análisis de ahorro (tamaño de hogar, inflación personal, calendario de pagos)
-- y versión inicial de RPC para el módulo pendiente de verificación con factura DIAN.

CREATE TABLE IF NOT EXISTS public.user_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    kind VARCHAR(32) NOT NULL CHECK (kind IN ('household_size', 'inflation_monthly', 'payment_calendar')),
    period DATE NOT NULL DEFAULT CURRENT_DATE,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, kind, period)
);

CREATE INDEX IF NOT EXISTS idx_user_reports_workspace_kind
    ON public.user_reports (workspace_id, kind, created_at DESC);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Propietario autenticado gestiona sus informes" ON public.user_reports;
CREATE POLICY "Propietario autenticado gestiona sus informes"
    ON public.user_reports FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.save_workspace_report(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_kind TEXT,
    p_period DATE,
    p_payload JSONB
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

    INSERT INTO public.user_reports (workspace_id, user_id, kind, period, payload)
    VALUES (p_workspace_id, auth.uid(), p_kind, COALESCE(p_period, CURRENT_DATE), p_payload)
    ON CONFLICT (workspace_id, kind, period) DO UPDATE
    SET payload = EXCLUDED.payload,
        created_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_workspace_report(UUID, TEXT, TEXT, DATE, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_workspace_report(UUID, TEXT, TEXT, DATE, JSONB) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_workspace_reports(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_kind TEXT DEFAULT NULL
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
            'id', r.id,
            'kind', r.kind,
            'period', r.period,
            'payload', r.payload,
            'createdAt', r.created_at
        ) ORDER BY r.period DESC, r.created_at DESC)
        FROM public.user_reports r
        WHERE r.workspace_id = p_workspace_id
          AND (p_kind IS NULL OR r.kind = p_kind)
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_reports(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_reports(UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- Stub creado para registro de verificación Nivel 2 QR DIAN (pendiente de activación en app)
CREATE OR REPLACE FUNCTION public.register_purchase_verification_stub(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_cufe TEXT,
    p_verification_method TEXT DEFAULT 'qr_dian',
    p_store_id TEXT DEFAULT NULL,
    p_invoice_total NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id UUID;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    INSERT INTO public.purchase_verifications (
        workspace_id, user_id, cufe, store_id, invoice_total, verification_method, status
    )
    VALUES (
        p_workspace_id,
        auth.uid(),
        left(btrim(p_cufe), 120),
        NULLIF(btrim(COALESCE(p_store_id, '')), ''),
        p_invoice_total,
        CASE WHEN p_verification_method IN ('qr_dian','xml_upload','ocr_receipt','manual_admin') THEN p_verification_method ELSE 'qr_dian' END,
        'module_pending'
    )
    ON CONFLICT (cufe) DO UPDATE
    SET status = public.purchase_verifications.status
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'verificationId', v_id,
        'status', 'module_pending',
        'message', 'Módulo de verificación de factura QR DIAN (Nivel 2) creado; validación automática próximamente.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.register_purchase_verification_stub(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_purchase_verification_stub(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO anon, authenticated, service_role;
