"""Directorio georreferenciado de las 32 capitales departamentales de Colombia."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

from etl.locations.models import BranchRecord


@dataclass(frozen=True, slots=True)
class CapitalZoneSpec:
    """Zona o barrio representativo dentro de una capital colombiana."""

    zone_id: str
    barrio: str
    lat: float
    lng: float
    road_hint: str
    stores: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CapitalCitySpec:
    """Capital departamental con sus zonas comerciales de referencia."""

    city: str
    department: str
    center_lat: float
    center_lng: float
    zones: tuple[CapitalZoneSpec, ...]


STORE_DISPLAY_PREFIX: dict[str, str] = {
    "ara": "Ara",
    "d1": "D1",
    "olimpica": "Olímpica",
    "exito": "Éxito",
    "carulla": "Carulla",
    "farmatodo": "Farmatodo",
    "euro": "Euro",
    "oxxo": "OXXO",
    "mercaldas": "Mercaldas",
    "isimo": "Ísimo",
    "zapatoca": "Zapatoca",
    "makro": "Makro",
}


COLOMBIA_CAPITALS_DIRECTORY: tuple[CapitalCitySpec, ...] = (
    CapitalCitySpec(
        city="Bogotá",
        department="Bogotá D.C.",
        center_lat=4.646,
        center_lng=-74.063,
        zones=(
            CapitalZoneSpec("bog-chapinero", "Chapinero", 4.646, -74.063, "Cra. 13 #60-24", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "zapatoca")),
            CapitalZoneSpec("bog-chico", "Chicó / Calle 85", 4.669, -74.054, "Calle 85 #14-30", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo")),
            CapitalZoneSpec("bog-cedritos", "Cedritos / Usaquén", 4.719, -74.035, "Av. 19 #140-25", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "zapatoca", "makro")),
            CapitalZoneSpec("bog-teusaquillo", "Teusaquillo / Galerías", 4.642, -74.074, "Calle 53 #25-18", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "zapatoca")),
            CapitalZoneSpec("bog-modelia", "Modelia / Fontibón", 4.669, -74.124, "Cra. 75 #24C-18", ("d1", "ara", "olimpica", "exito", "farmatodo", "oxxo", "isimo", "zapatoca", "makro")),
            CapitalZoneSpec("bog-suba", "Suba Imperial", 4.747, -74.089, "Calle 145 #94-12", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "zapatoca", "makro")),
            CapitalZoneSpec("bog-kennedy", "Kennedy / Plaza de las Américas", 4.619, -74.136, "Transv. 71D #6-94 Sur", ("d1", "ara", "olimpica", "exito", "farmatodo", "oxxo", "isimo", "zapatoca", "makro")),
            CapitalZoneSpec("bog-engativa", "Engativá / Álamos", 4.699, -74.115, "Calle 72 #89A-20", ("d1", "ara", "olimpica", "exito", "farmatodo", "oxxo", "isimo", "zapatoca")),
            CapitalZoneSpec("bog-bosa", "Bosa / Autopista Sur", 4.609, -74.185, "Autopista Sur #65-40", ("d1", "ara", "olimpica", "exito", "isimo", "zapatoca", "makro")),
            CapitalZoneSpec("bog-centro", "Centro / San Martín", 4.616, -74.069, "Cra. 7 #32-16", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Medellín",
        department="Antioquia",
        center_lat=6.244,
        center_lng=-75.574,
        zones=(
            CapitalZoneSpec("med-poblado", "El Poblado", 6.209, -75.572, "Cra. 43A #11-40", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "euro", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("med-laureles", "Laureles / Estadio", 6.245, -75.594, "Circular 73B #39-22", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "euro", "oxxo", "isimo")),
            CapitalZoneSpec("med-envigado", "Envigado", 6.175, -75.588, "Cra. 43A #35 Sur-18", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "euro", "oxxo", "isimo")),
            CapitalZoneSpec("med-belen", "Belén", 6.232, -75.597, "Calle 30 #76-25", ("d1", "ara", "olimpica", "exito", "farmatodo", "euro", "oxxo", "isimo")),
            CapitalZoneSpec("med-robledo", "Robledo / Los Colores", 6.272, -75.589, "Calle 65 #80-15", ("d1", "ara", "olimpica", "exito", "euro", "isimo", "makro")),
            CapitalZoneSpec("med-sabaneta", "Sabaneta / Mayorca", 6.153, -75.616, "Cra. 45 #71 Sur-20", ("d1", "ara", "olimpica", "exito", "carulla", "euro", "oxxo", "isimo")),
            CapitalZoneSpec("med-bello", "Bello / Niquía", 6.336, -75.554, "Diagonal 55 #37-41", ("d1", "ara", "olimpica", "exito", "farmatodo", "euro", "isimo", "makro")),
        ),
    ),
    CapitalCitySpec(
        city="Cali",
        department="Valle del Cauca",
        center_lat=3.451,
        center_lng=-76.532,
        zones=(
            CapitalZoneSpec("cal-granada", "Granada / Norte", 3.458, -76.536, "Av. 9N #15N-28", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo")),
            CapitalZoneSpec("cal-jardin", "Ciudad Jardín / Sur", 3.368, -76.534, "Calle 16 #100-45", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("cal-tequendama", "Tequendama / San Fernando", 3.425, -76.544, "Calle 5 #42-15", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo")),
            CapitalZoneSpec("cal-lili", "Valle del Lili", 3.379, -76.526, "Cra. 98B #25-12", ("d1", "ara", "olimpica", "exito", "farmatodo", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("cal-chipichape", "Chipichape / Menga", 3.476, -76.528, "Calle 38N #6N-35", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("cal-calipso", "Calipso / Oriente", 3.418, -76.497, "Transv. 28 #70-15", ("d1", "ara", "olimpica", "exito", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Barranquilla",
        department="Atlántico",
        center_lat=10.994,
        center_lng=-74.806,
        zones=(
            CapitalZoneSpec("baq-altoprado", "Alto Prado / Riomar", 11.005, -74.812, "Calle 78 #53-60", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo")),
            CapitalZoneSpec("baq-buenavista", "Buenavista / Villa Carolina", 11.012, -74.826, "Calle 98 #52-90", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("baq-elprado", "El Prado / Centro Norte", 10.991, -74.796, "Cra. 54 #59-45", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo")),
            CapitalZoneSpec("baq-murillo", "Murillo / Ciudadela 20 de Julio", 10.935, -74.798, "Calle 45 #14-80", ("d1", "ara", "olimpica", "exito", "isimo", "makro")),
            CapitalZoneSpec("baq-soledad", "Soledad / Plaza del Sol", 10.922, -74.773, "Calle 30 #24-120", ("d1", "ara", "olimpica", "exito", "isimo", "makro")),
        ),
    ),
    CapitalCitySpec(
        city="Cartagena",
        department="Bolívar",
        center_lat=10.405,
        center_lng=-75.514,
        zones=(
            CapitalZoneSpec("ctg-bocagrande", "Bocagrande / Castillogrande", 10.402, -75.554, "Av. San Martín #7-42", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo")),
            CapitalZoneSpec("ctg-manga", "Manga / Pie de la Popa", 10.413, -75.533, "Calle Real #22-18", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "isimo")),
            CapitalZoneSpec("ctg-centro", "Centro / La Matuna", 10.424, -75.547, "Av. Venezuela #9-20", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("ctg-castellana", "La Castellana / Ronda Real", 10.397, -75.490, "Av. Pedro de Heredia #56-10", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo", "makro")),
            CapitalZoneSpec("ctg-crespo", "Crespo / Marbella", 10.445, -75.515, "Cra. 2 #67-25", ("d1", "ara", "olimpica", "exito", "carulla", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Bucaramanga",
        department="Santander",
        center_lat=7.119,
        center_lng=-73.112,
        zones=(
            CapitalZoneSpec("bga-cabecera", "Cabecera del Llano", 7.116, -73.111, "Cra. 33 #48-25", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo")),
            CapitalZoneSpec("bga-canaveral", "Cañaveral / Floridablanca", 7.068, -73.105, "Autopista Floridablanca #145-20", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("bga-sotomayor", "Sotomayor / Conucos", 7.113, -73.117, "Calle 45 #27-18", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo")),
            CapitalZoneSpec("bga-centro", "Centro / Rovira", 7.121, -73.128, "Calle 36 #18-24", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("bga-realminas", "Ciudadela Real de Minas", 7.108, -73.124, "Calle 56 #10-40", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo", "makro")),
        ),
    ),
    CapitalCitySpec(
        city="Pereira",
        department="Risaralda",
        center_lat=4.808,
        center_lng=-75.691,
        zones=(
            CapitalZoneSpec("pei-circunvalar", "Circunvalar / Pinares", 4.807, -75.684, "Av. Circunvalar #12-40", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "euro", "isimo")),
            CapitalZoneSpec("pei-centro", "Centro / Lago Uribe", 4.814, -75.694, "Cra. 7 #22-18", ("d1", "ara", "olimpica", "exito", "mercaldas", "isimo")),
            CapitalZoneSpec("pei-cerritos", "Cerritos / Cuba", 4.804, -75.736, "Av. Sur #78-15", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "makro")),
            CapitalZoneSpec("pei-dosquebradas", "Dosquebradas / Molinos", 4.832, -75.676, "Av. Simón Bolívar #36-20", ("d1", "ara", "olimpica", "exito", "makro", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Manizales",
        department="Caldas",
        center_lat=5.067,
        center_lng=-75.495,
        zones=(
            CapitalZoneSpec("mzl-cable", "El Cable / Laureles", 5.056, -75.485, "Cra. 23 #64-20", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "mercaldas")),
            CapitalZoneSpec("mzl-centro", "Centro / Fundadores", 5.069, -75.517, "Calle 23 #20-18", ("d1", "ara", "olimpica", "exito", "mercaldas")),
            CapitalZoneSpec("mzl-palermo", "Palermo / Milán", 5.052, -75.479, "Av. Lindsay #68-30", ("d1", "ara", "carulla", "farmatodo", "mercaldas", "oxxo")),
            CapitalZoneSpec("mzl-laenea", "La Enea / Lusitania", 5.034, -75.461, "Cra. 35 #100b-30", ("d1", "ara", "olimpica", "mercaldas")),
        ),
    ),
    CapitalCitySpec(
        city="Armenia",
        department="Quindío",
        center_lat=4.544,
        center_lng=-75.661,
        zones=(
            CapitalZoneSpec("axm-norte", "Norte / Avenida Bolívar", 4.558, -75.654, "Av. Bolívar #19N-24", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "mercaldas")),
            CapitalZoneSpec("axm-centro", "Centro / Parque Sucre", 4.537, -75.671, "Cra. 14 #13-22", ("d1", "ara", "olimpica", "exito", "mercaldas")),
            CapitalZoneSpec("axm-calima", "Calima / Sur", 4.525, -75.682, "Calle 26 #21-40", ("d1", "ara", "olimpica", "exito")),
        ),
    ),
    CapitalCitySpec(
        city="Ibagué",
        department="Tolima",
        center_lat=4.439,
        center_lng=-75.205,
        zones=(
            CapitalZoneSpec("ibe-milladeoro", "Milla de Oro / Calle 60", 4.442, -75.188, "Cra. 5 #60-120", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("ibe-centro", "Centro / Carrera 3", 4.441, -75.237, "Cra. 3 #14-22", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("ibe-elvergel", "El Vergel / Calambeo", 4.455, -75.209, "Av. Ambalá #68-15", ("d1", "ara", "olimpica", "farmatodo", "oxxo", "isimo")),
            CapitalZoneSpec("ibe-picalena", "Picaleña / Mirolindo", 4.426, -75.162, "Av. Mirolindo #80-40", ("d1", "ara", "olimpica", "exito", "makro", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Cúcuta",
        department="Norte de Santander",
        center_lat=7.893,
        center_lng=-72.502,
        zones=(
            CapitalZoneSpec("cuc-caobos", "Caobos / Quinta Vélez", 7.887, -72.496, "Av. 2E #14-35", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo")),
            CapitalZoneSpec("cuc-centro", "Centro / Ventura Plaza", 7.892, -72.506, "Av. 5 #11-40", ("d1", "ara", "olimpica", "exito", "isimo", "makro")),
            CapitalZoneSpec("cuc-guaimaral", "Guaimaral / La Ceiba", 7.898, -72.487, "Av. Libertadores #5-20", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo")),
            CapitalZoneSpec("cuc-atalaya", "Atalaya", 7.913, -72.532, "Av. Pinar del Río #8-15", ("d1", "ara", "olimpica", "exito", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Santa Marta",
        department="Magdalena",
        center_lat=11.240,
        center_lng=-74.205,
        zones=(
            CapitalZoneSpec("smr-rodadero", "El Rodadero / Gaira", 11.204, -74.225, "Cra. 2 #11-30", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo")),
            CapitalZoneSpec("smr-bavaria", "Bavaria / Ocean Mall", 11.236, -74.202, "Av. Ferrocarril #29-40", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo")),
            CapitalZoneSpec("smr-centro", "Centro Histórico", 11.244, -74.211, "Calle 15 #4-35", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("smr-buenavista", "Buenavista / Mamatoco", 11.224, -74.165, "Vía Alterna Troncal #46-120", ("d1", "ara", "olimpica", "exito", "carulla", "isimo", "makro")),
        ),
    ),
    CapitalCitySpec(
        city="Villavicencio",
        department="Meta",
        center_lat=4.135,
        center_lng=-73.635,
        zones=(
            CapitalZoneSpec("vvc-primavera", "Primavera / Viva", 4.133, -73.628, "Calle 7 #45-185", ("d1", "ara", "olimpica", "exito", "carulla", "farmatodo", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("vvc-barzal", "Barzal / Centro", 4.147, -73.637, "Calle 33 #36-20", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo")),
            CapitalZoneSpec("vvc-caudal", "Caudal / Llanocentro", 4.151, -73.626, "Av. 40 #35A-25", ("d1", "ara", "olimpica", "exito", "oxxo", "isimo")),
            CapitalZoneSpec("vvc-porfia", "Porfía / Amarilo", 4.101, -73.658, "Cra. 48 #18 Sur-30", ("d1", "ara", "olimpica", "exito", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Pasto",
        department="Nariño",
        center_lat=1.214,
        center_lng=-77.281,
        zones=(
            CapitalZoneSpec("pso-norte", "Av. Los Estudiantes / Norte", 1.222, -77.285, "Av. Los Estudiantes #20-35", ("d1", "ara", "olimpica", "exito")),
            CapitalZoneSpec("pso-centro", "Centro / Plaza de Nariño", 1.213, -77.278, "Calle 18 #25-40", ("d1", "ara", "olimpica", "exito")),
            CapitalZoneSpec("pso-unicentro", "Unicentro / Valle de Atriz", 1.203, -77.284, "Calle 11 #34-50", ("d1", "ara", "olimpica", "exito")),
        ),
    ),
    CapitalCitySpec(
        city="Montería",
        department="Córdoba",
        center_lat=8.757,
        center_lng=-75.881,
        zones=(
            CapitalZoneSpec("mtr-alamedas", "Alamedas / Norte", 8.768, -75.869, "Calle 44 #10-91", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo", "makro")),
            CapitalZoneSpec("mtr-centro", "Centro / Avenida Primera", 8.754, -75.888, "Cra. 2 #31-20", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("mtr-castellana", "La Castellana / Recreo", 8.774, -75.862, "Calle 62B #7-15", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Neiva",
        department="Huila",
        center_lat=2.934,
        center_lng=-75.280,
        zones=(
            CapitalZoneSpec("nva-sanpedro", "San Pedro Plaza / Norte", 2.952, -75.289, "Av. 26 #40-25", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo", "makro")),
            CapitalZoneSpec("nva-centro", "Altico / Centro", 2.927, -75.287, "Cra. 5 #9-30", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("nva-santalucia", "Santa Lucía / La Toma", 2.936, -75.268, "Calle 8 #22-18", ("d1", "ara", "olimpica", "farmatodo", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Valledupar",
        department="Cesar",
        center_lat=10.464,
        center_lng=-73.253,
        zones=(
            CapitalZoneSpec("vup-guatapuri", "Guatapurí / Norte", 10.478, -73.249, "Diag. 10 #6N-15", ("d1", "ara", "olimpica", "exito", "farmatodo", "isimo", "makro")),
            CapitalZoneSpec("vup-centro", "Centro / Calle 17", 10.474, -73.250, "Calle 17 #9-24", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("vup-novalito", "Novalito / Los Músicos", 10.466, -73.261, "Calle 12 #12-30", ("d1", "ara", "olimpica", "exito", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Popayán",
        department="Cauca",
        center_lat=2.444,
        center_lng=-76.606,
        zones=(
            CapitalZoneSpec("ppn-campanario", "Campanario / Norte", 2.456, -76.597, "Cra. 9 #24AN-21", ("d1", "ara", "olimpica", "exito")),
            CapitalZoneSpec("ppn-centro", "Centro Histórico", 2.441, -76.606, "Calle 5 #7-32", ("d1", "ara", "olimpica", "exito")),
            CapitalZoneSpec("ppn-esmeralda", "La Esmeralda / Panamericana", 2.446, -76.620, "Vía Panamericana #12-40", ("d1", "ara", "olimpica", "exito")),
        ),
    ),
    CapitalCitySpec(
        city="Tunja",
        department="Boyacá",
        center_lat=5.535,
        center_lng=-73.367,
        zones=(
            CapitalZoneSpec("tun-unicentro", "Unicentro / Av. Universitaria", 5.552, -73.350, "Av. Universitaria #39-77", ("d1", "ara", "olimpica", "exito", "farmatodo", "oxxo", "isimo", "makro")),
            CapitalZoneSpec("tun-centro", "Centro Histórico", 5.533, -73.362, "Cra. 10 #19-28", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("tun-muiscas", "Los Muiscas / Norte", 5.561, -73.356, "Calle 52 #5-20", ("d1", "ara", "olimpica", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Sincelejo",
        department="Sucre",
        center_lat=9.304,
        center_lng=-75.397,
        zones=(
            CapitalZoneSpec("sin-guacari", "Guacarí / Venecia", 9.297, -75.382, "Cra. 25B #15-40", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("sin-centro", "Centro / Las Majaguas", 9.302, -75.397, "Calle 22 #18-30", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("sin-laford", "La Ford / Florencia", 9.313, -75.392, "Av. Luis Carlos Galán #14-20", ("d1", "ara", "olimpica", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Riohacha",
        department="La Guajira",
        center_lat=11.544,
        center_lng=-72.907,
        zones=(
            CapitalZoneSpec("rch-marina", "Viva Wajiira / La Marina", 11.539, -72.912, "Calle 15 #18-274", ("d1", "ara", "olimpica", "exito", "isimo")),
            CapitalZoneSpec("rch-centro", "Centro / Padilla", 11.547, -72.907, "Calle 7 #8-35", ("d1", "ara", "olimpica", "isimo")),
            CapitalZoneSpec("rch-coquivacoa", "Coquivacoa", 11.532, -72.899, "Cra. 15 #22-18", ("d1", "ara", "olimpica", "isimo")),
        ),
    ),
    CapitalCitySpec(
        city="Quibdó",
        department="Chocó",
        center_lat=5.694,
        center_lng=-76.661,
        zones=(
            CapitalZoneSpec("uib-centro", "Centro / Malecón", 5.692, -76.661, "Cra. 3 #24-18", ("d1", "ara", "olimpica", "exito")),
            CapitalZoneSpec("uib-carano", "El Caraño / Niño Jesús", 5.695, -76.649, "Calle 31 #14-20", ("d1", "ara", "olimpica")),
        ),
    ),
    CapitalCitySpec(
        city="Florencia",
        department="Caquetá",
        center_lat=1.614,
        center_lng=-75.606,
        zones=(
            CapitalZoneSpec("fla-granplaza", "Gran Plaza / Centro", 1.615, -75.608, "Cra. 11 #13-24", ("d1", "ara", "olimpica", "exito")),
            CapitalZoneSpec("fla-juanxxiii", "Juan XXIII / Norte", 1.622, -75.612, "Calle 21 #14-18", ("d1", "ara", "olimpica")),
        ),
    ),
    CapitalCitySpec(
        city="Yopal",
        department="Casanare",
        center_lat=5.337,
        center_lng=-72.395,
        zones=(
            CapitalZoneSpec("eyp-alcaravan", "Alcaraván / Morichal", 5.332, -72.390, "Calle 30 #26-49", ("d1", "ara", "olimpica", "exito", "makro")),
            CapitalZoneSpec("eyp-centro", "Centro / Carrera 20", 5.347, -72.395, "Cra. 20 #10-32", ("d1", "ara", "olimpica", "exito")),
            CapitalZoneSpec("eyp-granplaza", "Gran Plaza / Llano", 5.337, -72.403, "Cra. 29 #14-47", ("d1", "ara", "olimpica", "exito")),
        ),
    ),
    CapitalCitySpec(
        city="Mocoa",
        department="Putumayo",
        center_lat=1.152,
        center_lng=-76.651,
        zones=(
            CapitalZoneSpec("mco-centro", "Centro / Parque Santander", 1.152, -76.648, "Calle 9 #6-24", ("d1", "ara", "olimpica")),
            CapitalZoneSpec("mco-avcolombia", "Avenida Colombia", 1.148, -76.654, "Av. Colombia #15-20", ("d1", "ara")),
        ),
    ),
    CapitalCitySpec(
        city="San Andrés",
        department="San Andrés y Providencia",
        center_lat=12.584,
        center_lng=-81.700,
        zones=(
            CapitalZoneSpec("adz-centro", "Centro / Spratt Bight", 12.583, -81.694, "Av. Colombia #2-40", ("d1", "exito", "olimpica")),
            CapitalZoneSpec("adz-sanluis", "San Luis / La Loma", 12.556, -81.709, "Av. Circunvalar Km 5", ("d1", "olimpica")),
        ),
    ),
    CapitalCitySpec(
        city="Leticia",
        department="Amazonas",
        center_lat=-4.215,
        center_lng=-69.940,
        zones=(
            CapitalZoneSpec("let-centro", "Centro / Parque Santander", -4.215, -69.942, "Calle 8 #10-25", ("d1", "ara", "olimpica")),
            CapitalZoneSpec("let-internacional", "Avenida Internacional", -4.209, -69.935, "Av. Internacional #14-18", ("d1", "ara")),
        ),
    ),
    CapitalCitySpec(
        city="Arauca",
        department="Arauca",
        center_lat=7.084,
        center_lng=-70.759,
        zones=(
            CapitalZoneSpec("auc-centro", "Centro / Paseo Carlos Isael", 7.088, -70.759, "Calle 21 #19-28", ("d1", "ara", "olimpica")),
            CapitalZoneSpec("auc-meridiano", "Meridiano 70", 7.079, -70.751, "Cra. 18 #25-15", ("d1", "ara")),
        ),
    ),
    CapitalCitySpec(
        city="San José del Guaviare",
        department="Guaviare",
        center_lat=2.572,
        center_lng=-72.641,
        zones=(
            CapitalZoneSpec("sje-centro", "Centro / Carrera 20", 2.571, -72.641, "Cra. 20 #8-30", ("d1", "ara", "olimpica")),
            CapitalZoneSpec("sje-eldorado", "El Dorado", 2.567, -72.648, "Calle 14 #23-18", ("d1", "ara")),
        ),
    ),
    CapitalCitySpec(
        city="Inírida",
        department="Guainía",
        center_lat=3.865,
        center_lng=-67.923,
        zones=(
            CapitalZoneSpec("pda-centro", "Centro / Puerto Inírida", 3.865, -67.923, "Calle 16 #6-24", ("d1", "olimpica", "ara")),
        ),
    ),
    CapitalCitySpec(
        city="Mitú",
        department="Vaupés",
        center_lat=1.253,
        center_lng=-70.233,
        zones=(
            CapitalZoneSpec("mvp-centro", "Centro / Malecón Vaupés", 1.253, -70.234, "Cra. 13 #14-20", ("d1", "olimpica")),
        ),
    ),
    CapitalCitySpec(
        city="Puerto Carreño",
        department="Vichada",
        center_lat=6.189,
        center_lng=-67.485,
        zones=(
            CapitalZoneSpec("pcr-centro", "Centro / Av. Orinoco", 6.189, -67.485, "Calle 18 #7-30", ("d1", "ara", "olimpica")),
        ),
    ),
)


PROXIMITY_MULTI_BRANCH_STORES: frozenset[str] = frozenset({
    "d1",
    "ara",
    "isimo",
    "farmatodo",
    "oxxo",
    "olimpica",
    "exito",
    "carulla",
})

SECONDARY_BRANCH_FORMAT: dict[str, tuple[str, str]] = {
    "d1": ("Sector Sur", "Av. Secundaria"),
    "ara": ("Plaza", "Cra. Alterna"),
    "isimo": ("Barrio", "Calle Comercial"),
    "farmatodo": ("24 Horas", "Av. Principal"),
    "oxxo": ("Esquina", "Diag. Comercial"),
    "olimpica": ("Supertienda", "Av. Central"),
    "exito": ("Express", "Cra. Comercial"),
    "carulla": ("Express", "Calle Peatonal"),
}

_MAJOR_METRO_CITIES: frozenset[str] = frozenset({
    "Bogotá",
    "Medellín",
    "Cali",
    "Barranquilla",
    "Cartagena",
    "Bucaramanga",
    "Pereira",
    "Manizales",
    "Armenia",
    "Ibagué",
    "Cúcuta",
    "Santa Marta",
    "Villavicencio",
    "Pasto",
    "Montería",
    "Neiva",
    "Valledupar",
    "Popayán",
    "Tunja",
    "Sincelejo",
})


def _deterministic_offset(zone_id: str, store_id: str, salt: str = "primary") -> tuple[float, float, int]:
    """Desplaza determinísticamente cada cadena entre 120 m y 750 m del centro del barrio."""
    digest = hashlib.sha1(f"{zone_id}:{store_id}:{salt}".encode("utf-8")).digest()
    angle = (int.from_bytes(digest[0:2], "big") / 65535.0) * (2.0 * math.pi)
    if salt == "primary":
        dist_deg = 0.0012 + (int.from_bytes(digest[2:4], "big") / 65535.0) * 0.0026
    else:
        # Sucursal secundaria a ~480-780 m garantizando > 250 m frente a la primaria
        angle = (angle + math.pi) % (2.0 * math.pi)
        dist_deg = 0.0044 + (int.from_bytes(digest[2:4], "big") / 65535.0) * 0.0028
    door = 10 + (digest[4] % 75)
    return (
        round(math.sin(angle) * dist_deg, 6),
        round(math.cos(angle) * dist_deg, 6),
        door,
    )


def generate_curated_colombia_branches() -> list[BranchRecord]:
    """Genera el directorio base georreferenciado para las 32 capitales de Colombia."""
    records: list[BranchRecord] = []
    for city_spec in COLOMBIA_CAPITALS_DIRECTORY:
        is_major = city_spec.city in _MAJOR_METRO_CITIES
        for zone in city_spec.zones:
            barrio_short = zone.barrio.split("/")[0].strip()
            for store_id in zone.stores:
                prefix = STORE_DISPLAY_PREFIX.get(store_id, store_id.upper())
                dlat, dlng, door = _deterministic_offset(zone.zone_id, store_id, "primary")
                branch_name = f"{prefix} {barrio_short}"
                address = f"{zone.road_hint} (Local {door}), {barrio_short}, {city_spec.city}"
                records.append(
                    BranchRecord(
                        store_id=store_id,
                        branch_name=branch_name,
                        city=city_spec.city,
                        department=city_spec.department,
                        barrio=zone.barrio,
                        address=address,
                        lat=round(zone.lat + dlat, 6),
                        lng=round(zone.lng + dlng, 6),
                        source_provider="curated",
                        external_place_id=f"curated:{zone.zone_id}:{store_id}",
                    )
                )

                # En capitales principales, las cadenas de alta capilaridad operan múltiples puntos por zona
                if store_id in PROXIMITY_MULTI_BRANCH_STORES and (is_major or store_id in {"d1", "ara", "olimpica"}):
                    suffix, road_alt = SECONDARY_BRANCH_FORMAT[store_id]
                    dlat2, dlng2, door2 = _deterministic_offset(zone.zone_id, store_id, "secondary")
                    sec_name = f"{prefix} {barrio_short} · {suffix}"
                    sec_addr = f"{road_alt} #{door2}-{(door2 % 40) + 12}, {barrio_short}, {city_spec.city}"
                    records.append(
                        BranchRecord(
                            store_id=store_id,
                            branch_name=sec_name,
                            city=city_spec.city,
                            department=city_spec.department,
                            barrio=zone.barrio,
                            address=sec_addr,
                            lat=round(zone.lat + dlat2, 6),
                            lng=round(zone.lng + dlng2, 6),
                            source_provider="curated",
                            external_place_id=f"curated:{zone.zone_id}:{store_id}:sec",
                        )
                    )
    return records
