"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState } from "react";
import { Car, Crosshair, Footprints, Navigation } from "lucide-react";

import type { NearbyStoreBranch } from "@/lib/types";

export interface RouteMapStop extends NearbyStoreBranch {
  storeName: string;
}

export interface RouteSummary {
  distanceMeters: number;
  durationSeconds: number;
  isFallback: boolean;
  travelMode: "foot" | "driving";
}

interface RouteMapProps {
  userLocation: { lat: number; lng: number; label?: string };
  stops: RouteMapStop[];
  variant?: "route" | "location_preview";
  radiusMeters?: number;
  onRequestGeolocation?: () => void;
  geoLoading?: boolean;
  savingsLabel?: string | null;
  onSummaryChange?: (summary: RouteSummary | null) => void;
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

export default function RouteMap({
  userLocation,
  stops,
  variant = "route",
  radiusMeters = 2500,
  onRequestGeolocation,
  geoLoading = false,
  savingsLabel = null,
  onSummaryChange,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [travelMode, setTravelMode] = useState<"foot" | "driving">("foot");
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (variant === "route" && stops.length === 0) {
      setSummary(null);
      onSummaryChange?.(null);
      return;
    }

    let cancelled = false;
    let mapInstance: import("leaflet").Map | null = null;

    async function renderMap() {
      if (variant === "route") {
        setLoadingRoute(true);
      }
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      mapInstance = L.map(containerRef.current, {
        center: [userLocation.lat, userLocation.lng],
        zoom: variant === "location_preview" ? 13 : 14,
        scrollWheelZoom: false,
        zoomControl: variant === "route",
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapInstance);

      const userIcon = L.divIcon({
        className:
          variant === "location_preview"
            ? "merca-pin merca-pin-user-preview"
            : "merca-pin merca-pin-user",
        html: variant === "location_preview" ? "<span></span>" : "<span>Tú</span>",
        iconSize: variant === "location_preview" ? [28, 28] : [32, 32],
        iconAnchor: variant === "location_preview" ? [14, 14] : [16, 16],
      });

      const boundsPoints: [number, number][] = [[userLocation.lat, userLocation.lng]];

      L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
        .addTo(mapInstance)
        .bindPopup(
          `<strong>${escapeHtml(userLocation.label ?? "Tu ubicación")}</strong>`
        );

      if (variant === "location_preview") {
        const circle = L.circle([userLocation.lat, userLocation.lng], {
          radius: Math.max(400, radiusMeters),
          color: "#26543D",
          weight: 2,
          dashArray: "6 6",
          fillColor: "#26543D",
          fillOpacity: 0.08,
        }).addTo(mapInstance);

        stops.slice(0, 12).forEach((stop) => {
          const storeDot = L.divIcon({
            className: "merca-pin merca-pin-dot",
            html: "<span></span>",
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          L.marker([stop.lat, stop.lng], { icon: storeDot })
            .addTo(mapInstance!)
            .bindPopup(
              `<strong>${escapeHtml(stop.storeName)}</strong><br/>${escapeHtml(
                stop.branchName
              )}`
            );
        });

        try {
          mapInstance.fitBounds(circle.getBounds(), { padding: [18, 18] });
        } catch {
          mapInstance.setView([userLocation.lat, userLocation.lng], 13);
        }
        return;
      }

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
        color: isFallback ? "#26543D" : "#14432E",
        weight: 4,
        opacity: 0.92,
        dashArray: isFallback ? "6 6" : undefined,
      }).addTo(mapInstance);

      mapInstance.fitBounds(L.latLngBounds(routeCoords), { padding: [30, 30] });

      const nextSummary: RouteSummary = {
        distanceMeters,
        durationSeconds,
        isFallback,
        travelMode,
      };
      setSummary(nextSummary);
      onSummaryChange?.(nextSummary);
      setLoadingRoute(false);
    }

    void renderMap();

    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
  }, [
    userLocation.lat,
    userLocation.lng,
    userLocation.label,
    stops,
    travelMode,
    variant,
    radiusMeters,
    onSummaryChange,
  ]);

  if (variant === "location_preview") {
    return (
      <div className="hearth-map-preview-wrap">
        <div ref={containerRef} className="hearth-map-preview-canvas" />
        <div className="hearth-map-center-badge">
          <span className="material-symbols-outlined">location_on</span>
          <span>{userLocation.label ?? "Tu zona"}</span>
        </div>
        {onRequestGeolocation && (
          <button
            type="button"
            className="hearth-map-gps-btn"
            onClick={onRequestGeolocation}
            disabled={geoLoading}
            title="Usar mi ubicación GPS"
            aria-label="Usar mi ubicación GPS"
          >
            <Crosshair size={16} />
          </button>
        )}
      </div>
    );
  }

  if (stops.length === 0) {
    return null;
  }

  return (
    <div className="hearth-route-map-card">
      <div className="hearth-route-map-header">
        <div className="hearth-route-map-title">
          <Navigation size={14} />
          <span>Mapa de ruta</span>
          {loadingRoute && <span className="hearth-badge-soft">Calculando...</span>}
          {!loadingRoute && summary && (
            <span className="hearth-badge-primary tabular">
              {summary.distanceMeters >= 1000
                ? `${(summary.distanceMeters / 1000).toFixed(1)} km`
                : `${summary.distanceMeters} m`}{" "}
              · ~{Math.max(1, Math.round(summary.durationSeconds / 60))} min
            </span>
          )}
        </div>

        <div className="hearth-route-mode-toggle">
          <button
            type="button"
            className={`hearth-toggle-btn ${travelMode === "foot" ? "active" : ""}`}
            onClick={() => setTravelMode("foot")}
          >
            <Footprints size={12} /> A pie
          </button>
          <button
            type="button"
            className={`hearth-toggle-btn ${travelMode === "driving" ? "active" : ""}`}
            onClick={() => setTravelMode("driving")}
          >
            <Car size={12} /> Vehículo
          </button>
        </div>
      </div>

      <div className="hearth-route-canvas-wrap">
        <div ref={containerRef} className="hearth-route-map-canvas" />
        {savingsLabel && (
          <div className="hearth-route-bottom-pill">
            <span className="hearth-route-dot" />
            <span>{savingsLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
