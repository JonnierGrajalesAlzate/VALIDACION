/**
 * Contexto por petición usando AsyncLocalStorage (módulo nativo de Node).
 *
 * ¿Para qué? Para que cualquier función, por profunda que esté (un
 * repositorio, el algoritmo de ventana...), pueda loguear con el
 * requestId y la etapa ACTUAL sin tener que pasarlos como parámetro por
 * toda la cadena de llamadas. Node mantiene este "almacén" asociado a la
 * cadena asíncrona de cada petición, así que dos peticiones simultáneas
 * nunca se mezclan.
 */
const { AsyncLocalStorage } = require('async_hooks');

const almacen = new AsyncLocalStorage();

/** Ejecuta `fn` dentro de un contexto nuevo (lo usa el middleware requestId). */
function ejecutarConContexto(datos, fn) {
  return almacen.run({ ...datos }, fn);
}

/** Devuelve el contexto actual o un objeto vacío si no hay petición en curso. */
function obtenerContexto() {
  return almacen.getStore() || {};
}

/**
 * Marca la etapa actual. Si luego ocurre un error inesperado, el middleware
 * global de errores sabrá en qué etapa estaba el proceso.
 */
function establecerEtapa(etapa) {
  const ctx = almacen.getStore();
  if (ctx) ctx.etapa = etapa;
}

module.exports = { ejecutarConContexto, obtenerContexto, establecerEtapa };
