/**
 * Franjas horarias (límite de transacciones por usuario en cada franja).
 *
 * Por defecto (config/reglas.json):
 *   MANANA           05:00:01 → 12:00:00   hasta 10
 *   TARDE_NOCHE      12:00:01 → 20:00:00   hasta 6
 *   NOCHE_MADRUGADA  20:00:01 → 05:00:00   hasta 3   ← cruza la medianoche
 *
 * Decisiones (ver DECISIONES.md):
 *  - La hora se evalúa en la zona del negocio (TZ_NEGOCIO), no en UTC.
 *  - Se compara la hora TRUNCADA al segundo: 12:00:00.500 se lee como
 *    12:00:00 y cae en MANANA, igual que en un reloj. Así las franjas
 *    escritas "05:00:01 → 12:00:00" no dejan huecos entre milisegundos.
 *  - Una "ocurrencia" es una aparición concreta de la franja: la noche
 *    del 23/09 va del 23/09 20:00:01 al 24/09 05:00:00. Una transacción
 *    del 24/09 a las 02:00 pertenece a la noche del 23/09.
 */
const { DateTime } = require('luxon');
const env = require('../config/env');
const { horaASegundos } = require('../config/reglas');

const SEGUNDOS_DIA = 86400;

/** Duración de la franja en segundos (inclusive en ambos extremos). */
function duracionSegundos(franja) {
  const desde = horaASegundos(franja.desde);
  const hasta = horaASegundos(franja.hasta);
  return desde <= hasta ? hasta - desde + 1 : SEGUNDOS_DIA - desde + hasta + 1;
}

/**
 * Determina la franja y la ocurrencia de un instante.
 * @param {number} fechaMs  instante en milisegundos (epoch)
 * @param {Array}  franjas  reglas.franjasHorarias.franjas
 * @param {string} [zona]
 */
function obtenerFranja(fechaMs, franjas, zona = env.TZ_NEGOCIO) {
  const local = DateTime.fromMillis(fechaMs, { zone: zona });
  const segundoDelDia = local.hour * 3600 + local.minute * 60 + local.second;

  for (const franja of franjas) {
    const desde = horaASegundos(franja.desde);
    const hasta = horaASegundos(franja.hasta);
    const cruzaMedianoche = desde > hasta;
    const dentro = cruzaMedianoche
      ? segundoDelDia >= desde || segundoDelDia <= hasta
      : segundoDelDia >= desde && segundoDelDia <= hasta;
    if (!dentro) continue;

    // Si la franja cruza la medianoche y estamos en la madrugada, la
    // ocurrencia empezó el día ANTERIOR.
    const diaInicio = cruzaMedianoche && segundoDelDia <= hasta ? local.minus({ days: 1 }) : local;
    const inicio = diaInicio.startOf('day').plus({ seconds: desde });
    const duracion = duracionSegundos(franja);
    return {
      nombre: franja.nombre,
      limite: franja.limite,
      duracionSegundos: duracion,
      inicioMs: inicio.toMillis(),
      finMs: inicio.plus({ seconds: duracion }).toMillis(), // exclusivo
      clave: `${franja.nombre}|${inicio.toISODate()}`,
      etiqueta: `${franja.nombre} del ${inicio.toFormat('dd/MM/yyyy')} (${franja.desde} → ${franja.hasta})`,
    };
  }
  // No debería pasar: reglas.js valida que las franjas cubran las 24 horas.
  throw new Error(`Ninguna franja cubre la hora ${local.toFormat('HH:mm:ss')}; revise franjasHorarias en config/reglas.json`);
}

module.exports = { obtenerFranja, duracionSegundos };
