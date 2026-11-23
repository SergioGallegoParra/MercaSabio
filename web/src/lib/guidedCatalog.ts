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
  department?: string;
  barrio: string;
  label: string;
  lat: number;
  lng: number;
}

export const COLOMBIAN_CITIES: Array<{
  city: string;
  department?: string;
  barrios: BarrioLocationOption[];
}> = [
  {
    city: "Bogotá",
    department: "Bogotá D.C.",
    barrios: [
      { id: "bog-chapinero", city: "Bogotá", department: "Bogotá D.C.", barrio: "Chapinero", label: "Bogotá · Chapinero", lat: 4.646, lng: -74.063 },
      { id: "bog-chico", city: "Bogotá", department: "Bogotá D.C.", barrio: "Chicó / Calle 85", label: "Bogotá · Chicó / Calle 85", lat: 4.669, lng: -74.054 },
      { id: "bog-cedritos", city: "Bogotá", department: "Bogotá D.C.", barrio: "Cedritos / Usaquén", label: "Bogotá · Cedritos / Usaquén", lat: 4.719, lng: -74.035 },
      { id: "bog-teusaquillo", city: "Bogotá", department: "Bogotá D.C.", barrio: "Teusaquillo / Galerías", label: "Bogotá · Teusaquillo / Galerías", lat: 4.642, lng: -74.074 },
      { id: "bog-modelia", city: "Bogotá", department: "Bogotá D.C.", barrio: "Modelia / Fontibón", label: "Bogotá · Modelia / Fontibón", lat: 4.669, lng: -74.124 },
      { id: "bog-suba", city: "Bogotá", department: "Bogotá D.C.", barrio: "Suba Imperial", label: "Bogotá · Suba", lat: 4.747, lng: -74.089 },
      { id: "bog-kennedy", city: "Bogotá", department: "Bogotá D.C.", barrio: "Kennedy / Plaza de las Américas", label: "Bogotá · Kennedy", lat: 4.619, lng: -74.136 },
      { id: "bog-engativa", city: "Bogotá", department: "Bogotá D.C.", barrio: "Engativá / Álamos", label: "Bogotá · Engativá", lat: 4.699, lng: -74.115 },
      { id: "bog-bosa", city: "Bogotá", department: "Bogotá D.C.", barrio: "Bosa / Autopista Sur", label: "Bogotá · Bosa", lat: 4.609, lng: -74.185 },
      { id: "bog-centro", city: "Bogotá", department: "Bogotá D.C.", barrio: "Centro / San Martín", label: "Bogotá · Centro", lat: 4.616, lng: -74.069 },
    ],
  },
  {
    city: "Medellín",
    department: "Antioquia",
    barrios: [
      { id: "med-poblado", city: "Medellín", department: "Antioquia", barrio: "El Poblado", label: "Medellín · El Poblado", lat: 6.209, lng: -75.572 },
      { id: "med-laureles", city: "Medellín", department: "Antioquia", barrio: "Laureles / Estadio", label: "Medellín · Laureles", lat: 6.245, lng: -75.594 },
      { id: "med-envigado", city: "Medellín", department: "Antioquia", barrio: "Envigado", label: "Medellín · Envigado", lat: 6.175, lng: -75.588 },
      { id: "med-belen", city: "Medellín", department: "Antioquia", barrio: "Belén", label: "Medellín · Belén", lat: 6.232, lng: -75.597 },
      { id: "med-robledo", city: "Medellín", department: "Antioquia", barrio: "Robledo / Los Colores", label: "Medellín · Robledo", lat: 6.272, lng: -75.589 },
      { id: "med-sabaneta", city: "Medellín", department: "Antioquia", barrio: "Sabaneta / Mayorca", label: "Medellín · Sabaneta", lat: 6.153, lng: -75.616 },
      { id: "med-bello", city: "Medellín", department: "Antioquia", barrio: "Bello / Niquía", label: "Medellín · Bello", lat: 6.336, lng: -75.554 },
    ],
  },
  {
    city: "Cali",
    department: "Valle del Cauca",
    barrios: [
      { id: "cal-granada", city: "Cali", department: "Valle del Cauca", barrio: "Granada / Norte", label: "Cali · Granada / Norte", lat: 3.458, lng: -76.536 },
      { id: "cal-jardin", city: "Cali", department: "Valle del Cauca", barrio: "Ciudad Jardín / Sur", label: "Cali · Ciudad Jardín", lat: 3.368, lng: -76.534 },
      { id: "cal-tequendama", city: "Cali", department: "Valle del Cauca", barrio: "Tequendama / San Fernando", label: "Cali · Tequendama", lat: 3.425, lng: -76.544 },
      { id: "cal-lili", city: "Cali", department: "Valle del Cauca", barrio: "Valle del Lili", label: "Cali · Valle del Lili", lat: 3.379, lng: -76.526 },
      { id: "cal-chipichape", city: "Cali", department: "Valle del Cauca", barrio: "Chipichape / Menga", label: "Cali · Chipichape", lat: 3.476, lng: -76.528 },
      { id: "cal-calipso", city: "Cali", department: "Valle del Cauca", barrio: "Calipso / Oriente", label: "Cali · Calipso", lat: 3.418, lng: -76.497 },
    ],
  },
  {
    city: "Barranquilla",
    department: "Atlántico",
    barrios: [
      { id: "baq-altoprado", city: "Barranquilla", department: "Atlántico", barrio: "Alto Prado / Riomar", label: "Barranquilla · Alto Prado", lat: 11.005, lng: -74.812 },
      { id: "baq-buenavista", city: "Barranquilla", department: "Atlántico", barrio: "Buenavista / Villa Carolina", label: "Barranquilla · Buenavista", lat: 11.012, lng: -74.826 },
      { id: "baq-elprado", city: "Barranquilla", department: "Atlántico", barrio: "El Prado / Centro Norte", label: "Barranquilla · El Prado", lat: 10.991, lng: -74.796 },
      { id: "baq-murillo", city: "Barranquilla", department: "Atlántico", barrio: "Murillo / Ciudadela 20 de Julio", label: "Barranquilla · Murillo", lat: 10.935, lng: -74.798 },
      { id: "baq-soledad", city: "Barranquilla", department: "Atlántico", barrio: "Soledad / Plaza del Sol", label: "Barranquilla · Soledad", lat: 10.922, lng: -74.773 },
    ],
  },
  {
    city: "Cartagena",
    department: "Bolívar",
    barrios: [
      { id: "ctg-bocagrande", city: "Cartagena", department: "Bolívar", barrio: "Bocagrande / Castillogrande", label: "Cartagena · Bocagrande", lat: 10.402, lng: -75.554 },
      { id: "ctg-manga", city: "Cartagena", department: "Bolívar", barrio: "Manga / Pie de la Popa", label: "Cartagena · Manga", lat: 10.413, lng: -75.533 },
      { id: "ctg-centro", city: "Cartagena", department: "Bolívar", barrio: "Centro / La Matuna", label: "Cartagena · Centro", lat: 10.424, lng: -75.547 },
      { id: "ctg-castellana", city: "Cartagena", department: "Bolívar", barrio: "La Castellana / Ronda Real", label: "Cartagena · La Castellana", lat: 10.397, lng: -75.49 },
      { id: "ctg-crespo", city: "Cartagena", department: "Bolívar", barrio: "Crespo / Marbella", label: "Cartagena · Crespo", lat: 10.445, lng: -75.515 },
    ],
  },
  {
    city: "Bucaramanga",
    department: "Santander",
    barrios: [
      { id: "bga-cabecera", city: "Bucaramanga", department: "Santander", barrio: "Cabecera del Llano", label: "Bucaramanga · Cabecera", lat: 7.116, lng: -73.111 },
      { id: "bga-canaveral", city: "Bucaramanga", department: "Santander", barrio: "Cañaveral / Floridablanca", label: "Bucaramanga · Cañaveral", lat: 7.068, lng: -73.105 },
      { id: "bga-sotomayor", city: "Bucaramanga", department: "Santander", barrio: "Sotomayor / Conucos", label: "Bucaramanga · Sotomayor", lat: 7.113, lng: -73.117 },
      { id: "bga-centro", city: "Bucaramanga", department: "Santander", barrio: "Centro / Rovira", label: "Bucaramanga · Centro", lat: 7.121, lng: -73.128 },
      { id: "bga-realminas", city: "Bucaramanga", department: "Santander", barrio: "Ciudadela Real de Minas", label: "Bucaramanga · Real de Minas", lat: 7.108, lng: -73.124 },
    ],
  },
  {
    city: "Pereira",
    department: "Risaralda",
    barrios: [
      { id: "pei-circunvalar", city: "Pereira", department: "Risaralda", barrio: "Circunvalar / Pinares", label: "Pereira · Circunvalar", lat: 4.807, lng: -75.684 },
      { id: "pei-centro", city: "Pereira", department: "Risaralda", barrio: "Centro / Lago Uribe", label: "Pereira · Centro", lat: 4.814, lng: -75.694 },
      { id: "pei-cerritos", city: "Pereira", department: "Risaralda", barrio: "Cerritos / Cuba", label: "Pereira · Cerritos", lat: 4.804, lng: -75.736 },
      { id: "pei-dosquebradas", city: "Pereira", department: "Risaralda", barrio: "Dosquebradas / Molinos", label: "Pereira · Dosquebradas", lat: 4.832, lng: -75.676 },
    ],
  },
  {
    city: "Manizales",
    department: "Caldas",
    barrios: [
      { id: "mzl-cable", city: "Manizales", department: "Caldas", barrio: "El Cable / Laureles", label: "Manizales · El Cable", lat: 5.056, lng: -75.485 },
      { id: "mzl-centro", city: "Manizales", department: "Caldas", barrio: "Centro / Fundadores", label: "Manizales · Centro", lat: 5.069, lng: -75.517 },
      { id: "mzl-palermo", city: "Manizales", department: "Caldas", barrio: "Palermo / Milán", label: "Manizales · Palermo", lat: 5.052, lng: -75.479 },
      { id: "mzl-laenea", city: "Manizales", department: "Caldas", barrio: "La Enea / Lusitania", label: "Manizales · La Enea", lat: 5.034, lng: -75.461 },
    ],
  },
  {
    city: "Armenia",
    department: "Quindío",
    barrios: [
      { id: "axm-norte", city: "Armenia", department: "Quindío", barrio: "Norte / Avenida Bolívar", label: "Armenia · Av. Bolívar", lat: 4.558, lng: -75.654 },
      { id: "axm-centro", city: "Armenia", department: "Quindío", barrio: "Centro / Parque Sucre", label: "Armenia · Centro", lat: 4.537, lng: -75.671 },
      { id: "axm-calima", city: "Armenia", department: "Quindío", barrio: "Calima / Sur", label: "Armenia · Calima", lat: 4.525, lng: -75.682 },
    ],
  },
  {
    city: "Ibagué",
    department: "Tolima",
    barrios: [
      { id: "ibe-milladeoro", city: "Ibagué", department: "Tolima", barrio: "Milla de Oro / Calle 60", label: "Ibagué · Milla de Oro", lat: 4.442, lng: -75.188 },
      { id: "ibe-centro", city: "Ibagué", department: "Tolima", barrio: "Centro / Carrera 3", label: "Ibagué · Centro", lat: 4.441, lng: -75.237 },
      { id: "ibe-elvergel", city: "Ibagué", department: "Tolima", barrio: "El Vergel / Calambeo", label: "Ibagué · El Vergel", lat: 4.455, lng: -75.209 },
      { id: "ibe-picalena", city: "Ibagué", department: "Tolima", barrio: "Picaleña / Mirolindo", label: "Ibagué · Mirolindo", lat: 4.426, lng: -75.162 },
    ],
  },
  {
    city: "Cúcuta",
    department: "Norte de Santander",
    barrios: [
      { id: "cuc-caobos", city: "Cúcuta", department: "Norte de Santander", barrio: "Caobos / Quinta Vélez", label: "Cúcuta · Caobos", lat: 7.887, lng: -72.496 },
      { id: "cuc-centro", city: "Cúcuta", department: "Norte de Santander", barrio: "Centro / Ventura Plaza", label: "Cúcuta · Centro", lat: 7.892, lng: -72.506 },
      { id: "cuc-guaimaral", city: "Cúcuta", department: "Norte de Santander", barrio: "Guaimaral / La Ceiba", label: "Cúcuta · Guaimaral", lat: 7.898, lng: -72.487 },
      { id: "cuc-atalaya", city: "Cúcuta", department: "Norte de Santander", barrio: "Atalaya", label: "Cúcuta · Atalaya", lat: 7.913, lng: -72.532 },
    ],
  },
  {
    city: "Santa Marta",
    department: "Magdalena",
    barrios: [
      { id: "smr-rodadero", city: "Santa Marta", department: "Magdalena", barrio: "El Rodadero / Gaira", label: "Santa Marta · Rodadero", lat: 11.204, lng: -74.225 },
      { id: "smr-bavaria", city: "Santa Marta", department: "Magdalena", barrio: "Bavaria / Ocean Mall", label: "Santa Marta · Bavaria", lat: 11.236, lng: -74.202 },
      { id: "smr-centro", city: "Santa Marta", department: "Magdalena", barrio: "Centro Histórico", label: "Santa Marta · Centro", lat: 11.244, lng: -74.211 },
      { id: "smr-buenavista", city: "Santa Marta", department: "Magdalena", barrio: "Buenavista / Mamatoco", label: "Santa Marta · Mamatoco", lat: 11.224, lng: -74.165 },
    ],
  },
  {
    city: "Villavicencio",
    department: "Meta",
    barrios: [
      { id: "vvc-primavera", city: "Villavicencio", department: "Meta", barrio: "Primavera / Viva", label: "Villavicencio · Primavera", lat: 4.133, lng: -73.628 },
      { id: "vvc-barzal", city: "Villavicencio", department: "Meta", barrio: "Barzal / Centro", label: "Villavicencio · Barzal", lat: 4.147, lng: -73.637 },
      { id: "vvc-caudal", city: "Villavicencio", department: "Meta", barrio: "Caudal / Llanocentro", label: "Villavicencio · Caudal", lat: 4.151, lng: -73.626 },
      { id: "vvc-porfia", city: "Villavicencio", department: "Meta", barrio: "Porfía / Amarilo", label: "Villavicencio · Porfía", lat: 4.101, lng: -73.658 },
    ],
  },
  {
    city: "Pasto",
    department: "Nariño",
    barrios: [
      { id: "pso-norte", city: "Pasto", department: "Nariño", barrio: "Av. Los Estudiantes / Norte", label: "Pasto · Av. Los Estudiantes", lat: 1.222, lng: -77.285 },
      { id: "pso-centro", city: "Pasto", department: "Nariño", barrio: "Centro / Plaza de Nariño", label: "Pasto · Centro", lat: 1.213, lng: -77.278 },
      { id: "pso-unicentro", city: "Pasto", department: "Nariño", barrio: "Unicentro / Valle de Atriz", label: "Pasto · Unicentro", lat: 1.203, lng: -77.284 },
    ],
  },
  {
    city: "Montería",
    department: "Córdoba",
    barrios: [
      { id: "mtr-alamedas", city: "Montería", department: "Córdoba", barrio: "Alamedas / Norte", label: "Montería · Alamedas", lat: 8.768, lng: -75.869 },
      { id: "mtr-centro", city: "Montería", department: "Córdoba", barrio: "Centro / Avenida Primera", label: "Montería · Centro", lat: 8.754, lng: -75.888 },
      { id: "mtr-castellana", city: "Montería", department: "Córdoba", barrio: "La Castellana / Recreo", label: "Montería · La Castellana", lat: 8.774, lng: -75.862 },
    ],
  },
  {
    city: "Neiva",
    department: "Huila",
    barrios: [
      { id: "nva-sanpedro", city: "Neiva", department: "Huila", barrio: "San Pedro Plaza / Norte", label: "Neiva · Norte", lat: 2.952, lng: -75.289 },
      { id: "nva-centro", city: "Neiva", department: "Huila", barrio: "Altico / Centro", label: "Neiva · Centro", lat: 2.927, lng: -75.287 },
      { id: "nva-santalucia", city: "Neiva", department: "Huila", barrio: "Santa Lucía / La Toma", label: "Neiva · Santa Lucía", lat: 2.936, lng: -75.268 },
    ],
  },
  {
    city: "Valledupar",
    department: "Cesar",
    barrios: [
      { id: "vup-guatapuri", city: "Valledupar", department: "Cesar", barrio: "Guatapurí / Norte", label: "Valledupar · Guatapurí", lat: 10.478, lng: -73.249 },
      { id: "vup-centro", city: "Valledupar", department: "Cesar", barrio: "Centro / Calle 17", label: "Valledupar · Centro", lat: 10.474, lng: -73.25 },
      { id: "vup-novalito", city: "Valledupar", department: "Cesar", barrio: "Novalito / Los Músicos", label: "Valledupar · Novalito", lat: 10.466, lng: -73.261 },
    ],
  },
  {
    city: "Popayán",
    department: "Cauca",
    barrios: [
      { id: "ppn-campanario", city: "Popayán", department: "Cauca", barrio: "Campanario / Norte", label: "Popayán · Campanario", lat: 2.456, lng: -76.597 },
      { id: "ppn-centro", city: "Popayán", department: "Cauca", barrio: "Centro Histórico", label: "Popayán · Centro", lat: 2.441, lng: -76.606 },
      { id: "ppn-esmeralda", city: "Popayán", department: "Cauca", barrio: "La Esmeralda / Panamericana", label: "Popayán · La Esmeralda", lat: 2.446, lng: -76.62 },
    ],
  },
  {
    city: "Tunja",
    department: "Boyacá",
    barrios: [
      { id: "tun-unicentro", city: "Tunja", department: "Boyacá", barrio: "Unicentro / Av. Universitaria", label: "Tunja · Av. Universitaria", lat: 5.552, lng: -73.35 },
      { id: "tun-centro", city: "Tunja", department: "Boyacá", barrio: "Centro Histórico", label: "Tunja · Centro", lat: 5.533, lng: -73.362 },
      { id: "tun-muiscas", city: "Tunja", department: "Boyacá", barrio: "Los Muiscas / Norte", label: "Tunja · Los Muiscas", lat: 5.561, lng: -73.356 },
    ],
  },
  {
    city: "Sincelejo",
    department: "Sucre",
    barrios: [
      { id: "sin-guacari", city: "Sincelejo", department: "Sucre", barrio: "Guacarí / Venecia", label: "Sincelejo · Guacarí", lat: 9.297, lng: -75.382 },
      { id: "sin-centro", city: "Sincelejo", department: "Sucre", barrio: "Centro / Las Majaguas", label: "Sincelejo · Centro", lat: 9.302, lng: -75.397 },
      { id: "sin-laford", city: "Sincelejo", department: "Sucre", barrio: "La Ford / Florencia", label: "Sincelejo · La Ford", lat: 9.313, lng: -75.392 },
    ],
  },
  {
    city: "Riohacha",
    department: "La Guajira",
    barrios: [
      { id: "rch-marina", city: "Riohacha", department: "La Guajira", barrio: "Viva Wajiira / La Marina", label: "Riohacha · La Marina", lat: 11.539, lng: -72.912 },
      { id: "rch-centro", city: "Riohacha", department: "La Guajira", barrio: "Centro / Padilla", label: "Riohacha · Centro", lat: 11.547, lng: -72.907 },
      { id: "rch-coquivacoa", city: "Riohacha", department: "La Guajira", barrio: "Coquivacoa", label: "Riohacha · Coquivacoa", lat: 11.532, lng: -72.899 },
    ],
  },
  {
    city: "Quibdó",
    department: "Chocó",
    barrios: [
      { id: "uib-centro", city: "Quibdó", department: "Chocó", barrio: "Centro / Malecón", label: "Quibdó · Centro", lat: 5.692, lng: -76.661 },
      { id: "uib-carano", city: "Quibdó", department: "Chocó", barrio: "El Caraño / Niño Jesús", label: "Quibdó · El Caraño", lat: 5.695, lng: -76.649 },
    ],
  },
  {
    city: "Florencia",
    department: "Caquetá",
    barrios: [
      { id: "fla-granplaza", city: "Florencia", department: "Caquetá", barrio: "Gran Plaza / Centro", label: "Florencia · Centro", lat: 1.615, lng: -75.608 },
      { id: "fla-juanxxiii", city: "Florencia", department: "Caquetá", barrio: "Juan XXIII / Norte", label: "Florencia · Juan XXIII", lat: 1.622, lng: -75.612 },
    ],
  },
  {
    city: "Yopal",
    department: "Casanare",
    barrios: [
      { id: "eyp-alcaravan", city: "Yopal", department: "Casanare", barrio: "Alcaraván / Morichal", label: "Yopal · Alcaraván", lat: 5.332, lng: -72.39 },
      { id: "eyp-centro", city: "Yopal", department: "Casanare", barrio: "Centro / Carrera 20", label: "Yopal · Centro", lat: 5.347, lng: -72.395 },
      { id: "eyp-granplaza", city: "Yopal", department: "Casanare", barrio: "Gran Plaza / Llano", label: "Yopal · Gran Plaza", lat: 5.337, lng: -72.403 },
    ],
  },
  {
    city: "Mocoa",
    department: "Putumayo",
    barrios: [
      { id: "mco-centro", city: "Mocoa", department: "Putumayo", barrio: "Centro / Parque Santander", label: "Mocoa · Centro", lat: 1.152, lng: -76.648 },
      { id: "mco-avcolombia", city: "Mocoa", department: "Putumayo", barrio: "Avenida Colombia", label: "Mocoa · Av. Colombia", lat: 1.148, lng: -76.654 },
    ],
  },
  {
    city: "San Andrés",
    department: "San Andrés y Providencia",
    barrios: [
      { id: "adz-centro", city: "San Andrés", department: "San Andrés y Providencia", barrio: "Centro / Spratt Bight", label: "San Andrés · Centro", lat: 12.583, lng: -81.694 },
      { id: "adz-sanluis", city: "San Andrés", department: "San Andrés y Providencia", barrio: "San Luis / La Loma", label: "San Andrés · San Luis", lat: 12.556, lng: -81.709 },
    ],
  },
  {
    city: "Leticia",
    department: "Amazonas",
    barrios: [
      { id: "let-centro", city: "Leticia", department: "Amazonas", barrio: "Centro / Parque Santander", label: "Leticia · Centro", lat: -4.215, lng: -69.942 },
      { id: "let-internacional", city: "Leticia", department: "Amazonas", barrio: "Avenida Internacional", label: "Leticia · Av. Internacional", lat: -4.209, lng: -69.935 },
    ],
  },
  {
    city: "Arauca",
    department: "Arauca",
    barrios: [
      { id: "auc-centro", city: "Arauca", department: "Arauca", barrio: "Centro / Paseo Carlos Isael", label: "Arauca · Centro", lat: 7.088, lng: -70.759 },
      { id: "auc-meridiano", city: "Arauca", department: "Arauca", barrio: "Meridiano 70", label: "Arauca · Meridiano 70", lat: 7.079, lng: -70.751 },
    ],
  },
  {
    city: "San José del Guaviare",
    department: "Guaviare",
    barrios: [
      { id: "sje-centro", city: "San José del Guaviare", department: "Guaviare", barrio: "Centro / Carrera 20", label: "San José del Guaviare · Centro", lat: 2.571, lng: -72.641 },
      { id: "sje-eldorado", city: "San José del Guaviare", department: "Guaviare", barrio: "El Dorado", label: "San José del Guaviare · El Dorado", lat: 2.567, lng: -72.648 },
    ],
  },
  {
    city: "Inírida",
    department: "Guainía",
    barrios: [
      { id: "pda-centro", city: "Inírida", department: "Guainía", barrio: "Centro / Puerto Inírida", label: "Inírida · Centro", lat: 3.865, lng: -67.923 },
    ],
  },
  {
    city: "Mitú",
    department: "Vaupés",
    barrios: [
      { id: "mvp-centro", city: "Mitú", department: "Vaupés", barrio: "Centro / Malecón Vaupés", label: "Mitú · Centro", lat: 1.253, lng: -70.234 },
    ],
  },
  {
    city: "Puerto Carreño",
    department: "Vichada",
    barrios: [
      { id: "pcr-centro", city: "Puerto Carreño", department: "Vichada", barrio: "Centro / Av. Orinoco", label: "Puerto Carreño · Centro", lat: 6.189, lng: -67.485 },
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
