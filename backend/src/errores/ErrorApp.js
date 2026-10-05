const { httpDeCodigo } = require('./codigos');

class ErrorApp extends Error {
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

function crearDetalle({ idTxn = null, posicion, campo = null, codigo, mensaje, recibido, tipoRecibido, esperado = null }) {
  const detalle = { idTxn, campo, codigo, mensaje, recibido: recibido === undefined ? null : recibido, esperado };
  if (tipoRecibido !== undefined) detalle.tipoRecibido = tipoRecibido;
  if (posicion !== undefined) detalle.posicion = posicion;
  return detalle;
}

module.exports = { ErrorApp, crearDetalle };
