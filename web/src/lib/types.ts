export type CompareMode = "ean" | "pum";

export type UnitMeasure = "g" | "ml" | "und";

export interface StoreOffer {
  storeSkuId: string;
  storeId: string;
  storeName: string;
  channelType: string;
  masterProductId: string;
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
  capturedAt: string;
}

export interface ComparisonGroup {
  groupId: string;
  title: string;
  subtitle: string;
  brand: string | null;
  ean: string | null;
  canonicalSlug: string | null;
  canonicalName: string | null;
  netContent: number;
  unitMeasure: UnitMeasure;
  imageUrl: string | null;
  bestPrice: number;
  bestPum: number;
  highestPrice: number;
  savingsPct: number;
  offers: StoreOffer[];
}

export interface CanonicalCategoryOption {
  id: number;
  slug: string;
  name: string;
  baseUnit: UnitMeasure;
}

export interface DashboardPayload {
  eanGroups: ComparisonGroup[];
  pumGroups: ComparisonGroup[];
  categories: CanonicalCategoryOption[];
  storesCount: number;
  totalSkus: number;
  isDemoData: boolean;
  generatedAt: string;
}
