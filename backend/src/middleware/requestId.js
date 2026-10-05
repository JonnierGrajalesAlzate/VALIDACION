const crypto = require('crypto');
const { AsyncResource } = require('async_hooks');
const { ejecutarConContexto } = require('../logging/contexto');
const { ETAPAS } = require('../logging/etapas');
const { crearLogger } = require('../logging/logger');

const log = crearLogger(__filename);

function requestId(req, res, next) {
  const recibido = req.get('X-Request-Id');
  const id = recibido && /^[A-Za-z0-9._-]{8,64}$/.test(recibido) ? recibido : crypto.randomUUID();
  req.requestId = id;
  res.set('X-Request-Id', id);

  ejecutarConContexto({ requestId: id, etapa: ETAPAS.RECEPCION }, () => {
    const inicio = process.hrtime.bigint();
    log.info({ fn: 'requestId', metodo: req.method, ruta: req.originalUrl, ip: req.ip }, 'Petición recibida');
    res.on('finish', AsyncResource.bind(() => {
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      log.info({ fn: 'requestId', etapa: ETAPAS.RESPUESTA, status: res.statusCode, duracionMs: Math.round(ms) }, `Respuesta enviada ${req.method} ${req.originalUrl}`);
    }));
    next();
  });
}

module.exports = { requestId };
