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

  return (
    <article className="group-card">
      <header className="group-header">
        <div className="group-identity">
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
            <div className="group-thumb group-thumb-placeholder" aria-hidden="true">
              <Package size={24} />
            </div>
          )}

          <div>
            <div className="group-badges-row">
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
                  Alerta de Encogimiento
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

            <h2 className="group-title">{displayTitle}</h2>
            <div className="group-subtitle">
              {group.subtitle}
              {group.ean ? ` · EAN ${group.ean}` : ""}
            </div>
          </div>
        </div>

        <div className="group-summary">
          {group.savingsPct > 0 && (
            <span className="savings-badge tabular">Ahorra hasta {group.savingsPct}%</span>
          )}

          <div className="best-price-box">
            <div className="best-price-label">
              {mode === "pum" ? "Mejor PUM Real" : "Mejor precio"}
            </div>
            <div className="best-price-val tabular">
              {mode === "pum"
                ? `${pumFormatter.format(group.bestRealPum)} / ${group.unitMeasure}`
                : copFormatter.format(group.bestPrice)}
            </div>
            {anchorUsage && Math.abs(group.avgYieldFactor - 1) >= 0.03 && (
              <div className="usage-subprice tabular">
                Costo real por uso:{" "}
                <strong>{copFormatter.format(anchorUsage.realUsagePrice)}</strong>{" "}
                <span className="muted-inline">
                  (etiqueta {copFormatter.format(anchorUsage.nominalPrice)})
                </span>
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
                <Plus size={14} /> Añadir a canasta
              </>
            )}
          </button>
        </div>
      </header>

      {topAnchorPromo && anchorOffer && (
        <div className="bank-promo-strip">
          <div className="bank-promo-info">
            <CreditCard size={15} />
            <span>
              Hoy con <strong>{topAnchorPromo.promo.bankName}</strong> ({topAnchorPromo.promo.discountPct}
              % dcto en {anchorOffer.storeName}):{" "}
              <strong className="tabular">
                {copFormatter.format(topAnchorPromo.discountedPrice)}
              </strong>{" "}
              <span className="muted-inline">
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
              Solicitar tarjeta <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}

      <div className="offers-table-wrap">
        <table className="offers-table">
          <thead>
            <tr>
              <th>Cadena / Producto</th>
              <th>Precio / Real por uso</th>
              <th>PUM ({group.unitMeasure})</th>
              <th>Con tarjeta hoy</th>
              <th>Estado</th>
              <th>Enlace</th>
            </tr>
          </thead>
          <tbody>
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

              return (
                <tr key={offer.storeSkuId} className={isBest ? "best-row" : undefined}>
                  <td data-label="Cadena">
                    <div className="store-cell">
                      <span
                        className={`store-dot store-${offer.storeId}`}
                        aria-hidden="true"
                      />
                      <span>{offer.storeName}</span>
                      {isBest && <span className="tag tag-best">Más barato</span>}
                      {offer.isPrivateLabel && (
                        <span className="tag tag-private">Marca Propia</span>
                      )}
                      {offer.isEstimatedPhysicalPrice && (
                        <span className="tag tag-estimated">
                          Precio estimado en tienda física
                        </span>
                      )}
                    </div>
                    {(mode === "pum" || group.offers.length > 1) && (
                      <div className="group-subtitle">
                        {cleanProductTitle(offer.rawName)} ({offer.netContent} {offer.unitMeasure})
                      </div>
                    )}
                  </td>

                  <td data-label="Precio" className="price-cell tabular">
                    <div>{copFormatter.format(offer.calibratedPrice)}</div>
                    {hasDiscount && (
                      <span className="list-price">
                        {copFormatter.format(offer.rawListPrice)}
                      </span>
                    )}
                    {Math.abs(usage.avgYieldFactor - 1) >= 0.03 && (
                      <span className="real-usage-note">
                        Uso real: {copFormatter.format(usage.realUsagePrice)} (
                        {usage.avgYieldFactor.toFixed(2)}x)
                      </span>
                    )}
                  </td>

                  <td data-label={`PUM (${group.unitMeasure})`} className="tabular">
                    <div>{pumFormatter.format(usage.nominalPum)} / {offer.unitMeasure}</div>
                    {Math.abs(usage.avgYieldFactor - 1) >= 0.03 && (
                      <div className="real-usage-note">
                        Ajustado: {pumFormatter.format(usage.realAdjustedPum)} / {offer.unitMeasure}
                      </div>
                    )}
                  </td>

                  <td data-label="Con tarjeta hoy" className="tabular">
                    {bestBankPromo ? (
                      <div className="bank-cell">
                        <strong className="bank-price">
                          {copFormatter.format(bestBankPromo.discountedPrice)}
                        </strong>
                        {bankUrl !== "#" ? (
                          <a
                            href={bankUrl}
                            target="_blank"
                            rel="noopener noreferrer sponsored"
                            className="bank-affiliate-link"
                          >
                            {bestBankPromo.promo.bankName} (-{bestBankPromo.promo.discountPct}%){" "}
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="bank-affiliate-link">
                            {bestBankPromo.promo.bankName} (-{bestBankPromo.promo.discountPct}%)
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="group-subtitle">—</span>
                    )}
                  </td>

                  <td data-label="Estado">
                    {offer.inStock ? (
                      <span className="tag tag-best">Disponible</span>
                    ) : (
                      <span className="tag tag-out">Agotado</span>
                    )}
                  </td>

                  <td data-label="Enlace">
                    {storeUrl !== "#" ? (
                      <a
                        href={storeUrl}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="store-link"
                      >
                        Ver <ExternalLink size={13} />
                      </a>
                    ) : (
                      <span className="group-subtitle">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
