"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState } from "react";
import { Footprints, Car, Navigation } from "lucide-react";

import type { NearbyStoreBranch } from "@/lib/types";

export interface RouteMapStop extends NearbyStoreBranch {
  storeName: string;
}

interface RouteMapProps {
  userLocation: { lat: number; lng: number; label?: string };
  stops: RouteMapStop[];
}

interface RouteSummary {
  distanceMeters: number;
  durationSeconds: number;
  isFallback: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function RouteMap({ userLocation, stops }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [travelMode, setTravelMode] = useState<"foot" | "driving">("foot");
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || stops.length === 0) {
      setSummary(null);
      return;
    }

    let cancelled = false;
    let mapInstance: import("leaflet").Map | null = null;

    async function renderMap() {
      setLoadingRoute(true);
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      mapInstance = L.map(containerRef.current, {
        center: [userLocation.lat, userLocation.lng],
        zoom: 14,
        scrollWheelZoom: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(mapInstance);

      const userIcon = L.divIcon({
        className: "merca-pin merca-pin-user",
        html: "<span>Tú</span>",
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      const boundsPoints: [number, number][] = [[userLocation.lat, userLocation.lng]];

      L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
        .addTo(mapInstance)
        .bindPopup(
          `<strong>${escapeHtml(userLocation.label ?? "Tu ubicación")}</strong>`
        );

      stops.forEach((stop, idx) => {
        boundsPoints.push([stop.lat, stop.lng]);
        const stopIcon = L.divIcon({
          className: "merca-pin merca-pin-store",
          html: `<span>${idx + 1}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

        L.marker([stop.lat, stop.lng], { icon: stopIcon })
          .addTo(mapInstance!)
          .bindPopup(
            `<strong>${idx + 1}. ${escapeHtml(stop.storeName)}</strong><br/>${escapeHtml(
              stop.branchName
            )}${stop.address ? `<br/><small>${escapeHtml(stop.address)}</small>` : ""}`
          );
      });

      const waypoints = [
        `${userLocation.lng},${userLocation.lat}`,
        ...stops.map((s) => `${s.lng},${s.lat}`),
      ].join(";");

      let routeCoords: [number, number][] = boundsPoints;
      let isFallback = false;
      let distanceMeters = 0;
      let durationSeconds = 0;

      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/${travelMode}/${waypoints}?overview=full&geometries=geojson`;
        const res = await fetch(osrmUrl);
        if (!res.ok) {
          throw new Error(`OSRM HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          routes?: Array<{
            distance: number;
            duration: number;
            geometry?: { coordinates?: [number, number][] };
          }>;
        };

        const bestRoute = data.routes?.[0];
        if (!bestRoute?.geometry?.coordinates?.length) {
          throw new Error("OSRM sin geometría");
        }

        routeCoords = bestRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        distanceMeters = Math.round(bestRoute.distance);
        durationSeconds = Math.round(bestRoute.duration);
      } catch {
        isFallback = true;
        for (let i = 1; i < boundsPoints.length; i += 1) {
          const [lat1, lng1] = boundsPoints[i - 1];
          const [lat2, lng2] = boundsPoints[i];
          distanceMeters += haversineMeters(lat1, lng1, lat2, lng2);
        }
        distanceMeters = Math.round(distanceMeters);
        const speedMps = travelMode === "foot" ? 1.25 : 6.5;
        durationSeconds = Math.round(distanceMeters / speedMps);
      }

      if (cancelled || !mapInstance) return;

      L.polyline(routeCoords, {
        color: isFallback ? "#0369a1" : "#0f766e",
        weight: 4,
        opacity: 0.9,
        dashArray: isFallback ? "6 6" : undefined,
      }).addTo(mapInstance);

      mapInstance.fitBounds(L.latLngBounds(routeCoords), { padding: [32, 32] });

      setSummary({ distanceMeters, durationSeconds, isFallback });
      setLoadingRoute(false);
    }

    void renderMap();

    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
  }, [userLocation.lat, userLocation.lng, userLocation.label, stops, travelMode]);

  if (stops.length === 0) {
    return null;
  }

  return (
    <div className="route-map-card">
      <div className="route-map-header">
        <div className="route-map-title">
          <Navigation size={15} />
          <span>Mapa de ruta</span>
          {loadingRoute && <span className="tag tag-estimated">Calculando ruta...</span>}
          {!loadingRoute && summary && (
            <span className="tag tag-best tabular">
              {summary.distanceMeters >= 1000
                ? `${(summary.distanceMeters / 1000).toFixed(2)} km`
                : `${summary.distanceMeters} m`}{" "}
              · ~{Math.max(1, Math.round(summary.durationSeconds / 60))} min
              {summary.isFallback ? " (línea directa)" : ""}
            </span>
          )}
        </div>

        <div className="route-mode-toggle">
          <button
            type="button"
            className={`pill ${travelMode === "foot" ? "active" : ""}`}
            onClick={() => setTravelMode("foot")}
          >
            <Footprints size={13} /> A pie
          </button>
          <button
            type="button"
            className={`pill ${travelMode === "driving" ? "active" : ""}`}
            onClick={() => setTravelMode("driving")}
          >
            <Car size={13} /> Vehículo
          </button>
        </div>
      </div>

      <div ref={containerRef} className="route-map-canvas" />
    </div>
  );
}
