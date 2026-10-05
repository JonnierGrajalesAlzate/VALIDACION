BEGIN;
DROP TABLE IF EXISTS anomalias;
DROP TABLE IF EXISTS transacciones;
DROP TABLE IF EXISTS usuarios;
DROP FUNCTION IF EXISTS fn_set_fecha_actualizacion();
COMMIT;
