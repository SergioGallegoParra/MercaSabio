import type { BasketItemInput, BasketPlan } from "./basketOptimizer.ts";
import { extractProductSignature, QUALITY_TIER_LABELS } from "./comparisonEngine.ts";
import { cleanProductTitle } from "./productInsights.ts";
import type { QualityTier, StoreOffer, UnitMeasure } from "@/lib/types";

export type ShoppingExperienceMode = "generic_guided" | "habitual_guided" | "free_shop";

export type SizePreference = "any" | "small" | "medium" | "large";

export type PricePriorityMode = "lowest_total" | "lowest_pum";

export interface BarrioLocationOption {
  id: string;
  city: string;
  barrio: string;
  label: string;
  lat: number;
  lng: number;
}

export const COLOMBIAN_CITIES: Array<{
  city: string;
  barrios: BarrioLocationOption[];
}> = [
  {
    city: "Bogotá",
    barrios: [
      { id: "bog-chapinero", city: "Bogotá", barrio: "Chapinero", label: "Bogotá · Chapinero", lat: 4.646, lng: -74.063 },
      { id: "bog-chico", city: "Bogotá", barrio: "Chicó / Calle 85", label: "Bogotá · Chicó / Calle 85", lat: 4.669, lng: -74.054 },
      { id: "bog-cedritos", city: "Bogotá", barrio: "Cedritos / Usaquén", label: "Bogotá · Cedritos / Usaquén", lat: 4.719, lng: -74.035 },
      { id: "bog-teusaquillo", city: "Bogotá", barrio: "Teusaquillo / Galerías", label: "Bogotá · Teusaquillo / Galerías", lat: 4.642, lng: -74.074 },
      { id: "bog-modelia", city: "Bogotá", barrio: "Modelia / Fontibón", label: "Bogotá · Modelia / Fontibón", lat: 4.669, lng: -74.124 },
      { id: "bog-suba", city: "Bogotá", barrio: "Suba Imperial", label: "Bogotá · Suba", lat: 4.747, lng: -74.089 },
    ],
  },
  {
    city: "Medellín",
    barrios: [
      { id: "med-poblado", city: "Medellín", barrio: "El Poblado", label: "Medellín · El Poblado", lat: 6.209, lng: -75.572 },
      { id: "med-laureles", city: "Medellín", barrio: "Laureles / Estadio", label: "Medellín · Laureles", lat: 6.245, lng: -75.594 },
      { id: "med-envigado", city: "Medellín", barrio: "Envigado", label: "Medellín · Envigado", lat: 6.175, lng: -75.588 },
    ],
  },
  {
    city: "Cali",
    barrios: [
      { id: "cal-granada", city: "Cali", barrio: "Granada / Norte", label: "Cali · Granada / Norte", lat: 3.458, lng: -76.536 },
      { id: "cal-jardin", city: "Cali", barrio: "Ciudad Jardín", label: "Cali · Ciudad Jardín", lat: 3.368, lng: -76.534 },
    ],
  },
  {
    city: "Barranquilla",
    barrios: [
      { id: "baq-altoprado", city: "Barranquilla", barrio: "Alto Prado / Riomar", label: "Barranquilla · Alto Prado", lat: 11.005, lng: -74.812 },
    ],
  },
];

export const ALL_BARRIOS: BarrioLocationOption[] = COLOMBIAN_CITIES.flatMap((c) => c.barrios);

export interface FoodVariantOption {
  id: string;
  label: string;
  subtypeFamily: string;
  criticalAttribute?: string | null;
}

export interface GenericFoodOption {
  id: string;
  name: string;
  sectionId: "alacena" | "nevera" | "aseo";
  subsectionId: string;
  broadFamily: string;
  defaultSubtype: string;
  defaultUnitMeasure: UnitMeasure;
  defaultTargetContent: number;
  searchTerms: string[];
  description: string;
  variants: FoodVariantOption[];
  isDefaultGeneric?: boolean;
  defaultPriority?: PricePriorityMode;
  defaultSize?: SizePreference;
  defaultQualityTiers?: QualityTier[];
  defaultVariantId?: string;
}

export interface GuidedSubsection {
  id: string;
  label: string;
  description: string;
  materialIcon: string;
  foods: GenericFoodOption[];
}

export interface GuidedSection {
  id: "alacena" | "nevera" | "aseo";
  label: string;
  shortLabel: string;
  badgeLabel: string;
  stepNumber: 3 | 4 | 5;
  materialIcon: string;
  iconName: "utensils" | "snowflake" | "sparkles";
  description: string;
  subsections: GuidedSubsection[];
}

export const GUIDED_SECTIONS: GuidedSection[] = [
  {
    id: "alacena",
    label: "Alacena",
    shortLabel: "Alacena",
    badgeLabel: "Alacena básica",
    stepNumber: 3,
    materialIcon: "kitchen",
    iconName: "utensils",
    description: "Granos, harinas, pastas, aceites y bebidas secas de tu despensa.",
    subsections: [
      {
        id: "granos",
        label: "Granos",
        description: "Arroz blanco, integral, frijol, lenteja y garbanzo.",
        materialIcon: "grain",
        foods: [
          {
            id: "food-arroz",
            name: "Arroz blanco",
            sectionId: "alacena",
            subsectionId: "granos",
            broadFamily: "arroz",
            defaultSubtype: "arroz_blanco",
            defaultUnitMeasure: "g",
            defaultTargetContent: 1000,
            searchTerms: ["arroz"],
            description: "Arroz blanco tradicional, parbolizado, integral o especial.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            defaultQualityTiers: ["economico", "estandar"],
            variants: [
              { id: "arroz_blanco", label: "Blanco tradicional", subtypeFamily: "arroz_blanco" },
              { id: "arroz_integral", label: "Integral", subtypeFamily: "arroz_integral" },
              { id: "arroz_parbolizado", label: "Parbolizado", subtypeFamily: "arroz_parbolizado" },
              { id: "arroz_especial", label: "Jazmín / Basmati / Especial", subtypeFamily: "arroz_especial" },
            ],
          },
          {
            id: "food-frijol",
            name: "Frijol rojo / negro",
            sectionId: "alacena",
            subsectionId: "granos",
            broadFamily: "frijol",
            defaultSubtype: "frijol_seco",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["frijol"],
            description: "Frijol en grano seco (cargamanto, bola roja, caraota) o enlatado.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_total",
            defaultSize: "small",
            defaultQualityTiers: ["economico", "estandar"],
            variants: [
              { id: "frijol_seco", label: "En grano seco", subtypeFamily: "frijol_seco" },
              { id: "frijol_enlatado", label: "Enlatado / listo", subtypeFamily: "frijol_enlatado" },
            ],
          },
          {
            id: "food-lenteja",
            name: "Lenteja y Garbanzo",
            sectionId: "alacena",
            subsectionId: "granos",
            broadFamily: "granos",
            defaultSubtype: "lenteja_seca",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["lenteja", "garbanzo"],
            description: "Granos secos ricos en proteína vegetal.",
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "lenteja_seca", label: "Lenteja seca", subtypeFamily: "lenteja_seca" },
              { id: "garbanzo_arveja", label: "Garbanzo / Arveja", subtypeFamily: "garbanzo_arveja" },
            ],
          },
        ],
      },
      {
        id: "harinas",
        label: "Harinas y Pastas",
        description: "Espaguetis, harinas precocidas de maíz, trigo y avena.",
        materialIcon: "bakery_dining",
        foods: [
          {
            id: "food-pasta",
            name: "Pasta espagueti / clásica",
            sectionId: "alacena",
            subsectionId: "harinas",
            broadFamily: "pasta",
            defaultSubtype: "pasta_seca",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["pasta", "espagueti"],
            description: "Espagueti, tornillos, penne, conchitas o fideos.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "pasta_seca", label: "Pasta seca clásica", subtypeFamily: "pasta_seca" },
            ],
          },
          {
            id: "food-harina",
            name: "Harina de maíz / trigo",
            sectionId: "alacena",
            subsectionId: "harinas",
            broadFamily: "harinas",
            defaultSubtype: "harina_maiz",
            defaultUnitMeasure: "g",
            defaultTargetContent: 1000,
            searchTerms: ["harina"],
            description: "Harina precocida de maíz para arepas o harina de trigo.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "harina_maiz", label: "Maíz para arepas", subtypeFamily: "harina_maiz" },
              { id: "harina_trigo", label: "Trigo tradicional", subtypeFamily: "harina_trigo" },
            ],
          },
          {
            id: "food-avena",
            name: "Avena en hojuelas",
            sectionId: "alacena",
            subsectionId: "harinas",
            broadFamily: "cereales",
            defaultSubtype: "avena",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["avena"],
            description: "Avena en hojuelas o molida para desayuno.",
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "avena", label: "En hojuelas / molida", subtypeFamily: "avena" },
            ],
          },
        ],
      },
      {
        id: "aceites",
        label: "Aceites y Salsas",
        description: "Aceite vegetal o de oliva, azúcar, panela y salsas base.",
        materialIcon: "water_drop",
        foods: [
          {
            id: "food-aceite",
            name: "Aceite vegetal / girasol",
            sectionId: "alacena",
            subsectionId: "aceites",
            broadFamily: "aceite",
            defaultSubtype: "aceite_cocina",
            defaultUnitMeasure: "ml",
            defaultTargetContent: 900,
            searchTerms: ["aceite"],
            description: "Aceite vegetal, girasol, canola o oliva.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "aceite_cocina", label: "Vegetal / Girasol / Canola", subtypeFamily: "aceite_cocina" },
              { id: "aceite_oliva", label: "Aceite de oliva", subtypeFamily: "aceite_oliva" },
              { id: "aceite_oliva_ev", label: "Oliva Extra Virgen", subtypeFamily: "aceite_oliva", criticalAttribute: "extra_virgen" },
            ],
          },
          {
            id: "food-azucar",
            name: "Azúcar y Panela",
            sectionId: "alacena",
            subsectionId: "aceites",
            broadFamily: "endulzantes",
            defaultSubtype: "azucar_blanca",
            defaultUnitMeasure: "g",
            defaultTargetContent: 1000,
            searchTerms: ["azucar", "panela"],
            description: "Azúcar refinada, morena u orgánica, o panela tradicional.",
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "azucar_blanca", label: "Azúcar blanca / refinada", subtypeFamily: "azucar_blanca" },
              { id: "azucar_morena", label: "Azúcar morena / orgánica", subtypeFamily: "azucar_morena" },
              { id: "panela", label: "Panela", subtypeFamily: "panela" },
            ],
          },
          {
            id: "food-salsa-tomate",
            name: "Pasta / Salsa de tomate",
            sectionId: "alacena",
            subsectionId: "aceites",
            broadFamily: "salsas",
            defaultSubtype: "pasta_tomate",
            defaultUnitMeasure: "g",
            defaultTargetContent: 400,
            searchTerms: ["salsa tomate"],
            description: "Pasta de tomate, napolitana o salsa de tomate.",
            defaultPriority: "lowest_total",
            defaultSize: "small",
            variants: [
              { id: "pasta_tomate", label: "Salsa / Pasta de tomate", subtypeFamily: "pasta_tomate" },
            ],
          },
        ],
      },
      {
        id: "cafe",
        label: "Café y Desayuno",
        description: "Café tostado y molido, instantáneo, cápsulas y chocolate de mesa.",
        materialIcon: "coffee",
        foods: [
          {
            id: "food-cafe",
            name: "Café molido / grano",
            sectionId: "alacena",
            subsectionId: "cafe",
            broadFamily: "cafe",
            defaultSubtype: "cafe_molido",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["cafe"],
            description: "Café molido, en grano, instantáneo/liofilizado o cápsulas.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "cafe_molido", label: "Tostado y molido", subtypeFamily: "cafe_molido" },
              { id: "cafe_instantaneo", label: "Instantáneo / Soluble", subtypeFamily: "cafe_instantaneo" },
              { id: "cafe_grano", label: "En grano", subtypeFamily: "cafe_grano" },
              { id: "cafe_capsulas", label: "Cápsulas", subtypeFamily: "cafe_capsulas" },
            ],
          },
          {
            id: "food-chocolate",
            name: "Chocolate de mesa",
            sectionId: "alacena",
            subsectionId: "cafe",
            broadFamily: "desayuno",
            defaultSubtype: "chocolate_mesa",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["chocolate"],
            description: "Pastillas de chocolate tradicional o sin azúcar.",
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "chocolate_mesa", label: "Tradicional en pastilla", subtypeFamily: "chocolate_mesa" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "nevera",
    label: "Nevera y Lácteos",
    shortLabel: "Nevera & Frescos",
    badgeLabel: "Refrigerados",
    stepNumber: 4,
    materialIcon: "ac_unit",
    iconName: "snowflake",
    description: "Leches, quesos, proteínas frescas o enlatadas y huevos.",
    subsections: [
      {
        id: "leches",
        label: "Leches",
        description: "Leche líquida deslactosada, entera, descremada o en polvo.",
        materialIcon: "local_drink",
        foods: [
          {
            id: "food-leche",
            name: "Leche entera / deslactosada",
            sectionId: "nevera",
            subsectionId: "leches",
            broadFamily: "leche",
            defaultSubtype: "leche_deslactosada",
            defaultUnitMeasure: "ml",
            defaultTargetContent: 1000,
            searchTerms: ["leche"],
            description: "Elige si prefieres deslactosada, entera, descremada o en polvo.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "leche_deslactosada", label: "Deslactosada", subtypeFamily: "leche_deslactosada" },
              { id: "leche_entera", label: "Entera", subtypeFamily: "leche_entera" },
              { id: "leche_descremada", label: "Descremada / Light", subtypeFamily: "leche_descremada" },
              { id: "leche_polvo", label: "En polvo", subtypeFamily: "leche_polvo" },
            ],
          },
        ],
      },
      {
        id: "quesos",
        label: "Quesos y Lácteos",
        description: "Queso campesino/mozzarella, mantequilla y yogurt.",
        materialIcon: "bakery_dining",
        foods: [
          {
            id: "food-queso",
            name: "Queso fresco / campesino",
            sectionId: "nevera",
            subsectionId: "quesos",
            broadFamily: "quesos",
            defaultSubtype: "queso_fresco",
            defaultUnitMeasure: "g",
            defaultTargetContent: 400,
            searchTerms: ["queso", "mozzarella", "quesito"],
            description: "Queso campesino, doble crema, cuajada o mozzarella.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "small",
            variants: [
              { id: "queso_fresco", label: "Queso fresco / Mozzarella / Campesino", subtypeFamily: "queso_fresco" },
            ],
          },
          {
            id: "food-mantequilla",
            name: "Mantequilla / Margarina",
            sectionId: "nevera",
            subsectionId: "quesos",
            broadFamily: "quesos",
            defaultSubtype: "mantequilla_margarina",
            defaultUnitMeasure: "g",
            defaultTargetContent: 250,
            searchTerms: ["mantequilla", "margarina"],
            description: "Mantequilla o esparcible de cocina y mesa.",
            defaultPriority: "lowest_pum",
            defaultSize: "small",
            variants: [
              { id: "mantequilla_margarina", label: "Mantequilla / Margarina", subtypeFamily: "mantequilla_margarina" },
            ],
          },
          {
            id: "food-yogurt",
            name: "Yogurt / Kumis",
            sectionId: "nevera",
            subsectionId: "quesos",
            broadFamily: "quesos",
            defaultSubtype: "yogurt_bebida_lactea",
            defaultUnitMeasure: "g",
            defaultTargetContent: 1000,
            searchTerms: ["yogurt"],
            description: "Yogurt clásico, griego o kumis.",
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "yogurt_bebida_lactea", label: "Yogurt / Kumis / Griego", subtypeFamily: "yogurt_bebida_lactea" },
            ],
          },
        ],
      },
      {
        id: "proteinas",
        label: "Proteínas",
        description: "Pechuga de pollo, carne de res y atún en agua o aceite.",
        materialIcon: "set_meal",
        foods: [
          {
            id: "food-pollo",
            name: "Pechuga / Pollo fresco",
            sectionId: "nevera",
            subsectionId: "proteinas",
            broadFamily: "proteinas",
            defaultSubtype: "pollo_fresco",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["pollo", "pechuga"],
            description: "Pechuga, pernil o muslo de pollo fresco.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "pollo_fresco", label: "Pechuga / Pollo fresco", subtypeFamily: "pollo_fresco" },
            ],
          },
          {
            id: "food-res",
            name: "Carne de res / molida",
            sectionId: "nevera",
            subsectionId: "proteinas",
            broadFamily: "proteinas",
            defaultSubtype: "carne_res",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["carne res", "molida"],
            description: "Carne molida o cortes frescos de res.",
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "carne_res", label: "Carne de res / molida", subtypeFamily: "carne_res" },
            ],
          },
          {
            id: "food-atun",
            name: "Atún en agua / aceite",
            sectionId: "nevera",
            subsectionId: "proteinas",
            broadFamily: "atun",
            defaultSubtype: "atun_agua",
            defaultUnitMeasure: "g",
            defaultTargetContent: 160,
            searchTerms: ["atun"],
            description: "Lomitos o trozos de atún en agua, aceite vegetal u oliva.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "small",
            variants: [
              { id: "atun_agua", label: "En agua", subtypeFamily: "atun_agua" },
              { id: "atun_aceite", label: "En aceite vegetal", subtypeFamily: "atun_aceite" },
              { id: "atun_oliva", label: "En aceite de oliva", subtypeFamily: "atun_oliva" },
              { id: "atun_lomo_agua", label: "Solo Lomitos en agua", subtypeFamily: "atun_agua", criticalAttribute: "lomo_agua" },
            ],
          },
        ],
      },
      {
        id: "huevos",
        label: "Huevos",
        description: "Huevos por calibre AA, AAA, campo libre o codorniz.",
        materialIcon: "egg",
        foods: [
          {
            id: "food-huevos",
            name: "Huevos AA / AAA",
            sectionId: "nevera",
            subsectionId: "huevos",
            broadFamily: "huevos",
            defaultSubtype: "huevos_gallina",
            defaultUnitMeasure: "und",
            defaultTargetContent: 30,
            searchTerms: ["huevos"],
            description: "Huevos de gallina (AA, AAA, campo libre) o codorniz.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "large",
            variants: [
              { id: "huevos_cualquiera", label: "Gallina (cualquier calibre)", subtypeFamily: "huevos_gallina" },
              { id: "huevos_aa", label: "Tipo AA", subtypeFamily: "huevos_gallina", criticalAttribute: "aa" },
              { id: "huevos_aaa", label: "Tipo AAA", subtypeFamily: "huevos_gallina", criticalAttribute: "aaa" },
              { id: "huevos_campo_libre", label: "Campo libre / Pastoreo", subtypeFamily: "huevos_gallina", criticalAttribute: "campo_libre" },
              { id: "huevos_codorniz", label: "Huevos de codorniz", subtypeFamily: "huevos_codorniz" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "aseo",
    label: "Aseo y Limpieza",
    shortLabel: "Aseo y Limpieza",
    badgeLabel: "Hogar & Cuidado",
    stepNumber: 5,
    materialIcon: "cleaning_services",
    iconName: "sparkles",
    description: "Lavandería, superficies y cocina, aseo personal y papel hogar.",
    subsections: [
      {
        id: "lavanderia",
        label: "Lavandería",
        description: "Detergente en polvo o líquido y suavizantes de telas.",
        materialIcon: "local_laundry_service",
        foods: [
          {
            id: "food-detergente",
            name: "Detergente líquido / polvo",
            sectionId: "aseo",
            subsectionId: "lavanderia",
            broadFamily: "aseo_hogar",
            defaultSubtype: "detergente_ropa",
            defaultUnitMeasure: "g",
            defaultTargetContent: 1000,
            searchTerms: ["detergente"],
            description: "Detergente en polvo o líquido para ropa.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "detergente_ropa", label: "Detergente para ropa", subtypeFamily: "detergente_ropa" },
            ],
          },
          {
            id: "food-suavizante",
            name: "Suavizante de ropa",
            sectionId: "aseo",
            subsectionId: "lavanderia",
            broadFamily: "aseo_hogar",
            defaultSubtype: "suavizante_ropa",
            defaultUnitMeasure: "ml",
            defaultTargetContent: 900,
            searchTerms: ["suavizante"],
            description: "Suavizante floral o aroma fresco para ropa.",
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "suavizante_ropa", label: "Suavizante de telas", subtypeFamily: "suavizante_ropa" },
            ],
          },
        ],
      },
      {
        id: "superficies",
        label: "Superficies y Cocina",
        description: "Lavaplatos, limpiadores multiusos, pisos y blanqueadores.",
        materialIcon: "countertops",
        foods: [
          {
            id: "food-lavaloza",
            name: "Lavaloza líquido / crema",
            sectionId: "aseo",
            subsectionId: "superficies",
            broadFamily: "aseo_hogar",
            defaultSubtype: "lavaloza",
            defaultUnitMeasure: "g",
            defaultTargetContent: 500,
            searchTerms: ["lavaloza"],
            description: "Crema o líquido lavaplatos.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "lavaloza", label: "Lavaloza", subtypeFamily: "lavaloza" },
            ],
          },
          {
            id: "food-limpiador",
            name: "Limpiador pisos / Cloro",
            sectionId: "aseo",
            subsectionId: "superficies",
            broadFamily: "aseo_hogar",
            defaultSubtype: "limpiador_pisos",
            defaultUnitMeasure: "ml",
            defaultTargetContent: 1000,
            searchTerms: ["limpiador", "fabuloso", "cloro"],
            description: "Limpiador multiusos para pisos, baños y desinfectantes.",
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "limpiador_pisos", label: "Limpiador multiusos / pisos", subtypeFamily: "limpiador_pisos" },
            ],
          },
        ],
      },
      {
        id: "aseo_personal",
        label: "Aseo personal",
        description: "Jabón de baño y cuidado bucal esencial.",
        materialIcon: "soap",
        foods: [
          {
            id: "food-jabon",
            name: "Jabón de baño",
            sectionId: "aseo",
            subsectionId: "aseo_personal",
            broadFamily: "aseo_personal",
            defaultSubtype: "jabon_corporal",
            defaultUnitMeasure: "g",
            defaultTargetContent: 300,
            searchTerms: ["jabon bano", "protex", "dove"],
            description: "Jabón corporal en barra o líquido.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "jabon_corporal", label: "Jabón corporal / tocador", subtypeFamily: "jabon_corporal" },
            ],
          },
          {
            id: "food-crema-dental",
            name: "Crema dental",
            sectionId: "aseo",
            subsectionId: "aseo_personal",
            broadFamily: "aseo_personal",
            defaultSubtype: "crema_dental",
            defaultUnitMeasure: "ml",
            defaultTargetContent: 100,
            searchTerms: ["crema dental", "colgate"],
            description: "Pasta dental triple acción o blanqueadora.",
            defaultPriority: "lowest_pum",
            defaultSize: "small",
            variants: [
              { id: "crema_dental", label: "Crema dental", subtypeFamily: "crema_dental" },
            ],
          },
        ],
      },
      {
        id: "otros_aseo",
        label: "Otros",
        description: "Papel higiénico y complementos básicos del hogar.",
        materialIcon: "inventory_2",
        foods: [
          {
            id: "food-papel",
            name: "Papel higiénico",
            sectionId: "aseo",
            subsectionId: "otros_aseo",
            broadFamily: "aseo_personal",
            defaultSubtype: "papel_higienico",
            defaultUnitMeasure: "und",
            defaultTargetContent: 12,
            searchTerms: ["papel higienico"],
            description: "Rollos de papel higiénico doble o triple hoja.",
            isDefaultGeneric: true,
            defaultPriority: "lowest_pum",
            defaultSize: "medium",
            variants: [
              { id: "papel_higienico", label: "Papel higiénico", subtypeFamily: "papel_higienico" },
            ],
          },
        ],
      },
    ],
  },
];

export function inferSizeBucket(
  netContent: number,
  unit: UnitMeasure
): Exclude<SizePreference, "any"> {
  if (unit === "und") {
    if (netContent <= 8) return "small";
    if (netContent <= 18) return "medium";
    return "large";
  }
  if (netContent < 400) return "small";
  if (netContent <= 1200) return "medium";
  return "large";
}

export function sizeBucketLabel(bucket: SizePreference): string {
  switch (bucket) {
    case "small":
      return "Presentación pequeña";
    case "medium":
      return "Presentación mediana";
    case "large":
      return "Presentación familiar / grande";
    default:
      return "Cualquier tamaño";
  }
}

export interface HabitualItemProfile {
  subtypeFamily: string;
  broadFamily: string;
  familyLabel: string;
  qualityTier: QualityTier;
  qualityLabel: string;
  criticalAttribute: string | null;
  effectiveNetContent: number;
  effectiveUnitMeasure: UnitMeasure;
  sizeBucket: Exclude<SizePreference, "any">;
  traits: string[];
  summaryText: string;
}

/**
 * Deduce automáticamente las características y restricciones implícitas de un SKU específico
 * elegido en Opción 2 (Mercado Habitual) o Opción 3 (Compra Libre).
 */
export function inferHabitualItemProfile(offer: StoreOffer): HabitualItemProfile {
  const sig = extractProductSignature(offer);
  const qualityTier: QualityTier = sig.lexicalTierHint ?? "estandar";
  const qualityLabel = QUALITY_TIER_LABELS[qualityTier];
  const sizeBucket = inferSizeBucket(sig.effectiveNetContent, sig.effectiveUnitMeasure);

  const traits: string[] = [
    sig.familyLabel,
    `Gama ${qualityLabel}`,
    `${Math.round(sig.effectiveNetContent)} ${sig.effectiveUnitMeasure} (${sizeBucketLabel(sizeBucket).replace("Presentación ", "")})`,
  ];
  if (sig.criticalAttribute) {
    traits.push(`Atributo: ${sig.criticalAttribute.replace(/_/g, " ")}`);
  }
  if (offer.brand) {
    traits.push(`Marca base: ${offer.brand}`);
  }

  return {
    subtypeFamily: sig.subtypeFamily,
    broadFamily: sig.broadFamily,
    familyLabel: sig.familyLabel,
    qualityTier,
    qualityLabel,
    criticalAttribute: sig.criticalAttribute ?? null,
    effectiveNetContent: sig.effectiveNetContent,
    effectiveUnitMeasure: sig.effectiveUnitMeasure,
    sizeBucket,
    traits,
    summaryText: `${sig.familyLabel} · Gama ${qualityLabel} · ${Math.round(sig.effectiveNetContent)} ${sig.effectiveUnitMeasure}`,
  };
}

export interface BasketProfileSummary {
  totalItems: number;
  dominantTier: QualityTier | null;
  dominantTierLabel: string | null;
  inferredTraits: Array<{ label: string; count: number }>;
}

export function inferBasketProfileSummary(items: BasketItemInput[]): BasketProfileSummary {
  const tierCounts = new Map<QualityTier, number>();
  const traitCounts = new Map<string, number>();

  for (const item of items) {
    for (const t of item.allowedQualityTiers ?? []) {
      tierCounts.set(t, (tierCounts.get(t) ?? 0) + 1);
    }
    const labels: string[] = [];
    if (item.familyLabel) labels.push(item.familyLabel);
    if (item.requiredCriticalAttribute) {
      labels.push(item.requiredCriticalAttribute.replace(/_/g, " "));
    }
    if (item.sizePreference && item.sizePreference !== "any") {
      labels.push(sizeBucketLabel(item.sizePreference));
    }
    if (item.pricePriority === "lowest_pum") {
      labels.push("Prioriza menor PUM");
    }
    for (const l of labels) {
      traitCounts.set(l, (traitCounts.get(l) ?? 0) + 1);
    }
  }

  let dominantTier: QualityTier | null = null;
  let maxTierCount = 0;
  for (const [tier, cnt] of tierCounts.entries()) {
    if (cnt > maxTierCount) {
      maxTierCount = cnt;
      dominantTier = tier;
    }
  }

  const inferredTraits = [...traitCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    totalItems: items.length,
    dominantTier,
    dominantTierLabel: dominantTier ? QUALITY_TIER_LABELS[dominantTier] : null,
    inferredTraits,
  };
}

export function offerMatchesSubsection(
  offer: StoreOffer,
  subsection: GuidedSubsection
): boolean {
  const sig = extractProductSignature(offer);
  return subsection.foods.some(
    (food) =>
      sig.broadFamily === food.broadFamily ||
      food.variants.some((v) => v.subtypeFamily === sig.subtypeFamily)
  );
}

const copPlain = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/**
 * Exporta los carritos recomendados por supermercado y el comparativo de ahorro en texto plano
 * listo para copiar a WhatsApp, Notas o descargar en `.txt`.
 */
export function formatBasketAsPlainText(params: {
  mode: ShoppingExperienceMode;
  locationLabel: string;
  maxDistanceMeters: number;
  maxStores: number;
  plan: BasketPlan;
  habitualBaselineCost?: number | null;
  savingsVsHabitualCop?: number | null;
  savingsVsHabitualPct?: number | null;
  uncoveredItems?: string[];
}): string {
  const {
    mode,
    locationLabel,
    maxDistanceMeters,
    maxStores,
    plan,
    habitualBaselineCost,
    savingsVsHabitualCop,
    savingsVsHabitualPct,
    uncoveredItems,
  } = params;

  const modeTitle =
    mode === "generic_guided"
      ? "Mercado Genérico por Características"
      : mode === "habitual_guided"
        ? "Mercado Habitual Optimizado"
        : "Compra Libre Optimizada";

  const lines: string[] = [
    "LISTA DE COMPRA OPTIMIZADA - MERCASABIO",
    `Modalidad: ${modeTitle}`,
    `Ubicación: ${locationLabel}`,
    `Restricción: máx. ${(maxDistanceMeters / 1000).toFixed(1)} km · hasta ${maxStores} supermercado(s)`,
    `Cobertura: ${plan.coveredItems}/${plan.requestedItems} producto(s)`,
    "----------------------------------------",
  ];

  if (habitualBaselineCost && habitualBaselineCost > plan.totalNominalCost) {
    const saved = savingsVsHabitualCop ?? habitualBaselineCost - plan.totalNominalCost;
    const savedPct =
      savingsVsHabitualPct ??
      Number(((saved / habitualBaselineCost) * 100).toFixed(1));
    lines.push(`Precio normal de referencia: ${copPlain.format(habitualBaselineCost)}`);
    lines.push(`Precio total optimizado:     ${copPlain.format(plan.totalNominalCost)}`);
    lines.push(`AHORRO ESTIMADO:             ${copPlain.format(saved)} (${savedPct}%)`);
    lines.push("----------------------------------------");
  } else {
    lines.push(`TOTAL ESPERADO: ${copPlain.format(plan.totalNominalCost)}`);
    lines.push("----------------------------------------");
  }

  for (const stop of plan.storeStops) {
    lines.push("");
    lines.push(
      `SUPERMERCADO: ${stop.storeName.toUpperCase()} (${stop.branch.branchName} · ${Math.round(stop.branch.distanceMeters)} m)`
    );
    if (stop.branch.address) {
      lines.push(`Dirección: ${stop.branch.address}`);
    }
    lines.push(`Precio esperado en esta tienda: ${copPlain.format(stop.subtotalNominal)}`);

    for (const alloc of stop.allocations) {
      const title = cleanProductTitle(alloc.offer.rawName);
      const qtyPrefix = alloc.quantity > 1 ? `${alloc.quantity}x ` : "";
      lines.push(
        `  - [ ] ${qtyPrefix}${title} (${alloc.offer.netContent} ${alloc.offer.unitMeasure}) — ${copPlain.format(alloc.nominalCost)}`
      );
    }
  }

  if (uncoveredItems && uncoveredItems.length > 0) {
    lines.push("");
    lines.push(`Sin stock en el radio configurado (${uncoveredItems.length}):`);
    for (const label of uncoveredItems) {
      lines.push(`  - ${label}`);
    }
  }

  lines.push("");
  lines.push("Generado en MercaSabio (mercasabio.sdgp.workers.dev)");
  return lines.join("\n");
}

export function buildDefaultGenericBasketItems(): BasketItemInput[] {
  const items: BasketItemInput[] = [];
  for (const section of GUIDED_SECTIONS) {
    for (const sub of section.subsections) {
      for (const food of sub.foods) {
        if (!food.isDefaultGeneric) continue;
        const defaultVariant =
          food.variants.find((v) => v.id === food.defaultVariantId) ?? food.variants[0];
        items.push({
          itemKey: `generic-${food.id}`,
          label: food.name,
          masterProductId: null,
          canonicalSlug: null,
          matchMode: "pum",
          quantity: 1,
          allowSubstitutes: true,
          subtypeFamily: defaultVariant?.subtypeFamily ?? food.defaultSubtype,
          broadFamily: food.broadFamily,
          familyLabel: food.name,
          targetNetContent: food.defaultTargetContent,
          targetUnitMeasure: food.defaultUnitMeasure,
          allowedQualityTiers: food.defaultQualityTiers ?? ["economico", "estandar"],
          pricePriority: food.defaultPriority ?? "lowest_pum",
          requiredCriticalAttribute: defaultVariant?.criticalAttribute ?? null,
          sizePreference: food.defaultSize ?? "medium",
          excludedBrands: [],
          sectionId: section.id,
          subsectionId: sub.id,
          originMode: "generic_guided",
        });
      }
    }
  }
  return items;
}

export function getSectionIdForItem(
  item: Pick<BasketItemInput, "sectionId" | "subsectionId" | "subtypeFamily" | "broadFamily" | "label">
): "alacena" | "nevera" | "aseo" {
  if (item.sectionId) return item.sectionId;
  for (const section of GUIDED_SECTIONS) {
    for (const sub of section.subsections) {
      if (item.subsectionId && sub.id === item.subsectionId) return section.id;
      for (const food of sub.foods) {
        if (
          (item.subtypeFamily &&
            (food.defaultSubtype === item.subtypeFamily ||
              food.variants.some((v) => v.subtypeFamily === item.subtypeFamily))) ||
          (item.broadFamily && food.broadFamily === item.broadFamily)
        ) {
          return section.id;
        }
      }
    }
  }
  const lower = (item.label ?? "").toLowerCase();
  if (/(leche|queso|quesito|mantequilla|yogurt|kumis|huevo|pollo|pechuga|carne|res|atun)/.test(lower)) {
    return "nevera";
  }
  if (/(detergente|suavizante|lavaloza|limpiador|cloro|jabon|crema dental|colgate|papel higienico)/.test(lower)) {
    return "aseo";
  }
  return "alacena";
}

export function getSubsectionForItem(
  item: Pick<BasketItemInput, "sectionId" | "subsectionId" | "subtypeFamily" | "broadFamily" | "label">
): {
  sectionId: "alacena" | "nevera" | "aseo";
  subsectionId: string;
  subsectionLabel: string;
} {
  for (const section of GUIDED_SECTIONS) {
    for (const sub of section.subsections) {
      if (item.subsectionId && sub.id === item.subsectionId) {
        return { sectionId: section.id, subsectionId: sub.id, subsectionLabel: sub.label };
      }
      for (const food of sub.foods) {
        if (
          item.subtypeFamily &&
          (food.defaultSubtype === item.subtypeFamily ||
            food.variants.some((v) => v.subtypeFamily === item.subtypeFamily))
        ) {
          return { sectionId: section.id, subsectionId: sub.id, subsectionLabel: sub.label };
        }
      }
    }
  }
  const secId = getSectionIdForItem(item);
  const section = GUIDED_SECTIONS.find((s) => s.id === secId) ?? GUIDED_SECTIONS[0];
  for (const sub of section.subsections) {
    for (const food of sub.foods) {
      if (item.broadFamily && food.broadFamily === item.broadFamily) {
        return { sectionId: section.id, subsectionId: sub.id, subsectionLabel: sub.label };
      }
    }
  }
  const fallbackSub = section.subsections[0];
  return {
    sectionId: section.id,
    subsectionId: fallbackSub.id,
    subsectionLabel: fallbackSub.label,
  };
}

export function getAvailableBrandsForItem(
  item: BasketItemInput,
  offers: StoreOffer[]
): string[] {
  const brands = new Set<string>();
  const targetSubtype = item.subtypeFamily ?? null;
  const targetBroad = item.broadFamily ?? null;

  for (const offer of offers) {
    const sig = extractProductSignature(offer);
    const sameMaster =
      item.masterProductId != null && offer.masterProductId === item.masterProductId;
    const sameSlug =
      item.canonicalSlug != null && offer.canonicalSlug === item.canonicalSlug;
    const sameSubtype = targetSubtype != null && sig.subtypeFamily === targetSubtype;
    const sameBroad =
      item.allowSubstitutes !== false &&
      targetBroad != null &&
      sig.broadFamily === targetBroad;

    if (!sameMaster && !sameSlug && !sameSubtype && !sameBroad) continue;

    const candidateBrand = (offer.brand || sig.brandKey || "").trim();
    if (!candidateBrand || /^sin\s+marca$/i.test(candidateBrand)) continue;
    brands.add(candidateBrand);
  }

  if (item.anchorBrand && item.anchorBrand.trim() && !/^sin\s+marca$/i.test(item.anchorBrand)) {
    brands.add(item.anchorBrand.trim());
  }

  return [...brands].sort((a, b) => a.localeCompare(b, "es"));
}
