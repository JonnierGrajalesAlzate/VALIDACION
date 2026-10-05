const { AsyncLocalStorage } = require('async_hooks');

const almacen = new AsyncLocalStorage();

function ejecutarConContexto(datos, fn) {
  return almacen.run({ ...datos }, fn);
}

function obtenerContexto() {
  return almacen.getStore() || {};
}

function establecerEtapa(etapa) {
  const ctx = almacen.getStore();
  if (ctx) ctx.etapa = etapa;
}

module.exports = { ejecutarConContexto, obtenerContexto, establecerEtapa };
