-- 0027_payment_promotions_calendar.sql
-- Calendario generalizado de alianzas con bancos, billeteras digitales y cajas de compensación,
-- más días promocionales propios de cada cadena. Conserva bank_promotions sin romper compatibilidad.

CREATE TABLE IF NOT EXISTS public.payment_promotions (
    id SERIAL PRIMARY KEY,
    partner_id VARCHAR(40) NOT NULL REFERENCES public.payment_partners(id) ON DELETE CASCADE,
    partner_variant VARCHAR(60),
    store_id VARCHAR(30) REFERENCES public.stores(id) ON DELETE CASCADE,
    canonical_category_id INT REFERENCES public.canonical_categories(id) ON DELETE SET NULL,
    discount_type VARCHAR(24) NOT NULL CHECK (discount_type IN ('pct', 'fixed_cop', 'cashback_pct', 'points_multiplier')),
    discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    max_discount_cop NUMERIC(14,2),
    min_purchase_cop NUMERIC(14,2),
    valid_days INT[] NOT NULL,
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,
    terms_short VARCHAR(255),
    source_url TEXT,
    affiliate_url TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (partner_id, store_id, discount_type, discount_value)
);

CREATE TABLE IF NOT EXISTS public.store_promo_days (
    id SERIAL PRIMARY KEY,
    store_id VARCHAR(30) NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    canonical_category_id INT REFERENCES public.canonical_categories(id) ON DELETE SET NULL,
    label VARCHAR(120) NOT NULL,
    discount_pct NUMERIC(5,2) CHECK (discount_pct IS NULL OR (discount_pct > 0 AND discount_pct <= 100)),
    valid_days INT[] NOT NULL,
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, label)
);

ALTER TABLE public.payment_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_promo_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura pública de promociones de pago" ON public.payment_promotions;
CREATE POLICY "Lectura pública de promociones de pago"
    ON public.payment_promotions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Lectura pública de días promocionales por cadena" ON public.store_promo_days;
CREATE POLICY "Lectura pública de días promocionales por cadena"
    ON public.store_promo_days FOR SELECT TO anon, authenticated USING (true);

-- Migrar registros existentes de bank_promotions
INSERT INTO public.payment_promotions (
    partner_id, store_id, canonical_category_id, discount_type, discount_value,
    valid_days, terms_short, affiliate_url, active
)
SELECT
    CASE
        WHEN bp.bank_name ILIKE '%Éxito%' THEN 'tarjeta_exito'
        WHEN bp.bank_name ILIKE '%Bogotá%' OR bp.bank_name ILIKE '%Aval%' THEN 'banco_bogota'
        WHEN bp.bank_name ILIKE '%Nu%' THEN 'nu'
        WHEN bp.bank_name ILIKE '%Lulo%' THEN 'lulo'
        WHEN bp.bank_name ILIKE '%Davivienda%' THEN 'davivienda'
        WHEN bp.bank_name ILIKE '%Bancolombia%' THEN 'bancolombia'
        ELSE 'nu'
    END AS partner_id,
    bp.store_id,
    bp.canonical_category_id,
    'pct' AS discount_type,
    bp.discount_pct,
    bp.valid_days,
    bp.terms_short,
    bp.affiliate_url,
    bp.active
FROM public.bank_promotions bp
ON CONFLICT (partner_id, store_id, discount_type, discount_value) DO NOTHING;

-- Semillas referenciales del calendario colombiano (verificables y actualizables desde admin)
INSERT INTO public.payment_promotions (
    partner_id, partner_variant, store_id, discount_type, discount_value,
    max_discount_cop, min_purchase_cop, valid_days, terms_short, source_url, active
)
VALUES
    ('tarjeta_exito', 'crédito', 'exito', 'pct', 15.00, 25000, 60000, ARRAY[2,5], 'Martes y viernes 15 % con Tarjeta Éxito en referencias seleccionadas (tope $25.000)', 'https://www.tarjetaexito.com', TRUE),
    ('bancolombia', 'crédito / débito', 'exito', 'pct', 10.00, 20000, 80000, ARRAY[3], 'Miércoles 10 % pagando con tarjetas Bancolombia seleccionadas (tope $20.000)', 'https://www.bancolombia.com', TRUE),
    ('rappicard', 'crédito', 'carulla', 'cashback_pct', 5.00, 15000, NULL, ARRAY[0,1,2,3,4,5,6], 'Hasta 5 % en cashback referencial usando RappiCard en comercios aliados', 'https://www.rappicard.co', TRUE),
    ('nequi', 'billetera digital', 'd1', 'cashback_pct', 3.00, 8000, 40000, ARRAY[1,4], 'Lunes y jueves beneficio referencial en compras desde $40.000 con tarjeta Nequi', 'https://www.nequi.com.co', TRUE),
    ('davivienda', 'crédito / débito', 'olimpica', 'pct', 12.00, 22000, 70000, ARRAY[5], 'Viernes 12 % con tarjetas Davivienda en referencias de mercado (tope $22.000)', 'https://www.davivienda.com', TRUE),
    ('compensar', 'subsidio cuota monetaria', 'ara', 'fixed_cop', 6000.00, 6000, 50000, ARRAY[0,1,2,3,4,5,6], 'Redención referencial de subsidio de caja de compensación en compras desde $50.000', 'https://corporativo.compensar.com', TRUE),
    ('colsubsidio', 'subsidio / tarjeta', 'exito', 'fixed_cop', 7000.00, 7000, 60000, ARRAY[0,1,2,3,4,5,6], 'Uso referencial de bono o cuota monetaria Colsubsidio en mercado básico', 'https://www.colsubsidio.com', TRUE)
ON CONFLICT (partner_id, store_id, discount_type, discount_value) DO NOTHING;

INSERT INTO public.store_promo_days (store_id, label, discount_pct, valid_days, active)
VALUES
    ('exito', 'Martes de frutas y verduras Éxito', 20.00, ARRAY[2], TRUE),
    ('exito', 'Miércoles de carnes y proteína', 15.00, ARRAY[3], TRUE),
    ('carulla', 'Miércoles de campo fresco Carulla', 20.00, ARRAY[3], TRUE),
    ('olimpica', 'Madrugón / Jueves Rojo Olímpica', 15.00, ARRAY[4], TRUE),
    ('ara', 'Imperdibles de quincena Ara', 10.00, ARRAY[5,6], TRUE)
ON CONFLICT (store_id, label) DO NOTHING;
