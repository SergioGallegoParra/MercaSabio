# Comparador de Precios Retail Colombia (100% Free Tier)

Arquitectura base para ingesta diaria, normalización de unidades, homologación en cascada, Change Data Capture (CDC) en memoria y frontend ISR sobre **Supabase (PostgreSQL)**, **GitHub Actions (Python 3.12)** y **Vercel (Next.js App Router)**.

## Estructura del Proyecto

```text
├── .github/workflows/daily_scrape.yml   # Matriz paralela diaria (03:00 UTC / 22:00 COT)
├── supabase/migrations/
│   ├── 0001_initial_schema.sql          # DDL, pg_trgm, uuid-ossp, v_latest_prices y RPCs
│   └── 0002_seed_stores.sql             # Tiendas iniciales y categorías canónicas base
├── etl/
│   ├── main.py                          # CLI del pipeline (`python -m etl.main --store ...`)
│   ├── core/
│   │   ├── models.py                    # Modelos Pydantic v2 y métricas CDC
│   │   ├── normalizer.py                # Regex de gramajes/volúmenes (g, ml, und) y PUM
│   │   ├── calibrator.py                # Factor alpha por mediana y redondeo ROUND(..., -1)
│   │   ├── canonical_mapper.py          # Mapeo de categorías canónicas y marcas propias
│   │   ├── base_scraper.py              # Cliente httpx.AsyncClient con rate limit y backoff
│   │   ├── entity_resolver.py           # Homologación en cascada (EAN -> pg_trgm -> Canónica)
│   │   └── cdc_manager.py               # CDC en memoria contra v_latest_prices
│   └── scrapers/
│       ├── vtex_scraper.py              # Conector VTEX para Éxito, Carulla y Olímpica
│       ├── d1_scraper.py                # Conector VTEX IO GraphQL para D1 (cookie vtex_segment)
│       ├── ara_scraper.py               # Conector Ara (API JSON móvil y folletos PDF sin navegador)
│       ├── hybris_scraper.py            # Conector SAP Commerce (Hybris) para Alkosto y Ktronix
│       └── rappi_scraper.py             # Conector Rappi con guest token y calibración alpha
├── web/                                 # Frontend Next.js App Router (ISR 6h + Supavisor 6543)
└── tests/                               # Pruebas unitarias con MockTransport e InMemoryGateway
```

## Ejecución ETL (Python 3.12)

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m etl.main --store exito --dry-run --max-categories 1
```

## Ejecución Frontend (`web/`)

Configura `web/.env.local` usando el pool de Supavisor por puerto `6543` (`web/.env.example`):

```bash
cd web
npm install
npm run build
npm run dev
```
