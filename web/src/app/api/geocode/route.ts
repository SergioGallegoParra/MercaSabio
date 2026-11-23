import { NextRequest, NextResponse } from "next/server";

export interface GeocodeResultItem {
  id: string;
  label: string;
  city: string;
  barrio: string;
  lat: number;
  lng: number;
  source: "google" | "osm";
}

interface GooglePlaceV1Item {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
}

interface NominatimItem {
  place_id?: number;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  address?: {
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    quarter?: string;
    city_district?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
  };
}

async function queryGooglePlaces(query: string, apiKey: string): Promise<GeocodeResultItem[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents",
    },
    body: JSON.stringify({
      textQuery: `${query}, Colombia`,
      languageCode: "es",
      regionCode: "CO",
      pageSize: 6,
    }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { places?: GooglePlaceV1Item[] };
  const items = Array.isArray(data.places) ? data.places : [];
  const out: GeocodeResultItem[] = [];

  for (const place of items) {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const comps = place.addressComponents ?? [];
    const findComp = (typeName: string) =>
      comps.find((c) => c.types?.includes(typeName))?.longText?.trim() ?? "";

    const city =
      findComp("locality") ||
      findComp("administrative_area_level_2") ||
      findComp("administrative_area_level_1") ||
      "Colombia";
    const barrio =
      findComp("sublocality_level_1") ||
      findComp("neighborhood") ||
      place.displayName?.text?.trim() ||
      city;
    const display = place.displayName?.text?.trim() || barrio;
    const formatted = place.formattedAddress?.trim() || "";
    const label = formatted && formatted !== display ? `${city} · ${display}` : `${city} · ${barrio}`;

    out.push({
      id: `google:${place.id ?? `${lat},${lng}`}`,
      label: label.slice(0, 80),
      city,
      barrio: formatted ? `${barrio} (${formatted.split(",")[0]})` : barrio,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      source: "google",
    });
  }
  return out;
}

async function queryNominatim(query: string): Promise<GeocodeResultItem[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "co");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "es");
  url.searchParams.set("limit", "6");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "MercaSabio-Web/1.0 (https://mercasabio.co)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(6500),
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as NominatimItem[];
  if (!Array.isArray(rows)) return [];

  const results: GeocodeResultItem[] = [];
  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const addr = row.address ?? {};
    const city =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.state ||
      "Colombia";
    const barrio =
      addr.neighbourhood ||
      addr.suburb ||
      addr.quarter ||
      addr.city_district ||
      addr.road ||
      row.name ||
      city;

    const cleanBarrio = barrio.trim();
    const cleanCity = city.trim();
    const label =
      cleanBarrio && cleanBarrio.toLowerCase() !== cleanCity.toLowerCase()
        ? `${cleanCity} · ${cleanBarrio}`
        : cleanCity;

    results.push({
      id: `osm:${row.place_id ?? `${lat},${lng}`}`,
      label: label.slice(0, 80),
      city: cleanCity,
      barrio: row.display_name ? row.display_name.split(",").slice(0, 2).join(", ") : cleanBarrio,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      source: "osm",
    });
  }
  return results;
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] as GeocodeResultItem[] });
  }

  try {
    const googleKey = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
    let results: GeocodeResultItem[] = [];
    if (googleKey) {
      results = await queryGooglePlaces(q, googleKey).catch(() => []);
    }
    if (results.length === 0) {
      results = await queryNominatim(q).catch(() => []);
    }

    return NextResponse.json(
      { results },
      {
        headers: {
          "Cache-Control": "s-maxage=600, stale-while-revalidate=3600",
        },
      }
    );
  } catch (error) {
    console.error("[api/geocode] Error geocodificando consulta:", error);
    return NextResponse.json({ results: [] as GeocodeResultItem[] }, { status: 200 });
  }
}
