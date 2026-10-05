const { DateTime } = require('luxon');
const env = require('../config/env');
const { horaASegundos } = require('../config/reglas');

function obtenerFranja(fechaMs, franjas, zona = env.TZ_NEGOCIO) {
  const local = DateTime.fromMillis(fechaMs, { zone: zona });
  const segundoDelDia = local.hour * 3600 + local.minute * 60 + local.second;

  for (const franja of franjas) {
    const desde = horaASegundos(franja.desde);
    const hasta = horaASegundos(franja.hasta);
    const dentro = desde > hasta
      ? segundoDelDia >= desde || segundoDelDia <= hasta
      : segundoDelDia >= desde && segundoDelDia <= hasta;
    if (!dentro) continue;
    return {
      nombre: franja.nombre,
      segundosVentana: franja.segundosVentana,
      etiqueta: `${franja.nombre} (${franja.desde} → ${franja.hasta})`,
    };
  }
  throw new Error(`Ninguna franja cubre la hora ${local.toFormat('HH:mm:ss')}; revise franjasHorarias en config/reglas.json`);
}

function ventanaPara(fechaMs, reglas, zona = env.TZ_NEGOCIO) {
  const fh = reglas.franjasHorarias;
  if (!fh.activo) return { segundos: reglas.ventanaDeslizante.segundos, franja: null };
  const f = obtenerFranja(fechaMs, fh.franjas, zona);
  return { segundos: f.segundosVentana, franja: f.nombre };
}

function ventanaMaxima(reglas) {
  const fh = reglas.franjasHorarias;
  return fh.activo ? Math.max(...fh.franjas.map((f) => f.segundosVentana)) : reglas.ventanaDeslizante.segundos;
}

module.exports = { obtenerFranja, ventanaPara, ventanaMaxima };
