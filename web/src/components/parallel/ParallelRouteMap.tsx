"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState } from "react";

import HearthIcon from "@/components/HearthIcon";
import { getTransportProfile } from "@/lib/transport";
import type { NearbyStoreBranch, TransportMode } from "@/lib/types";

export interface ParallelRouteStop extends NearbyStoreBranch {
  storeName: string;
}

export interface ParallelRouteSummary {
  distanceMeters: number;
  durationSeconds: number;
  isFallback: boolean;
  osrmProfile: "foot" | "driving";
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
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Synchronized map component: uses parent transportMode directly instead of
 * maintaining a conflicting internal Foot/Driving toggle.
 */
export default function ParallelRouteMap({
  userLocation,
  stops,
  transportMode,
  radiusMeters,
  variant = "route",
  onSummaryChange,
}: {
  userLocation: { lat: number; lng: number; label: string };
  stops: ParallelRouteStop[];
  transportMode: TransportMode;
  radiusMeters: number;
  variant?: "route" | "preview";
  onSummaryChange?: (summary: ParallelRouteSummary | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [summary, setSummary] = useState<ParallelRouteSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const osrmProfile: "foot" | "driving" =
    transportMode === "car" || transportMode === "moto" ? "driving" : "foot";
  const transportProf = getTransportProfile(transportMode);

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

    async function draw() {
      if (variant === "route") setLoading(true);
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      mapInstance = L.map(containerRef.current, {
        center: [userLocation.lat, userLocation.lng],
        zoom: variant === "preview" ? 13 : 14,
        scrollWheelZoom: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapInstance);

      const userIcon = L.divIcon({
        className: "merca-pin merca-pin-user",
        html: "<span>Tú</span>",
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
        .addTo(mapInstance)
        .bindPopup(`<strong>${escapeHtml(userLocation.label)}</strong>`);

      if (variant === "preview") {
        const circle = L.circle([userLocation.lat, userLocation.lng], {
          radius: Math.max(400, radiusMeters),
          color: "#14432E",
          weight: 2,
          dashArray: "6 5",
          fillColor: "#14432E",
          fillOpacity: 0.08,
        }).addTo(mapInstance);

        stops.slice(0, 12).forEach((s) => {
          const dot = L.divIcon({
            className: "merca-pin merca-pin-dot",
            html: "<span></span>",
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          L.marker([s.lat, s.lng], { icon: dot })
            .addTo(mapInstance!)
            .bindPopup(`<strong>${escapeHtml(s.storeName)}</strong><br/>${escapeHtml(s.branchName)}`);
        });

        try {
          mapInstance.fitBounds(circle.getBounds(), { padding: [20, 20] });
        } catch {
          mapInstance.setView([userLocation.lat, userLocation.lng], 13);
        }
        setLoading(false);
        return;
      }

      const boundsPoints: [number, number][] = [[userLocation.lat, userLocation.lng]];
      stops.forEach((stop, idx) => {
        boundsPoints.push([stop.lat, stop.lng]);
        const stopIcon = L.divIcon({
          className:
            idx === 0
              ? "merca-pin merca-pin-store merca-pin-store-first"
              : "merca-pin merca-pin-store",
          html: `<span>${idx + 1}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        L.marker([stop.lat, stop.lng], { icon: stopIcon })
          .addTo(mapInstance!)
          .bindPopup(
            `<strong>${idx + 1}. ${escapeHtml(stop.storeName)}</strong><br/>${escapeHtml(
              stop.branchName
            )}`
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
        const osrmUrl = `https://router.project-osrm.org/route/v1/${osrmProfile}/${waypoints}?overview=full&geometries=geojson`;
        const res = await fetch(osrmUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          routes?: Array<{
            distance: number;
            duration: number;
            geometry?: { coordinates?: [number, number][] };
          }>;
        };
        const best = json.routes?.[0];
        if (!best?.geometry?.coordinates?.length) throw new Error("No geometry");
        routeCoords = best.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        distanceMeters = Math.round(best.distance);
        // Bike/public speed adjustments when OSRM foot profile is used
        const speedAdj =
          transportMode === "bike" ? 0.45 : transportMode === "public" ? 0.55 : 1;
        durationSeconds = Math.round(best.duration * speedAdj);
      } catch {
        isFallback = true;
        for (let i = 1; i < boundsPoints.length; i += 1) {
          distanceMeters += haversineMeters(
            boundsPoints[i - 1][0],
            boundsPoints[i - 1][1],
            boundsPoints[i][0],
            boundsPoints[i][1]
          );
        }
        distanceMeters = Math.round(distanceMeters);
        const mps =
          transportMode === "car" || transportMode === "moto"
            ? 6.5
            : transportMode === "bike"
              ? 3.6
              : transportMode === "public"
                ? 4.2
                : 1.25;
        durationSeconds = Math.round(distanceMeters / mps);
      }

      if (cancelled || !mapInstance) return;

      L.polyline(routeCoords, {
        color: "#14432E",
        weight: 4,
        opacity: 0.9,
        dashArray: isFallback ? "6 6" : undefined,
      }).addTo(mapInstance);

      mapInstance.fitBounds(L.latLngBounds(routeCoords), { padding: [28, 28] });

      const next: ParallelRouteSummary = {
        distanceMeters,
        durationSeconds,
        isFallback,
        osrmProfile,
      };
      setSummary(next);
      onSummaryChange?.(next);
      setLoading(false);
    }

    void draw();

    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
  }, [
    userLocation.lat,
    userLocation.lng,
    userLocation.label,
    stops,
    osrmProfile,
    transportMode,
    radiusMeters,
    variant,
    onSummaryChange,
  ]);

  return (
    <div className="ms2-map-frame">
      <div
        className="ms2-row-between"
        style={{
          padding: "10px 14px",
          background: "var(--ms2-bg)",
          borderBottom: "1px solid var(--ms2-border)",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.82rem" }}>
          <HearthIcon
            name={osrmProfile === "driving" ? "directions_car" : "directions_walk"}
            size={15}
          />
          <strong>
            {variant === "preview"
              ? `Radio ${(radiusMeters / 1000).toFixed(1)} km (${stops.length} sedes)`
              : `Trayecto ${transportProf.label.toLowerCase()}`}
          </strong>
        </div>

        {summary && (
          <span className="ms2-badge green ms2-num">
            {loading
              ? "Calculando..."
              : `${(summary.distanceMeters / 1000).toFixed(1)} km · ~${Math.max(
                  1,
                  Math.round(summary.durationSeconds / 60)
                )} min`}
          </span>
        )}
      </div>

      <div ref={containerRef} className="ms2-map-canvas" />
    </div>
  );
}
