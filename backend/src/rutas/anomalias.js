const { Router } = require('express');
const { z } = require('zod');
const anomaliasRepo = require('../repositorios/anomalias.repo');
const transaccionesRepo = require('../repositorios/transacciones.repo');
const reglas = require('../config/reglas');
const { ventanaPara } = require('../ventana/franjas');
const { simularVentana } = require('../ventana/ventanaDeslizante');
const { validarParametros, validarId, fechaFiltro, paginacion } = require('../validacion/consultas');
const { aIsoNegocio } = require('../validacion/fechas');
const { ErrorApp } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { establecerEtapa } = require('../logging/contexto');
const { crearLogger } = require('../logging/logger');

const log = crearLogger(__filename);
const router = Router();

const ESTADOS_REVISION = ['NUEVA', 'ABIERTA', 'REVISADA', 'DESCARTADA'];

const esquemaListar = z.strictObject({
  tipo: z.enum(['POSIBLE_FRAUDE']).optional(),
  nivel: z.enum(['BAJO', 'MEDIO', 'ALTO']).optional(),
  estadoRevision: z.enum(ESTADOS_REVISION).optional(),
  desde: fechaFiltro('desde').optional(),
  hasta: fechaFiltro('hasta').optional(),
  usuario: z.string().min(1).max(254).optional(),
  ...paginacion,
});

function aAnomaliaApi(a) {
  return {
    id: a.id,
    tipo: a.tipo,
    nivel: a.nivel,
    cantidadTransacciones: a.cantidad_transacciones,
    ventanaSegundos: a.ventana_segundos,
    estadoRevision: a.estado_revision,
    notaRevision: a.nota_revision,
    fechaRevision: a.fecha_revision ? aIsoNegocio(a.fecha_revision) : null,
    idTxn: a.transaccion_id,
    usuarioId: a.usuario_id,
    usuario: a.email,
    estadoUsuario: a.estado_usuario,
    valor: a.valor,
    metodoPago: a.metodo_pago,
    fechaTxn: aIsoNegocio(a.fecha_txn),
    fechaCreacion: aIsoNegocio(a.fecha_creacion),
  };
}

router.get('/', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  const filtros = validarParametros(esquemaListar, req.query);
  const { filas, total } = await anomaliasRepo.listar(filtros);
  res.json({ ok: true, requestId: req.requestId, total, pagina: filtros.pagina, limite: filtros.limite, datos: filas.map(aAnomaliaApi) });
});

router.get('/:id', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  const id = validarId(req.params.id);
  const a = await anomaliasRepo.obtenerPorId(id);
  if (!a) throw new ErrorApp({ etapa: ETAPAS.CONSULTA, codigo: 'NO_ENCONTRADO', mensaje: `La anomalía id=${id} no existe` });

  const tMs = a.fecha_txn.getTime();
  const W = a.ventana_segundos;

  const desde = new Date(tMs - 2 * W * 1000);
  const hasta = new Date(tMs + W * 1000);
  const txns = await transaccionesRepo.deUsuarioEnRango(a.usuario_id, desde, hasta);
  const pasos = simularVentana(txns.map((t) => ({ id: t.id, fechaMs: t.fecha_txn.getTime() })), W);
  const pasoDisparo = pasos.find((p) => p.enVentana.includes(a.transaccion_id) && p.conteo === a.cantidad_transacciones)
    || pasos.find((p) => p.entro === a.transaccion_id);
  const involucradas = new Set(pasoDisparo ? pasoDisparo.enVentana : [a.transaccion_id]);
  const { franja } = ventanaPara(tMs, reglas.obtener());
  const lineaTiempo = {
    tipoVentana: 'DESLIZANTE',
    franja,
    descripcion: `Ventana de ${W} s${franja ? ` (franja ${franja})` : ''}: una transacción sigue dentro mientras (fecha_actual − fecha_txn) ≤ ${W} s`,
    rango: { desde: aIsoNegocio(desde), hasta: aIsoNegocio(hasta) },
    transacciones: txns.map((t) => ({
      idTxn: t.id, fecha: aIsoNegocio(t.fecha_txn), valor: t.valor, metodoPago: t.metodo_pago, estado: t.estado,
      tiposAnomalia: t.tipos_anomalia,
      esDisparadora: t.id === a.transaccion_id,
      involucrada: involucradas.has(t.id),
      segundosRespectoDisparo: (t.fecha_txn.getTime() - tMs) / 1000,
    })),
    pasos: pasos.map((p) => ({ ...p, fecha: aIsoNegocio(p.fechaMs), fechaMs: undefined, esPasoDisparo: p === pasoDisparo })),
    involucradas: [...involucradas],
  };

  res.json({
    ok: true,
    requestId: req.requestId,
    anomalia: aAnomaliaApi(a),
    lineaTiempo,
    reconstruida: true,
    nota: 'Las transacciones involucradas se reconstruyen con una consulta (mismo usuario, dentro de la ventana guardada). El modelo actual solo guarda la transacción que disparó la anomalía.',
  });
});

const esquemaRevision = z.strictObject({
  estadoRevision: z.enum(['ABIERTA', 'REVISADA', 'DESCARTADA']),
  nota: z.string().trim().max(500, 'máximo 500 caracteres').nullable().optional(),
});

router.patch('/:id', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  const id = validarId(req.params.id);
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ErrorApp({ etapa: ETAPAS.VALIDACION_ESQUEMA, codigo: 'TIPO_INVALIDO', mensaje: 'El cuerpo debe ser un objeto JSON: { "estadoRevision": "ABIERTA" | "REVISADA" | "DESCARTADA", "nota"?: "..." }' });
  }
  const { estadoRevision, nota } = validarParametros(esquemaRevision, req.body, 'body');
  const a = await anomaliasRepo.cambiarRevision(id, estadoRevision, nota === '' ? null : nota);
  if (!a) throw new ErrorApp({ etapa: ETAPAS.CONSULTA, codigo: 'NO_ENCONTRADO', mensaje: `La anomalía id=${id} no existe` });
  log.info({ fn: 'cambiarRevision', anomaliaId: id, estadoRevision, conNota: Boolean(a.nota_revision) }, `Anomalía #${id} ahora está ${estadoRevision}`);
  res.json({ ok: true, requestId: req.requestId, mensaje: `Anomalía #${id} ahora está ${estadoRevision}`, anomalia: aAnomaliaApi(a) });
});

module.exports = router;
