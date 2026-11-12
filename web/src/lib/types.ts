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
