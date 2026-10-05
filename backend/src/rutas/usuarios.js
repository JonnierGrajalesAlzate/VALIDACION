const { Router } = require('express');
const { z } = require('zod');
const usuariosRepo = require('../repositorios/usuarios.repo');
const { validarParametros, validarId } = require('../validacion/consultas');
const { aIsoNegocio } = require('../validacion/fechas');
const { ErrorApp } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { establecerEtapa } = require('../logging/contexto');
const { crearLogger } = require('../logging/logger');

const log = crearLogger(__filename);
const router = Router();

const esquemaListar = z.strictObject({
  estado: z.enum(['ACTIVO', 'INACTIVO']).optional(),
  email: z.string().min(1).max(254).optional(),
});

function aUsuarioApi(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    estado: u.estado,
    totalTransacciones: u.total_transacciones,
    transaccionesAnomalas: u.transacciones_anomalas,
    totalAnomalias: u.total_anomalias,
    valorTotal: u.valor_total,
    ultimaTransaccion: u.ultima_transaccion ? aIsoNegocio(u.ultima_transaccion) : null,
    fechaCreacion: aIsoNegocio(u.fecha_creacion),
    fechaActualizacion: aIsoNegocio(u.fecha_actualizacion),
  };
}

router.get('/', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  const filtros = validarParametros(esquemaListar, req.query);
  const filas = await usuariosRepo.listarConConteos(filtros);
  res.json({ ok: true, requestId: req.requestId, total: filas.length, datos: filas.map(aUsuarioApi) });
});

const esquemaPatch = z.strictObject({ estado: z.enum(['ACTIVO', 'INACTIVO']) });

router.patch('/:id', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  const id = validarId(req.params.id);
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ErrorApp({ etapa: ETAPAS.VALIDACION_ESQUEMA, codigo: 'TIPO_INVALIDO', mensaje: 'El cuerpo debe ser un objeto JSON: { "estado": "ACTIVO" | "INACTIVO" }' });
  }
  const { estado } = validarParametros(esquemaPatch, req.body, 'body');
  const u = await usuariosRepo.cambiarEstado(id, estado);
  if (!u) throw new ErrorApp({ etapa: ETAPAS.CONSULTA, codigo: 'NO_ENCONTRADO', mensaje: `El usuario id=${id} no existe` });
  log.info({ fn: 'cambiarEstado', usuarioId: id, usuario: u.email, estado }, `Usuario ${u.email} ahora está ${estado}`);
  res.json({
    ok: true,
    requestId: req.requestId,
    mensaje: `Usuario ${u.email} ahora está ${estado}`,
    usuario: { id: u.id, nombre: u.nombre, email: u.email, estado: u.estado, fechaActualizacion: aIsoNegocio(u.fecha_actualizacion) },
  });
});

module.exports = router;
