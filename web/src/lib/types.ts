export type CompareMode = "ean" | "pum";

export type UnitMeasure = "g" | "ml" | "und";

export interface StoreOffer {
  storeSkuId: string;
  storeId: string;
  storeName: string;
  channelType: string;
  masterProductId: string;
  canonicalCategoryId: number | null;
  rawName: string;
  rawUrl: string | null;
  rawListPrice: number;
  rawSalePrice: number;
  calibratedPrice: number;
  pumPrice: number;
  inStock: boolean;
  sourceOrigin: string;
  isEstimatedPhysicalPrice: boolean;
  isPrivateLabel: boolean;
  brand: string | null;
  ean: string | null;
  netContent: number;
  unitMeasure: UnitMeasure;
  canonicalSlug: string | null;
  canonicalName: string | null;
  imageUrl: string | null;
  positiveVotes: number;
  totalVotes: number;
  avgYieldFactor: number;
  invimaRegistry: string | null;
  actualManufacturer: string | null;
  shrinkflationAlert: boolean;
  previousNetContent: number | null;
  capturedAt: string;
}

export interface ComparisonGroup {
  groupId: string;
  title: string;
  subtitle: string;
  brand: string | null;
  ean: string | null;
  canonicalCategoryId: number | null;
  canonicalSlug: string | null;
  canonicalName: string | null;
  netContent: number;
  unitMeasure: UnitMeasure;
  imageUrl: string | null;
  bestPrice: number;
  bestPum: number;
  bestRealPum: number;
  highestPrice: number;
  savingsPct: number;
  positiveVotes: number;
  totalVotes: number;
  avgYieldFactor: number;
  invimaRegistry: string | null;
  actualManufacturer: string | null;
  shrinkflationAlert: boolean;
  previousNetContent: number | null;
  offers: StoreOffer[];
  signature?: ProductSignatureSummary;
  directCompetitors?: TieredCompetitorMatch[];
  similarCompetitors?: TieredCompetitorMatch[];
  bulkOptions?: BulkComparisonOption[];
  substitutesCount?: number;
  qualityTier?: QualityTier;
  qualityLabel?: string;
  criticalAttribute?: string | null;
  pumRatioVsMedian?: number | null;
  reviewStatus?: ReviewStatus;
  needsReview?: boolean;
  doubtReason?: string | null;
}

export type TieredMatchType = "exact_ean" | "equivalent_size" | "similar_competitor";

export type QualityTier = "economico" | "estandar" | "premium" | "especial";

export type ReviewStatus =
  | "provisional_auto"
  | "needs_review"
  | "reported"
  | "verified"
  | "excluded";

export type CurationReportReason =
  | "distinta_calidad"
  | "distinto_producto"
  | "tamano_incomparable"
  | "otro";

export interface ProductCurationOverride {
  storeSkuId: string;
  masterProductId: string | null;
  overrideSubtype: string | null;
  overrideBroadFamily: string | null;
  overrideQualityTier: QualityTier | null;
  reviewStatus: ReviewStatus;
  doubtReason: string | null;
  adminNotes: string | null;
  updatedAt: string;
}

export interface ComparisonPairRule {
  id: string;
  skuAId: string;
  skuBId: string;
  ruleType: "blocked_pair" | "approved_same_tier" | "approved_substitute";
  reason: string | null;
  createdAt: string;
}

export interface ComparisonReportItem {
  id: string;
  anchorSkuId: string;
  comparedSkuId: string;
  reportReason: CurationReportReason;
  matchTier: string;
  comment: string | null;
  reportCount: number;
  status: "pending" | "resolved_blocked" | "resolved_tier_changed" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

export interface CurationContext {
  overridesBySkuId?: Record<string, ProductCurationOverride>;
  pairRules?: ComparisonPairRule[];
}

export interface ProductSignatureSummary {
  broadFamily: string;
  subtypeFamily: string;
  familyLabel: string;
  effectiveNetContent: number;
  effectiveUnitMeasure: UnitMeasure;
  effectivePum: number;
  qualityTier?: QualityTier;
  qualityLabel?: string;
  criticalAttribute?: string | null;
  pumRatioVsMedian?: number | null;
  reviewStatus?: ReviewStatus;
  needsReview?: boolean;
  doubtReason?: string | null;
}

export interface TieredCompetitorMatch {
  offer: StoreOffer;
  matchType: TieredMatchType;
  weightDiffPct: number;
  priceDiffCop: number;
  pumDiffPct: number;
  reasonLabel: string;
  effectiveNetContent: number;
  effectiveUnitMeasure: UnitMeasure;
  effectivePum: number;
  qualityTier?: QualityTier;
  qualityLabel?: string;
  isCrossTier?: boolean;
}

export interface BulkComparisonOption {
  offer: StoreOffer;
  effectiveNetContent: number;
  effectiveUnitMeasure: UnitMeasure;
  effectivePum: number;
  sizeRatio: number;
  pumSavingsPct: number;
  equivalentAnchorTotalCop: number;
  totalSavingsOnBulkCop: number;
  savingsLabel: string;
}

export interface CanonicalCategoryOption {
  id: number;
  slug: string;
  name: string;
  baseUnit: UnitMeasure;
}

export interface BankPromotion {
  id: number;
  bankName: string;
  storeId: string | null;
  canonicalCategoryId: number | null;
  discountPct: number;
  validDays: number[];
  affiliateUrl: string;
  termsShort: string | null;
  active: boolean;
}

export interface NearbyStoreBranch {
  branchId: string;
  storeId: string;
  branchName: string;
  city: string;
  address: string | null;
  lat: number;
  lng: number;
  distanceMeters: number;
}

export interface DashboardPayload {
  eanGroups: ComparisonGroup[];
  pumGroups: ComparisonGroup[];
  categories: CanonicalCategoryOption[];
  bankPromotions: BankPromotion[];
  storesCount: number;
  totalSkus: number;
  isDemoData: boolean;
  generatedAt: string;
}

export interface AdminSubtypeOption {
  subtype: string;
  broadFamily: string;
  label: string;
  count: number;
}

export interface AdminActiveMatchSummary {
  storeSkuId: string;
  storeName: string;
  storeSlug: string;
  productTitle: string;
  priceCop: number;
  pum: number;
  unitMeasure: UnitMeasure;
  matchType: TieredMatchType;
  qualityTier: QualityTier;
  isCrossTier: boolean;
}

export interface AdminCatalogItem {
  offer: StoreOffer;
  signature: ProductSignatureSummary;
  qualityTier: QualityTier;
  qualityLabel: string;
  criticalAttribute: string | null;
  subtypeMedianPum: number | null;
  pumRatioVsMedian: number | null;
  reviewStatus: ReviewStatus;
  needsReview: boolean;
  doubtReason: string | null;
  hasOverride: boolean;
  adminNotes: string | null;
  directMatches: AdminActiveMatchSummary[];
  similarMatches: AdminActiveMatchSummary[];
}

export interface AdminCurationPayload {
  items: AdminCatalogItem[];
  reports: ComparisonReportItem[];
  pairRules: ComparisonPairRule[];
  subtypeOptions: AdminSubtypeOption[];
  broadFamilies: Array<{ broadFamily: string; label: string; count: number }>;
  stores: Array<{ slug: string; name: string; count: number }>;
  stats: {
    totalActive: number;
    pendingReports: number;
    doubtCount: number;
    verifiedCount: number;
    excludedCount: number;
  };
  generatedAt: string;
}
