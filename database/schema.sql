BEGIN;

CREATE OR REPLACE FUNCTION fn_set_fecha_actualizacion() RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_actualizacion := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE usuarios (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre              VARCHAR(120) NOT NULL,
  email               VARCHAR(254) NOT NULL,
  estado              VARCHAR(10)  NOT NULL DEFAULT 'ACTIVO',
  fecha_creacion      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  fecha_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_usuarios_email      UNIQUE (email),
  CONSTRAINT ck_usuarios_email_min  CHECK (email = LOWER(email)),
  CONSTRAINT ck_usuarios_nombre     CHECK (LENGTH(BTRIM(nombre)) > 0),
  CONSTRAINT ck_usuarios_estado     CHECK (estado IN ('ACTIVO', 'INACTIVO'))
);

CREATE TABLE transacciones (
  id                  BIGINT        PRIMARY KEY,
  usuario_id          BIGINT        NOT NULL,
  valor               NUMERIC(14,2) NOT NULL,
  fecha_txn           TIMESTAMPTZ   NOT NULL,
  estado              VARCHAR(10)   NOT NULL DEFAULT 'VALIDA',
  hash                CHAR(64)      NOT NULL,
  metodo_pago         VARCHAR(30)   NOT NULL,
  fecha_creacion      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  fecha_actualizacion TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_transacciones_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT ck_transacciones_id      CHECK (id > 0),
  CONSTRAINT ck_transacciones_valor   CHECK (valor > 0),
  CONSTRAINT ck_transacciones_estado  CHECK (estado IN ('VALIDA', 'ANOMALA')),
  CONSTRAINT ck_transacciones_hash    CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_transacciones_metodo  CHECK (LENGTH(BTRIM(metodo_pago)) > 0)
);

CREATE TABLE anomalias (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaccion_id         BIGINT      NOT NULL,
  tipo                   VARCHAR(30) NOT NULL,
  nivel                  VARCHAR(5)  NOT NULL,
  cantidad_transacciones INTEGER     NOT NULL,
  ventana_segundos       INTEGER     NOT NULL,
  estado_revision        VARCHAR(10) NOT NULL DEFAULT 'NUEVA',
  nota_revision          VARCHAR(500),
  fecha_revision         TIMESTAMPTZ,
  fecha_creacion         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_actualizacion    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_anomalias_transaccion FOREIGN KEY (transaccion_id)
    REFERENCES transacciones (id) ON DELETE CASCADE,
  CONSTRAINT ck_anomalias_tipo     CHECK (tipo IN ('POSIBLE_FRAUDE', 'EXCESO_FRANJA_HORARIA')),
  CONSTRAINT ck_anomalias_nivel    CHECK (nivel IN ('BAJO', 'MEDIO', 'ALTO')),
  CONSTRAINT ck_anomalias_cantidad CHECK (cantidad_transacciones > 0),
  CONSTRAINT ck_anomalias_ventana  CHECK (ventana_segundos > 0),
  CONSTRAINT ck_anomalias_estado_revision
    CHECK (estado_revision IN ('NUEVA', 'ABIERTA', 'REVISADA', 'DESCARTADA')),
  CONSTRAINT uq_anomalias_txn_tipo UNIQUE (transaccion_id, tipo)
);

CREATE TRIGGER trg_usuarios_fecha_actualizacion
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_set_fecha_actualizacion();

CREATE TRIGGER trg_transacciones_fecha_actualizacion
  BEFORE UPDATE ON transacciones
  FOR EACH ROW EXECUTE FUNCTION fn_set_fecha_actualizacion();

CREATE TRIGGER trg_anomalias_fecha_actualizacion
  BEFORE UPDATE ON anomalias
  FOR EACH ROW EXECUTE FUNCTION fn_set_fecha_actualizacion();

CREATE INDEX ix_transacciones_usuario_fecha ON transacciones (usuario_id, fecha_txn);
CREATE INDEX ix_transacciones_fecha         ON transacciones (fecha_txn);
CREATE INDEX ix_anomalias_estado_revision   ON anomalias (estado_revision);
CREATE INDEX ix_anomalias_fecha_creacion    ON anomalias (fecha_creacion);

COMMIT;
