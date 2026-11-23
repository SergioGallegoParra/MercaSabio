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
  displayName?: string | null;
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
  productType?: string | null;
  subPresentation?: string | null;
  subPresentationLabel?: string | null;
  variantTags?: string[];
  imageUrl: string | null;
  positiveVotes: number;
  totalVotes: number;
  avgYieldFactor: number;
  invimaRegistry: string | null;
  actualManufacturer: string | null;
  shrinkflationAlert: boolean;
  previousNetContent: number | null;
  capturedAt: string;
  availableCities?: string[] | null;
  rappiPromoPrice?: number | null;
  rappiSavingsCop?: number | null;
  rappiSavingsPct?: number | null;
  rappiPromoUrl?: string | null;
  sabiometro?: SabiometroSummary;
  productAttributes?: ProductAttributes;
  manufacturing?: ProductManufacturingSummary;
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

export interface RappiDiscountItem {
  storeSkuId: string;
  storeId: string;
  storeName: string;
  displayName: string;
  rawName: string;
  brand: string | null;
  netContent: number;
  unitMeasure: UnitMeasure;
  imageUrl: string | null;
  standardPrice: number;
  rappiPromoPrice: number;
  rappiSavingsCop: number;
  rappiSavingsPct: number;
  rappiPromoUrl: string | null;
}

export interface DashboardPayload {
  eanGroups: ComparisonGroup[];
  pumGroups: ComparisonGroup[];
  categories: CanonicalCategoryOption[];
  bankPromotions: BankPromotion[];
  paymentPartners?: PaymentPartner[];
  paymentPromotions?: PaymentPromotion[];
  storePromoDays?: StorePromoDay[];
  rappiDiscounts?: RappiDiscountItem[];
  samePlantPairs?: Array<{
    productA: string;
    productB: string;
    matchLevel: SamePlantMatchLevel;
    confidence: number;
    verifiedByAdmin: boolean;
    sharedInvimaRegistry: string | null;
    manufacturerName: string | null;
    plantName: string | null;
    plantCity: string | null;
    evidenceUrl?: string | null;
  }>;
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

// --- MercaSabio v3 Domain Contracts ---

export type SubscriptionPlanTier = "free" | "premium";

export type GatedFeature =
  | "multi_device_sync"
  | "personal_inflation"
  | "household_report"
  | "payment_calendar"
  | "alerts_replenish"
  | "sabiometro_vote"
  | "budget_optimizer"
  | "save_habitual_basket"
  | "purchase_verification"
  | "community_baskets"
  | "favorite_baskets";

export type SabiometroSatisfaction = 1 | 0.75 | 0.25 | 0;
export type SabiometroYieldFactor = 0.5 | 1 | 1.5;
export type SabiometroReputationLevel = 0 | 1 | 2;
export type SabiometroStatus = "insufficient" | "published" | "under_review";
export type SabiometroConsensusLabel =
  | "Sin calificación suficiente"
  | "Compra segura"
  | "Consenso moderado"
  | "Opiniones divididas";
export type SabiometroSupportLabel =
  | "Pocas reseñas"
  | "Respaldado"
  | "Ampliamente probado";

export interface SabiometroVoteInput {
  satisfaction: SabiometroSatisfaction;
  yieldFactor: SabiometroYieldFactor;
  reputationLevel?: SabiometroReputationLevel;
  effectiveWeightOverride?: number;
  ageDays?: number;
  comment?: string;
}

export interface SabiometroSummary {
  masterProductId: string;
  voteMass: number;
  pHat: number | null;
  rBad: number | null;
  fYield: number;
  wilsonLower: number | null;
  valueIndex: number | null;
  status: SabiometroStatus;
  consensusLabel: SabiometroConsensusLabel;
  supportLabel: SabiometroSupportLabel | null;
  votesCount: number;
  underReview: boolean;
  frozenAt?: string | null;
  computedAt?: string | null;
}

export type PurchaseVerificationStatus =
  | "pending"
  | "verified"
  | "rejected"
  | "module_pending";

export interface PurchaseVerificationStub {
  verificationId?: string;
  cufe: string;
  storeId?: string | null;
  invoiceTotal?: number | null;
  verificationMethod: "qr_dian" | "xml_upload" | "ocr_receipt" | "manual_admin";
  status: PurchaseVerificationStatus;
  message: string;
}

export type SamePlantMatchLevel =
  | "same_registry"
  | "same_plant"
  | "same_manufacturer";

export interface ProductManufacturingSummary {
  masterProductId: string;
  manufacturerName: string | null;
  plantId?: string | null;
  plantName: string | null;
  plantCity: string | null;
  invimaRegistry: string | null;
  evidenceType?: "invima_registry" | "label_photo" | "official_statement" | "community";
  evidenceUrl?: string | null;
  confidence: number;
  verifiedByAdmin: boolean;
}

export interface SamePlantInfo {
  matchLevel: SamePlantMatchLevel;
  confidence: number;
  verifiedByAdmin: boolean;
  manufacturerName: string | null;
  plantName: string | null;
  plantCity: string | null;
  invimaRegistry: string | null;
  evidenceUrl?: string | null;
  explanationText: string;
}

export type DietFilter =
  | "lactose_free"
  | "gluten_free"
  | "low_sugar"
  | "high_protein"
  | "vegan"
  | "vegetarian"
  | "low_sodium";

export interface ProductAttributes {
  masterProductId: string;
  lactoseFree: boolean | null;
  glutenFree: boolean | null;
  vegan: boolean | null;
  vegetarian: boolean | null;
  sugarG100: number | null;
  proteinG100: number | null;
  sodiumMg100: number | null;
  fatG100: number | null;
  kcal100: number | null;
  frontWarningSeals: string[];
  source: "label_scrape" | "open_food_facts" | "manual" | "inferred_name";
  confidence: number;
}

export type TransportMode = "walk" | "bike" | "public" | "moto" | "car";
export type ShoppingCadence = "daily" | "weekly" | "biweekly" | "monthly";

export interface UserProfile {
  workspaceId: string;
  displayName: string | null;
  planTier?: SubscriptionPlanTier;
  householdAdults: number;
  householdChildren: number;
  householdPets: number;
  monthlyBudgetCop: number | null;
  weeklyBudgetCop: number | null;
  shoppingCadence: ShoppingCadence;
  transportMode: TransportMode;
  homeLat: number | null;
  homeLng: number | null;
  homeLabel: string | null;
  dietaryRestrictions: DietFilter[];
  preferredStoreIds: string[];
  onboardingCompletedAt: string | null;
}

export interface PaymentPartner {
  id: string;
  name: string;
  partnerType: "bank" | "wallet" | "store_card" | "caja_compensacion";
  logoUrl?: string | null;
}

export interface UserPaymentMethod {
  partnerId: string;
  productVariant: string;
  partnerName?: string;
  partnerType?: PaymentPartner["partnerType"];
}

export interface PaymentPromotion {
  id: number;
  partnerId: string;
  partnerName?: string;
  partnerVariant?: string | null;
  storeId: string | null;
  canonicalCategoryId?: number | null;
  discountType: "pct" | "fixed_cop" | "cashback_pct" | "points_multiplier";
  discountValue: number;
  maxDiscountCop?: number | null;
  minPurchaseCop?: number | null;
  validDays: number[];
  validFrom?: string;
  validTo?: string | null;
  termsShort?: string | null;
  sourceUrl?: string | null;
  affiliateUrl?: string | null;
  active: boolean;
  lastVerifiedAt?: string | null;
}

export interface StorePromoDay {
  id: number;
  storeId: string;
  label: string;
  discountPct: number | null;
  validDays: number[];
  active: boolean;
}

export type SwapReason =
  | "same_plant"
  | "lower_pum"
  | "better_sabiometro"
  | "same_tier"
  | "private_label_equivalent"
  | "bulk_format"
  | "diet_match";

export interface HabitualSwap {
  itemKey: string;
  habitual: {
    title: string;
    brand: string | null;
    priceCop: number;
    imageUrl: string | null;
    netContent: number;
    unitMeasure: UnitMeasure;
    pum: number;
    realPum: number;
    qualityTier?: QualityTier;
  };
  recommended: StoreOffer;
  quantity: number;
  nominalCostCop: number;
  savingsCop: number;
  savingsPct: number;
  pumWarning: boolean;
  reasonCodes: SwapReason[];
  reasonsText: string[];
  samePlant?: SamePlantInfo | null;
  sabiometro?: SabiometroSummary | null;
  qualityTier?: QualityTier;
  locked: boolean;
}

export interface BudgetOptimizationResult {
  feasible: boolean;
  totalCop: number;
  budgetCop: number;
  minimumPossibleCop: number;
  utilityScore: number;
  mode: "my_brands" | "generic";
  selectedCandidates: Record<string, StoreOffer>;
  swaps: HabitualSwap[];
  blockingLocks: Array<{
    itemKey: string;
    label: string;
    unlockSavingsCop: number;
  }>;
}

export interface PackTrapFinding {
  itemKey: string;
  largeOffer: StoreOffer;
  combo: Array<{ offer: StoreOffer; units: number }>;
  comboContent: number;
  largeContent: number;
  comboCostCop: number;
  largeCostCop: number;
  comboPum: number;
  largePum: number;
  equivalentSavingsCop: number;
  savingsPct: number;
  message: string;
}

export interface HouseholdReportItem {
  itemKey: string;
  familyLabel: string;
  currentTitle: string;
  recommendedTitle: string;
  monthlyCurrentCostCop: number;
  monthlyBulkCostCop: number;
  monthlySavingsCop: number;
  tripsAvoidedPerMonth: number;
  perishableSkipped: boolean;
  packTrapApplied: boolean;
  note: string;
}

export interface HouseholdReport {
  householdMembersEquivalent: number;
  adults: number;
  children: number;
  totalMonthlySavingsCop: number;
  totalTripsAvoidedPerMonth: number;
  items: HouseholdReportItem[];
  skippedPerishableFamilies: string[];
}

export interface WeeklyShoppingPlan {
  bestDayOfWeek: number;
  bestDayLabel: string;
  bestChainCombo: string;
  projectedTotalCop: number;
  paymentDiscountCop: number;
  matrix: Array<{
    dayOfWeek: number;
    dayLabel: string;
    cells: Array<{
      storeId: string;
      storeName: string;
      partnerName: string | null;
      promoLabel: string | null;
      discountCop: number;
      estimatedTotalCop: number;
      staleVerification: boolean;
    }>;
  }>;
}

export interface InflationLineItem {
  masterProductId: string;
  title: string;
  familyLabel: string;
  quantity: number;
  priceACop: number;
  priceBCop: number;
  deltaCop: number;
  deltaPct: number;
}

export interface InflationReport {
  dateA: string;
  dateB: string;
  totalACop: number;
  totalBCop: number;
  deltaCop: number;
  deltaPct: number;
  foodIpcReferencePct: number;
  missingCount: number;
  topCauses: Array<{ familyLabel: string; deltaCop: number }>;
  lines: InflationLineItem[];
  containmentSwaps: HabitualSwap[];
  containmentSavingsCop: number;
}

export interface ReplenishmentAlert {
  familyKey: string;
  label: string;
  estimatedDaysRemaining: number;
  urgencyRatio: number;
  hasActivePromo: boolean;
  promoText: string | null;
  suggestedOffer?: StoreOffer;
  dedupeKey: string;
  message: string;
}

export interface SavingsProjection {
  savingsPerTripCop: number;
  optimizedBasketTotalCop: number;
  cadence: ShoppingCadence;
  tripsPerMonth: number;
  monthlySavingsCop: number;
  yearlySavingsCop: number;
  freeMarketsPerYear: number;
  label: string;
  headline: string;
}

export interface SyncWorkspace {
  id: string;
  householdCode: string;
  label: string;
  lastDeviceLabel: string | null;
  lastSyncedAt: string;
}

export interface WorkspaceDevice {
  deviceId: string;
  deviceName: string;
  deviceKind: "desktop" | "mobile" | "tablet";
  lastSeenAt: string;
}

export interface SyncedBasketItem {
  id?: string;
  basketId: string;
  itemKey: string;
  payload: Record<string, unknown>;
  quantity: number;
  isLocked: boolean;
  chosenStoreSkuId?: string | null;
  checkedAt?: string | null;
  checkedByDevice?: string | null;
  sortOrder: number;
  version: number;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface SyncedBasket {
  id: string;
  workspaceId: string;
  title: string;
  status: "draft" | "optimized" | "shopping" | "completed" | "archived";
  isHabitual: boolean;
  budgetCop: number | null;
  optimizeMode: "my_brands" | "generic";
  activeDietFilters: DietFilter[];
  transportMode: TransportMode | null;
  maxStores: number;
  radiusMeters: number | null;
  lastPlan: Record<string, unknown> | null;
  lastPlanAt: string | null;
  version: number;
  updatedByDevice: string | null;
  createdAt: string;
  updatedAt: string;
  items: SyncedBasketItem[];
}

export interface WorkspaceAlert {
  id: string;
  kind:
    | "promo_day"
    | "replenish"
    | "inflation_report"
    | "price_drop"
    | "pack_trap"
    | "budget_overrun"
    | "sync";
  title: string;
  body: string;
  deepLink?: string | null;
  payload?: Record<string, unknown> | null;
  dedupeKey: string;
  scheduledFor: string;
  readAt?: string | null;
  dismissedAt?: string | null;
}

export type CommunityCategoryTag =
  | "general"
  | "economico"
  | "alto_proteina"
  | "sin_lactosa"
  | "familiar"
  | "rapido";

export interface FavoriteBasketRecord {
  id: string;
  workspaceId: string;
  title: string;
  optimizeMode: "my_brands" | "generic";
  itemsCount: number;
  items: Record<string, unknown>[];
  activeDietFilters: DietFilter[];
  estimatedTotalCop: number;
  estimatedSavingsCop: number;
  storeSummary: string;
  zoneLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityBasketRecord {
  id: string;
  authorAlias: string;
  title: string;
  description: string | null;
  categoryTag: CommunityCategoryTag;
  zoneLabel: string;
  itemsCount: number;
  items: Record<string, unknown>[];
  activeDietFilters: DietFilter[];
  estimatedTotalCop: number;
  estimatedSavingsCop: number;
  estimatedSavingsPct: number;
  storeSummary: string;
  avgSabiometro: number | null;
  copiesCount: number;
  createdAt: string;
}

export interface AdminStoreSummaryItem {
  storeId: string;
  storeName: string;
  totalSkus: number;
  categorizedSkus: number;
  uncategorizedSkus: number;
  withEanSkus: number;
  withImageSkus: number;
  privateLabelSkus: number;
  lastVerifiedAt: string | null;
}

export interface AdminCatalogBrowseRow {
  storeSkuId: string;
  storeId: string;
  storeName: string;
  externalSku: string;
  rawName: string;
  displayName?: string | null;
  rawUrl: string | null;
  brand: string | null;
  ean: string | null;
  netContent: number;
  unitMeasure: UnitMeasure;
  isPrivateLabel: boolean;
  imageUrl: string | null;
  canonicalSlug: string | null;
  canonicalName: string | null;
  productType?: string | null;
  subPresentation?: string | null;
  subPresentationLabel?: string | null;
  variantTags?: string[];
  isDeprecatedCandidate?: boolean;
  deprecatedReason?: string | null;
  calibratedPrice: number;
  rawListPrice: number;
  pumPrice: number;
  inStock: boolean;
  sourceOrigin: string;
  capturedAt: string;
}

export interface AdminStoreCatalogPayload {
  summary: AdminStoreSummaryItem[];
  items: AdminCatalogBrowseRow[];
  categories: CanonicalCategoryOption[];
  totalCount: number;
  page: number;
  pageSize: number;
  generatedAt: string;
}

