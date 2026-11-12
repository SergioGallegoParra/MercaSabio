# Especificación de Rediseño UI/UX Profesional — MercaSabio (`DESIGN.md`)

> **Propósito de este documento:** Guía técnica e instrucciones paso a paso para que un agente de IA transforme el frontend actual (`web/`) de un prototipo funcional a una **aplicación comercial de nivel producción (Retail / Fintech Consumer App)**, sin romper los tipos (`types.ts`), la lógica de negocio (`queries.ts`, `basketOptimizer.ts`, `productInsights.ts`), la seguridad (`next.config.ts`) ni las pruebas unitarias (`web/tests/ecosystem.test.ts`).

---

## 1. Diagnóstico: ¿Por qué la página actual parece un borrador?

Aunque la arquitectura de datos es sólida, visualmente la interfaz actual presenta **7 problemas de diseño estructurales**:

1. **Sin barra de navegación superior (`Navbar`) ni pie de página (`Footer`):** La página abre directamente con un bloque `.hero` suelto dentro de `<main>`. No existe cabecera fija con marca, selector de ubicación tipo e-commerce (`"📍 Bogotá · Chapinero"`), buscador integrado ni botón de acceso al carrito/canasta; tampoco existe un `<footer>` con explicación metodológica del PUM y aviso legal de enlaces de afiliado.
2. **Tipografía de sistema genérica (`Segoe UI / Arial`):** En `web/src/app/layout.tsx` no se cargan fuentes web mediante `next/font/google`. El uso de fuentes del sistema resta jerarquía tipográfica y personalidad de marca.
3. **Los productos quedan enterrados debajo del pliegue ("Below the Fold"):** Antes de ver el primer producto, el usuario debe pasar por el Hero (`~160px`), el panel de controles (`~220px`) y el panel completo del Optimizador de Canasta (`~240px`). En una pantalla de laptop (`1366×768`), el primer producto apenas asoma al final de la ventana.
4. **Cada producto renderiza una `<table>` HTML de 6 columnas con `<thead>` repetido:** Repetir `Cadena / Producto | Precio / Real por uso | PUM | Con tarjeta hoy | Estado | Enlace` 24 veces por página genera ruido visual de "hoja de cálculo administrativa" en lugar de una tienda o comparador moderno (como Knasta, Idealo, Keepa o Cornershop).
5. **Columna única gigante (`1120px` de ancho por tarjeta):** Cuando un producto tiene 1 o 2 ofertas, una tarjeta de `1120px` de ancho deja más del 60% del espacio en blanco o estira innecesariamente los datos. Una **grilla de 2 columnas en escritorio** (`grid-template-columns: repeat(auto-fill, minmax(480px, 1fr))`) duplica la densidad informativa y permite escanear productos de un vistazo.
6. **Identidad débil de supermercados:** Las cadenas (`D1`, `Carulla`, `Éxito`, `Olímpica`, `Alkosto`, `Ktronix`, `Ara`) se muestran como texto plano con un punto de `9px`. Faltan monogramas/insignias reconocibles con los colores de cada cadena y barras visuales que comparen qué tan cara es una tienda frente a la más barata.
7. **Interacción estática en búsqueda y carga:** El buscador exige presionar `"Buscar"` (no tiene *debounce* automático al escribir ni sugerencias rápidas de búsqueda), y el estado de carga solo baja la opacidad (`opacity: 0.5`) en vez de mostrar tarjetas *skeleton* con animación *shimmer*.

---

## 2. Reglas de Oro para la IA Ejecutora

1. **NO modificar** la firma ni los nombres exportados en:
   - `web/src/lib/types.ts`
   - `web/src/lib/basketOptimizer.ts`
   - `web/src/lib/productInsights.ts`
   - `web/src/lib/queries.ts`
   - `web/src/app/api/search/route.ts` y `web/src/app/api/nearby/route.ts`
   - `web/next.config.ts` (mantener intactas las cabeceras CSP y de seguridad)
2. **Archivos objetivo a modificar:**
   - `web/src/app/layout.tsx`
   - `web/src/components/ProductCard.tsx`
   - `web/src/components/PriceComparator.tsx`
   - `web/src/components/RouteMap.tsx` (solo retoques visuales de contenedor/leyenda si aplica)
   - `web/src/app/globals.css`
3. **Cero dependencias externas nuevas:** Usar únicamente `next/font/google`, `lucide-react` (ya instalado) y CSS moderno nativo (CSS Grid, Flexbox, `backdrop-filter`, variables CSS, `@keyframes`).

---

## 3. Especificación de Cambios Paso a Paso

### PASO 1: Tipografía Profesional y Metadatos en `web/src/app/layout.tsx`

Reemplazar la fuente del sistema por la combinación **Plus Jakarta Sans** (títulos e interfaz) + **JetBrains Mono** (precios, PUM, porcentajes y métricas tabulares) usando `next/font/google`.

**Instrucción exacta para `web/src/app/layout.tsx`:**
- Importar `Plus_Jakarta_Sans` y `JetBrains_Mono` desde `"next/font/google"`.
- Configurar variables CSS `--font-sans` y `--font-mono`:
  ```tsx
  import type { Metadata } from "next";
  import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
  import type { ReactNode } from "react";

  import "./globals.css";

  const jakarta = Plus_Jakarta_Sans({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700", "800"],
    variable: "--font-sans",
    display: "swap",
  });

  const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    weight: ["500", "600", "700"],
    variable: "--font-mono",
    display: "swap",
  });
  ```
- Aplicar `className={`${jakarta.variable} ${jetbrainsMono.variable}`}` en la etiqueta `<html lang="es-CO">`.
- En `globals.css`, usar `font-family: var(--font-sans), system-ui, -apple-system, sans-serif;` en `body` y `font-family: var(--font-mono), monospace;` en `.tabular`.

---

### PASO 2: Nueva Arquitectura de Layout en `web/src/components/PriceComparator.tsx`

Reorganizar la jerarquía visual en **5 zonas claras** para que los productos aparezcan inmediatamente en el primer pantallazo (*Above the Fold*):

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. STICKY TOP NAVBAR (`<header className="site-navbar">`)                    │
│ [Logo MercaSabio]  [🔍 Buscar arroz, leche, EAN... (Debounce 300ms)]         │
│                    [📍 Bogotá · Chapinero ▾]  [🛒 Mi Canasta (2) · $16.400]  │
├──────────────────────────────────────────────────────────────────────────────┤
│ 2. COMPACT HERO + TRUST BAR (`<section className="hero-compact">`)           │
│ Título + Propuesta de valor en 1 línea + 3 KPIs en línea + Chips rápidos:    │
│ Sugerencias rápidas: [Arroz] [Leche] [Aceite] [Huevos] [Café] [Detergente]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ 3. STICKY FILTER & MODE TOOLBAR (`<section className="toolbar-sticky">`)     │
│ [ Modo: (•) Misma marca EAN  ( ) Equivalente PUM ]                           │
│ [ Categorías: (Todas) (Arroz 1kg) (Leche 1L) (Aceite 900ml) ... ]            │
│ [ Mostrar: ☑ Solo 2+ tiendas ]  [ Ordenar: Más cadenas ▾ ]  [197 resultados] │
├──────────────────────────────────────────────────────────────────────────────┤
│ 4. GRILLA BENTO DE PRODUCTOS (2 columnas en desktop, 1 en móvil)             │
│ ┌───────────────────────────────────┐  ┌───────────────────────────────────┐ │
│ │ ProductCard #1 (Sin <table>)      │  │ ProductCard #2 (Sin <table>)      │ │
│ └───────────────────────────────────┘  └───────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│ 5. DRAWER / PANEL COLAPSABLE DE CANASTA Y RUTA + FOOTER PROFESIONAL          │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Detalles obligatorios de implementación en `PriceComparator.tsx`:

1. **Sticky Navbar (`<header className="site-navbar">`):**
   - **Marca:** Ícono o isotipo en gradiente esmeralda (`#0f766e` → `#14b8a6`) + texto `MercaSabio` + badge `COL`.
   - **Buscador central con *Debounce* de 300 ms:**
     - Mantener el `<form onSubmit={handleSearchSubmit}>` para accesibilidad, pero añadir un `useEffect` con `setTimeout(..., 300)` cuando el usuario escriba en `query` (solo si el valor cambió respecto a la última búsqueda ejecutada) para que filtre en vivo sin obligar a hacer clic en `"Buscar"`.
     - Dentro del input, mostrar un spinner animado (`<RefreshCw size={15} className="spin" />`) cuando `loading === true` y un botón `×` para limpiar el texto instantáneamente.
   - **Selector rápido de ubicación en el Navbar:**
     - Un botón/select compacto con `<MapPin size={14} />` para cambiar entre `Bogotá · Chapinero`, `Bogotá · Calle 85`, `Medellín · El Poblado` o `Usar mi GPS`.
   - **Botón de Canasta en el Navbar:**
     - Muestra el contador de productos `basketItems.length` y el total del plan activo (`copFormatter.format(activePlan.totalNominalCost)`). Al hacer clic, abre/despliega el panel del Optimizador de Canasta (`isBasketOpen`) y hace scroll suave hacia él (o abre un Drawer/Modal).

2. **Chips de Búsqueda Rápida (`QUICK_SEARCH_TERMS`):**
   - Debajo del buscador o en el hero compacto, mostrar chips clicables para búsquedas frecuentes: `["Arroz", "Leche", "Aceite", "Huevos", "Café", "Azúcar", "Atún"]`. Al hacer clic en uno, actualiza `query` y ejecuta `fetchFiltered(term, selectedCategory)`.

3. **Optimizador de Canasta Colapsable / Drawer Inteligente:**
   - **Cuando `basketItems.length === 0`:** NO renderizar una caja gigante vacía de 220px. Mostrar únicamente una franja compacta de 1 línea (`.basket-empty-banner`, altura `~48px`) con fondo suave:
     `"🗺️ Ruta de ahorro cercana (${nearbyBranches.length} sedes a ${(radiusMeters/1000).toFixed(1)} km): agrega productos con '+ Canasta' para calcular si te conviene comprar en 1, 2 o 3 tiendas."` + controles compactos de GPS/Radio.
   - **Cuando `basketItems.length > 0`:** Expandir automáticamente `.basket-panel` con las 3 tarjetas comparativas (`1 tienda`, `2 tiendas`, `3 tiendas`), resaltando con borde esmeralda (`2px solid var(--accent)`) y sombra la opción recomendada, junto al mapa `RouteMap` al lado derecho en desktop (layout de 2 columnas dentro de `.basket-body`: izquierda planes e ítems, derecha `RouteMap` de `340px` de alto).

4. **Skeletons de Carga (`.skeleton-card`):**
   - Cuando `loading === true`, mostrar una barra de progreso superior indeterminada y, si se está cambiando de categoría/búsqueda, superponer o mostrar tarjetas con efecto `@keyframes shimmer` para que la transición se sienta instantánea y fluida.

5. **Footer Institucional (`<footer className="site-footer">`):**
   - Incluir 3 columnas al final de `PriceComparator.tsx`:
     - **Columna 1 — Sobre MercaSabio:** Explicación breve de la homologación EAN-13 y el cálculo de Precio por Unidad de Medida (PUM Nominal vs. PUM Real Ajustado por rendimiento).
     - **Columna 2 — Cadenas Monitoreadas:** Badges de `Carulla`, `Éxito`, `Tiendas D1`, `Olímpica`, `Alkosto`, `Ktronix`, `Ara`.
     - **Columna 3 — Transparencia y Aviso Legal:** Nota clara indicando que los precios se actualizan periódicamente desde catálogos públicos, que los precios en tienda física pueden variar según zona, y divulgación de enlaces de afiliado/tarjetas aliadas (`rel="sponsored"`).

---

### PASO 3: Rediseño Completo de `web/src/components/ProductCard.tsx` (Adiós al `<table>` burocrático)

Reemplazar la tabla HTML de 6 columnas por una **Tarjeta Bento Moderna** compuesta por 3 secciones limpias:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ [🛒 IMG 80x80]  [Ahorra 22%] [👍 Muy positivo] [⚠️ Shrinkflation]       │
│                 Arroz Integral Diana 1.000 G                            │
│                 DIANA · 1000 g · EAN 7702001001234                      │
│                                                                         │
│                 MEJOR PRECIO HOY                     [ + Canasta ]      │
│                 $ 4.500   ($4,50 / g · 3 tiendas)                       │
├─────────────────────────────────────────────────────────────────────────┤
│ 💳 Hoy con Tarjeta Éxito (-15% en Carulla): $ 3.825  [Solicitar ↗]      │
├─────────────────────────────────────────────────────────────────────────┤
│ OFERTAS POR CADENA (ordenadas de menor a mayor precio)                  │
│                                                                         │
│ ┌─ 🟢 [D1] Tiendas D1  [Más barato] [Marca Propia] ───────────────────┐ │
│ │  Arroz Integral 1000g              $ 4.500    $4,50/g   [Ver ↗]     │ │
│ │  ████████████████░░░░░░ (100% — Mejor precio)    💳 Nu -5%: $4.275  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ ┌─ 🟢 [CA] Carulla ───────────────────────────────────────────────────┐ │
│ │  Arroz Integral Diana 1000g        $ 5.200    $5,20/g   [Ver ↗]     │ │
│ │  ████████████████████░░ (+15% vs mejor)          💳 Éxito: $4.420   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Detalles obligatorios de implementación en `ProductCard.tsx`:

1. **Mapa de Identidad Visual por Cadena (`STORE_BRAND_META`):**
   Definir en `ProductCard.tsx` un diccionario estático con monograma y clases de color para cada `storeId`:
   ```ts
   const STORE_BRAND_META: Record<
     string,
     { short: string; bg: string; fg: string; border: string }
   > = {
     d1: { short: "D1", bg: "#fef2f2", fg: "#dc2626", border: "#fecaca" },
     exito: { short: "ÉX", bg: "#fefce8", fg: "#a16207", border: "#fde047" },
     carulla: { short: "CA", bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0" },
     olimpica: { short: "OL", bg: "#fff7ed", fg: "#c2410c", border: "#fed7aa" },
     alkosto: { short: "AL", bg: "#fff1f2", fg: "#be123c", border: "#fecdd3" },
     ktronix: { short: "KT", bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
     ara: { short: "AR", bg: "#fff7ed", fg: "#ea580c", border: "#fdba74" },
     rappi: { short: "RP", bg: "#fef2f2", fg: "#e11d48", border: "#fecdd3" },
   };
   ```

2. **Cabecera de Tarjeta (`.card-top`):**
   - **Imagen (`80×80px` en desktop, `64×64px` en móvil):** Contenedor `.group-thumb-box` con fondo blanco puro, borde sutil, `border-radius: 14px`, sombra ligera y transición `transform: scale(1.04)` en `:hover`. Si no hay imagen o falla, mostrar un contenedor estilizado con ícono `<Package size={26} />` y la unidad (`1000 g` / `900 ml`).
   - **Jerarquía de título y metadatos:**
     - Fila superior de insignias: Si `group.savingsPct > 0`, mostrar primero el badge destacado `.savings-badge` (`"🔥 Ahorras {group.savingsPct}%"`). Luego el badge Steam (solo si `group.totalVotes > 0`), badge de rendimiento (`anchorUsage.yieldLabel`), alerta de *Shrinkflation* e INVIMA.
     - Título `.group-title` con `display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;` para que todas las tarjetas mantengan una altura armónica en la grilla de 2 columnas.
     - Subtítulo con marca en mayúscula sostenida (`pill` neutra), contenido neto (`1000 g`) y código EAN si existe.
   - **Bloque de Precio Principal (`.card-price-hero`):**
     - Mostrar claramente el mejor precio en tamaño grande (`1.45rem`, `font-weight: 800`, `var(--font-mono)`), seguido del PUM (`$4,50 / g`) en una línea secundaria clara y el botón `.basket-toggle-btn` con diseño de botón de acción primario/secundario claro (`"+ Canasta"` / `"✓ En canasta"`).

3. **Filas Comparativas de Ofertas (`.offers-list` y `.offer-row` en lugar de `<table>`):**
   - Cada oferta en `visibleOffers` se renderiza como un `<div className={`offer-row ${isBest ? "offer-row-best" : ""}`}>`.
   - **Columna Izquierda de la fila:**
     - Monograma de la cadena (`.store-avatar` de `34×34px` con `short`, `bg`, `fg`, `border` de `STORE_BRAND_META`).
     - Nombre de la tienda (`offer.storeName`), tags (`Más barato`, `Marca Propia`, `Estimado física`, o `Agotado`), y debajo el nombre específico del SKU si `mode === "pum" || group.offers.length > 1`.
     - **Barra visual de proporción de precio (`.price-ratio-bar`):** Cuando `group.offers.length > 1` y `group.bestPrice > 0`, dibujar una barra fina (`height: 4px`, `border-radius: 999px`) cuyo ancho relativo o etiqueta muestre si es el mejor precio (`"Mejor opción"`) o cuánto más cuesta en porcentaje (`"+${diffPct}% vs. mejor"`).
   - **Columna Derecha de la fila:**
     - Precio principal en `var(--font-mono)` (`copFormatter.format(offer.calibratedPrice)`), precio de lista tachado si `hasDiscount`, y PUM (`$4,50 / g`).
     - Si existe `bestBankPromo`, mostrar un chip interactivo compacto: `💳 {bestBankPromo.promo.bankName}: {copFormatter.format(bestBankPromo.discountedPrice)} (-{bestBankPromo.promo.discountPct}%)` enlazado de forma segura (`bankUrl`).
     - Botón/enlace externo a la tienda (`.store-link-btn` con ícono `<ExternalLink size={13} />`).

---

### PASO 4: Sistema de Estilos Completo en `web/src/app/globals.css`

Actualizar `web/src/app/globals.css` aplicando los siguientes principios de diseño:

1. **Paleta de colores refinada y superficies con profundidad:**
   ```css
   :root {
     --bg: #f1f5f9;
     --surface: #ffffff;
     --surface-elevated: #f8fafc;
     --surface-muted: #f1f5f9;
     --border: #e2e8f0;
     --border-strong: #cbd5e1;
     --text: #0f172a;
     --text-secondary: #334155;
     --text-muted: #64748b;
     --accent: #0d9488;
     --accent-hover: #0f766e;
     --accent-soft: #ccfbf1;
     --accent-text: #115e59;
     --radius-sm: 8px;
     --radius-md: 12px;
     --radius-lg: 16px;
     --radius-xl: 20px;
     --shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.04);
     --shadow-sm: 0 2px 8px -2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04);
     --shadow-md: 0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 4px 10px -3px rgba(15, 23, 42, 0.04);
     --shadow-lg: 0 20px 40px -10px rgba(15, 23, 42, 0.14);
   }
   ```

2. **Navbar Sticky con `backdrop-filter: blur(12px)`:**
   - `.site-navbar`: `position: sticky; top: 0; z-index: 50; background: rgba(255, 255, 255, 0.88); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border);`
   - Contenedor interno de `max-width: 1280px; margin: 0 auto; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px;`.

3. **Ancho de contenedor ampliado a `1280px` y Grilla de Productos de 2 Columnas:**
   - `.container`: `max-width: 1280px; margin: 0 auto; padding: 20px 24px 96px;`
   - `.groups-grid`:
     ```css
     .groups-grid {
       display: grid;
       grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
       gap: 20px;
       align-items: start;
     }
     ```
   - En pantallas `< 1100px`, `.groups-grid` pasa automáticamente a `1fr` (`grid-template-columns: 1fr`).

4. **Micro-interacciones en tarjetas y botones:**
   - `.group-card`: `transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;`
   - `.group-card:hover`: `transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--border-strong);`
   - Animación `@keyframes spin` para el indicador de búsqueda y `@keyframes shimmer` para tarjetas de carga.

5. **Layout de 2 columnas dentro del Optimizador de Canasta cuando tiene productos:**
   - `.basket-workspace`: `display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 18px; align-items: start;` en desktop (`> 960px`), apilándose en 1 columna en pantallas menores.

---

## 4. Checklist de Validación para la IA Ejecutora

Al terminar de implementar los pasos 1 a 4, la IA ejecutora **debe correr y verificar**:

1. **Verificación de tipos TypeScript:**
   ```bash
   npm --prefix web run typecheck
   ```
   *(Debe terminar con código `0` y sin errores).*

2. **Pruebas unitarias de frontend y optimizador:**
   ```bash
   npm --prefix web test
   ```
   *(Deben pasar las 4 pruebas en `web/tests/ecosystem.test.ts`).*

3. **Build de producción para Cloudflare Workers:**
   ```bash
   npm --prefix web run build:cf
   ```
   *(Debe generar `.open-next/worker.js` sin errores de compilación ni advertencias de ESLint/Next).*

4. **Despliegue en Cloudflare Workers (si el usuario lo solicita):**
   ```bash
   npm --prefix web run deploy
   ```
