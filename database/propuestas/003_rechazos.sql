-- =====================================================================
--  PROPUESTA 003 (opcional) — Registro de transacciones rechazadas
--  ⚠ NO EJECUTADA. Requiere aprobación (agrega una tabla al modelo).
--
--  Para qué: hoy las transacciones rechazadas (tipo inválido, hash, etc.)
--  solo quedan en backend/logs/app.log. Con esta tabla el dashboard podría
--  mostrar "% de rechazos por tipo de error" o "intentos con hash inválido
--  por usuario" (otra señal de fraude).
-- =====================================================================
BEGIN;

CREATE TABLE rechazos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id     VARCHAR(64)  NOT NULL,
  id_txn         BIGINT,                 -- puede ser NULL si el idTxn venía mal
  etapa          VARCHAR(30)  NOT NULL,
  codigo         VARCHAR(40)  NOT NULL,
  campo          VARCHAR(60),
  mensaje        VARCHAR(1000) NOT NULL,
  cuerpo         JSONB,                  -- elemento recibido tal cual
  fecha_creacion TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_rechazos_fecha  ON rechazos (fecha_creacion);
CREATE INDEX ix_rechazos_codigo ON rechazos (codigo);

COMMIT;

-- Reversión:  DROP TABLE IF EXISTS rechazos;
