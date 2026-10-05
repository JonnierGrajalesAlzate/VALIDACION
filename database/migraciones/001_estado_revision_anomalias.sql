BEGIN;

ALTER TABLE anomalias
  ADD COLUMN estado_revision VARCHAR(10) NOT NULL DEFAULT 'NUEVA',
  ADD COLUMN nota_revision   VARCHAR(500),
  ADD COLUMN fecha_revision  TIMESTAMPTZ,
  ADD CONSTRAINT ck_anomalias_estado_revision
    CHECK (estado_revision IN ('NUEVA', 'ABIERTA', 'REVISADA', 'DESCARTADA'));

CREATE INDEX ix_anomalias_estado_revision ON anomalias (estado_revision);

COMMIT;

