BEGIN;

CREATE TABLE rechazos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id     VARCHAR(64)  NOT NULL,
  id_txn         BIGINT,
  etapa          VARCHAR(30)  NOT NULL,
  codigo         VARCHAR(40)  NOT NULL,
  campo          VARCHAR(60),
  mensaje        VARCHAR(1000) NOT NULL,
  cuerpo         JSONB,
  fecha_creacion TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_rechazos_fecha  ON rechazos (fecha_creacion);
CREATE INDEX ix_rechazos_codigo ON rechazos (codigo);

COMMIT;

