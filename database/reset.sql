-- =====================================================================
--  Appresso — BORRA las 3 tablas y la función del trigger.
--  ⚠ Destructivo: elimina TODOS los datos. Úselo solo para empezar de
--  cero; luego ejecute schema.sql y (opcional) seed.sql.
-- =====================================================================
BEGIN;
DROP TABLE IF EXISTS anomalias;
DROP TABLE IF EXISTS transacciones;
DROP TABLE IF EXISTS usuarios;
DROP FUNCTION IF EXISTS fn_set_fecha_actualizacion();
COMMIT;
