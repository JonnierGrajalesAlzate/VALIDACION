/**
 * /api/anomalias
 *   GET /     → listar con filtros (tipo, nivel, desde, hasta, usuario) y paginación
 *   GET /:id  → detalle + línea de tiempo + recorrido de la ventana deslizante
 *
 * Sobre la línea de tiempo: el modelo de datos guarda solo la transacción
 * que DISPARÓ la anomalía, no todas las involucradas. Por eso aquí se
 * RECONSTRUYEN buscando las transacciones del mismo usuario alrededor de
 * esa fecha y volviendo a pasar la ventana con el tamaño guardado en
 * anomalias.ventana_segundos. Si después se borran transacciones, la
 * reconstrucción puede diferir de lo que se vio al detectarla (ver la
 * migración propuesta 002 en DECISIONES.md).
 */
const { Router } = require('express');
const { z } = require('zod');
const anomaliasRepo = require('../repositorios/anomalias.repo');
const transaccionesRepo = require('../repositorios/transacciones.repo');
const reglas = require('../config/reglas');
const { obtenerFranja } = require('../ventana/franjas');
const { simularVentana } = require('../ventana/ventanaDeslizante');
const { validarParametros, validarId, fechaFiltro, paginacion } = require('../validacion/consultas');
const { aIsoNegocio } = require('../validacion/fechas');
const { ErrorApp } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { establecerEtapa } = require('../logging/contexto');

const router = Router();

const esquemaListar = z.strictObject({
  tipo: z.enum(['POSIBLE_FRAUDE', 'EXCESO_FRANJA_HORARIA']).optional(),
  nivel: z.enum(['BAJO', 'MEDIO', 'ALTO']).optional(),
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
  let lineaTiempo;

  if (a.tipo === 'POSIBLE_FRAUDE') {
    // Se toma un margen de una ventana antes y después para VER qué
    // transacciones entraban y salían alrededor del disparo.
    const desde = new Date(tMs - 2 * W * 1000);
    const hasta = new Date(tMs + W * 1000);
    const txns = await transaccionesRepo.deUsuarioEnRango(a.usuario_id, desde, hasta);
    const pasos = simularVentana(txns.map((t) => ({ id: t.id, fechaMs: t.fecha_txn.getTime() })), W);
    // Ventana que corresponde a la anomalía: la que contiene la transacción
    // disparadora con la cantidad registrada (normalmente, el paso en que
    // ella misma entró).
    const pasoDisparo = pasos.find((p) => p.enVentana.includes(a.transaccion_id) && p.conteo === a.cantidad_transacciones)
      || pasos.find((p) => p.entro === a.transaccion_id);
    const involucradas = new Set(pasoDisparo ? pasoDisparo.enVentana : [a.transaccion_id]);
    lineaTiempo = {
      tipoVentana: 'DESLIZANTE',
      descripcion: `Ventana de ${W} s: una transacción sigue dentro mientras (fecha_actual − fecha_txn) ≤ ${W} s`,
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
  } else {
    const R = reglas.obtener();
    const fh = R.franjasHorarias;
    let desde;
    let hasta;
    let descripcion;
    if (fh.modo === 'OCURRENCIA') {
      const f = obtenerFranja(tMs, fh.franjas);
      desde = new Date(f.inicioMs);
      hasta = new Date(f.finMs - 1);
      descripcion = `Franja ${f.etiqueta}: límite ${f.limite} transacción(es) por usuario`;
    } else {
      desde = new Date(tMs - W * 1000);
      hasta = new Date(tMs);
      descripcion = `Ventana móvil de ${W} s con el límite de la franja de la transacción`;
    }
    const txns = await transaccionesRepo.deUsuarioEnRango(a.usuario_id, desde, hasta);
    let acumulado = 0;
    lineaTiempo = {
      tipoVentana: fh.modo === 'OCURRENCIA' ? 'FRANJA' : 'FRANJA_MOVIL',
      descripcion,
      rango: { desde: aIsoNegocio(desde), hasta: aIsoNegocio(hasta) },
      transacciones: txns.map((t) => ({
        idTxn: t.id, fecha: aIsoNegocio(t.fecha_txn), valor: t.valor, metodoPago: t.metodo_pago, estado: t.estado,
        tiposAnomalia: t.tipos_anomalia,
        esDisparadora: t.id === a.transaccion_id,
        involucrada: true,
        acumuladoEnFranja: (acumulado += 1),
      })),
      pasos: [],
      involucradas: txns.map((t) => t.id),
    };
  }

  res.json({
    ok: true,
    requestId: req.requestId,
    anomalia: aAnomaliaApi(a),
    lineaTiempo,
    reconstruida: true,
    nota: 'Las transacciones involucradas se reconstruyen con una consulta (mismo usuario, dentro de la ventana guardada). El modelo actual solo guarda la transacción que disparó la anomalía.',
  });
});

module.exports = router;
