/**
 * Pool de conexiones a PostgreSQL (node-postgres).
 *
 * Un Pool reutiliza conexiones abiertas en vez de abrir una nueva por
 * consulta (abrir una conexión cuesta decenas de milisegundos).
 *
 * REGLA DE ORO: todas las consultas usan parámetros ($1, $2...). Nunca se
 * concatenan valores en el SQL: así es imposible una inyección SQL y PG
 * recibe cada valor con su tipo.
 */
const { Pool, types } = require('pg');
const env = require('../config/env');
const { crearLogger } = require('../logging/logger');
const { ErrorApp } = require('../errores/ErrorApp');
const { traducirErrorPg } = require('../errores/traductorPg');
const { obtenerContexto } = require('../logging/contexto');

const log = crearLogger(__filename);

// ── Conversión de tipos al leer ──────────────────────────────────────────
// Por defecto `pg` devuelve BIGINT (OID 20) y NUMERIC (OID 1700) como
// string, porque podrían no caber en un Number de JS. Aquí es seguro
// convertirlos: los id se validan como enteros "seguros" (≤ 2^53-1) y
// NUMERIC(14,2) tiene como máximo 14 dígitos significativos (un double
// representa exactamente hasta 15).
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const pool = new Pool({
  host: env.PGHOST,
  port: env.PGPORT,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  max: 10,
  connectionTimeoutMillis: 5000, // si PG no responde en 5 s, falla con un error claro
  idleTimeoutMillis: 30000,
  application_name: 'appresso-api',
});

// Un cliente inactivo del pool puede fallar (p. ej. si se reinicia PG).
// Sin este manejador, ese error tumbaría todo el proceso de Node.
pool.on('error', (err) => {
  const t = traducirErrorPg(err);
  log.error({ fn: 'pool.on(error)', etapa: 'PERSISTENCIA', codigoPg: t.original.codigoPg, mensajePg: t.original.mensajePg }, t.mensaje);
});

/**
 * Convierte un error de PG en ErrorApp (mensaje en español + etapa) y lo
 * loguea con el código y mensaje originales.
 */
function envolverErrorPg(err, { etapa, fn, contexto } = {}) {
  if (err instanceof ErrorApp) return err;
  const t = traducirErrorPg(err);
  const etapaFinal = etapa || obtenerContexto().etapa || 'PERSISTENCIA';
  log.error(
    {
      fn: fn || 'consulta',
      etapa: etapaFinal,
      codigoPg: t.original.codigoPg,
      mensajePg: t.original.mensajePg,
      detallePg: t.original.detallePg,
      restriccion: t.original.restriccion,
      ...(contexto || {}),
    },
    `${etapaFinal}: ${t.mensaje}`,
  );
  return new ErrorApp({
    etapa: etapaFinal,
    codigo: t.codigo,
    mensaje: t.mensaje,
    causa: err,
    errores: [
      {
        idTxn: null,
        campo: t.original.columna,
        codigo: t.codigo,
        mensaje: t.mensaje,
        recibido: null,
        esperado: null,
        codigoPg: t.original.codigoPg,
        mensajePg: t.original.mensajePg,
      },
    ],
  });
}

/**
 * Ejecuta una consulta parametrizada. Si falla, lanza ErrorApp traducido.
 * @param {string} sql     SQL con marcadores $1, $2...
 * @param {Array}  params  Valores de los marcadores
 * @param {object} [meta]  { fn, etapa } para el log
 * @param {import('pg').PoolClient} [cliente] Si se pasa, usa ese cliente (dentro de una transacción)
 */
async function consultar(sql, params = [], meta = {}, cliente = pool) {
  try {
    return await cliente.query(sql, params);
  } catch (err) {
    throw envolverErrorPg(err, meta);
  }
}

/**
 * Ejecuta `fn(cliente)` dentro de una transacción SQL:
 * BEGIN → fn → COMMIT, o ROLLBACK si algo falla.
 * Así un lote nunca queda guardado a medias.
 */
async function enTransaccion(fn, meta = {}) {
  let cliente;
  try {
    cliente = await pool.connect();
  } catch (err) {
    throw envolverErrorPg(err, { ...meta, fn: meta.fn || 'enTransaccion.connect' });
  }
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    try {
      await cliente.query('ROLLBACK');
      log.warn({ fn: 'enTransaccion', etapa: obtenerContexto().etapa }, 'ROLLBACK ejecutado: no se guardó ningún dato de esta operación');
    } catch (errRollback) {
      log.error({ fn: 'enTransaccion', error: errRollback }, 'Falló el ROLLBACK');
    }
    throw err instanceof ErrorApp ? err : envolverErrorPg(err, meta);
  } finally {
    cliente.release();
  }
}

module.exports = { pool, consultar, enTransaccion, envolverErrorPg };
