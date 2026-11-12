"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  ExternalLink,
  Factory,
  Flame,
  Package,
  Plus,
  Sparkles,
  ThumbsUp,
} from "lucide-react";

import {
  buildStoreAffiliateUrl,
  cleanProductTitle,
  computeRealUsageMetrics,
  findActiveBankPromotions,
  getSteamRatingBadge,
  sanitizeExternalUrl,
} from "@/lib/productInsights";
import type { BankPromotion, CompareMode, ComparisonGroup } from "@/lib/types";

export {
  buildStoreAffiliateUrl,
  cleanProductTitle,
  computeRealUsageMetrics,
  findActiveBankPromotions,
  getSteamRatingBadge,
  sanitizeExternalUrl,
} from "@/lib/productInsights";

const STORE_BRAND_META: Record<
  string,
  { short: string; bg: string; fg: string; border: string }
> = {
  d1: { short: "D1", bg: "#fef2f2", fg: "#dc2626", border: "#fecaca" },
  exito: { short: "ÉX", bg: "#fefce8", fg: "#a16207", border: "#fde047" },
  carulla: { short: "CA", bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0" },
  olimpica: { short: "OL", bg: "#fff7ed", fg: "#c2410c", border: "#fed7aa" },
  ara: { short: "AR", bg: "#fff7ed", fg: "#ea580c", border: "#fdba74" },
  rappi: { short: "RP", bg: "#fef2f2", fg: "#e11d48", border: "#fecdd3" },
};

const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const pumFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface ProductCardProps {
  group: ComparisonGroup;
  mode: CompareMode;
  bankPromotions: BankPromotion[];
  currentDay?: number;
  inBasket: boolean;
  onToggleBasket: (group: ComparisonGroup) => void;
}

export default function ProductCard({
  group,
  mode,
  bankPromotions,
  currentDay,
  inBasket,
  onToggleBasket,
}: ProductCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const steam = getSteamRatingBadge(group.positiveVotes, group.totalVotes);
  const anchorOffer = group.offers.find((o) => o.inStock) ?? group.offers[0];
  const anchorUsage = anchorOffer
    ? computeRealUsageMetrics(
        anchorOffer.calibratedPrice,
        anchorOffer.pumPrice,
        anchorOffer.avgYieldFactor
      )
    : null;

  const anchorBankPromos = anchorOffer
    ? findActiveBankPromotions(anchorOffer, bankPromotions, currentDay)
    : [];
  const topAnchorPromo = anchorBankPromos[0] ?? null;
  const topPromoUrl = topAnchorPromo
    ? sanitizeExternalUrl(topAnchorPromo.promo.affiliateUrl)
    : "#";

  const visibleOffers =
    group.offers.length > 3 && !expanded ? group.offers.slice(0, 3) : group.offers;
  const hiddenOffersCount = Math.max(0, group.offers.length - 3);
  const displayTitle = cleanProductTitle(group.title);
  const distinctStores = new Set(group.offers.map((o) => o.storeId)).size;

  return (
    <article className="group-card">
      <header className="card-top">
        <div className="group-identity">
          <div className="group-thumb-box">
            {group.imageUrl && !imgFailed ? (
              <img
                src={group.imageUrl}
                alt={displayTitle}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="group-thumb"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <div className="group-thumb-placeholder" aria-hidden="true">
                <Package size={24} />
                <span>
                  {group.netContent} {group.unitMeasure}
                </span>
              </div>
            )}
          </div>

          <div className="group-meta-col">
            <div className="group-badges-row">
              {group.savingsPct > 0 && (
                <span className="savings-badge tabular">
                  <Flame size={11} /> Ahorras {group.savingsPct}%
                </span>
              )}

              {group.totalVotes > 0 && (
                <span className={`tag ${steam.tone}`}>
                  <ThumbsUp size={11} />
                  {steam.label}
                  {steam.positivePct !== null ? ` (${steam.positivePct}% · ${group.totalVotes})` : ""}
                </span>
              )}

              {anchorUsage?.yieldLabel && (
                <span className="tag tag-yield">
                  <Sparkles size={11} />
                  {anchorUsage.yieldLabel} ({group.avgYieldFactor.toFixed(2)}x)
                </span>
              )}

              {group.shrinkflationAlert && (
                <span className="tag tag-shrinkflation">
                  <AlertTriangle size={11} />
                  Encogimiento
                  {group.previousNetContent
                    ? ` (${group.previousNetContent} → ${group.netContent} ${group.unitMeasure})`
                    : ""}
                </span>
              )}

              {group.invimaRegistry && (
                <span className="tag tag-estimated">
                  <Factory size={11} />
                  INVIMA {group.invimaRegistry}
                  {group.actualManufacturer ? ` · ${group.actualManufacturer}` : ""}
                </span>
              )}
            </div>

            <h2 className="group-title" title={displayTitle}>
              {displayTitle}
            </h2>

            <div className="group-subtitle-pills">
              <span className="meta-pill">{group.brand ?? "Marca comercial"}</span>
              <span className="meta-pill tabular">
                {group.netContent} {group.unitMeasure}
              </span>
              {group.ean && <span className="meta-pill tabular">EAN {group.ean}</span>}
            </div>
          </div>
        </div>

        <div className="card-price-hero">
          <div className="best-price-box">
            <div className="best-price-label">
              {mode === "pum" ? "Mejor PUM Real" : "Mejor precio hoy"}
            </div>
            <div className="best-price-val tabular">
              {mode === "pum"
                ? `${pumFormatter.format(group.bestRealPum)} / ${group.unitMeasure}`
                : copFormatter.format(group.bestPrice)}
            </div>
            <div className="best-price-sub tabular">
              {mode === "pum"
                ? `Desde ${copFormatter.format(group.bestPrice)}`
                : `${pumFormatter.format(group.bestPum)} / ${group.unitMeasure}`}{" "}
              · {distinctStores} {distinctStores === 1 ? "cadena" : "cadenas"}
            </div>
            {anchorUsage && Math.abs(group.avgYieldFactor - 1) >= 0.03 && (
              <div className="usage-subprice tabular">
                Costo real uso: <strong>{copFormatter.format(anchorUsage.realUsagePrice)}</strong>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`basket-toggle-btn ${inBasket ? "in-basket" : ""}`}
            onClick={() => onToggleBasket(group)}
          >
            {inBasket ? (
              <>
                <Check size={14} /> En canasta
              </>
            ) : (
              <>
                <Plus size={14} /> Canasta
              </>
            )}
          </button>
        </div>
      </header>

      {topAnchorPromo && anchorOffer && (
        <div className="bank-promo-strip">
          <div className="bank-promo-info">
            <CreditCard size={14} />
            <span>
              Hoy con <strong>{topAnchorPromo.promo.bankName}</strong> (-
              {topAnchorPromo.promo.discountPct}% en {anchorOffer.storeName}):{" "}
              <strong className="tabular">
                {copFormatter.format(topAnchorPromo.discountedPrice)}
              </strong>{" "}
              <span className="muted-inline tabular">
                (ahorras {copFormatter.format(topAnchorPromo.savingsCop)})
              </span>
            </span>
          </div>
          {topPromoUrl !== "#" && (
            <a
              href={topPromoUrl}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="affiliate-cta"
            >
              Solicitar <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}

      <div className="offers-list">
        {visibleOffers.map((offer, index) => {
          const isBest = index === 0 && offer.inStock;
          const hasDiscount = offer.rawListPrice > offer.calibratedPrice;
          const usage = computeRealUsageMetrics(
            offer.calibratedPrice,
            offer.pumPrice,
            offer.avgYieldFactor
          );
          const bestBankPromo = findActiveBankPromotions(
            offer,
            bankPromotions,
            currentDay
          )[0];
          const bankUrl = bestBankPromo
            ? sanitizeExternalUrl(bestBankPromo.promo.affiliateUrl)
            : "#";
          const storeUrl = offer.rawUrl ? buildStoreAffiliateUrl(offer.rawUrl) : "#";
          const brandMeta = STORE_BRAND_META[offer.storeId] ?? {
            short: offer.storeName.slice(0, 2).toUpperCase(),
            bg: "#f1f5f9",
            fg: "#334155",
            border: "#cbd5e1",
          };

          const refValue = mode === "pum" ? group.bestRealPum : group.bestPrice;
          const curValue = mode === "pum" ? usage.realAdjustedPum : offer.calibratedPrice;
          const diffPct =
            refValue > 0 && curValue > refValue
              ? Math.round(((curValue - refValue) / refValue) * 100)
              : 0;
          const barWidth =
            diffPct === 0 ? 100 : Math.max(24, Math.min(96, Math.round(100 / (1 + diffPct / 100))));

          return (
            <div key={offer.storeSkuId} className={`offer-row ${isBest ? "offer-row-best" : ""}`}>
              <div className="offer-main">
                <span
                  className="store-avatar"
                  style={{
                    backgroundColor: brandMeta.bg,
                    color: brandMeta.fg,
                    borderColor: brandMeta.border,
                  }}
                  aria-hidden="true"
                >
                  {brandMeta.short}
                </span>

                <div className="offer-store-info">
                  <div className="store-cell">
                    <span>{offer.storeName}</span>
                    {isBest && <span className="tag tag-best">Mejor opción</span>}
                    {offer.isPrivateLabel && (
                      <span className="tag tag-private">Marca Propia</span>
                    )}
                    {offer.isEstimatedPhysicalPrice && (
                      <span className="tag tag-estimated">Estimado tienda</span>
                    )}
                    {!offer.inStock && <span className="tag tag-out">Agotado</span>}
                  </div>

                  {(mode === "pum" || group.offers.length > 1) && (
                    <div className="offer-sku-name">
                      {cleanProductTitle(offer.rawName)} · {offer.netContent} {offer.unitMeasure}
                    </div>
                  )}

                  {group.offers.length > 1 && group.bestPrice > 0 && (
                    <div className="price-ratio-row">
                      <div className="price-ratio-track">
                        <div
                          className={`price-ratio-fill ${diffPct === 0 ? "is-best" : ""}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className="price-ratio-label tabular">
                        {diffPct === 0 ? "Mejor precio" : `+${diffPct}% vs. mejor`}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="offer-pricing">
                <div className="offer-price-stack">
                  <div className="offer-price-line">
                    <span className="price-cell tabular">
                      {copFormatter.format(offer.calibratedPrice)}
                    </span>
                    {hasDiscount && (
                      <span className="list-price tabular">
                        {copFormatter.format(offer.rawListPrice)}
                      </span>
                    )}
                  </div>
                  <div className="offer-pum-line tabular">
                    {pumFormatter.format(usage.nominalPum)} / {offer.unitMeasure}
                    {Math.abs(usage.avgYieldFactor - 1) >= 0.03 &&
                      ` · Real ${copFormatter.format(usage.realUsagePrice)}`}
                  </div>
                  {bestBankPromo && (
                    <div className="offer-bank-line tabular">
                      {bankUrl !== "#" ? (
                        <a
                          href={bankUrl}
                          target="_blank"
                          rel="noopener noreferrer sponsored"
                          className="bank-chip-link"
                        >
                          <CreditCard size={11} />
                          {bestBankPromo.promo.bankName}:{" "}
                          {copFormatter.format(bestBankPromo.discountedPrice)} (-
                          {bestBankPromo.promo.discountPct}%)
                        </a>
                      ) : (
                        <span className="bank-chip-link">
                          <CreditCard size={11} />
                          {bestBankPromo.promo.bankName}:{" "}
                          {copFormatter.format(bestBankPromo.discountedPrice)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {storeUrl !== "#" && (
                  <a
                    href={storeUrl}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="store-link-btn"
                    title={`Ir a ${offer.storeName}`}
                  >
                    Ver <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hiddenOffersCount > 0 && (
        <div className="offers-expand-wrap">
          <button
            type="button"
            className="offers-expand-btn"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? (
              <>
                <ChevronUp size={14} /> Mostrar solo las 3 mejores ofertas
              </>
            ) : (
              <>
                <ChevronDown size={14} /> Ver {hiddenOffersCount}{" "}
                {hiddenOffersCount === 1 ? "oferta adicional" : "ofertas adicionales"}
              </>
            )}
          </button>
        </div>
      )}
    </article>
  );
}
