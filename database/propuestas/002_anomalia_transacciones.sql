-- =====================================================================
--  PROPUESTA 002 — Transacciones involucradas en cada anomalía
--  ⚠ NO EJECUTADA. Requiere aprobación (agrega una tabla al modelo).
--
--  Para qué: hoy solo se guarda la transacción que DISPARÓ la anomalía.
--  Las demás de la ventana se RECONSTRUYEN con una consulta (mismo usuario,
--  dentro de ventana_segundos). Eso falla si luego se borra alguna
--  transacción, o si cambia la configuración de franjas. Esta tabla N:M
--  "congela" exactamente cuáles estaban en la ventana al detectarla.
--
--  Impacto: tabla nueva; no modifica las existentes. Las anomalías ya
--  registradas seguirían usando la reconstrucción.
-- =====================================================================
BEGIN;

CREATE TABLE anomalia_transacciones (
  anomalia_id    BIGINT  NOT NULL REFERENCES anomalias (id)     ON DELETE CASCADE,
  transaccion_id BIGINT  NOT NULL REFERENCES transacciones (id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL CHECK (orden > 0),  -- posición dentro de la ventana (1 = la más antigua)
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (anomalia_id, transaccion_id)
);
CREATE INDEX ix_anomalia_transacciones_txn ON anomalia_transacciones (transaccion_id);

COMMIT;

-- Reversión:  DROP TABLE IF EXISTS anomalia_transacciones;
