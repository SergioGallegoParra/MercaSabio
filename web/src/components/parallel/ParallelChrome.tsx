"use client";

import Link from "next/link";

import HearthIcon from "@/components/HearthIcon";
import { MercaSabioIsotipo, MercaSabioLogotipo } from "@/components/v3/MercaSabioLogo";
import { useWorkspace } from "@/components/v3/WorkspaceContext";
import { getTransportProfile } from "@/lib/transport";
import type { TransportMode } from "@/lib/types";

export type ParallelTab = "inicio" | "canasta" | "ahorro" | "ruta";

function shortBarrio(zoneLabel: string): string {
  const parts = zoneLabel.split("·").map((p) => p.trim());
  const barrio = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return barrio?.split("/")[0]?.trim() || "Chapinero";
}

export function ParallelHeader({
  activeTab,
  basketCount,
  zoneLabel,
  transportMode,
  radiusMeters,
  onSelectTab,
  onOpenZone,
  onOpenHousehold,
  onOpenMisMercados,
  onOpenFavorites,
  onOpenDevices,
  onOpenAlerts,
}: {
  activeTab: ParallelTab;
  basketCount: number;
  zoneLabel: string;
  transportMode: TransportMode;
  radiusMeters: number;
  onSelectTab: (tab: ParallelTab) => void;
  onOpenZone: () => void;
  onOpenHousehold: () => void;
  onOpenMisMercados: () => void;
  onOpenFavorites: () => void;
  onOpenDevices: () => void;
  onOpenAlerts: () => void;
}) {
  const { unreadAlertsCount, favorites, favoriteLimit } = useWorkspace();
  const prof = getTransportProfile(transportMode);
  const kmText = (radiusMeters / 1000).toFixed(1).replace(".", ",");
  const barrio = shortBarrio(zoneLabel);

  const tabs: Array<{ id: ParallelTab; label: string; count?: number }> = [
    { id: "inicio", label: "Inicio" },
    { id: "canasta", label: "Canasta", count: basketCount },
    { id: "ahorro", label: "Ahorro" },
    { id: "ruta", label: "Ruta" },
  ];

  return (
    <>
      <header className="ms2-header">
        <div className="ms2-header-inner">
          <div className="ms2-header-left">
            <button
              type="button"
              className="ms2-brand-btn"
              onClick={() => onSelectTab("inicio")}
              aria-label="MercaSabio v2, ir al inicio"
            >
              <span className="ms2-desktop-only">
                <MercaSabioLogotipo variant="invertido" compact />
              </span>
              <span className="ms2-mobile-only" style={{ alignItems: "center", gap: 6 }}>
                <MercaSabioIsotipo size={32} />
                <strong style={{ fontSize: "1rem", letterSpacing: "-0.01em" }}>
                  MercaSabio
                </strong>
              </span>
            </button>

            <nav className="ms2-desktop-nav" aria-label="Navegación principal">
              {tabs.map((tab) => {
                const current = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={current ? "page" : undefined}
                    className="ms2-nav-tab"
                    onClick={() => onSelectTab(tab.id)}
                  >
                    <span>{tab.label}</span>
                    {typeof tab.count === "number" && (
                      <span className="ms2-nav-count ms2-num">{tab.count}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="ms2-header-actions">
            <button
              type="button"
              className="ms2-zone-btn"
              onClick={onOpenZone}
              title="Cambiar ciudad, barrio, transporte y radio"
            >
              <span className="ms2-zone-dot" aria-hidden="true" />
              <span>
                {barrio} · {prof.shortLabel} {kmText} km
              </span>
            </button>

            <button
              type="button"
              className="ms2-header-pill ms2-desktop-only"
              onClick={onOpenMisMercados}
              title="Ver mercado activo, habitual y favoritos"
            >
              <HearthIcon name="storefront" size={14} />
              <span>Mis mercados</span>
            </button>

            <button
              type="button"
              className="ms2-header-pill"
              onClick={onOpenHousehold}
              title="Perfil del hogar, dieta y tarjetas"
            >
              <HearthIcon name="home_pin" size={14} />
              <span className="ms2-desktop-only">Hogar</span>
            </button>

            <button
              type="button"
              className="ms2-icon-btn-header"
              onClick={onOpenAlerts}
              aria-label={`Alertas y recompras (${unreadAlertsCount} sin leer)`}
              title="Alertas y recompras"
            >
              <HearthIcon name="notifications" size={16} />
              {unreadAlertsCount > 0 && (
                <span className="ms2-bell-badge ms2-num">{unreadAlertsCount}</span>
              )}
            </button>

            <button
              type="button"
              className="ms2-header-pill gold ms2-desktop-only"
              onClick={onOpenDevices}
              title="Enlazar PC y celular"
            >
              <HearthIcon name="smartphone" size={14} />
              <span>Conectar</span>
            </button>

            <Link
              href="/admin"
              className="ms2-header-pill ms2-desktop-only"
              title="Panel de curación"
              aria-label="Panel de curación"
            >
              <HearthIcon name="tune" size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* Única barra auxiliar móvil: sin duplicar controles en el cuerpo */}
      <div className="ms2-mobile-utility-bar" aria-label="Accesos rápidos del hogar">
        <button type="button" className="ms2-utility-chip" onClick={onOpenMisMercados}>
          <HearthIcon name="storefront" size={14} />
          <span>Mis mercados</span>
        </button>
        <button type="button" className="ms2-utility-chip" onClick={onOpenFavorites}>
          <HearthIcon name="auto_awesome" size={14} />
          <span className="ms2-num">
            Favoritos ({favorites.length}/{favoriteLimit})
          </span>
        </button>
        <button type="button" className="ms2-utility-chip" onClick={onOpenDevices}>
          <HearthIcon name="smartphone" size={14} />
          <span>PC y celular</span>
        </button>
      </div>
    </>
  );
}

export function ParallelMobileBottomNav({
  activeTab,
  basketCount,
  onSelectTab,
}: {
  activeTab: ParallelTab;
  basketCount: number;
  onSelectTab: (tab: ParallelTab) => void;
}) {
  const items: Array<{ id: ParallelTab; label: string; icon: string; badge?: number }> = [
    { id: "inicio", label: "Inicio", icon: "home_pin" },
    { id: "canasta", label: "Canasta", icon: "shopping_basket", badge: basketCount },
    { id: "ahorro", label: "Ahorro", icon: "savings" },
    { id: "ruta", label: "Ruta", icon: "alt_route" },
  ];

  return (
    <nav className="ms2-bottom-nav" aria-label="Menú inferior de secciones">
      {items.map((item) => {
        const active = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            className="ms2-bottom-btn"
            onClick={() => onSelectTab(item.id)}
          >
            <HearthIcon name={item.icon} size={20} />
            {typeof item.badge === "number" && item.badge > 0 && (
              <span className="ms2-bottom-badge ms2-num">{item.badge}</span>
            )}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
