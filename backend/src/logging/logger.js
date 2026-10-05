const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { DateTime } = require('luxon');
const env = require('../config/env');
const { obtenerContexto } = require('./contexto');

const DIR_LOGS = path.join(__dirname, '..', '..', 'logs');
fs.mkdirSync(DIR_LOGS, { recursive: true });

const CAMPOS_CABECERA = new Set(['level', 'message', 'requestId', 'etapa', 'archivo', 'fn', 'stack', 'timestamp']);

function valorParaLog(valor) {
  if (valor === undefined) return 'undefined';
  if (typeof valor === 'string') return JSON.stringify(valor);
  let texto;
  try {
    texto = JSON.stringify(valor);
  } catch {
    texto = String(valor);
  }
  if (texto === undefined) texto = String(valor);
  return texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;
}

const formatoLinea = winston.format.printf((info) => {
  const fecha = DateTime.now().setZone(env.TZ_NEGOCIO).toFormat('yyyy-MM-dd HH:mm:ss.SSS ZZ');
  const nivel = info.level.toUpperCase();
  const requestId = info.requestId || '-';
  const etapa = info.etapa || '-';
  const origen = `${info.archivo || '?'}:${info.fn || '?'}`;

  const extras = Object.keys(info)
    .filter((k) => !CAMPOS_CABECERA.has(k) && typeof k === 'string')
    .map((k) => `${k}=${valorParaLog(info[k])}`);

  let linea = `[${fecha}] [${nivel}] [${requestId}] [${etapa}] [${origen}] ${info.message}`;
  if (extras.length) linea += ` | ${extras.join(' ')}`;
  if (info.stack) linea += `\n${info.stack}`;
  return linea;
});

const esPrueba = env.NODE_ENV === 'test';

const loggerBase = winston.createLogger({
  level: env.LOG_LEVEL,
  format: formatoLinea,
  transports: [
    new winston.transports.Console({ silent: esPrueba && !process.env.LOG_EN_PRUEBAS }),
    new winston.transports.File({
      filename: path.join(DIR_LOGS, esPrueba ? 'test.log' : 'app.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

function crearLogger(rutaArchivo) {
  const archivo = path.basename(rutaArchivo);

  const escribir = (nivel) => (campos, mensaje) => {
    if (typeof campos === 'string') {
      mensaje = campos;
      campos = {};
    }
    const ctx = obtenerContexto();
    const { error, ...resto } = campos || {};
    const entrada = {
      requestId: ctx.requestId,
      etapa: ctx.etapa,
      archivo,
      ...resto,
      message: mensaje,
    };
    if (error) {
      entrada.errorMensaje = error.message;
      if (error.code) entrada.errorCodigo = error.code;
      if (resto.incluirStack !== false && error.stack) entrada.stack = error.stack;
    }
    delete entrada.incluirStack;
    loggerBase.log(nivel, entrada);
  };

  return {
    error: escribir('error'),
    warn: escribir('warn'),
    info: escribir('info'),
    debug: escribir('debug'),
    debugActivo: () => loggerBase.isLevelEnabled('debug'),
  };
}

function vaciarLogs() {
  return new Promise((resolve) => {
    loggerBase.on('finish', resolve);
    loggerBase.end();
    setTimeout(resolve, 500);
  });
}

module.exports = { crearLogger, vaciarLogs, valorParaLog };
