/**
 * Error "controlado" de la aplicación.
 *
 * A diferencia de un Error genérico, sabe:
 *  - en qué ETAPA ocurrió,
 *  - qué código HTTP corresponde,
 *  - y la lista de errores detallados (campo, recibido, esperado...)
 * que se devuelve tal cual al cliente con la estructura fija de la API.
 */
const { httpDeCodigo } = require('./codigos');

class ErrorApp extends Error {
  /**
   * @param {object} p
   * @param {string} p.etapa   Etapa del proceso (ver logging/etapas.js)
   * @param {string} p.codigo  Código del catálogo (ver errores/codigos.js)
   * @param {string} p.mensaje Mensaje legible en español
   * @param {Array}  [p.errores] Detalle [{ idTxn, campo, codigo, mensaje, recibido, esperado }]
   * @param {number} [p.http]  Código HTTP (por defecto el del catálogo)
   * @param {Error}  [p.causa] Error original (p. ej. el de PostgreSQL), solo para logs
   */
  constructor({ etapa, codigo, mensaje, errores, http, causa }) {
    super(mensaje);
    this.name = 'ErrorApp';
    this.etapa = etapa;
    this.codigo = codigo;
    this.http = http || httpDeCodigo(codigo);
    this.errores = errores && errores.length ? errores : [crearDetalle({ codigo, mensaje })];
    this.causa = causa;
  }
}

/**
 * Crea un elemento de la lista "errores" siempre con las mismas claves,
 * para que el frontend (y el profesor) vean una estructura estable.
 */
function crearDetalle({ idTxn = null, posicion, campo = null, codigo, mensaje, recibido, tipoRecibido, esperado = null }) {
  const detalle = { idTxn, campo, codigo, mensaje, recibido: recibido === undefined ? null : recibido, esperado };
  // tipoRecibido distingue, por ejemplo, el string "50000" del número 50000.
  if (tipoRecibido !== undefined) detalle.tipoRecibido = tipoRecibido;
  // posicion = índice dentro del lote (útil cuando el elemento no trae idTxn válido).
  if (posicion !== undefined) detalle.posicion = posicion;
  return detalle;
}

module.exports = { ErrorApp, crearDetalle };
