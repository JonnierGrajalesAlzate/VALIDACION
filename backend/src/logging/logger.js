/**
 * Logger central (winston) con UNA línea por evento, en este formato:
 *
 * [fecha-hora] [NIVEL] [requestId] [ETAPA] [archivo:función] mensaje | idTxn=... campo=... recibido=... esperado=...
 *
 * Se escribe a la consola y a backend/logs/app.log (en pruebas a
 * logs/test.log, y la consola queda en silencio para no ensuciar la
 * salida de Jest).
 *
 * Uso:
 *   const log = crearLogger(__filename);
 *   log.warn({ fn: 'validar', etapa: ETAPAS.VALIDACION_ESQUEMA, idTxn: 10001, campo: 'value' }, 'mensaje');
 */
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { DateTime } = require('luxon');
const env = require('../config/env');
const { obtenerContexto } = require('./contexto');

const DIR_LOGS = path.join(__dirname, '..', '..', 'logs');
fs.mkdirSync(DIR_LOGS, { recursive: true });

// Campos que van en la "cabecera" de la línea; el resto se imprime como
// pares clave=valor al final, después de " | ".
const CAMPOS_CABECERA = new Set(['level', 'message', 'requestId', 'etapa', 'archivo', 'fn', 'stack', 'timestamp']);

/** Convierte un valor a texto corto y sin saltos de línea para el log. */
function valorParaLog(valor) {
  if (valor === undefined) return 'undefined';
  if (typeof valor === 'string') return JSON.stringify(valor); // con comillas: se ve si venía como string
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
  // El stack trace completo va en líneas siguientes (solo para errores inesperados).
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
      maxsize: 10 * 1024 * 1024, // rota a los 10 MB para que el archivo no crezca sin límite
      maxFiles: 5,
    }),
  ],
});

/**
 * Crea un logger "atado" a un archivo. Toma automáticamente el requestId y
 * la etapa del contexto de la petición, pero se pueden sobrescribir.
 */
function crearLogger(rutaArchivo) {
  const archivo = path.basename(rutaArchivo);

  const escribir = (nivel) => (campos, mensaje) => {
    // Permite llamar log.info('mensaje') sin objeto de campos.
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
    // Si viene un objeto Error se agregan su mensaje, código de PG y stack.
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
    /** Indica si el nivel debug está activo (para no calcular textos caros en vano). */
    debugActivo: () => loggerBase.isLevelEnabled('debug'),
  };
}

/** Espera a que los logs pendientes se escriban (se usa antes de process.exit). */
function vaciarLogs() {
  return new Promise((resolve) => {
    loggerBase.on('finish', resolve);
    loggerBase.end();
    setTimeout(resolve, 500); // por si el transporte no emite 'finish'
  });
}

module.exports = { crearLogger, vaciarLogs, valorParaLog };
