const { Router } = require('express');
const env = require('../config/env');
const reglas = require('../config/reglas');
const repo = require('../repositorios/estadisticas.repo');
const { aIsoNegocio } = require('../validacion/fechas');
const { establecerEtapa } = require('../logging/contexto');
const { ETAPAS } = require('../logging/etapas');
const { validarParametros } = require('../validacion/consultas');
const { z } = require('zod');

const router = Router();

function comparar(actual, anterior) {
  return { actual, anterior, variacion: anterior ? Math.round(((actual - anterior) / anterior) * 1000) / 10 : null };
}

router.get('/', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  validarParametros(z.strictObject({}), req.query);
  const tz = env.TZ_NEGOCIO;
  const fh = reglas.obtener().franjasHorarias;
  const [tarjetas, recurrentes, casos, evolucion, mapaCalor, porHora, porFranja, porCantidad, rafaga, porNivel, porTipo, porMetodoPago] = await Promise.all([
    repo.tarjetas(tz),
    repo.usuariosRecurrentes(10),
    repo.casosFrecuentes(10),
    repo.evolucion(tz, 90),
    repo.mapaCalor(tz),
    repo.porHora(tz),
    repo.porFranja(tz, fh.franjas),
    repo.porCantidad(),
    repo.rafagaMayor(),
    repo.porNivel(),
    repo.porTipo(),
    repo.porMetodoPago(),
  ]);
  const t = tarjetas;

  res.json({
    ok: true,
    requestId: req.requestId,
    zonaHoraria: tz,
    generado: aIsoNegocio(new Date()),
    tarjetas: {
      transacciones: { hoy: t.transacciones_hoy, semana: t.transacciones_semana, mes: t.transacciones_mes, total: t.transacciones_total },
      anomalias: { hoy: t.anomalias_hoy, semana: t.anomalias_semana, mes: t.anomalias_mes, total: t.anomalias_total },
      transaccionesAnomalas: t.transacciones_anomalas,
      porcentajeAnomalas: t.porcentaje_anomalas ?? 0,
      usuariosAfectados: t.usuarios_afectados,
      valorSospechoso: t.valor_sospechoso,
      usuariosTotal: t.usuarios_total,
      promedioTransaccionesPorUsuario: t.promedio_transacciones_por_usuario ?? 0,
    },
    tendencias: {
      transacciones: {
        hoy: comparar(t.transacciones_hoy, t.transacciones_ayer),
        semana: comparar(t.transacciones_semana, t.transacciones_semana_anterior),
        mes: comparar(t.transacciones_mes, t.transacciones_mes_anterior),
      },
      anomalias: {
        hoy: comparar(t.anomalias_hoy, t.anomalias_ayer),
        semana: comparar(t.anomalias_semana, t.anomalias_semana_anterior),
        mes: comparar(t.anomalias_mes, t.anomalias_mes_anterior),
      },
    },
    revision: { nuevas: t.revision_nuevas, abiertas: t.revision_abiertas, revisadas: t.revision_revisadas, descartadas: t.revision_descartadas },
    usuariosRecurrentes: recurrentes.map((u) => ({
      id: u.id, email: u.email, estado: u.estado, anomalias: u.anomalias, transaccionesAnomalas: u.transacciones_anomalas,
      transaccionesTotal: u.transacciones_total, valorSospechoso: u.valor_sospechoso, ultimaAnomalia: aIsoNegocio(u.ultima_anomalia),
    })),
    casosFrecuentes: casos.map((c) => ({ tipo: c.tipo, nivel: c.nivel, metodoPago: c.metodo_pago, cantidad: c.cantidad, usuarios: c.usuarios, valor: c.valor })),
    evolucion: evolucion.map((e) => ({ dia: e.dia, total: e.total, mediaMovil: e.media_movil, promedioPrevio: e.promedio_previo, pico: e.pico })),
    mapaCalor: mapaCalor.map((m) => ({ diaSemana: m.dia_semana, hora: m.hora, cantidad: m.cantidad })),
    porHora,
    porFranja: porFranja.map((f) => {
      const franja = fh.franjas.find((x) => x.nombre === f.nombre);
      return {
        franja: f.nombre, desde: franja.desde, hasta: franja.hasta, segundosVentana: franja.segundosVentana,
        transacciones: f.transacciones, transaccionesAnomalas: f.transacciones_anomalas, anomalias: f.anomalias, usuarios: f.usuarios,
      };
    }),
    multiplesTransacciones: {
      porCantidad: porCantidad.map((c) => ({ cantidad: c.grupo, masDe: c.grupo === 6, anomalias: c.anomalias, usuarios: c.usuarios })),
      rafagaMayor: rafaga && {
        anomaliaId: rafaga.id, cantidad: rafaga.cantidad_transacciones, ventanaSegundos: rafaga.ventana_segundos,
        usuario: rafaga.email, fecha: aIsoNegocio(rafaga.fecha_txn),
      },
    },
    porNivel,
    porTipo,
    porMetodoPago: porMetodoPago.map((m) => ({
      metodoPago: m.metodo_pago, transacciones: m.transacciones, transaccionesAnomalas: m.transacciones_anomalas, anomalias: m.anomalias, valorSospechoso: m.valor_sospechoso,
    })),
  });
});

module.exports = router;
