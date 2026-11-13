-- 0021_expand_store_branches_colombia.sql
-- Amplía sucursales físicas de supermercados por ciudad y barrio en Bogotá,
-- Medellín, Cali y Barranquilla para los 3 modos de compra y cálculo de distancia mínima.

INSERT INTO public.store_branches (store_id, branch_name, city, address, location)
VALUES
    -- Bogotá · Calle 85 / Chicó
    ('d1', 'D1 Chicó Norte', 'Bogotá', 'Cra. 11 #86-32', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0512, 4.6688), 4326)::extensions.geography),
    ('exito', 'Éxito Chicó 85', 'Bogotá', 'Calle 85 #14-45', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0539, 4.6691), 4326)::extensions.geography),
    ('ara', 'Ara Carrera 11 Chicó', 'Bogotá', 'Cra. 11 #82-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0522, 4.6656), 4326)::extensions.geography),
    ('olimpica', 'Olímpica Calle 85', 'Bogotá', 'Cra. 15 #84-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0556, 4.6684), 4326)::extensions.geography),

    -- Bogotá · Cedritos / Usaquén
    ('carulla', 'Carulla Cedritos', 'Bogotá', 'Av. 19 #140-35', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0365, 4.7215), 4326)::extensions.geography),
    ('exito', 'Éxito Wow Country / Usaquén', 'Bogotá', 'Calle 134 #9-51', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0332, 4.7148), 4326)::extensions.geography),
    ('d1', 'D1 Cedritos 140', 'Bogotá', 'Calle 140 #12-40', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0352, 4.7208), 4326)::extensions.geography),
    ('ara', 'Ara Cedritos', 'Bogotá', 'Av. 9 #142-22', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0321, 4.7224), 4326)::extensions.geography),
    ('olimpica', 'Olímpica Cedritos', 'Bogotá', 'Cra. 19 #138-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0378, 4.7199), 4326)::extensions.geography),

    -- Bogotá · Teusaquillo / Galerías
    ('exito', 'Éxito Galerías', 'Bogotá', 'Calle 53 #24-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0736, 4.6431), 4326)::extensions.geography),
    ('d1', 'D1 Teusaquillo', 'Bogotá', 'Cra. 24 #45C-15', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0724, 4.6362), 4326)::extensions.geography),
    ('ara', 'Ara Galerías', 'Bogotá', 'Cra. 27 #52-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0751, 4.6422), 4326)::extensions.geography),
    ('carulla', 'Carulla Pablo VI / Nicolás de Federmán', 'Bogotá', 'Calle 57 #38-10', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0815, 4.6485), 4326)::extensions.geography),

    -- Bogotá · Modelia / Fontibón
    ('exito', 'Éxito Fontibón', 'Bogotá', 'Calle 17 #97-25', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.1398, 4.6745), 4326)::extensions.geography),
    ('d1', 'D1 Modelia', 'Bogotá', 'Cra. 75 #24C-14', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.1225, 4.6698), 4326)::extensions.geography),
    ('ara', 'Ara Modelia', 'Bogotá', 'Calle 24 #82-15', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.1268, 4.6682), 4326)::extensions.geography),
    ('olimpica', 'Olímpica Hayuelos / Modelia', 'Bogotá', 'Calle 20 #82-52', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.1289, 4.6651), 4326)::extensions.geography),

    -- Bogotá · Suba
    ('exito', 'Éxito Suba', 'Bogotá', 'Calle 145 #105B-58', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0932, 4.7486), 4326)::extensions.geography),
    ('d1', 'D1 Suba Imperial', 'Bogotá', 'Av. Suba #145-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0894, 4.7458), 4326)::extensions.geography),
    ('ara', 'Ara Suba Pinar', 'Bogotá', 'Cra. 92 #146-40', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0865, 4.7471), 4326)::extensions.geography),
    ('olimpica', 'Olímpica Suba', 'Bogotá', 'Calle 145 #91-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.0879, 4.7462), 4326)::extensions.geography),

    -- Medellín · Laureles & Belén
    ('exito', 'Éxito Laureles', 'Medellín', 'Cra. 81 #37-100', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5964, 6.2456), 4326)::extensions.geography),
    ('carulla', 'Carulla Laureles Circular', 'Medellín', 'Circular 73B #39-14', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5912, 6.2442), 4326)::extensions.geography),
    ('d1', 'D1 Laureles Avenida Nutibara', 'Medellín', 'Transv. 39B #74-20', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5928, 6.2429), 4326)::extensions.geography),
    ('ara', 'Ara Laureles Estadio', 'Medellín', 'Calle 48 #77A-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5948, 6.2564), 4326)::extensions.geography),
    ('olimpica', 'Olímpica Belén Los Alpes', 'Medellín', 'Calle 30 #80-12', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5975, 6.2328), 4326)::extensions.geography),

    -- Medellín · Envigado & El Poblado extras
    ('ara', 'Ara El Poblado Manila', 'Medellín', 'Cra. 43E #12-19', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5712, 6.2116), 4326)::extensions.geography),
    ('exito', 'Éxito Envigado Viva', 'Medellín', 'Cra. 48 #32B Sur-139', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5914, 6.1768), 4326)::extensions.geography),
    ('d1', 'D1 Envigado Centro', 'Medellín', 'Cra. 43 #37 Sur-22', extensions.ST_SetSRID(extensions.ST_MakePoint(-75.5866, 6.1712), 4326)::extensions.geography),

    -- Cali · Granada / Norte y Ciudad Jardín
    ('carulla', 'Carulla Peñón / Granada', 'Cali', 'Cra. 2 Oeste #2-10', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5394, 3.4508), 4326)::extensions.geography),
    ('exito', 'Éxito La Flora / Norte', 'Cali', 'Av. 3N #52N-46', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5192, 3.4856), 4326)::extensions.geography),
    ('d1', 'D1 Granada Cali', 'Cali', 'Av. 9N #15N-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5364, 3.4581), 4326)::extensions.geography),
    ('ara', 'Ara Norte Cali', 'Cali', 'Av. 4N #44N-18', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5231, 3.4792), 4326)::extensions.geography),
    ('olimpica', 'Olímpica Ciudad Jardín', 'Cali', 'Cra. 100 #16-30', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5326, 3.3688), 4326)::extensions.geography),
    ('carulla', 'Carulla Ciudad Jardín', 'Cali', 'Calle 16 #105-40', extensions.ST_SetSRID(extensions.ST_MakePoint(-76.5359, 3.3662), 4326)::extensions.geography),

    -- Barranquilla · Alto Prado / Riomar
    ('olimpica', 'SAO Olímpica Villa Country / Alto Prado', 'Barranquilla', 'Calle 78 #53-70', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8085, 11.0038), 4326)::extensions.geography),
    ('exito', 'Éxito Buenavista Barranquilla', 'Barranquilla', 'Calle 98 #52-115', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8264, 11.0124), 4326)::extensions.geography),
    ('carulla', 'Carulla Prado 79', 'Barranquilla', 'Cra. 52 #79-180', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8098, 11.0054), 4326)::extensions.geography),
    ('d1', 'D1 Alto Prado', 'Barranquilla', 'Cra. 51B #80-45', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8124, 11.0061), 4326)::extensions.geography),
    ('ara', 'Ara Riomar 93', 'Barranquilla', 'Cra. 49C #93-22', extensions.ST_SetSRID(extensions.ST_MakePoint(-74.8195, 11.0086), 4326)::extensions.geography)
ON CONFLICT (store_id, branch_name, city) DO NOTHING;
