-- =====================================================================
--  Appresso — Vacía las tablas SIN borrar su estructura.
--  Útil antes de cargar los datos de prueba del profesor, para que los
--  datos de ejemplo del seed no interfieran con sus ventanas de tiempo.
--  RESTART IDENTITY reinicia los contadores de usuarios.id y anomalias.id.
-- =====================================================================
TRUNCATE TABLE anomalias, transacciones, usuarios RESTART IDENTITY;
