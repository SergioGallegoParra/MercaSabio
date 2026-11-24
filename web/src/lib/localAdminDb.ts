import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { cleanProductTitle, simplifyProductDisplayName } from "@/lib/productInsights";
import type {
  AdminCatalogBrowseRow,
  AdminStoreCatalogPayload,
  AdminStoreSummaryItem,
  CanonicalCategoryOption,
  CurationContext,
  ProductCurationOverride,
  QualityTier,
  ReviewStatus,
  StoreOffer,
  UnitMeasure,
} from "@/lib/types";

interface SqliteStatement {
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => { changes?: number };
}

interface SqliteDatabase {
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
}

const require = createRequire(import.meta.url);

export function isLocalAdminEnvironment(): boolean {
  return !process.env.VERCEL && resolveLocalStagingDbPath() !== null;
}

export function resolveLocalStagingDbPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "../etl/data/local_staging.db"),
    path.resolve(process.cwd(), "etl/data/local_staging.db"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function openLocalSqlite(readonly = true): SqliteDatabase | null {
  if (process.env.VERCEL) return null;
  const dbPath = resolveLocalStagingDbPath();
  if (!dbPath) return null;
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (filename: string, options?: { readOnly?: boolean }) => SqliteDatabase;
  };
  return new DatabaseSync(dbPath, { readOnly: readonly });
}

export function queryLocalAdminCatalog(params: {
  storeId: string;
  query: string;
  categorySlug: string;
  subPresentation: string;
  stockFilter: string;
  labelFilter: string;
  sort: string;
  includeSummary: boolean;
  page: number;
  pageSize: number;
}): AdminStoreCatalogPayload {
  const db = openLocalSqlite(true);
  if (!db) {
    throw new Error("Base local SQLite no disponible");
  }

  try {
    const summary: AdminStoreSummaryItem[] = params.includeSummary
      ? db
          .prepare(
            `
            SELECT
              s.id AS store_id,
              s.name AS store_name,
              COUNT(ss.id) AS total_skus,
              SUM(CASE WHEN mp.canonical_category_id IS NOT NULL THEN 1 ELSE 0 END) AS categorized_skus,
              SUM(CASE WHEN mp.canonical_category_id IS NULL THEN 1 ELSE 0 END) AS uncategorized_skus,
              SUM(CASE WHEN mp.ean IS NOT NULL AND TRIM(mp.ean) <> '' THEN 1 ELSE 0 END) AS with_ean_skus,
              SUM(CASE WHEN mp.image_url IS NOT NULL AND TRIM(mp.image_url) <> '' THEN 1 ELSE 0 END) AS with_image_skus,
              SUM(CASE WHEN mp.is_private_label = 1 THEN 1 ELSE 0 END) AS private_label_skus,
              MAX(ss.last_verified_at) AS last_verified_at
            FROM stores s
            LEFT JOIN store_skus ss ON ss.store_id = s.id AND ss.is_mercado = 1
            LEFT JOIN master_products mp ON mp.id = ss.master_product_id
            GROUP BY s.id, s.name
            ORDER BY total_skus DESC, s.name ASC
            `,
          )
          .all()
          .map((r) => ({
            storeId: String(r.store_id),
            storeName: String(r.store_name),
            totalSkus: Number(r.total_skus ?? 0),
            categorizedSkus: Number(r.categorized_skus ?? 0),
            uncategorizedSkus: Number(r.uncategorized_skus ?? 0),
            withEanSkus: Number(r.with_ean_skus ?? 0),
            withImageSkus: Number(r.with_image_skus ?? 0),
            privateLabelSkus: Number(r.private_label_skus ?? 0),
            lastVerifiedAt: r.last_verified_at ? String(r.last_verified_at) : null,
          }))
      : [];

    const categories: CanonicalCategoryOption[] = params.includeSummary
      ? db
          .prepare("SELECT id, slug, COALESCE(name, slug) AS name, base_unit FROM canonical_categories ORDER BY name ASC")
          .all()
          .map((c) => ({
            id: Number(c.id),
            slug: String(c.slug),
            name: String(c.name),
            baseUnit: (c.base_unit ? String(c.base_unit) : "g") as UnitMeasure,
          }))
      : [];

    const where: string[] = ["ss.is_mercado = 1"];
    const args: unknown[] = [];

    if (params.storeId) {
      where.push("ss.store_id = ?");
      args.push(params.storeId);
    }
    if (params.query) {
      where.push("(LOWER(ss.raw_name) LIKE ? OR LOWER(COALESCE(ss.display_name, '')) LIKE ? OR LOWER(COALESCE(mp.brand, '')) LIKE ? OR COALESCE(mp.ean, '') LIKE ?)");
      const like = `%${params.query.toLowerCase()}%`;
      args.push(like, like, like, like);
    }
    if (params.categorySlug === "__uncategorized__") {
      where.push("mp.canonical_category_id IS NULL");
    } else if (params.categorySlug) {
      where.push("cc.slug = ?");
      args.push(params.categorySlug);
    }
    if (params.subPresentation) {
      where.push("COALESCE(ss.sub_presentation, mp.sub_presentation) = ?");
      args.push(params.subPresentation);
    }
    if (params.stockFilter === "in_stock") {
      where.push("COALESCE(lp.in_stock, 0) = 1");
    } else if (params.stockFilter === "out_of_stock") {
      where.push("COALESCE(lp.in_stock, 0) = 0");
    }
    if (params.labelFilter === "private_label") {
      where.push("mp.is_private_label = 1");
    } else if (params.labelFilter === "national") {
      where.push("mp.is_private_label = 0");
    }

    const whereSql = where.join(" AND ");
    const orderSql =
      params.sort === "price_asc"
        ? "CAST(COALESCE(lp.calibrated_price, 0) AS REAL) ASC"
        : params.sort === "price_desc"
          ? "CAST(COALESCE(lp.calibrated_price, 0) AS REAL) DESC"
          : params.sort === "pum_asc"
            ? "CAST(COALESCE(lp.pum_price, 0) AS REAL) ASC"
            : "COALESCE(ss.display_name, ss.raw_name) ASC";

    const baseFrom = `
      FROM store_skus ss
      JOIN stores s ON s.id = ss.store_id
      JOIN master_products mp ON mp.id = ss.master_product_id
      LEFT JOIN canonical_categories cc ON cc.id = mp.canonical_category_id
      LEFT JOIN price_records lp ON lp.id = (
        SELECT pr.id FROM price_records pr WHERE pr.store_sku_id = ss.id ORDER BY pr.id DESC LIMIT 1
      )
      WHERE ${whereSql}
    `;

    const countRow = db.prepare(`SELECT COUNT(*) AS cnt ${baseFrom}`).get(...args);
    const totalCount = Number(countRow?.cnt ?? 0);
    const offset = (params.page - 1) * params.pageSize;

    const rows = db
      .prepare(
        `
        SELECT
          ss.id AS store_sku_id,
          ss.store_id,
          s.name AS store_name,
          ss.external_sku,
          ss.raw_name,
          COALESCE(ss.display_name, ss.raw_name) AS display_name,
          ss.raw_url,
          mp.brand,
          mp.ean,
          mp.net_content,
          mp.unit_measure,
          mp.is_private_label,
          mp.image_url,
          cc.slug AS canonical_slug,
          cc.name AS canonical_name,
          COALESCE(ss.product_type, mp.product_type) AS product_type,
          COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
          COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
          ss.variant_tags_json,
          ss.is_deprecated_candidate,
          ss.deprecated_reason,
          COALESCE(lp.calibrated_price, '0') AS calibrated_price,
          COALESCE(lp.raw_list_price, '0') AS raw_list_price,
          COALESCE(lp.pum_price, '0') AS pum_price,
          COALESCE(lp.in_stock, 0) AS in_stock,
          COALESCE(lp.source_origin, 'local') AS source_origin,
          COALESCE(lp.captured_at, ss.last_verified_at) AS captured_at
        ${baseFrom}
        ORDER BY ${orderSql}
        LIMIT ? OFFSET ?
        `,
      )
      .all(...args, params.pageSize, offset);

    const items: AdminCatalogBrowseRow[] = rows.map((r) => {
      let variantTags: string[] = [];
      if (r.variant_tags_json) {
        try {
          const parsed = JSON.parse(String(r.variant_tags_json));
          if (Array.isArray(parsed)) variantTags = parsed.map(String);
        } catch {
          variantTags = [];
        }
      }
      return {
        storeSkuId: String(r.store_sku_id),
        storeId: String(r.store_id),
        storeName: String(r.store_name),
        externalSku: String(r.external_sku),
        rawName: String(r.raw_name),
        displayName: String(r.display_name ?? r.raw_name),
        rawUrl: r.raw_url ? String(r.raw_url) : null,
        brand: r.brand ? String(r.brand) : null,
        ean: r.ean ? String(r.ean) : null,
        netContent: Number(r.net_content ?? 1),
        unitMeasure: String(r.unit_measure ?? "und") as UnitMeasure,
        isPrivateLabel: Boolean(r.is_private_label),
        imageUrl: r.image_url ? String(r.image_url) : null,
        canonicalSlug: r.canonical_slug ? String(r.canonical_slug) : null,
        canonicalName: r.canonical_name ? String(r.canonical_name) : null,
        productType: r.product_type ? String(r.product_type) : null,
        subPresentation: r.sub_presentation ? String(r.sub_presentation) : null,
        subPresentationLabel: r.sub_presentation_label ? String(r.sub_presentation_label) : null,
        variantTags,
        isDeprecatedCandidate: Boolean(r.is_deprecated_candidate),
        deprecatedReason: r.deprecated_reason ? String(r.deprecated_reason) : null,
        calibratedPrice: Number(r.calibrated_price ?? 0),
        rawListPrice: Number(r.raw_list_price ?? 0),
        pumPrice: Number(r.pum_price ?? 0),
        inStock: Boolean(r.in_stock),
        sourceOrigin: String(r.source_origin ?? "local"),
        capturedAt: String(r.captured_at ?? ""),
      };
    });

    return {
      summary,
      items,
      categories,
      totalCount,
      page: params.page,
      pageSize: params.pageSize,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

export function applyLocalAdminCuration(params: {
  action: string;
  storeSkuId: string | null;
  qualityTier: string | null;
  subtype: string | null;
  broadFamily: string | null;
  notes: string | null;
}): { ok: true; local: true } {
  const db = openLocalSqlite(false);
  if (!db) {
    throw new Error("Base local SQLite no disponible");
  }
  try {
    if (params.action === "set_product_curation" && params.storeSkuId) {
      const sku = db
        .prepare("SELECT master_product_id FROM store_skus WHERE id = ?")
        .get(params.storeSkuId);
      db.prepare(
        `
        INSERT INTO product_curation_overrides (
          store_sku_id, master_product_id, override_subtype, override_broad_family,
          override_quality_tier, review_status, admin_notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(store_sku_id) DO UPDATE SET
          override_subtype = excluded.override_subtype,
          override_broad_family = excluded.override_broad_family,
          override_quality_tier = excluded.override_quality_tier,
          review_status = 'approved',
          admin_notes = excluded.admin_notes,
          updated_at = CURRENT_TIMESTAMP
        `,
      ).run(
        params.storeSkuId,
        sku?.master_product_id ?? null,
        params.subtype,
        params.broadFamily,
        params.qualityTier,
        params.notes,
      );
    } else if (params.action === "exclude_sku" && params.storeSkuId) {
      db.prepare("UPDATE store_skus SET is_mercado = 0 WHERE id = ?").run(params.storeSkuId);
    }
    return { ok: true, local: true };
  } finally {
    db.close();
  }
}

function normalizeLocalReviewStatus(rawStatus: unknown): ReviewStatus {
  const value = String(rawStatus ?? "").trim();
  if (value === "approved" || value === "verified") return "verified";
  if (value === "excluded" || value === "reported" || value === "needs_review") return value;
  return "provisional_auto";
}

export function getLocalAdminBoardInputs(queryText = ""): {
  offers: StoreOffer[];
  curationContext: CurationContext;
} {
  const db = openLocalSqlite(true);
  if (!db) {
    throw new Error("Base local SQLite no disponible");
  }
  const needle = queryText.trim().toLowerCase();
  const limit = needle ? 240 : 360;

  try {
    const where: string[] = ["ss.is_mercado = 1"];
    const args: unknown[] = [];
    if (needle) {
      where.push(
        "(LOWER(ss.raw_name) LIKE ? OR LOWER(COALESCE(ss.display_name, '')) LIKE ? OR LOWER(COALESCE(mp.brand, '')) LIKE ? OR COALESCE(mp.ean, '') LIKE ?)"
      );
      const like = `%${needle}%`;
      args.push(like, like, like, like);
    }

    const rows = db
      .prepare(
        `
        SELECT
          ss.id AS store_sku_id,
          ss.store_id,
          s.name AS store_name,
          s.channel_type,
          s.markup_discount_factor,
          ss.master_product_id,
          mp.canonical_category_id,
          ss.raw_name,
          ss.display_name,
          ss.raw_url,
          mp.brand,
          mp.ean,
          mp.net_content,
          mp.unit_measure,
          mp.is_private_label,
          mp.image_url,
          cc.slug AS canonical_slug,
          cc.name AS canonical_name,
          COALESCE(ss.product_type, mp.product_type) AS product_type,
          COALESCE(ss.sub_presentation, mp.sub_presentation) AS sub_presentation,
          COALESCE(ss.sub_presentation_label, mp.sub_presentation_label) AS sub_presentation_label,
          ss.variant_tags_json,
          mp.positive_votes,
          mp.total_votes,
          mp.avg_yield_factor,
          mp.invima_registry,
          mp.actual_manufacturer,
          mp.shrinkflation_alert,
          mp.previous_net_content,
          COALESCE(lp.raw_list_price, '0') AS raw_list_price,
          COALESCE(lp.raw_sale_price, '0') AS raw_sale_price,
          COALESCE(lp.calibrated_price, '0') AS calibrated_price,
          COALESCE(lp.pum_price, '0') AS pum_price,
          COALESCE(lp.in_stock, 0) AS in_stock,
          COALESCE(lp.source_origin, 'local') AS source_origin,
          COALESCE(lp.captured_at, ss.last_verified_at) AS captured_at
        FROM store_skus ss
        JOIN stores s ON s.id = ss.store_id
        JOIN master_products mp ON mp.id = ss.master_product_id
        LEFT JOIN canonical_categories cc ON cc.id = mp.canonical_category_id
        LEFT JOIN price_records lp ON lp.id = (
          SELECT pr.id FROM price_records pr WHERE pr.store_sku_id = ss.id ORDER BY pr.id DESC LIMIT 1
        )
        WHERE ${where.join(" AND ")}
        LIMIT ?
        `
      )
      .all(...args, limit);

    const offers: StoreOffer[] = rows.map((r) => {
      const calibratedPrice = Number(r.calibrated_price ?? 0);
      const rawSalePrice = Number(r.raw_sale_price ?? 0);
      const markupFactor = Number(r.markup_discount_factor ?? 1);
      const unitMeasure = String(r.unit_measure ?? "und") as UnitMeasure;
      const rawName = cleanProductTitle(String(r.raw_name ?? ""));
      let variantTags: string[] = [];
      if (r.variant_tags_json) {
        try {
          const parsed = JSON.parse(String(r.variant_tags_json));
          if (Array.isArray(parsed)) variantTags = parsed.map(String);
        } catch {
          variantTags = [];
        }
      }

      return {
        storeSkuId: String(r.store_sku_id),
        storeId: String(r.store_id),
        storeName: String(r.store_name),
        channelType: String(r.channel_type ?? "retailer"),
        masterProductId: String(r.master_product_id),
        canonicalCategoryId:
          r.canonical_category_id !== null && r.canonical_category_id !== undefined
            ? Number(r.canonical_category_id)
            : null,
        rawName,
        displayName:
          String(r.display_name ?? "").trim() ||
          simplifyProductDisplayName(String(r.raw_name ?? ""), unitMeasure),
        rawUrl: r.raw_url ? String(r.raw_url) : null,
        rawListPrice: Number(r.raw_list_price ?? 0),
        rawSalePrice,
        calibratedPrice,
        pumPrice: Number(r.pum_price ?? 0),
        inStock: Boolean(r.in_stock),
        sourceOrigin: String(r.source_origin ?? "local"),
        isEstimatedPhysicalPrice:
          String(r.source_origin ?? "") === "rappi_api" ||
          markupFactor !== 1 ||
          Math.abs(calibratedPrice - rawSalePrice) > 0.01,
        isPrivateLabel: Boolean(r.is_private_label),
        brand: r.brand ? String(r.brand) : null,
        ean: r.ean ? String(r.ean) : null,
        netContent: Number(r.net_content ?? 1),
        unitMeasure,
        canonicalSlug: r.canonical_slug ? String(r.canonical_slug) : null,
        canonicalName: r.canonical_name ? String(r.canonical_name) : null,
        productType: r.product_type ? String(r.product_type) : null,
        subPresentation: r.sub_presentation ? String(r.sub_presentation) : null,
        subPresentationLabel: r.sub_presentation_label ? String(r.sub_presentation_label) : null,
        variantTags,
        imageUrl: r.image_url ? String(r.image_url) : null,
        positiveVotes: Number(r.positive_votes ?? 0),
        totalVotes: Number(r.total_votes ?? 0),
        avgYieldFactor: Number(r.avg_yield_factor ?? 1) || 1,
        invimaRegistry: r.invima_registry ? String(r.invima_registry) : null,
        actualManufacturer: r.actual_manufacturer ? String(r.actual_manufacturer) : null,
        shrinkflationAlert: Boolean(r.shrinkflation_alert),
        previousNetContent:
          r.previous_net_content !== null && r.previous_net_content !== undefined
            ? Number(r.previous_net_content)
            : null,
        capturedAt: String(r.captured_at ?? ""),
      };
    });

    const overrideRows = db
      .prepare(
        `
        SELECT
          store_sku_id, master_product_id, override_subtype, override_broad_family,
          override_quality_tier, review_status, doubt_reason, admin_notes, updated_at
        FROM product_curation_overrides
        `
      )
      .all();

    const overridesBySkuId: Record<string, ProductCurationOverride> = {};
    for (const row of overrideRows) {
      const skuId = String(row.store_sku_id);
      overridesBySkuId[skuId] = {
        storeSkuId: skuId,
        masterProductId: row.master_product_id ? String(row.master_product_id) : null,
        overrideSubtype: row.override_subtype ? String(row.override_subtype) : null,
        overrideBroadFamily: row.override_broad_family ? String(row.override_broad_family) : null,
        overrideQualityTier: row.override_quality_tier
          ? (String(row.override_quality_tier) as QualityTier)
          : null,
        reviewStatus: normalizeLocalReviewStatus(row.review_status),
        doubtReason: row.doubt_reason ? String(row.doubt_reason) : null,
        adminNotes: row.admin_notes ? String(row.admin_notes) : null,
        updatedAt: String(row.updated_at ?? ""),
      };
    }

    return {
      offers,
      curationContext: { overridesBySkuId, pairRules: [] },
    };
  } finally {
    db.close();
  }
}
