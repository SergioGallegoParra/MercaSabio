-- 0022_user_profiles_and_auth.sql
-- Hogares compartidos sin login obligatorio (sync_workspaces + sesiones por dispositivo),
-- perfil del hogar y catálogo de bancos, billeteras digitales y cajas de compensación.
-- Compatible con activación futura de auth obligatoria por funcionalidad vía REQUIRE_AUTH_FOR.

DO $$
BEGIN
    CREATE TYPE public.transport_mode AS ENUM ('walk', 'bike', 'public', 'moto', 'car');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE public.shopping_cadence AS ENUM ('daily', 'weekly', 'biweekly', 'monthly');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.sync_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_code VARCHAR(20) NOT NULL UNIQUE,
    secret_hash TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    label VARCHAR(80) NOT NULL DEFAULT 'Mi hogar',
    last_device_label VARCHAR(80),
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_workspaces_user
    ON public.sync_workspaces (user_id)
    WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sync_workspace_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    device_id VARCHAR(64) NOT NULL,
    device_name VARCHAR(80) NOT NULL DEFAULT 'Dispositivo',
    device_kind VARCHAR(20) NOT NULL DEFAULT 'desktop' CHECK (device_kind IN ('desktop', 'mobile', 'tablet')),
    token_hash TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    UNIQUE (workspace_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_sessions_workspace
    ON public.sync_workspace_sessions (workspace_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.user_profiles (
    workspace_id UUID PRIMARY KEY REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    display_name VARCHAR(80),
    household_adults SMALLINT NOT NULL DEFAULT 1 CHECK (household_adults BETWEEN 0 AND 20),
    household_children SMALLINT NOT NULL DEFAULT 0 CHECK (household_children BETWEEN 0 AND 20),
    household_pets SMALLINT NOT NULL DEFAULT 0 CHECK (household_pets BETWEEN 0 AND 20),
    monthly_budget_cop NUMERIC(14,2) CHECK (monthly_budget_cop IS NULL OR monthly_budget_cop >= 0),
    weekly_budget_cop NUMERIC(14,2) CHECK (weekly_budget_cop IS NULL OR weekly_budget_cop >= 0),
    shopping_cadence public.shopping_cadence NOT NULL DEFAULT 'biweekly',
    transport_mode public.transport_mode NOT NULL DEFAULT 'walk',
    home_lat DOUBLE PRECISION,
    home_lng DOUBLE PRECISION,
    home_label VARCHAR(120),
    dietary_restrictions TEXT[] NOT NULL DEFAULT '{}',
    preferred_store_ids VARCHAR(30)[] NOT NULL DEFAULT '{}',
    onboarding_completed_at TIMESTAMPTZ,
    phone_verified_at TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payment_partners (
    id VARCHAR(40) PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    partner_type VARCHAR(24) NOT NULL CHECK (partner_type IN ('bank', 'wallet', 'store_card', 'caja_compensacion')),
    logo_url TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO public.payment_partners (id, name, partner_type)
VALUES
    ('nu', 'Nu Colombia', 'bank'),
    ('rappicard', 'RappiCard', 'bank'),
    ('bancolombia', 'Bancolombia', 'bank'),
    ('davivienda', 'Davivienda', 'bank'),
    ('banco_bogota', 'Banco de Bogotá / Aval', 'bank'),
    ('lulo', 'Lulo Bank', 'bank'),
    ('tarjeta_exito', 'Tarjeta Éxito / Carulla', 'store_card'),
    ('nequi', 'Nequi', 'wallet'),
    ('daviplata', 'Daviplata', 'wallet'),
    ('compensar', 'Compensar (Subsidio)', 'caja_compensacion'),
    ('colsubsidio', 'Colsubsidio (Subsidio)', 'caja_compensacion'),
    ('cafam', 'Cafam', 'caja_compensacion'),
    ('comfama', 'Comfama', 'caja_compensacion')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_payment_methods (
    workspace_id UUID NOT NULL REFERENCES public.sync_workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    partner_id VARCHAR(40) NOT NULL REFERENCES public.payment_partners(id) ON DELETE CASCADE,
    product_variant VARCHAR(60) NOT NULL DEFAULT 'estándar',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, partner_id, product_variant)
);

-- RLS estricto
ALTER TABLE public.sync_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_workspace_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de socios de pago" ON public.payment_partners;
CREATE POLICY "Lectura pública de socios de pago"
    ON public.payment_partners FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Propietario autenticado lee su hogar" ON public.sync_workspaces;
CREATE POLICY "Propietario autenticado lee su hogar"
    ON public.sync_workspaces FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Propietario autenticado gestiona su perfil" ON public.user_profiles;
CREATE POLICY "Propietario autenticado gestiona su perfil"
    ON public.user_profiles FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Propietario autenticado gestiona sus pagos" ON public.user_payment_methods;
CREATE POLICY "Propietario autenticado gestiona sus pagos"
    ON public.user_payment_methods FOR ALL TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Propietario autenticado lee sus dispositivos" ON public.sync_workspace_sessions;
CREATE POLICY "Propietario autenticado lee sus dispositivos"
    ON public.sync_workspace_sessions FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.sync_workspaces w
            WHERE w.id = workspace_id AND w.user_id = (SELECT auth.uid())
        )
    );

-- Helper privado: valida que (workspace_id, session_token) o auth.uid() autoricen la operación
CREATE OR REPLACE FUNCTION public._assert_workspace_access(
    p_workspace_id UUID,
    p_session_token TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_hash TEXT;
    v_ok BOOLEAN := FALSE;
BEGIN
    IF p_workspace_id IS NULL THEN
        RAISE EXCEPTION 'workspace_id requerido';
    END IF;

    IF v_uid IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.sync_workspaces w
            WHERE w.id = p_workspace_id AND w.user_id = v_uid
        ) INTO v_ok;
        IF v_ok THEN
            RETURN p_workspace_id;
        END IF;
    END IF;

    IF p_session_token IS NOT NULL AND length(btrim(p_session_token)) >= 16 THEN
        v_hash := encode(sha256(convert_to(btrim(p_session_token), 'UTF8')), 'hex');
        SELECT EXISTS (
            SELECT 1 FROM public.sync_workspace_sessions s
            WHERE s.workspace_id = p_workspace_id
              AND s.revoked_at IS NULL
              AND s.token_hash = v_hash
        ) OR EXISTS (
            SELECT 1 FROM public.sync_workspaces w
            WHERE w.id = p_workspace_id AND w.secret_hash = v_hash
        ) INTO v_ok;
        IF v_ok THEN
            UPDATE public.sync_workspace_sessions
            SET last_seen_at = NOW()
            WHERE workspace_id = p_workspace_id AND token_hash = v_hash;
            RETURN p_workspace_id;
        END IF;
    END IF;

    RAISE EXCEPTION 'Acceso no autorizado al espacio del hogar';
END;
$$;

REVOKE ALL ON FUNCTION public._assert_workspace_access(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._generate_household_code()
RETURNS VARCHAR(20)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_chars CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    v_code TEXT := 'HOGAR-';
    i INT;
BEGIN
    FOR i IN 1..6 LOOP
        v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::INT, 1);
    END LOOP;
    RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public._generate_household_code() FROM PUBLIC, anon, authenticated;

-- Crea o une un hogar sin pedir login; emite token propio para ese dispositivo
CREATE OR REPLACE FUNCTION public.provision_or_join_workspace(
    p_household_code TEXT DEFAULT NULL,
    p_device_id TEXT DEFAULT 'web-default',
    p_device_name TEXT DEFAULT 'Navegador',
    p_device_kind TEXT DEFAULT 'desktop'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_clean_code TEXT := upper(btrim(COALESCE(p_household_code, '')));
    v_dev_id TEXT := left(COALESCE(NULLIF(btrim(p_device_id), ''), gen_random_uuid()::TEXT), 64);
    v_dev_name TEXT := left(COALESCE(NULLIF(btrim(p_device_name), ''), 'Dispositivo'), 80);
    v_dev_kind TEXT := CASE WHEN p_device_kind IN ('desktop','mobile','tablet') THEN p_device_kind ELSE 'desktop' END;
    v_workspace_id UUID;
    v_code VARCHAR(20);
    v_raw_secret TEXT := replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '');
    v_secret_hash TEXT := encode(sha256(convert_to(v_raw_secret, 'UTF8')), 'hex');
    v_joined BOOLEAN := FALSE;
    v_uid UUID := auth.uid();
    v_attempts INT := 0;
BEGIN
    IF v_clean_code <> '' THEN
        SELECT id, household_code INTO v_workspace_id, v_code
        FROM public.sync_workspaces
        WHERE upper(household_code) = v_clean_code
        LIMIT 1;

        IF v_workspace_id IS NULL THEN
            RAISE EXCEPTION 'Código de Hogar no encontrado: %', v_clean_code;
        END IF;
        v_joined := TRUE;
    ELSE
        LOOP
            v_attempts := v_attempts + 1;
            v_code := public._generate_household_code();
            EXIT WHEN NOT EXISTS (SELECT 1 FROM public.sync_workspaces WHERE household_code = v_code) OR v_attempts > 12;
        END LOOP;

        INSERT INTO public.sync_workspaces (household_code, secret_hash, user_id, last_device_label)
        VALUES (v_code, v_secret_hash, v_uid, v_dev_name)
        RETURNING id INTO v_workspace_id;

        INSERT INTO public.user_profiles (workspace_id, user_id)
        VALUES (v_workspace_id, v_uid)
        ON CONFLICT (workspace_id) DO NOTHING;
    END IF;

    INSERT INTO public.sync_workspace_sessions (workspace_id, device_id, device_name, device_kind, token_hash)
    VALUES (v_workspace_id, v_dev_id, v_dev_name, v_dev_kind, v_secret_hash)
    ON CONFLICT (workspace_id, device_id) DO UPDATE
    SET device_name = EXCLUDED.device_name,
        device_kind = EXCLUDED.device_kind,
        token_hash = EXCLUDED.token_hash,
        revoked_at = NULL,
        last_seen_at = NOW();

    UPDATE public.sync_workspaces
    SET last_device_label = v_dev_name,
        last_synced_at = NOW()
    WHERE id = v_workspace_id;

    RETURN jsonb_build_object(
        'workspaceId', v_workspace_id,
        'householdCode', v_code,
        'sessionToken', v_raw_secret,
        'deviceId', v_dev_id,
        'joined', v_joined
    );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_or_join_workspace(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_or_join_workspace(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_workspace_bundle(
    p_workspace_id UUID,
    p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_ws RECORD;
    v_profile JSONB;
    v_payments JSONB;
    v_devices JSONB;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    SELECT id, household_code, label, last_device_label, last_synced_at, created_at
    INTO v_ws
    FROM public.sync_workspaces
    WHERE id = p_workspace_id;

    SELECT to_jsonb(up.*) INTO v_profile
    FROM public.user_profiles up
    WHERE up.workspace_id = p_workspace_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'partnerId', upm.partner_id,
        'productVariant', upm.product_variant,
        'partnerName', pp.name,
        'partnerType', pp.partner_type
    ) ORDER BY pp.name), '[]'::jsonb)
    INTO v_payments
    FROM public.user_payment_methods upm
    JOIN public.payment_partners pp ON pp.id = upm.partner_id
    WHERE upm.workspace_id = p_workspace_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'deviceId', d.device_id,
        'deviceName', d.device_name,
        'deviceKind', d.device_kind,
        'lastSeenAt', d.last_seen_at
    ) ORDER BY d.last_seen_at DESC), '[]'::jsonb)
    INTO v_devices
    FROM public.sync_workspace_sessions d
    WHERE d.workspace_id = p_workspace_id AND d.revoked_at IS NULL;

    RETURN jsonb_build_object(
        'workspace', jsonb_build_object(
            'id', v_ws.id,
            'householdCode', v_ws.household_code,
            'label', v_ws.label,
            'lastDeviceLabel', v_ws.last_device_label,
            'lastSyncedAt', v_ws.last_synced_at
        ),
        'profile', v_profile,
        'paymentMethods', v_payments,
        'devices', v_devices
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_bundle(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_bundle(UUID, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_workspace_profile(
    p_workspace_id UUID,
    p_session_token TEXT,
    p_profile JSONB,
    p_payment_methods JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_pm JSONB;
    v_partner TEXT;
    v_variant TEXT;
BEGIN
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);

    INSERT INTO public.user_profiles (
        workspace_id,
        display_name,
        household_adults,
        household_children,
        household_pets,
        monthly_budget_cop,
        weekly_budget_cop,
        shopping_cadence,
        transport_mode,
        home_lat,
        home_lng,
        home_label,
        dietary_restrictions,
        preferred_store_ids,
        onboarding_completed_at,
        updated_at
    )
    VALUES (
        p_workspace_id,
        NULLIF(left(btrim(COALESCE(p_profile->>'displayName', '')), 80), ''),
        GREATEST(0, LEAST(20, COALESCE((p_profile->>'householdAdults')::SMALLINT, 1))),
        GREATEST(0, LEAST(20, COALESCE((p_profile->>'householdChildren')::SMALLINT, 0))),
        GREATEST(0, LEAST(20, COALESCE((p_profile->>'householdPets')::SMALLINT, 0))),
        NULLIF(p_profile->>'monthlyBudgetCop', '')::NUMERIC(14,2),
        NULLIF(p_profile->>'weeklyBudgetCop', '')::NUMERIC(14,2),
        COALESCE(NULLIF(p_profile->>'shoppingCadence', '')::public.shopping_cadence, 'biweekly'),
        COALESCE(NULLIF(p_profile->>'transportMode', '')::public.transport_mode, 'walk'),
        NULLIF(p_profile->>'homeLat', '')::DOUBLE PRECISION,
        NULLIF(p_profile->>'homeLng', '')::DOUBLE PRECISION,
        NULLIF(left(btrim(COALESCE(p_profile->>'homeLabel', '')), 120), ''),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile->'dietaryRestrictions', '[]'::jsonb))), '{}'),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile->'preferredStoreIds', '[]'::jsonb))), '{}'),
        CASE WHEN (p_profile->>'onboardingCompletedAt') IS NOT NULL THEN (p_profile->>'onboardingCompletedAt')::TIMESTAMPTZ ELSE NOW() END,
        NOW()
    )
    ON CONFLICT (workspace_id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        household_adults = EXCLUDED.household_adults,
        household_children = EXCLUDED.household_children,
        household_pets = EXCLUDED.household_pets,
        monthly_budget_cop = EXCLUDED.monthly_budget_cop,
        weekly_budget_cop = EXCLUDED.weekly_budget_cop,
        shopping_cadence = EXCLUDED.shopping_cadence,
        transport_mode = EXCLUDED.transport_mode,
        home_lat = COALESCE(EXCLUDED.home_lat, public.user_profiles.home_lat),
        home_lng = COALESCE(EXCLUDED.home_lng, public.user_profiles.home_lng),
        home_label = COALESCE(EXCLUDED.home_label, public.user_profiles.home_label),
        dietary_restrictions = EXCLUDED.dietary_restrictions,
        preferred_store_ids = EXCLUDED.preferred_store_ids,
        onboarding_completed_at = COALESCE(public.user_profiles.onboarding_completed_at, EXCLUDED.onboarding_completed_at),
        updated_at = NOW();

    IF p_payment_methods IS NOT NULL AND jsonb_typeof(p_payment_methods) = 'array' THEN
        DELETE FROM public.user_payment_methods WHERE workspace_id = p_workspace_id;
        FOR v_pm IN SELECT * FROM jsonb_array_elements(p_payment_methods) LOOP
            v_partner := btrim(COALESCE(v_pm->>'partnerId', ''));
            v_variant := COALESCE(NULLIF(btrim(COALESCE(v_pm->>'productVariant', '')), ''), 'estándar');
            IF v_partner <> '' AND EXISTS (SELECT 1 FROM public.payment_partners WHERE id = v_partner) THEN
                INSERT INTO public.user_payment_methods (workspace_id, partner_id, product_variant)
                VALUES (p_workspace_id, v_partner, left(v_variant, 60))
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END IF;

    RETURN public.get_workspace_bundle(p_workspace_id, p_session_token);
END;
$$;

REVOKE ALL ON FUNCTION public.save_workspace_profile(UUID, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_workspace_profile(UUID, TEXT, JSONB, JSONB) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.link_workspace_to_auth_user(
    p_workspace_id UUID,
    p_session_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sesión autenticada requerida para vincular usuario';
    END IF;
    PERFORM public._assert_workspace_access(p_workspace_id, p_session_token);
    UPDATE public.sync_workspaces SET user_id = v_uid WHERE id = p_workspace_id;
    UPDATE public.user_profiles SET user_id = v_uid WHERE workspace_id = p_workspace_id;
    UPDATE public.user_payment_methods SET user_id = v_uid WHERE workspace_id = p_workspace_id;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.link_workspace_to_auth_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_workspace_to_auth_user(UUID, TEXT) TO authenticated, service_role;
