/**
 * Validación y conversión de fechas ISO 8601 con Luxon.
 *
 * Formato aceptado:  YYYY-MM-DDTHH:mm:ss[.S a .SSS][Z | ±HH:mm]
 *   - Milisegundos opcionales (1 a 3 dígitos).
 *   - Si NO trae zona horaria se asume TZ_NEGOCIO (America/Bogota).
 *   - Fechas imposibles (2026-02-30, 25:00:00...) se rechazan con un
 *     mensaje que dice exactamente qué parte es imposible.
 *
 * Se valida componente por componente ANTES de llamar a Luxon para dar
 * mensajes en español precisos ("febrero de 2026 tiene 28 días") en lugar
 * del genérico "unit out of range".
 */
const { DateTime } = require('luxon');
const env = require('../config/env');

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Pistas para los errores de formato más comunes. */
function pistaFormato(texto) {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(texto)) return "use la letra 'T' entre la fecha y la hora, no un espacio";
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return 'falta la hora (HH:mm:ss)';
  if (/^\d{2}[/-]\d{2}[/-]\d{4}/.test(texto)) return 'el orden debe ser año-mes-día (YYYY-MM-DD)';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto)) return 'faltan los segundos (HH:mm:ss)';
  if (/^\d{4}-\d{1,2}-\d{1,2}T/.test(texto)) return 'el mes y el día deben tener 2 dígitos (ej. 2026-09-03)';
  if (/[+-]\d{4}$/.test(texto)) return 'la zona horaria debe llevar dos puntos (ej. -05:00)';
  return 'formato esperado YYYY-MM-DDTHH:mm:ss.SSS (ej. 2026-09-23T10:30:01.120)';
}

/**
 * @param {string} texto
 * @param {string} [zona] zona a asumir si el texto no trae una
 * @returns {{ ok: true, fecha: DateTime } | { ok: false, codigo: string, mensaje: string }}
 */
function parsearFechaIso(texto, zona = env.TZ_NEGOCIO) {
  const m = RE_ISO.exec(texto);
  if (!m) {
    return { ok: false, codigo: 'FORMATO_INVALIDO', mensaje: `fecha con formato inválido: ${pistaFormato(texto)}` };
  }
  const [, a, mes, d, h, min, s, frac, tz] = m;
  const anio = Number(a);
  const nMes = Number(mes);
  const dia = Number(d);

  if (frac !== undefined && frac.length > 3) {
    return { ok: false, codigo: 'FORMATO_INVALIDO', mensaje: `la fecha admite máximo 3 decimales en los segundos (milisegundos); se recibieron ${frac.length}` };
  }
  if (nMes < 1 || nMes > 12) {
    return { ok: false, codigo: 'FECHA_IMPOSIBLE', mensaje: `fecha imposible: el mes ${mes} no existe (debe estar entre 01 y 12)` };
  }
  const diasDelMes = DateTime.local(anio, nMes).daysInMonth;
  if (dia < 1 || dia > diasDelMes) {
    return { ok: false, codigo: 'FECHA_IMPOSIBLE', mensaje: `fecha imposible: ${a}-${mes}-${d} no existe (${MESES[nMes - 1]} de ${anio} tiene ${diasDelMes} días)` };
  }
  if (Number(h) > 23) return { ok: false, codigo: 'FECHA_IMPOSIBLE', mensaje: `hora imposible: ${h} (debe estar entre 00 y 23)` };
  if (Number(min) > 59) return { ok: false, codigo: 'FECHA_IMPOSIBLE', mensaje: `minuto imposible: ${min} (debe estar entre 00 y 59)` };
  if (Number(s) > 59) return { ok: false, codigo: 'FECHA_IMPOSIBLE', mensaje: `segundo imposible: ${s} (debe estar entre 00 y 59)` };
  if (tz && tz !== 'Z') {
    const [hh, mm] = tz.slice(1).split(':').map(Number);
    if (hh > 14 || mm > 59) return { ok: false, codigo: 'FECHA_IMPOSIBLE', mensaje: `zona horaria imposible: ${tz} (rango válido -12:00 a +14:00)` };
  }

  // Luxon: si el texto trae zona, la usa; si no, interpreta la hora en `zona`.
  const fecha = DateTime.fromISO(texto, { zone: zona });
  if (!fecha.isValid) {
    return { ok: false, codigo: 'FECHA_IMPOSIBLE', mensaje: `fecha inválida: ${fecha.invalidExplanation || fecha.invalidReason}` };
  }
  return { ok: true, fecha, teniaZona: Boolean(tz) };
}

/** Formatea un instante (Date o ms) como ISO en la zona del negocio. */
function aIsoNegocio(valor) {
  const dt = valor instanceof Date ? DateTime.fromJSDate(valor) : DateTime.fromMillis(Number(valor));
  return dt.setZone(env.TZ_NEGOCIO).toISO();
}

module.exports = { parsearFechaIso, aIsoNegocio };
