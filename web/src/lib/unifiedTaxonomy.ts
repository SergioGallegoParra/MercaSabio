import type { HearthIconName } from "@/components/HearthIcon";
import type { StoreOffer } from "@/lib/types";

export interface UnifiedSubcategoryDef {
  subSlug: string;
  label: string;
}

export interface UnifiedMacroCategoryDef {
  macroSlug: string;
  label: string;
  shortLabel: string;
  icon: HearthIconName;
  subcategories: UnifiedSubcategoryDef[];
}

export interface UnifiedTaxonomyMatch {
  macroSlug: string;
  macroLabel: string;
  subSlug: string;
  subLabel: string;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sub(label: string): UnifiedSubcategoryDef {
  return { subSlug: slugify(label), label };
}

/**
 * Taxonomía oficial unificada (10 Macro-categorías y 59 Subcategorías)
 * homologada sobre las 1,895 rutas activas del proyecto con Google AI Studio.
 */
export const UNIFIED_MACRO_CATEGORIES: UnifiedMacroCategoryDef[] = [
  {
    macroSlug: "frutas-y-verduras",
    label: "Frutas y Verduras",
    shortLabel: "Fruver",
    icon: "eco",
    subcategories: [
      sub("Frutas frescas"),
      sub("Verduras, hortalizas y tubérculos"),
      sub("Hierbas, aromáticas y plantas"),
      sub("Pulpas y fruver congelado"),
    ],
  },
  {
    macroSlug: "carnes-pescados-y-charcuteria",
    label: "Carnes, Pescados y Charcutería",
    shortLabel: "Carnes",
    icon: "set_meal",
    subcategories: [
      sub("Carne de res"),
      sub("Carne de cerdo"),
      sub("Pollo y aves"),
      sub("Pescados y mariscos"),
      sub("Otras carnes"),
      sub("Carnes frías y charcutería"),
    ],
  },
  {
    macroSlug: "lacteos-huevos-y-refrigerados",
    label: "Lácteos, Huevos y Refrigerados",
    shortLabel: "Lácteos",
    icon: "local_drink",
    subcategories: [
      sub("Leches"),
      sub("Bebidas vegetales"),
      sub("Yogures, kumis y avenas"),
      sub("Quesos y cuajadas"),
      sub("Mantequillas, margarinas y cremas"),
      sub("Huevos"),
      sub("Arepas y tortillas"),
    ],
  },
  {
    macroSlug: "despensa",
    label: "Despensa",
    shortLabel: "Despensa",
    icon: "kitchen",
    subcategories: [
      sub("Arroz, granos y semillas"),
      sub("Pastas y fideos"),
      sub("Aceites y vinagres"),
      sub("Harinas y premezclas"),
      sub("Azúcar, panela y endulzantes"),
      sub("Café, chocolate e infusiones"),
      sub("Cereales, granolas y avenas"),
      sub("Salsas, condimentos y sopas"),
      sub("Enlatados y conservas"),
      sub("Mermeladas, arequipes y untables"),
      sub("Repostería y gelatinas"),
      sub("Saludable y especiales"),
    ],
  },
  {
    macroSlug: "panaderia-y-pasteleria",
    label: "Panadería y Pastelería",
    shortLabel: "Panadería",
    icon: "bakery_dining",
    subcategories: [
      sub("Panadería fresca"),
      sub("Panadería empacada"),
      sub("Tortas y pastelería dulce"),
    ],
  },
  {
    macroSlug: "bebidas",
    label: "Bebidas",
    shortLabel: "Bebidas",
    icon: "water_bottle",
    subcategories: [
      sub("Aguas"),
      sub("Gaseosas y maltas"),
      sub("Jugos, néctares y refrescos"),
      sub("Hidratantes y energizantes"),
      sub("Té líquido y bebidas listas"),
    ],
  },
  {
    macroSlug: "snacks-galletas-y-dulces",
    label: "Snacks, Galletas y Dulces",
    shortLabel: "Snacks",
    icon: "grain",
    subcategories: [
      sub("Pasabocas salados"),
      sub("Galletas"),
      sub("Frutos secos y semillas"),
      sub("Chocolates, dulces y confitería"),
    ],
  },
  {
    macroSlug: "congelados-y-comidas-listas",
    label: "Congelados y Comidas Listas",
    shortLabel: "Congelados",
    icon: "ac_unit",
    subcategories: [
      sub("Helados y postres"),
      sub("Comidas preparadas"),
      sub("Congelados y hielo"),
    ],
  },
  {
    macroSlug: "cuidado-personal-y-bebes",
    label: "Cuidado Personal y Bebés",
    shortLabel: "Cuidado y Bebé",
    icon: "sanitizer",
    subcategories: [
      sub("Cuidado capilar"),
      sub("Cuidado corporal, facial y solar"),
      sub("Cuidado oral"),
      sub("Higiene íntima y protección"),
      sub("Afeitado, depilación y repelentes"),
      sub("Pañales y pañitos húmedos"),
      sub("Alimentación infantil"),
      sub("Aseo y accesorios del bebé"),
    ],
  },
  {
    macroSlug: "hogar-aseo-y-mascotas",
    label: "Hogar, Aseo y Mascotas",
    shortLabel: "Aseo y Mascotas",
    icon: "cleaning_services",
    subcategories: [
      sub("Detergentes y cuidado de ropa"),
      sub("Limpiadores y lavalozas"),
      sub("Ambientadores e insecticidas"),
      sub("Implementos de limpieza"),
      sub("Papeles, desechables y empaques"),
      sub("Mascotas"),
      sub("Hogar general y promociones"),
    ],
  },
];

const SUB_LOOKUP = new Map<string, UnifiedTaxonomyMatch>();
for (const macro of UNIFIED_MACRO_CATEGORIES) {
  for (const s of macro.subcategories) {
    SUB_LOOKUP.set(s.subSlug, {
      macroSlug: macro.macroSlug,
      macroLabel: macro.label,
      subSlug: s.subSlug,
      subLabel: s.label,
    });
  }
}

function matchOf(subLabel: string): UnifiedTaxonomyMatch {
  const found = SUB_LOOKUP.get(slugify(subLabel));
  if (found) return found;
  return {
    macroSlug: "despensa",
    macroLabel: "Despensa",
    subSlug: "saludable-y-especiales",
    subLabel: "Saludable y especiales",
  };
}

function normText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CANONICAL_TO_SUB: Record<string, string> = {
  "arroz-blanco-1000g": "Arroz, granos y semillas",
  "leche-entera-1000ml": "Leches",
  "aceite-vegetal-900ml": "Aceites y vinagres",
  "huevos-aa-30und": "Huevos",
  "azucar-refinada-1000g": "Azúcar, panela y endulzantes",
  "cafe-molido-500g": "Café, chocolate e infusiones",
  "pasta-espagueti-500g": "Pastas y fideos",
  "panela-redonda-500g": "Azúcar, panela y endulzantes",
  "atun-lata-160g": "Enlatados y conservas",
  "papel-higienico-4und": "Papeles, desechables y empaques",
  "detergente-polvo-1000g": "Detergentes y cuidado de ropa",
  "pollo-pechuga-1000g": "Pollo y aves",
};

function classifyFromCanonicalSlug(
  slug: string,
  hay: string
): UnifiedTaxonomyMatch | null {
  switch (slug) {
    case "aceites-y-vinagres":
      return matchOf("Aceites y vinagres");
    case "aguas-jugos-y-gaseosas":
      if (/\b(energizante|vive\s*100|red\s+bull|monster|speed\s+max|gatorade|powerade|electrolit|suero|hidratante)\b/.test(hay)) {
        return matchOf("Hidratantes y energizantes");
      }
      if (/\b(gaseosa|coca\s*cola|pepsi|colombiana|manzana\s+postobon|quatro|sprite|seven\s+up|pony\s+malta|bretana|soda|ginger|tonica)\b/.test(hay)) {
        return matchOf("Gaseosas y maltas");
      }
      if (/\b(te\s+(?:liquido|frio|helado|verde|negro|matcha)|fuze\s+tea|hatsu|mr\s+tea|lipton)\b/.test(hay)) {
        return matchOf("Té líquido y bebidas listas");
      }
      if (/\b(agua\s+(?:pura|natural|sin\s+gas|con\s+gas|mineral|cristal|brisa|manantial|h2oh|saborizada))\b/.test(hay)) {
        return matchOf("Aguas");
      }
      return matchOf("Jugos, néctares y refrescos");
    case "arroces-y-granos":
      if (/\b(cereal|granola|avena|corn\s+flakes|zucaritas|choco\s*krispis|froot\s+loops|muesli)\b/.test(hay)) {
        return matchOf("Cereales, granolas y avenas");
      }
      return matchOf("Arroz, granos y semillas");
    case "aseo-hogar-y-lavanderia":
      if (/\b(detergente|suavizante|quitamancha|blanqueador|cloro|clorox|fab|ariel|tide|top\s+terra|bonaropa|suavitel|aromatel|vanish|jabon\s+rey|jabon\s+ropa)\b/.test(hay)) {
        return matchOf("Detergentes y cuidado de ropa");
      }
      if (/\b(ambientador|glade|air\s+wick|poett|insecticida|raid|baygon|eliminador\s+de\s+olor)\b/.test(hay)) {
        return matchOf("Ambientadores e insecticidas");
      }
      if (/\b(escoba|trapero|trapeador|esponja|fibra|guante|pano|cepillo)\b/.test(hay)) {
        return matchOf("Implementos de limpieza");
      }
      if (/\b(papel\s+higienico|servilleta|toalla(?:s)?\s+(?:de\s+)?cocina|bolsa(?:s)?\s+de\s+basura)\b/.test(hay)) {
        return matchOf("Papeles, desechables y empaques");
      }
      return matchOf("Limpiadores y lavalozas");
    case "azucar-panela-miel":
      return matchOf("Azúcar, panela y endulzantes");
    case "bebes-y-maternidad":
      if (/\b(panal(?:es)?|huggies|pequenin|winny|pampers|panito|toallita)\b/.test(hay)) {
        return matchOf("Pañales y pañitos húmedos");
      }
      if (/\b(compota|papilla|cereal|nestum|formula|nan\b|enfamil|enfagrow|similac|alula|pediasure|leche)\b/.test(hay)) {
        return matchOf("Alimentación infantil");
      }
      return matchOf("Aseo y accesorios del bebé");
    case "cafe-te-y-chocolate":
      return matchOf("Café, chocolate e infusiones");
    case "carbon-lena-y-asados":
      return matchOf("Hogar general y promociones");
    case "carnes-pollo-pescado":
      if (/\b(pollo|pechuga|muslo|pernil\s+de\s+pollo|contramuslo|alas|bucanero|mac\s+pollo|friko|pimpollo|pollocoa|pavo|gallina)\b/.test(hay)) {
        return matchOf("Pollo y aves");
      }
      if (/\b(cerdo|costilla\s+de\s+cerdo|costilla\s+cerdo|lomo\s+de\s+cerdo|chuleta|tocino|pernil\s+de\s+cerdo|chicharron)\b/.test(hay)) {
        return matchOf("Carne de cerdo");
      }
      if (/\b(pescado|tilapia|trucha|salmon|bagre|mojarra|robalo|corvina|corvinata|basa|camaron|langostino|calamar|marisco|atun)\b/.test(hay)) {
        return matchOf("Pescados y mariscos");
      }
      if (/\b(res|molida|solomo|solomito|sobrebarriga|cadera|posta|muchacho|punta\s+de\s+anca|bife|chatas|higado|bofe)\b/.test(hay)) {
        return matchOf("Carne de res");
      }
      return matchOf("Otras carnes");
    case "congelados-y-helados":
      if (/\b(helado|paleta|crem\s+helado|popsy|polet|chococono|bocatto|bonice|bolis)\b/.test(hay)) {
        return matchOf("Helados y postres");
      }
      if (/\b(empanada|lasana|pizza|tamal|nugget|dedito|palito|comida|hamburguesa|croqueta)\b/.test(hay)) {
        return matchOf("Comidas preparadas");
      }
      return matchOf("Congelados y hielo");
    case "cuidado-del-calzado":
      return matchOf("Implementos de limpieza");
    case "cuidado-personal-e-higiene":
      if (/\b(crema\s+dental|pasta\s+dental|colgate|oral\s*b|sensodyne|enjuague\s+bucal|listerine|seda\s+dental|cepillo\s+(?:dental|de\s+dientes))\b/.test(hay)) {
        return matchOf("Cuidado oral");
      }
      if (/\b(shampoo|champu|acondicionador|crema\s+(?:para|de)\s+peinar|tratamiento\s+capilar|tinte|cabello|head\s*&\s*shoulders|pantene|sedal|savital|nutribela)\b/.test(hay)) {
        return matchOf("Cuidado capilar");
      }
      if (/\b(toalla(?:s)?\s+higienica|nosotras|kotex|tampon|protector(?:es)?\s+diario|jabon\s+intimo|saba)\b/.test(hay)) {
        return matchOf("Higiene íntima y protección");
      }
      if (/\b(afeitadora|prestobarba|gillette|schick|espuma\s+(?:de\s+)?afeitar|depilacion|repelente|cuchilla)\b/.test(hay)) {
        return matchOf("Afeitado, depilación y repelentes");
      }
      return matchOf("Cuidado corporal, facial y solar");
    case "dulces-y-chocolateria":
      if (/\b(mermelada|arequipe|dulce\s+de\s+leche|nutella|crema\s+de\s+avellana|leche\s+condensada|lecherita|esparcible)\b/.test(hay)) {
        return matchOf("Mermeladas, arequipes y untables");
      }
      return matchOf("Chocolates, dulces y confitería");
    case "enlatados-y-conservas":
      return matchOf("Enlatados y conservas");
    case "frutas-y-verduras":
      if (/\b(pulpa|congelad[oa])\b/.test(hay)) {
        return matchOf("Pulpas y fruver congelado");
      }
      if (/\b(cilantro|perejil|albahaca|hierbabuena|romero|tomillo|laurel|menta|sabila|guasca|oregano)\b/.test(hay)) {
        return matchOf("Hierbas, aromáticas y plantas");
      }
      if (/\b(tomate|cebolla|papa|zanahoria|lechuga|brocoli|coliflor|pepino|pimenton|ajo|espinaca|platano|yuca|arracacha|habichuela|mazorca|ahuyama|calabacin|arveja|frijol\s+verde)\b/.test(hay)) {
        return matchOf("Verduras, hortalizas y tubérculos");
      }
      return matchOf("Frutas frescas");
    case "galletas-y-snacks":
      if (/\b(galleta|saltin|ducales|festival|oreo|wafer|club\s+social|toscanas|tosh|crakenas|noel)\b/.test(hay)) {
        return matchOf("Galletas");
      }
      if (/\b(mani|almendra|nuez|nueces|maranon|pistacho|pasas|ciruela|frutos\s+secos|semilla|arandano)\b/.test(hay)) {
        return matchOf("Frutos secos y semillas");
      }
      return matchOf("Pasabocas salados");
    case "harinas-y-reposteria":
      if (/\b(gelatina|flan|pudin|polvo\s+(?:para\s+)?hornear|levadura|esencia|royal|natilla)\b/.test(hay)) {
        return matchOf("Repostería y gelatinas");
      }
      return matchOf("Harinas y premezclas");
    case "hogar-y-desechables":
      if (/\b(escoba|trapero|esponja|guante|pano)\b/.test(hay)) {
        return matchOf("Implementos de limpieza");
      }
      if (/\b(vela|velon|pilas|bateria|bombillo|fosforo|encendedor)\b/.test(hay)) {
        return matchOf("Hogar general y promociones");
      }
      return matchOf("Papeles, desechables y empaques");
    case "huevos-y-derivados":
      return matchOf("Huevos");
    case "jamones-y-embutidos":
      return matchOf("Carnes frías y charcutería");
    case "lacteos-y-leches":
      if (/\b(almendra|soya|soja|avena|coco|arroz|vegetal|silk|ades|natures\s+heart)\b/.test(hay)) {
        return matchOf("Bebidas vegetales");
      }
      return matchOf("Leches");
    case "mascotas":
      return matchOf("Mascotas");
    case "panaderia-y-arepas":
      if (/\b(arepa|tortilla|taco\s+shell)\b/.test(hay)) {
        return matchOf("Arepas y tortillas");
      }
      if (/\b(ponque|torta|brownie|muffin|cupcake|ramo|chocoramo|gansito|pinguino|pastel|dona)\b/.test(hay)) {
        return matchOf("Tortas y pastelería dulce");
      }
      return matchOf("Panadería empacada");
    case "pastas-y-fideos":
      return matchOf("Pastas y fideos");
    case "quesos-y-mantequillas":
      if (/\b(mantequilla|margarina|rama|campi|la\s+fina|crema\s+de\s+leche|ghee|esparcible)\b/.test(hay)) {
        return matchOf("Mantequillas, margarinas y cremas");
      }
      return matchOf("Quesos y cuajadas");
    case "salsas-y-condimentos":
      return matchOf("Salsas, condimentos y sopas");
    case "yogures-y-kumis":
      return matchOf("Yogures, kumis y avenas");
    default:
      return null;
  }
}

/**
 * Clasifica cualquier oferta de tienda dentro de la taxonomía 10x59 de cara al cliente.
 */
export function classifyOfferUnifiedTaxonomy(
  offer: Pick<
    StoreOffer,
    "rawName" | "displayName" | "rawUrl" | "canonicalSlug" | "subPresentation" | "brand"
  >
): UnifiedTaxonomyMatch {
  const slug = (offer.canonicalSlug ?? "").trim().toLowerCase();
  if (slug && CANONICAL_TO_SUB[slug]) {
    return matchOf(CANONICAL_TO_SUB[slug]);
  }

  const hay = normText(
    `${offer.rawUrl ?? ""} ${offer.displayName ?? ""} ${offer.rawName} ${offer.brand ?? ""} ${offer.subPresentation ?? ""}`
  );

  if (slug) {
    const byDbSlug = classifyFromCanonicalSlug(slug, hay);
    if (byDbSlug) {
      return byDbSlug;
    }
  }

  // Mascotas (prioridad sobre palabras compartidas como "alimento", "jabon", "shampoo")
  if (
    /\b(mascotas?|perros?|gatos?|cachorros?|gatitos?|concentrado|dog\s+chow|cat\s+chow|whiskas|pedigree|chunky|nutrecan|mirringo|ringo|donkat|purina|churu|aren[ao]\s+(?:para\s+)?gatos?)\b/.test(
      hay
    )
  ) {
    return matchOf("Mascotas");
  }

  // Bebés (alimentación vs pañales vs aseo)
  if (
    /\b(bebes?|infantil|compota|papilla|nestum|nan\s+pro|enfagrow|enfamil|similac|alula|klim\s+1|pediasure)\b/.test(
      hay
    )
  ) {
    if (/\b(panal(?:es)?|huggies|pequenin|winny|pampers|panitos?\s+humedos?|toallitas?\s+humedas?)\b/.test(hay)) {
      return matchOf("Pañales y pañitos húmedos");
    }
    if (
      /\b(compota|papilla|cereal\s+infantil|nestum|formula|nan\s+pro|enfamil|enfagrow|similac|alula|colada)\b/.test(
        hay
      )
    ) {
      return matchOf("Alimentación infantil");
    }
    return matchOf("Aseo y accesorios del bebé");
  }
  if (/\b(huggies|pequenin|winny|pampers)\b/.test(hay)) {
    return matchOf("Pañales y pañitos húmedos");
  }

  // Aseo del hogar / lavandería
  if (/\b(detergente|suavizante|quitamancha|blanqueador|cloro|clorox|fab|ariel|tide|top\s+terra|bonaropa|jabon\s+(?:rey|azul|barra\s+ropa|en\s+barra\s+lava)|suavitel|aromatel|vanish)\b/.test(hay)) {
    return matchOf("Detergentes y cuidado de ropa");
  }
  if (/\b(lavaloza|lavaplatos|axion|lozacrem|desengrasante|desinfectante|limpiavidrios|limpiador|limpido|fabuloso|pinolina|ajax|varsol|destapa\s+canerias|cera\s+(?:para\s+)?piso)\b/.test(hay)) {
    return matchOf("Limpiadores y lavalozas");
  }
  if (/\b(ambientador|glade|air\s+wick|poett|insecticida|raid|baygon|plaga|repelente\s+ambiente)\b/.test(hay)) {
    return matchOf("Ambientadores e insecticidas");
  }
  if (/\b(papel\s+higienico|servilleta|toalla(?:s)?\s+(?:de\s+)?cocina|papel\s+aluminio|aluminio\s+rollo|bolsas?\s+(?:de\s+basura|recerrable|ziploc|multiusos)|desechable|familia|scott|rosal)\b/.test(hay)) {
    return matchOf("Papeles, desechables y empaques");
  }
  if (/\b(escoba|trapero|trapeador|esponja|fibra|guante|pano\s+multiusos|cepillo\s+(?:ropa|piso|banos)|betun|cherry|grif)\b/.test(hay)) {
    return matchOf("Implementos de limpieza");
  }

  // Cuidado personal
  if (/\b(crema\s+dental|pasta\s+dental|colgate|oral\s*b|sensodyne|enjuague\s+bucal|listerine|seda\s+dental|hilo\s+dental|cepillo\s+(?:dental|de\s+dientes))\b/.test(hay)) {
    return matchOf("Cuidado oral");
  }
  if (/\b(shampoo|champu|acondicionador|crema\s+(?:para|de)\s+peinar|tratamiento\s+capilar|tinte\s+cabello|fijador\s+cabello|head\s*&\s*shoulders|pantene|sedal|savital|nutribela|bio\s+expert|elusive)\b/.test(hay)) {
    return matchOf("Cuidado capilar");
  }
  if (/\b(toalla(?:s)?\s+higienica|nosotras|kotex|tampon|protector(?:es)?\s+diario|jabon\s+intimo|saba)\b/.test(hay)) {
    return matchOf("Higiene íntima y protección");
  }
  if (/\b(afeitadora|prestobarba|gillette|schick|espuma\s+(?:de\s+)?afeitar|depilacion|cera\s+depilatoria|repelente\s+(?:piel|mosquitos|noff|stay\s+off))\b/.test(hay)) {
    return matchOf("Afeitado, depilación y repelentes");
  }
  if (/\b(desodorante|rexona|dove|nivea|balance|speed\s+stick|jabon\s+(?:liquido|corporal|tocador|bano|protex|palmolive)|protector\s+solar|bloqueador\s+solar|eucerin|cetaphil|neutrogena|bioderma|cerave|crema\s+(?:corporal|manos|facial|hidratante|humectante))\b/.test(hay)) {
    return matchOf("Cuidado corporal, facial y solar");
  }

  // Bebidas (antes de café/leche cuando es líquido listo)
  if (/\b(energizante|vive\s*100|red\s+bull|monster|speed\s+max|gatorade|powerade|electrolit|isotonica)\b/.test(hay)) {
    return matchOf("Hidratantes y energizantes");
  }
  if (/\b(gaseosa|coca\s+cola|pepsi|colombiana|manzana\s+postobon|quatro|sprite|seven\s+up|pony\s+malta|bretana|soda|ginger\s+ale|tonica)\b/.test(hay)) {
    return matchOf("Gaseosas y maltas");
  }
  if (/\b(te\s+(?:liquido|frio|helado)|fuze\s+tea|hatsu|mr\s+tea|lipton\s+ice)\b/.test(hay)) {
    return matchOf("Té líquido y bebidas listas");
  }
  if (/\b(jugo|nectar|hit|del\s+valle|tampico|cifrut|frutiño|frutino|tang|clight|pulpa\s+liquida)\b/.test(hay)) {
    return matchOf("Jugos, néctares y refrescos");
  }
  if (/\b(agua\s+(?:pura|natural|sin\s+gas|con\s+gas|mineral|cristal|brisa|manantial|h2oh)|botella\s+agua)\b/.test(hay)) {
    return matchOf("Aguas");
  }

  // Lácteos, Huevos y Refrigerados
  if (/\bhuevo(?:s)?\b/.test(hay) && !/\bchocolate|kinder\b/.test(hay)) {
    return matchOf("Huevos");
  }
  if (/\b(leche\s+(?:de\s+)?(?:almendra|soya|soja|coco|avena|arroz)|bebida\s+(?:de\s+)?(?:almendra|soya|avena|coco)|silk|ades|natures\s+heart)\b/.test(hay)) {
    return matchOf("Bebidas vegetales");
  }
  if (/\b(yogurt|yogur|kumis|alpinito|yogo\s+yogo|yox|kefir|avena\s+(?:alpina|alqueria|colanta|liquida|vaso))\b/.test(hay)) {
    return matchOf("Yogures, kumis y avenas");
  }
  if (/\b(arepa(?:s)?|tortilla(?:s)?\s+(?:de\s+trigo|maiz|bimbo|del\s+comal)|taco\s+shell)\b/.test(hay)) {
    return matchOf("Arepas y tortillas");
  }
  if (/\b(queso|quesito|cuajada|mozzarella|parmesano|doble\s+crema|cheddar|brie|holandes|suero\s+costeno)\b/.test(hay) && !/\b(pollo|pechuga|muslo|contramuslo|carne|cerdo|chorizo)\b/.test(hay)) {
    return matchOf("Quesos y cuajadas");
  }
  if (/\b(mantequilla|margarina|rama|campi|la\s+fina|crema\s+de\s+leche|ghee)\b/.test(hay)) {
    return matchOf("Mantequillas, margarinas y cremas");
  }
  if (/\b(leche\s+(?:entera|deslactosada|semidescremada|descremada|en\s+polvo|uht|larga\s+vida)|alqueria|colanta|parmala|pomas|klim|medalla\s+de\s+oro)\b/.test(hay)) {
    return matchOf("Leches");
  }

  // Carnes, Pescados y Charcutería
  if (/\b(salchicha|salchichon|jamon|mortadela|chorizo|tocineta|cabanos|butifarra|pepperoni|salami|prosciutto|jamoneta|ranchera|zenu|rica|pietran|swiss|cunit)\b/.test(hay)) {
    return matchOf("Carnes frías y charcutería");
  }
  if (/\b(atun|sardina|enlatado|conserva|durazno\s+en\s+almibar|maiz\s+dulce\s+lata|arveja\s+lata|frijol\s+lata|champinon\s+lata|van\s+camps|isabel|soberana|alimentos\s+en\s+lata)\b/.test(hay)) {
    return matchOf("Enlatados y conservas");
  }
  if (/\b(pescado|tilapia|trucha|salmon|bagre|mojarra|robalo|camaron|langostino|calamar|marisco|filete\s+de\s+pescado)\b/.test(hay)) {
    return matchOf("Pescados y mariscos");
  }
  if (/\b(pollo|pechuga|muslo|pernil|contramuslo|alas\s+de\s+pollo|pavo|nucita\s+pollo|mac\s+pollo|friko|bucanero)\b/.test(hay)) {
    return matchOf("Pollo y aves");
  }
  if (/\b(cerdo|costilla\s+cerdo|lomo\s+de\s+cerdo|chuleta|tocino|pernil\s+cerdo|espinazo)\b/.test(hay)) {
    return matchOf("Carne de cerdo");
  }
  if (/\b(carne\s+(?:de\s+)?res|molida\s+res|solomo|solomito|sobrebarriga|lomo\s+res|cadera|posta|muchacho|punta\s+de\s+anca|costilla\s+res|hamburguesa\s+res)\b/.test(hay)) {
    return matchOf("Carne de res");
  }

  // Congelados y Comidas Listas
  if (/\b(helado|paleta|crem\s+helado|popsy|polet|chococono|bocatto)\b/.test(hay)) {
    return matchOf("Helados y postres");
  }
  if (/\b(empanada|lasana|lasaña|pizza|tamal|nuggets|deditos\s+de\s+queso|palitos\s+de\s+queso|comida\s+(?:lista|preparada)|hamburguesa\s+congelada|papa\s+francesa\s+congelada|yuca\s+congelada|hielo)\b/.test(hay)) {
    if (/\b(hielo|congelada|congelado)\b/.test(hay) && !/\b(pizza|lasana|empanada|tamal)\b/.test(hay)) {
      return matchOf("Congelados y hielo");
    }
    return matchOf("Comidas preparadas");
  }

  // Frutas y Verduras
  if (/\b(pulpa\s+(?:de\s+)?fruta|fruta\s+congelada|mora\s+congelada|lulo\s+congelado|mango\s+congelado)\b/.test(hay)) {
    return matchOf("Pulpas y fruver congelado");
  }
  if (/\b(cilantro|perejil|albahaca|hierbabuena|romero|tomillo|laurel|menta\s+fresca|sabila)\b/.test(hay)) {
    return matchOf("Hierbas, aromáticas y plantas");
  }
  if (/\b(banano|manzana|pera|fresa|mora|uva|mango|papaya|pina|naranja|mandarina|limon|aguacate|maracuya|lulo|guanabana|sandia|melon|kiwi|durazno\s+fresco|guayaba)\b/.test(hay)) {
    return matchOf("Frutas frescas");
  }
  if (/\b(tomate|cebolla|papa\s+(?:pastusa|criolla|sabanera|capira)|zanahoria|lechuga|brocoli|coliflor|pepino|pimenton|ajo|espinaca|platano|yuca|arracacha|habichuela|mazorca|ahuyama|calabacin)\b/.test(hay)) {
    return matchOf("Verduras, hortalizas y tubérculos");
  }

  // Despensa
  if (/\b(arroz|frijol|lenteja|garbanzo|arveja|blanquillo|maiz\s+pira|diana|roa|florhuila|sonora|castellano)\b/.test(hay)) {
    return matchOf("Arroz, granos y semillas");
  }
  if (/\b(pasta|espagueti|spaghetti|tallarin|fusilli|penne|macarron|fideo|conchitas|doria|monticello|la\s+muneca|barilla)\b/.test(hay)) {
    return matchOf("Pastas y fideos");
  }
  if (/\b(aceite|vinagre|oliva\s+extra|girasol|canola|soya\s+aceite|premier|gourmet|ricuras|oliosoya|carbonell|ybarra)\b/.test(hay)) {
    return matchOf("Aceites y vinagres");
  }
  if (/\b(harina|premezcla|fecula|maizena|promasa|pan\s+harina|haz\s+de\s+oros|natilla|bunuelo)\b/.test(hay)) {
    return matchOf("Harinas y premezclas");
  }
  if (/\b(azucar|panela|endulzante|stevia|sucralosa|splenda|miel\s+de\s+abejas|incauca|manuelita|riopaila)\b/.test(hay)) {
    return matchOf("Azúcar, panela y endulzantes");
  }
  if (/\b(cafe|capuchino|cappuccino|espresso|sello\s+rojo|juan\s+valdez|colcafe|nescafe|matiz|oma|tostao|lukafe|aguila\s+roja|chocolate\s+(?:de\s+mesa|en\s+polvo|luker|corona|sol)|milo|chocolisto|cocoa|aromatica|te\s+(?:hindu|jaibel|bolsa|cajas))\b/.test(hay)) {
    return matchOf("Café, chocolate e infusiones");
  }
  if (/\b(cereal|granola|avena\s+(?:en\s+hojuelas|molida|quaker)|corn\s+flakes|zucaritas|choco\s+krispis|froot\s+loops|fitness|kelloggs)\b/.test(hay)) {
    return matchOf("Cereales, granolas y avenas");
  }
  if (/\b(salsa|mayonesa|mostaza|ketchup|aderezo|caldo\s+(?:de|maggi|knorr|doña|dona|ricostilla)|sopa|crema\s+(?:de|pollo|champinones|tomate)|condimento|pimienta|comino|oregano|sal\s+(?:refisal|marina))\b/.test(hay)) {
    return matchOf("Salsas, condimentos y sopas");
  }
  if (/\b(mermelada|arequipe|dulce\s+de\s+leche|nutella|crema\s+de\s+avellana|leche\s+condensada|mantequilla\s+de\s+mani)\b/.test(hay)) {
    return matchOf("Mermeladas, arequipes y untables");
  }
  if (/\b(gelatina|flan|pudin|polvo\s+(?:para\s+)?hornear|levadura|esencia\s+vainilla|royal)\b/.test(hay)) {
    return matchOf("Repostería y gelatinas");
  }

  // Snacks, Galletas y Dulces
  if (/\b(galleta|saltin|ducales|festival|oreo|milo\s+galleta|wafer|club\s+social|toscanas|tosh|crakeñas|noel)\b/.test(hay)) {
    return matchOf("Galletas");
  }
  if (/\b(mani|almendra|nuez|nueces|maranon|pistacho|pasas|ciruelas\s+pasas|frutos\s+secos|mix\s+semillas|la\s+especial)\b/.test(hay)) {
    return matchOf("Frutos secos y semillas");
  }
  if (/\b(papas?\s+(?:margarita|pringles|fritas|rizadas)|doritos|cheetos|detodito|tostitos|chicharron\s+paquete|platanitos|crispetas|maiz\s+tostado|rosquitas|achiras|pasabocas|snack)\b/.test(hay)) {
    return matchOf("Pasabocas salados");
  }
  if (/\b(chocolate\s+(?:jet|jumbo|hershey|snickers|m&m|ferrero|barra)|gomita|trululu|caramelo|chupeta|bon\s+bon\s+bum|bocadillo|chicle|trident|mentas|confiteria)\b/.test(hay)) {
    return matchOf("Chocolates, dulces y confitería");
  }

  // Panadería y Pastelería
  if (/\b(ponque|torta|brownie|muffin|cupcake|ramo|chocoramo|gansito|pinguino|brazos?\s+de\s+reina)\b/.test(hay)) {
    return matchOf("Tortas y pastelería dulce");
  }
  if (/\b(pan\s+(?:tajado|integral|blanco|brioche|hamburguesa|perro|artesanal|aliñado|alino|de\s+yuca|de\s+bono|blandito)|bimbo|comapan|guadalupe|tostadas|calados|croissant|almojabana|pandebono|pandequeso)\b/.test(hay)) {
    return matchOf("Panadería empacada");
  }

  return matchOf("Saludable y especiales");
}
