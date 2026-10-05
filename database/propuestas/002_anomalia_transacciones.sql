BEGIN;

CREATE TABLE anomalia_transacciones (
  anomalia_id    BIGINT  NOT NULL REFERENCES anomalias (id)     ON DELETE CASCADE,
  transaccion_id BIGINT  NOT NULL REFERENCES transacciones (id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL CHECK (orden > 0),
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (anomalia_id, transaccion_id)
);
CREATE INDEX ix_anomalia_transacciones_txn ON anomalia_transacciones (transaccion_id);

COMMIT;

