-- =====================================================================
--  Appresso — Esquema de base de datos (PostgreSQL 13+; probado en 18)
--  Cómo ejecutarlo: pgAdmin 4 → clic derecho sobre la base ACTIVIDAD_PA
--  → Query Tool → abrir este archivo → Ejecutar (F5).
--
--  Todo va dentro de BEGIN/COMMIT: si una sola sentencia falla, no queda
--  un esquema a medias. Si las tablas ya existen el script falla a
--  propósito (no las borra). Para empezar de cero, ejecute antes reset.sql.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Función de trigger reutilizable: actualiza fecha_actualizacion en cada
-- UPDATE. Se hace en la base de datos (y no en Node) para que se cumpla
-- incluso si alguien edita las filas a mano desde pgAdmin.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_fecha_actualizacion() RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_actualizacion := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- usuarios
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  -- IDENTITY es el estándar SQL moderno (reemplaza a SERIAL).
  -- ALWAYS impide que se inserte un id a mano por error.
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- El JSON no trae nombre: la API guarda la parte local del correo
  -- (aa@aa.com → "aa"). Ver DECISIONES.md.
  nombre              VARCHAR(120) NOT NULL,
  -- 254 caracteres = longitud máxima práctica de un correo (RFC 5321).
  email               VARCHAR(254) NOT NULL,
  estado              VARCHAR(10)  NOT NULL DEFAULT 'ACTIVO',
  fecha_creacion      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  fecha_actualizacion TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_usuarios_email      UNIQUE (email),
  -- El correo se guarda normalizado en minúsculas; así el UNIQUE también
  -- evita "AA@aa.com" y "aa@aa.com" como dos usuarios distintos.
  CONSTRAINT ck_usuarios_email_min  CHECK (email = LOWER(email)),
  CONSTRAINT ck_usuarios_nombre     CHECK (LENGTH(BTRIM(nombre)) > 0),
  CONSTRAINT ck_usuarios_estado     CHECK (estado IN ('ACTIVO', 'INACTIVO'))
);

-- ---------------------------------------------------------------------
-- transacciones
-- ---------------------------------------------------------------------
CREATE TABLE transacciones (
  -- NO es IDENTITY/SERIAL: se guarda el idTxn que envía el cliente. Así la
  -- PRIMARY KEY detecta por sí sola los duplicados (error 23505).
  id                  BIGINT        PRIMARY KEY,
  usuario_id          BIGINT        NOT NULL,
  -- NUMERIC es exacto (no tiene errores de redondeo como float/double);
  -- (14,2) permite hasta 999.999.999.999,99.
  valor               NUMERIC(14,2) NOT NULL,
  -- TIMESTAMPTZ guarda el instante absoluto (en UTC internamente) con
  -- precisión de microsegundos, así que los milisegundos no se pierden.
  fecha_txn           TIMESTAMPTZ   NOT NULL,
  estado              VARCHAR(10)   NOT NULL DEFAULT 'VALIDA',
  -- SHA-256 en hexadecimal ocupa siempre exactamente 64 caracteres.
  hash                CHAR(64)      NOT NULL,
  -- Sin CHECK de lista: los métodos permitidos son configurables en la
  -- aplicación (config/reglas.json) y no deben exigir migrar la BD.
  metodo_pago         VARCHAR(30)   NOT NULL,
  fecha_creacion      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  fecha_actualizacion TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- ON DELETE RESTRICT: no se puede borrar un usuario que tenga
  -- transacciones; para "darlo de baja" se marca INACTIVO y así el
  -- historial (y la evidencia de fraude) nunca se pierde.
  CONSTRAINT fk_transacciones_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE RESTRICT,
  CONSTRAINT ck_transacciones_id      CHECK (id > 0),
  CONSTRAINT ck_transacciones_valor   CHECK (valor > 0),
  CONSTRAINT ck_transacciones_estado  CHECK (estado IN ('VALIDA', 'ANOMALA')),
  CONSTRAINT ck_transacciones_hash    CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_transacciones_metodo  CHECK (LENGTH(BTRIM(metodo_pago)) > 0)
);

-- ---------------------------------------------------------------------
-- anomalias
-- ---------------------------------------------------------------------
CREATE TABLE anomalias (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Transacción que DISPARÓ la anomalía (la que hizo superar el umbral).
  transaccion_id         BIGINT      NOT NULL,
  tipo                   VARCHAR(30) NOT NULL,
  nivel                  VARCHAR(5)  NOT NULL,
  -- Cuántas transacciones había dentro de la ventana al dispararse.
  cantidad_transacciones INTEGER     NOT NULL,
  -- Tamaño de ventana usado en ese momento (queda "congelado" aunque
  -- después se cambie la configuración).
  ventana_segundos       INTEGER     NOT NULL,
  fecha_creacion         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_actualizacion    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- ON DELETE CASCADE: una anomalía no tiene sentido sin su transacción;
  -- al borrar la transacción (DELETE /api/transacciones/:id) se borran
  -- sus anomalías y no quedan filas huérfanas.
  CONSTRAINT fk_anomalias_transaccion FOREIGN KEY (transaccion_id)
    REFERENCES transacciones (id) ON DELETE CASCADE,
  CONSTRAINT ck_anomalias_tipo     CHECK (tipo IN ('POSIBLE_FRAUDE', 'EXCESO_FRANJA_HORARIA')),
  CONSTRAINT ck_anomalias_nivel    CHECK (nivel IN ('BAJO', 'MEDIO', 'ALTO')),
  CONSTRAINT ck_anomalias_cantidad CHECK (cantidad_transacciones > 0),
  CONSTRAINT ck_anomalias_ventana  CHECK (ventana_segundos > 0),
  -- Una transacción puede disparar los dos tipos, pero no dos veces el mismo.
  CONSTRAINT uq_anomalias_txn_tipo UNIQUE (transaccion_id, tipo)
);

-- ---------------------------------------------------------------------
-- Triggers de fecha_actualizacion
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_usuarios_fecha_actualizacion
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_set_fecha_actualizacion();

CREATE TRIGGER trg_transacciones_fecha_actualizacion
  BEFORE UPDATE ON transacciones
  FOR EACH ROW EXECUTE FUNCTION fn_set_fecha_actualizacion();

CREATE TRIGGER trg_anomalias_fecha_actualizacion
  BEFORE UPDATE ON anomalias
  FOR EACH ROW EXECUTE FUNCTION fn_set_fecha_actualizacion();

-- ---------------------------------------------------------------------
-- Índices para las consultas frecuentes
-- ---------------------------------------------------------------------
-- Ventana deslizante: "transacciones del usuario X entre fecha A y B".
-- Como usuario_id es la primera columna, también sirve para la FK.
CREATE INDEX ix_transacciones_usuario_fecha ON transacciones (usuario_id, fecha_txn);
-- Filtros por rango de fechas y agregaciones del dashboard.
CREATE INDEX ix_transacciones_fecha         ON transacciones (fecha_txn);
-- Evolución de anomalías en el tiempo.
CREATE INDEX ix_anomalias_fecha_creacion    ON anomalias (fecha_creacion);
-- NOTA: anomalias(transaccion_id) ya está cubierto por el índice que crea
-- uq_anomalias_txn_tipo (transaccion_id es su columna líder). Crear otro
-- índice igual solo haría más lentas las escrituras.

COMMIT;
