const { ErrorApp } = require('../errores/ErrorApp');
const { esErrorPg } = require('../errores/traductorPg');
const { envolverErrorPg } = require('../db/pool');
const { obtenerContexto } = require('../logging/contexto');
const { crearLogger } = require('../logging/logger');
const env = require('../config/env');

const log = crearLogger(__filename);

function rutaNoEncontrada(req, res, next) {
  next(new ErrorApp({
    etapa: 'RECEPCION',
    codigo: 'RUTA_NO_ENCONTRADA',
    mensaje: `La ruta ${req.method} ${req.path} no existe. Consulte README.md para ver los endpoints disponibles.`,
  }));
}

// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, next) {
  const ctx = obtenerContexto();
  let error = err;

  if (!(error instanceof ErrorApp) && esErrorPg(error)) {
    error = envolverErrorPg(error, { fn: 'manejadorErrores' });
  }

  if (!(error instanceof ErrorApp)) {
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
