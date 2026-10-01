/**
 * GET /api/estadisticas → todos los datos del dashboard en una sola respuesta.
 * Las consultas son independientes, así que se ejecutan en paralelo.
 */
const { Router } = require('express');
const env = require('../config/env');
const repo = require('../repositorios/estadisticas.repo');
const { aIsoNegocio } = require('../validacion/fechas');
const { establecerEtapa } = require('../logging/contexto');
const { ETAPAS } = require('../logging/etapas');
const { validarParametros } = require('../validacion/consultas');
const { z } = require('zod');

const router = Router();

router.get('/', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  validarParametros(z.strictObject({}), req.query);
  const tz = env.TZ_NEGOCIO;
  const [tarjetas, recurrentes, casos, evolucion, mapaCalor, porNivel, porTipo, porMetodoPago] = await Promise.all([
    repo.tarjetas(tz),
    repo.usuariosRecurrentes(10),
    repo.casosFrecuentes(10),
    repo.evolucion(tz, 90),
    repo.mapaCalor(tz),
    repo.porNivel(),
    repo.porTipo(),
    repo.porMetodoPago(),
  ]);

  res.json({
    ok: true,
    requestId: req.requestId,
    zonaHoraria: tz,
    generado: aIsoNegocio(new Date()),
    tarjetas: {
      transacciones: { hoy: tarjetas.transacciones_hoy, semana: tarjetas.transacciones_semana, mes: tarjetas.transacciones_mes, total: tarjetas.transacciones_total },
      anomalias: { hoy: tarjetas.anomalias_hoy, semana: tarjetas.anomalias_semana, mes: tarjetas.anomalias_mes, total: tarjetas.anomalias_total },
      transaccionesAnomalas: tarjetas.transacciones_anomalas,
      porcentajeAnomalas: tarjetas.porcentaje_anomalas ?? 0,
      usuariosAfectados: tarjetas.usuarios_afectados,
      valorSospechoso: tarjetas.valor_sospechoso,
      usuariosTotal: tarjetas.usuarios_total,
      promedioTransaccionesPorUsuario: tarjetas.promedio_transacciones_por_usuario ?? 0,
    },
    usuariosRecurrentes: recurrentes.map((u) => ({
      id: u.id, email: u.email, estado: u.estado, anomalias: u.anomalias, transaccionesAnomalas: u.transacciones_anomalas,
      transaccionesTotal: u.transacciones_total, valorSospechoso: u.valor_sospechoso, ultimaAnomalia: aIsoNegocio(u.ultima_anomalia),
    })),
    casosFrecuentes: casos.map((c) => ({ tipo: c.tipo, nivel: c.nivel, metodoPago: c.metodo_pago, cantidad: c.cantidad, usuarios: c.usuarios, valor: c.valor })),
    evolucion: evolucion.map((e) => ({ dia: e.dia, posibleFraude: e.posible_fraude, excesoFranja: e.exceso_franja, total: e.total })),
    mapaCalor: mapaCalor.map((m) => ({ diaSemana: m.dia_semana, hora: m.hora, cantidad: m.cantidad })),
    porNivel,
    porTipo,
    porMetodoPago: porMetodoPago.map((m) => ({
      metodoPago: m.metodo_pago, transacciones: m.transacciones, transaccionesAnomalas: m.transacciones_anomalas, anomalias: m.anomalias, valorSospechoso: m.valor_sospechoso,
    })),
  });
});

module.exports = router;
