/**
 * Validación de parámetros de consulta (?usuario=...&desde=...) y de :id.
 *
 * Nota: en la URL TODO llega como texto, así que aquí sí se convierte
 * "50" → 50, pero solo después de comprobar con una expresión regular que
 * es exactamente un número. Parámetros desconocidos → error (modo estricto),
 * para que un error de tipeo como ?estdo=ANOMALA no se ignore en silencio.
 */
const { z } = require('zod');
const { DateTime } = require('luxon');
const env = require('../config/env');
const { ErrorApp } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { parsearFechaIso } = require('./fechas');

/** Entero positivo escrito en texto ("12" → 12). */
const enteroTexto = (min, max) => z
  .string()
  .regex(/^\d+$/, 'debe ser un entero positivo')
  .transform(Number)
  .refine((n) => n >= min && n <= max, `debe estar entre ${min} y ${max}`);

/**
 * Fecha de filtro. Acepta ISO completa (2026-09-23T10:00:00) o solo el día
 * (2026-09-23): "desde" toma el inicio del día y "hasta" el final.
 */
const fechaFiltro = (extremo) => z.string().transform((texto, ctx) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const dia = DateTime.fromISO(texto, { zone: env.TZ_NEGOCIO });
    if (!dia.isValid) {
      ctx.addIssue({ code: 'custom', message: `fecha imposible: ${texto}` });
      return z.NEVER;
    }
    return (extremo === 'desde' ? dia.startOf('day') : dia.endOf('day')).toJSDate();
  }
  const r = parsearFechaIso(texto);
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.mensaje });
    return z.NEVER;
  }
  return r.fecha.toJSDate();
});

const paginacion = {
  limite: enteroTexto(1, 500).optional().default(50),
  pagina: enteroTexto(1, 1000000).optional().default(1),
};

/**
 * Valida `datos` con `esquema`; si falla lanza ErrorApp 422 con un error
 * por parámetro.
 */
function validarParametros(esquema, datos, origen = 'query') {
  const r = esquema.safeParse(datos || {});
  if (r.success) return r.data;
  const errores = r.error.issues.flatMap((i) => {
    if (i.code === 'unrecognized_keys') {
      return i.keys.map((k) => ({
        idTxn: null, campo: k, codigo: 'PARAMETRO_INVALIDO',
        mensaje: `el parámetro '${k}' no existe en este endpoint (valores permitidos: ${Object.keys(esquema.shape).join(', ')})`,
        recibido: datos[k], esperado: Object.keys(esquema.shape).join(' | '),
      }));
    }
    const campo = String(i.path[0]);
    const presente = datos && Object.prototype.hasOwnProperty.call(datos, campo);
    let mensaje = i.message;
    if (i.code === 'invalid_value') mensaje = `debe ser uno de: ${i.values.join(', ')}`;
    if (i.code === 'invalid_type') mensaje = presente ? `tipo inválido (${i.message})` : 'es obligatorio';
    return [{
      idTxn: null, campo, codigo: presente ? 'PARAMETRO_INVALIDO' : 'CAMPO_FALTANTE',
      mensaje: `${origen === 'body' ? 'campo' : 'parámetro'} '${campo}' ${mensaje}`,
      recibido: presente ? datos[campo] : null, esperado: i.values ? i.values.join(' | ') : null,
    }];
  });
  throw new ErrorApp({
    etapa: ETAPAS.CONSULTA,
    codigo: errores.every((e) => e.codigo === 'CAMPO_FALTANTE') ? 'CAMPO_FALTANTE' : 'PARAMETRO_INVALIDO',
    mensaje: errores.map((e) => e.mensaje).join('; '),
    errores,
  });
}

/** Valida el :id de la ruta (entero positivo). */
function validarId(texto, nombre = 'id') {
  return validarParametros(z.strictObject({ [nombre]: enteroTexto(1, Number.MAX_SAFE_INTEGER) }), { [nombre]: texto }, 'ruta')[nombre];
}

module.exports = { validarParametros, validarId, fechaFiltro, paginacion, enteroTexto };
