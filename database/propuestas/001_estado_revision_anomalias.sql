-- =====================================================================
--  PROPUESTA 001 — Estado de revisión de las anomalías
--  ⚠ NO EJECUTADA. Requiere aprobación (cambia el modelo de datos acordado).
--
--  Para qué: el dashboard pide estados de revisión (nueva, abierta,
--  revisada, descartada). La tabla anomalias no tiene dónde guardarlos.
--
--  Impacto: agrega 3 columnas a anomalias; las filas existentes quedan en
--  'NUEVA'. No afecta a usuarios ni transacciones. Reversible (ver abajo).
-- =====================================================================
BEGIN;

ALTER TABLE anomalias
  ADD COLUMN estado_revision VARCHAR(10) NOT NULL DEFAULT 'NUEVA',
  ADD COLUMN nota_revision   VARCHAR(500),
  ADD COLUMN fecha_revision  TIMESTAMPTZ,
  ADD CONSTRAINT ck_anomalias_estado_revision
    CHECK (estado_revision IN ('NUEVA', 'ABIERTA', 'REVISADA', 'DESCARTADA'));

-- Para filtrar rápido "pendientes de revisar" en el dashboard.
CREATE INDEX ix_anomalias_estado_revision ON anomalias (estado_revision);

COMMIT;

-- Reversión:
-- BEGIN;
-- DROP INDEX IF EXISTS ix_anomalias_estado_revision;
-- ALTER TABLE anomalias DROP CONSTRAINT IF EXISTS ck_anomalias_estado_revision,
--   DROP COLUMN IF EXISTS fecha_revision, DROP COLUMN IF EXISTS nota_revision,
--   DROP COLUMN IF EXISTS estado_revision;
-- COMMIT;
