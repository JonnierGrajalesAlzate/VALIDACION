const { Router } = require('express');
const { z } = require('zod');
const { procesarTransacciones } = require('../servicios/procesarTransacciones');
const transaccionesRepo = require('../repositorios/transacciones.repo');
const { validarParametros, validarId, fechaFiltro, paginacion } = require('../validacion/consultas');
const { aIsoNegocio } = require('../validacion/fechas');
const { ErrorApp } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { establecerEtapa } = require('../logging/contexto');
const { crearLogger } = require('../logging/logger');

const log = crearLogger(__filename);
const router = Router();

router.post('/', async (req, res) => {
  const { http, cuerpo } = await procesarTransacciones(req.body, { requestId: req.requestId });
  res.status(http).json(cuerpo);
});

const esquemaListar = z.strictObject({
  usuario: z.string().min(1).max(254).optional(),
  desde: fechaFiltro('desde').optional(),
  hasta: fechaFiltro('hasta').optional(),
  estado: z.enum(['VALIDA', 'ANOMALA']).optional(),
  metodoPago: z.string().min(1).max(30).optional(),
  ...paginacion,
});

function aTransaccionApi(f) {
  return {
    idTxn: f.id,
    usuarioId: f.usuario_id,
    usuario: f.email,
    valor: f.valor,
    fecha: aIsoNegocio(f.fecha_txn),
    estado: f.estado,
    metodoPago: f.metodo_pago,
    hash: f.hash,
    totalAnomalias: f.total_anomalias,
    fechaCreacion: aIsoNegocio(f.fecha_creacion),
  };
}

router.get('/', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  const filtros = validarParametros(esquemaListar, req.query);
  const { filas, total } = await transaccionesRepo.listar(filtros);
  res.json({ ok: true, requestId: req.requestId, total, pagina: filtros.pagina, limite: filtros.limite, datos: filas.map(aTransaccionApi) });
});

router.delete('/:id', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  const id = validarId(req.params.id);
  const eliminada = await transaccionesRepo.eliminar(id);
  if (!eliminada) {
    throw new ErrorApp({ etapa: ETAPAS.CONSULTA, codigo: 'NO_ENCONTRADO', mensaje: `La transacción idTxn=${id} no existe` });
  }
  log.info({ fn: 'eliminar', idTxn: id, anomaliasEliminadas: eliminada.anomalias_eliminadas }, `Transacción idTxn=${id} eliminada junto con ${eliminada.anomalias_eliminadas} anomalía(s)`);
  res.json({
    ok: true,
    requestId: req.requestId,
    mensaje: `Transacción idTxn=${id} eliminada (y ${eliminada.anomalias_eliminadas} anomalía(s) asociadas)`,
    eliminada: { idTxn: eliminada.id, usuario: eliminada.email, valor: eliminada.valor, fecha: aIsoNegocio(eliminada.fecha_txn), estado: eliminada.estado, metodoPago: eliminada.metodo_pago },
    anomaliasEliminadas: eliminada.anomalias_eliminadas,
  });
});

module.exports = router;
module.exports.aTransaccionApi = aTransaccionApi;
