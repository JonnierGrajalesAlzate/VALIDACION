/**
 * Catálogo de códigos de error de la API y su código HTTP.
 * Tener un único catálogo evita que el mismo problema salga con códigos o
 * estados HTTP distintos según el endpoint.
 */
const CODIGOS = Object.freeze({
  // 400 — el cuerpo no se pudo leer
  JSON_MALFORMADO: { http: 400 },
  CUERPO_VACIO: { http: 400 },
  // 415 — no se envió como application/json
  CONTENT_TYPE_INVALIDO: { http: 415 },
  // 413 — el cuerpo supera el tamaño permitido
  CUERPO_DEMASIADO_GRANDE: { http: 413 },
  // 422 — el JSON es válido pero su contenido no
  CAMPO_FALTANTE: { http: 422 },
  CAMPO_NO_PERMITIDO: { http: 422 },
  TIPO_INVALIDO: { http: 422 },
  FORMATO_INVALIDO: { http: 422 },
  FECHA_IMPOSIBLE: { http: 422 },
  VALOR_FUERA_DE_RANGO: { http: 422 },
  METODO_PAGO_NO_PERMITIDO: { http: 422 },
  VALOR_NO_PERMITIDO: { http: 422 },
  LOTE_VACIO: { http: 422 },
  LOTE_DEMASIADO_GRANDE: { http: 422 },
  HASH_INVALIDO: { http: 422 },
  USUARIO_INACTIVO: { http: 422 },
  PARAMETRO_INVALIDO: { http: 422 },
  CONFIGURACION_INVALIDA: { http: 422 },
  // 409 — choca con lo que ya existe
  DUPLICADO: { http: 409 },
  DUPLICADO_EN_LOTE: { http: 409 },
  LLAVE_FORANEA: { http: 409 },
  // 404
  NO_ENCONTRADO: { http: 404 },
  RUTA_NO_ENCONTRADA: { http: 404 },
  // 5xx — errores reales del servidor
  BD_SIN_CONEXION: { http: 503 },
  BD_CREDENCIALES: { http: 503 },
  BD_NO_EXISTE: { http: 503 },
  BD_TABLA_NO_EXISTE: { http: 500 },
  BD_COLUMNA_NO_EXISTE: { http: 500 },
  BD_ERROR: { http: 500 },
  ERROR_INTERNO: { http: 500 },
});

function httpDeCodigo(codigo) {
  return (CODIGOS[codigo] && CODIGOS[codigo].http) || 500;
}

module.exports = { CODIGOS, httpDeCodigo };
