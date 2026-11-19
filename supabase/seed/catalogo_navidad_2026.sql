-- =====================================================================
-- Carga de productos — Catálogo Mayorista Navideño 2026 (Thian Candle)
-- Requiere la migración 20261118b_product_price_category.sql.
-- Precio = "Precio al Público / Precio General" del catálogo, en COP.
-- (El precio mayorista va en el comentario de cada línea, solo como referencia.)
--
-- Se puede ejecutar más de una vez: si la referencia (sku) ya existe,
-- actualiza nombre, descripción, precio y categoría en vez de duplicar.
-- =====================================================================
BEGIN;

INSERT INTO public.products (sku, name, category, price, description) VALUES
  -- Línea de Deseos · Especial 7 de diciembre
  ('NAV26-01', 'Velitas Florecer Navideño',      'Línea de Deseos', 30000, 'Velitas blancas con flores y deseos: Gratitud, Éxitos, Salud, Amor, Unión, Paz, Familia, Dinero.'),        -- mayorista 25.000
  ('NAV26-02', 'Velitas Luz de Estrellas',       'Línea de Deseos', 30000, 'Velitas de colores con estrellas doradas: Salud, Familia, Amor, Paz, Fe, Unión.'),                            -- mayorista 25.000
  ('NAV26-03', 'Velitas Destellos de Navidad',   'Línea de Deseos', 23000, 'Velitas con estrella escarchada: Fe, Amor, Sabiduría, Éxito, Familia.'),                                      -- mayorista 18.000
  ('NAV26-04', 'Velitas Pinos de Luz',           'Línea de Deseos', 28000, 'Velitas en forma de pino: Unión, Fe, Paz, Familia, Dinero, Dios, Amor, Gratitud.'),                           -- mayorista 24.000
  ('NAV26-05', 'Velas de Mascotas – Gato y perro', 'Línea de Deseos', 11500, 'Rosado o azul. Combinación a elegir: dos gatos, dos perros o un gato y un perro.'),                       -- mayorista 9.500
  ('NAV26-06', 'Velas de Mascotas – Huella y perrito', 'Línea de Deseos', 10000, 'Vela huellita y vela perrito.'),                                                                         -- mayorista 9.000

  -- Combos & Sets
  ('NAV26-07', 'Set Noche de Paz',               'Combos y Sets', 22000, 'Tres velitas Fe, Amor, Familia + pesebre.'),                                                                     -- mayorista 18.000
  ('NAV26-08', 'Set Nacimiento de Fe',           'Combos y Sets', 20000, 'Nacimiento + tres pinos Familia, Fe, Amor.'),                                                                    -- mayorista 17.000
  ('NAV26-09', 'Colección Milagro de Navidad',   'Combos y Sets', 25000, 'Reno, Sagrada Familia y árbol. Decorativas: sin pabilo.'),                                                      -- mayorista 20.000
  ('NAV26-10', 'Mini Detalle Casita de Belén',   'Combos y Sets', 12000, 'Pieza decorativa con tarjeta de mensaje. Sin pabilo.'),                                                         -- mayorista 10.000
  ('NAV26-11', 'Mini Detalle Nacimiento de Amor','Combos y Sets', 12000, 'Pieza decorativa con tarjeta de mensaje. Sin pabilo.'),                                                         -- mayorista 10.000
  ('NAV26-12', 'Blanca Navidad',                 'Combos y Sets',  8000, 'Vela copo de nieve.'),                                                                                          -- mayorista 6.500

  -- Línea Grinch
  ('NAV26-13', 'Vela Aromática Grinch Vibes',    'Línea Grinch', 40000, 'Vela aromática en vaso, fragancia a ponche navideño.'),                                                          -- mayorista 35.000
  ('NAV26-14', 'Vela Decorativa Dulcemente Grinch', 'Línea Grinch', 22000, 'Vela decorativa con forma de cara.'),                                                                         -- mayorista 19.000

  -- Línea Luz de Navidad · Deseos tradicionales personalizables
  ('NAV26-15', 'Luz de Navidad – Colores con esfera',     'Luz de Navidad', 15000, 'Velas de colores personalizadas con nombres o deseos + esfera.'),                                    -- mayorista 10.000
  ('NAV26-16', 'Luz de Navidad – Blancas doradas con esfera', 'Luz de Navidad', 12000, 'Velas blancas con letra dorada personalizadas + esfera acrílica.'),                              -- mayorista 10.000
  ('NAV26-17', 'Luz de Navidad – Neón con figuras',       'Luz de Navidad', 15000, 'Velas neón con figura navideña, personalizadas con nombres o deseos.'),                             -- mayorista 13.500
  ('NAV26-18', 'Luz de Navidad – Blancas letra de color', 'Luz de Navidad', 15000, 'Velas blancas con letra de color, personalizadas con nombres o deseos.'),                            -- mayorista 13.500
  ('NAV26-19', 'Luz de Navidad – Escarchadas',            'Luz de Navidad', 15000, 'Velas escarchadas de colores, personalizadas con nombres o deseos.'),                               -- mayorista 13.500

  -- Línea Luz de Navidad · Deseos tradicionales (caja x10)
  ('NAV26-20', 'Caja x10 – Blancas con figuras doradas',  'Luz de Navidad', 20000, 'Abundancia, Amor, Dinero, Prosperidad, Sabiduría, Familia, Fe y Paz, Bondad, Alegría, Gratitud.'), -- mayorista 17.000
  ('NAV26-21', 'Caja x10 – Blancas doradas escarchadas',  'Luz de Navidad', 20000, 'Abundancia, Amor, Dinero, Prosperidad, Sabiduría, Familia, Fe y Paz, Viajes, Gratitud, Armonía.'),  -- mayorista 17.000
  ('NAV26-22', 'Caja x10 – Neón con figuras',             'Luz de Navidad', 20000, 'Amor, Fe y Paz, Abundancia, Sabiduría, Prosperidad, Familia, Bondad, Gratitud, Alegría, Dinero.'), -- mayorista 17.000
  ('NAV26-23', 'Caja x10 – Neón con figuras religiosas',  'Luz de Navidad', 20000, 'Abundancia, Amor, Dinero, Prosperidad, Sabiduría, Familia, Armonía, Viajes, Fe y Paz, Gratitud.'), -- mayorista 17.000

  -- Línea Velas Navideñas
  ('NAV26-24', 'Velas Navideñas – Pesebre',              'Velas Navideñas', 13000, 'Personajes del pesebre: vaca, Virgen, Niño, José, ángel, Reyes Magos, burro, oveja.'),               -- mayorista 12.000
  ('NAV26-25', 'Velas Navideñas – Personajes divertidos','Velas Navideñas', 13000, 'Bota, gorro, árbol, muñeco de nieve, Papá Noel, reno, galleta, bastón.'),                           -- mayorista 10.000
  ('NAV26-26', 'Velas Navideñas – Amigos de Navidad',    'Velas Navideñas', 13000, 'Papá Noel, elfo, oso, reno, pingüino, muñeco de nieve.'),                                           -- mayorista 10.000

  -- Colección Navideña
  ('NAV26-27', 'Pecera Decorativa Dulce Navidad en Cristal', 'Colección Navideña', 38000, 'Pieza decorativa en pecera de vidrio. Sin pabilo.')                                          -- mayorista 33.000
ON CONFLICT (sku) DO UPDATE
  SET name = EXCLUDED.name, category = EXCLUDED.category,
      price = EXCLUDED.price, description = EXCLUDED.description;

COMMIT;

-- Verificación (debe devolver 27 filas con precio):
-- SELECT sku, category, name, price FROM public.products
--  WHERE sku LIKE 'NAV26-%' ORDER BY sku;
