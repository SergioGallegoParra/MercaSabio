# Comparador de Precios Retail Colombia - MercaSabio (100% Free Tier)

Arquitectura base para ingesta diaria, normalización de unidades, homologación en cascada, Change Data Capture (CDC) en memoria, detección de shrinkflation y frontend Next.js App Router desplegado en **Cloudflare Workers** (`@opennextjs/cloudflare` + `wrangler`) sobre **Supabase (PostgreSQL + PostGIS via HTTPS/RPC)** y **GitHub Actions (Python 3.12)**.

## Producción

- Frontend (Cloudflare Workers): https://mercasabio.sdgallegop.workers.dev

## Estructura del Proyecto

```text
├── .github/workflows/daily_scrape.yml   # Matriz paralela diaria (03:00 UTC / 22:00 COT)
├── supabase/migrations/
│   ├── 0001_initial_schema.sql          # DDL, pg_trgm, uuid-ossp, v_latest_prices y RPCs
│   ├── 0002_seed_stores.sql             # Tiendas iniciales y categorías canónicas base
│   ├── 0003_rls_and_security_hardening.sql
│   ├── 0004_widen_price_precision.sql
│   ├── 0005_web_search_rpc.sql          # RPCs de búsqueda paginada y resumen de tiendas
│   ├── 0006_ecosystem_features.sql      # PostGIS, store_branches, product_reviews, bank_promotions y get_nearby_stores
│   └── 0007_revoke_trigger_execute.sql
├── etl/
│   ├── main.py                          # CLI del pipeline (`python -m etl.main --store ...`)
│   ├── core/
│   │   ├── models.py                    # Modelos Pydantic v2 y métricas CDC
│   │   ├── normalizer.py                # Regex de gramajes/volúmenes (g, ml, und) y PUM
│   │   ├── calibrator.py                # Factor alpha por mediana y redondeo ROUND(..., -1)
│   │   ├── canonical_mapper.py          # Mapeo de categorías canónicas y marcas propias
│   │   ├── base_scraper.py              # Cliente httpx.AsyncClient con rate limit y backoff
│   │   ├── entity_resolver.py           # Homologación en cascada (EAN -> pg_trgm -> Canónica)
│   │   ├── shrinkflation_detector.py    # Detección de reducción de net_content con precio >= anterior
│   │   └── cdc_manager.py               # CDC en memoria contra v_latest_prices
│   └── scrapers/
│       ├── vtex_scraper.py              # Conector VTEX para Éxito, Carulla y Olímpica
│       ├── d1_scraper.py                # Conector VTEX IO GraphQL para D1 (cookie vtex_segment)
│       ├── ara_scraper.py               # Conector Ara (API JSON móvil y folletos PDF sin navegador)
│       ├── hybris_scraper.py            # Conector SAP Commerce (Hybris) para Alkosto y Ktronix
│       └── rappi_scraper.py            # Conector Rappi con guest token y calibración alpha
├── web/                                 # Frontend Next.js App Router + OpenNext Cloudflare (`mercasabio`)
└── tests/                               # Pruebas unitarias con MockTransport e InMemoryGateway
```

## Ejecución ETL (Python 3.12)

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m etl.main --store exito --dry-run --max-categories 1
```

## Ejecución y Despliegue Frontend (`web/` en Cloudflare Workers)

Configura `web/.env.local` (para `next dev`) y `web/.dev.vars` (para `wrangler` / `preview`) usando las credenciales HTTPS de Supabase (`web/.env.example`: `SUPABASE_URL` y `SUPABASE_ANON_KEY`):

```bash
cd web
npm install
npm run typecheck
npm test
npm run dev
```

### Build, preview local y despliegue en Cloudflare

El Worker configurado en `web/wrangler.jsonc` usa el nombre `mercasabio` y `@opennextjs/cloudflare` (`web/open-next.config.ts`). Para desplegar a producción los secretos deben existir en el Worker:

```bash
cd web
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY

npm run build:cf    # Compila Next.js + OpenNext para Cloudflare (.open-next/)
npm run preview     # Preview local con runtime workerd
npm run deploy      # Compila y despliega a mercasabio.sdgallegop.workers.dev
```
