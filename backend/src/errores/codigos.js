const CODIGOS = Object.freeze({
  JSON_MALFORMADO: { http: 400 },
  CUERPO_VACIO: { http: 400 },
  CONTENT_TYPE_INVALIDO: { http: 415 },
  CUERPO_DEMASIADO_GRANDE: { http: 413 },
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
  DUPLICADO: { http: 409 },
  DUPLICADO_EN_LOTE: { http: 409 },
  LLAVE_FORANEA: { http: 409 },
  NO_ENCONTRADO: { http: 404 },
  RUTA_NO_ENCONTRADA: { http: 404 },
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
