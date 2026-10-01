/**
 * GET /api/health → estado del servidor y de la conexión a PostgreSQL.
 * Responde 200 si todo está bien y 503 si la BD no está disponible o le
 * falta alguna tabla/columna (con el detalle exacto de qué falta).
 */
const { Router } = require('express');
const env = require('../config/env');
const { verificarEsquema } = require('../db/verificarEsquema');
const { establecerEtapa } = require('../logging/contexto');
const { ETAPAS } = require('../logging/etapas');

const router = Router();

router.get('/', async (req, res) => {
  establecerEtapa(ETAPAS.CONSULTA);
  const bd = await verificarEsquema();
  const ok = bd.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    requestId: req.requestId,
    servidor: {
      estado: 'ACTIVO',
      entorno: env.NODE_ENV,
      zonaHorariaNegocio: env.TZ_NEGOCIO,
      uptimeSegundos: Math.round(process.uptime()),
      node: process.version,
    },
    baseDeDatos: {
      estado: ok ? 'CONECTADA' : 'CON_PROBLEMAS',
      host: env.PGHOST,
      puerto: env.PGPORT,
      nombre: env.PGDATABASE,
      latenciaMs: bd.latenciaMs ?? null,
      version: bd.version ?? null,
      problemas: bd.problemas,
      ...(bd.original ? { codigoPg: bd.original.codigoPg, mensajePg: bd.original.mensajePg } : {}),
    },
  });
});

module.exports = router;
