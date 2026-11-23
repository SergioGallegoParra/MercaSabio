import { NextRequest, NextResponse } from "next/server";

import { isLocalAdminEnvironment, queryLocalAdminCatalog } from "@/lib/localAdminDb";
import type { AdminStoreCatalogPayload } from "@/lib/types";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = (sp.get("storeId") ?? "").trim().toLowerCase().slice(0, 30);
  const query = (sp.get("q") ?? "").trim().slice(0, 80);
  const categorySlug = (sp.get("category") ?? "").trim().slice(0, 100);
  const subPresentation = (sp.get("subPresentation") ?? "").trim().slice(0, 80);
  const stockFilter = (sp.get("stock") ?? "all").trim().slice(0, 20);
  const labelFilter = (sp.get("label") ?? "all").trim().slice(0, 20);
  const sort = (sp.get("sort") ?? "name_asc").trim().slice(0, 20);
  const includeSummary = sp.get("summary") !== "0";

  const rawPage = Number(sp.get("page") ?? 1);
  const rawPageSize = Number(sp.get("pageSize") ?? 40);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const pageSize = Number.isFinite(rawPageSize)
    ? Math.min(100, Math.max(10, Math.floor(rawPageSize)))
    : 40;

  if (!isLocalAdminEnvironment()) {
    return NextResponse.json(
      { error: "El panel /admin es exclusivo del modo local sobre SQLite." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const payload: AdminStoreCatalogPayload = queryLocalAdminCatalog({
      storeId,
      query,
      categorySlug,
      subPresentation,
      stockFilter,
      labelFilter,
      sort,
      includeSummary,
      page,
      pageSize,
    });

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[api/admin/catalog] Error cargando inventario local:", error);
    return NextResponse.json(
      { error: "No fue posible consultar el inventario de productos en SQLite local." },
      { status: 500 }
    );
  }
}
