const { Pool, types } = require('pg');
const env = require('../config/env');
const { crearLogger } = require('../logging/logger');
const { ErrorApp } = require('../errores/ErrorApp');
const { traducirErrorPg } = require('../errores/traductorPg');
const { obtenerContexto } = require('../logging/contexto');

const log = crearLogger(__filename);

types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const pool = new Pool({
  host: env.PGHOST,
  port: env.PGPORT,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'appresso-api',
});

pool.on('error', (err) => {
  const t = traducirErrorPg(err);
  log.error({ fn: 'pool.on(error)', etapa: 'PERSISTENCIA', codigoPg: t.original.codigoPg, mensajePg: t.original.mensajePg }, t.mensaje);
});

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

async function consultar(sql, params = [], meta = {}, cliente = pool) {
  try {
    return await cliente.query(sql, params);
  } catch (err) {
    throw envolverErrorPg(err, meta);
  }
}

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
