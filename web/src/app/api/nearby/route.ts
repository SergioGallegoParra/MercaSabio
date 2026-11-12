import { NextRequest, NextResponse } from "next/server";

import { getNearbyStores } from "@/lib/queries";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const rawLat = Number(searchParams.get("lat"));
  const rawLng = Number(searchParams.get("lng"));
  const rawRadius = Number(searchParams.get("radius") ?? 2000);

  if (
    !Number.isFinite(rawLat) ||
    !Number.isFinite(rawLng) ||
    Math.abs(rawLat) > 90 ||
    Math.abs(rawLng) > 180
  ) {
    return NextResponse.json(
      { error: "Coordenadas inválidas. Envía lat y lng numéricos válidos." },
      { status: 400 }
    );
  }

  const lat = Number(rawLat.toFixed(3));
  const lng = Number(rawLng.toFixed(3));

  const radiusMeters = Number.isFinite(rawRadius)
    ? Math.min(Math.max(Math.round(rawRadius), 300), 10000)
    : 2000;

  try {
    const branches = await getNearbyStores({ lat, lng, radiusMeters });
    return NextResponse.json(
      { branches, radiusMeters },
      {
        headers: {
          "Cache-Control": "s-maxage=180, stale-while-revalidate=600",
        },
      }
    );
  } catch (error) {
    console.error("[api/nearby] Error consultando sucursales cercanas:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las tiendas cercanas en PostGIS." },
      { status: 500 }
    );
  }
}
