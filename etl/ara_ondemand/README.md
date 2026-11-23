# Backend On-Demand de Comparación y Búsqueda · Tiendas Ara

Servicio FastAPI asíncrono (`main.py` + `utils.py`) para consultar en tiempo real las tiendas Ara más cercanas al usuario con control de concurrencia, caché en memoria y paginación *lazy loading*.

## Requisitos y Variables de Entorno

Las dependencias están integradas en `pyproject.toml`, `requirements.txt` y `.venv` (`fastapi`, `uvicorn`, `aiohttp`, `pydantic`).

Configura en `.env` (raíz del proyecto):

```env
ARA_GW_BASE_URL=https://api-gw-prod-v1-501aqrta.ew.gateway.dev
ARA_GW_API_KEY=<tu-api-key-de-ara>
```

> El módulo carga `.env` automáticamente si las variables no están exportadas en la shell actual.

## Cómo Ejecutar el Servidor

Desde la raíz del proyecto:

```powershell
.\.venv\Scripts\uvicorn.exe etl.ara_ondemand.main:app --host 127.0.0.1 --port 8000 --reload
```

O directamente desde `etl/ara_ondemand`:

```powershell
..\..\.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000 --reload
```

Documentación interactiva OpenAPI disponible en `http://127.0.0.1:8000/docs`.

## Endpoints

### 1. Evaluador de Canasta (`POST /evaluar-canasta`)

Recibe `lat`, `lon`, `radio_km` (`0 < radio_km <= 8`) y `lista_productos` (`2` a `50` términos).

- Selecciona hasta las **5 tiendas Ara más cercanas** mediante fórmula de **Haversine**.
- Revisa caché en memoria con TTL de **15 minutos** (`900 s`) bajo llave `f"{store_id}_{query}"`.
- Ejecuta únicamente los *cache misses* con `asyncio` + `aiohttp`, limitados por un `asyncio.Semaphore(5)` global.
- Excluye productos deshabilitados (`isDisabled`) y referencias mayoristas (`X25` / `X 25`).
- Devuelve ofertas crudas (`id`, `code_ean`, `code_sap`, `store_id`, `title`, `price`, `pum`, `category_id`, `category`, `images`) para cálculo posterior de **Sabiómetro**, **PUM** y calidad en el frontend.

Ejemplo:

```bash
curl -X POST http://127.0.0.1:8000/evaluar-canasta \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 5.06889,
    "lon": -75.51738,
    "radio_km": 8,
    "lista_productos": ["Arroz Diana 1kg", "Leche"]
  }'
```

### 2. Búsqueda Libre por Categoría o Query (`GET /buscar`)

Parámetros query: `lat`, `lon`, `radio_km` (`<= 8`), `query` (opcional), `categoria_id` (opcional) y `page_token` (opcional). Al menos uno de `query` o `categoria_id` es obligatorio.

- **Lazy Loading estricto:** consulta únicamente **la tienda más cercana** en la primera página (hasta 20 ítems), retornando `next_page_token`.
- Al recibir `page_token`, continúa con el `nextPageToken` de esa tienda o avanza automáticamente a la siguiente tienda cercana dentro del top 5 cuando se agotan las páginas de la tienda actual.
- **Nota técnica del Gateway:** si se envía solo `categoria_id` sin `query`, la API `/products-search?categoryId=...` devuelve `HTTP 400`, por lo que el servicio pagina `/products?storeId=...` (usando el parámetro real `startAfter` en lugar de `nextPageToken`) y filtra por `categoryId` sin descartar ítems.

Ejemplo:

```bash
curl "http://127.0.0.1:8000/buscar?lat=5.06889&lon=-75.51738&radio_km=8&query=leche"
```

## Hallazgos Clave del Gateway y Reglas de Resiliencia

1. **Unidad de `price`:** en la respuesta real de `/products-search` y `/products`, `price` ya viene en **COP enteros** (ej. `6390` para un quesito de `185 g` cuyo `pum` es `"Gramo a $34.54"`), por lo que no se divide entre `100`.
2. **Identificador de tienda (`id` vs `ID`):** las consultas de catálogo requieren el campo `"id"` (ej. `"0719"`), coincidente con `codeStore`, no el consecutivo `"ID"`.
3. **Latencia de `/stores`:** el directorio completo retorna ~1,653 tiendas y tarda ~6.9 s en frío; se precalienta en RAM al arrancar FastAPI con caché de 6 horas y bloqueo *single-flight*, manteniendo `timeout=4 s` estricto en cada llamada a `/products-search` y `/products`.
4. **Resiliencia:** máximo `3` reintentos con backoff exponencial (`1 s`, `2 s`, `4 s`) ante `HTTP 429`, `5xx` o timeouts, más pausa aleatoria (`0.2 s` a `0.5 s`) antes de cada petición real y transporte IPv4 (`socket.AF_INET`) en Windows. Si una tienda falla tras agotar reintentos, se registra en `errores` y se aborta únicamente esa consulta sin tumbar las demás tiendas.
