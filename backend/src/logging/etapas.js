/**
 * Etapas con nombre del procesamiento de una petición.
 *
 * Todo log y todo error lleva la etapa en la que ocurrió. Así, en lugar de
 * "hay un error", la consola dice por ejemplo
 * "[VALIDACION_HASH] idTxn=10002 hash no coincide".
 *
 * Se exporta un objeto congelado (Object.freeze) para que un error de
 * tipeo como ETAPAS.VALIDACON_HASH dé `undefined` en vez de inventar
 * una etapa nueva en silencio.
 */
const ETAPAS = Object.freeze({
  ARRANQUE: 'ARRANQUE', // verificación de BD al iniciar el servidor
  RECEPCION: 'RECEPCION',
  PARSEO_JSON: 'PARSEO_JSON',
  VALIDACION_ESQUEMA: 'VALIDACION_ESQUEMA',
  VALIDACION_HASH: 'VALIDACION_HASH',
  DUPLICADOS: 'DUPLICADOS',
  USUARIO: 'USUARIO',
  ORDENAMIENTO: 'ORDENAMIENTO',
  VENTANA_DESLIZANTE: 'VENTANA_DESLIZANTE',
  PERSISTENCIA: 'PERSISTENCIA',
  CONSULTA: 'CONSULTA', // endpoints de lectura (GET) y cambios simples
  CONFIGURACION: 'CONFIGURACION',
  RESPUESTA: 'RESPUESTA',
});

module.exports = { ETAPAS };
