/**
 * Middleware GLOBAL de errores de Express.
 *
 * Garantiza que NINGÚN error salga como un 500 genérico sin explicación:
 * - ErrorApp (errores controlados): se responden con su etapa, código y detalle.
 * - Errores de PostgreSQL que se escaparon: se traducen.
 * - Cualquier otro error: 500 con la etapa en la que estaba el proceso, y
 *   en el log el stack trace COMPLETO.
 *
 * Estructura fija de la respuesta de error:
 * { ok:false, requestId, etapa, errores:[{ idTxn, campo, codigo, mensaje, recibido, esperado }] }
 */
const { ErrorApp } = require('../errores/ErrorApp');
const { esErrorPg } = require('../errores/traductorPg');
const { envolverErrorPg } = require('../db/pool');
const { obtenerContexto } = require('../logging/contexto');
const { crearLogger } = require('../logging/logger');
const env = require('../config/env');

const log = crearLogger(__filename);

/** 404 para rutas que no existen (se registra después de todas las rutas). */
function rutaNoEncontrada(req, res, next) {
  next(new ErrorApp({
    etapa: 'RECEPCION',
    codigo: 'RUTA_NO_ENCONTRADA',
    mensaje: `La ruta ${req.method} ${req.path} no existe. Consulte README.md para ver los endpoints disponibles.`,
  }));
}

// Express reconoce un middleware de errores porque tiene 4 parámetros.
// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, next) {
  const ctx = obtenerContexto();
  let error = err;

  if (!(error instanceof ErrorApp) && esErrorPg(error)) {
    // envolverErrorPg ya deja el log con el código/mensaje originales de PG.
    error = envolverErrorPg(error, { fn: 'manejadorErrores' });
  }

  if (!(error instanceof ErrorApp)) {
    // Error inesperado (bug): log con stack completo y la etapa en curso.
    const etapa = ctx.etapa || 'DESCONOCIDA';
    log.error(
      { fn: 'manejadorErrores', etapa, error: err, metodo: req.method, ruta: req.originalUrl },
      `${etapa}: error inesperado del servidor: ${err && err.message}`,
    );
    error = new ErrorApp({
      etapa,
      codigo: 'ERROR_INTERNO',
      mensaje: `Error interno inesperado durante la etapa ${etapa}: ${err && err.message}. ` +
        `Busque el requestId ${req.requestId} en backend/logs/app.log para ver el stack trace completo.`,
    });
    // En desarrollo se devuelve el stack también en la respuesta, para depurar rápido.
    if (env.NODE_ENV === 'development' && err && err.stack) error.errores[0].stack = err.stack.split('\n').slice(0, 8);
  } else if (error.http >= 500) {
    log.error({ fn: 'manejadorErrores', etapa: error.etapa, codigo: error.codigo, error: error.causa }, `${error.etapa}: ${error.message}`);
  } else {
    log.warn({ fn: 'manejadorErrores', etapa: error.etapa, codigo: error.codigo, status: error.http, errores: error.errores.length }, `${error.etapa}: ${error.message}`);
  }

  if (res.headersSent) return undefined;
  return res.status(error.http).json({
    ok: false,
    requestId: req.requestId || ctx.requestId || null,
    etapa: error.etapa,
    mensaje: error.message,
    errores: error.errores,
  });
}

module.exports = { manejadorErrores, rutaNoEncontrada };
