import { NextRequest, NextResponse } from "next/server";

import { getDashboardData } from "@/lib/queries";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const rawCategory = (searchParams.get("category") ?? "").trim().slice(0, 60);
  const categorySlug = /^[a-z0-9-]*$/.test(rawCategory) ? rawCategory : "";

  try {
    const payload = await getDashboardData({ query, categorySlug });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("[api/search] Error consultando Supabase:", error);
    return NextResponse.json(
      { error: "No fue posible consultar precios en la base de datos." },
      { status: 500 }
    );
  }
}
