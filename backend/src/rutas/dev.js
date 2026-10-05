const { Router } = require('express');
const { calcularHash } = require('../hashing');
const { ErrorApp } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { establecerEtapa } = require('../logging/contexto');

const router = Router();

router.post('/calcular-hash', (req, res) => {
  establecerEtapa(ETAPAS.VALIDACION_HASH);
  const cuerpo = req.body;
  const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  if (!lista.length || lista.some((t) => t === null || typeof t !== 'object' || Array.isArray(t))) {
    throw new ErrorApp({ etapa: ETAPAS.RECEPCION, codigo: 'TIPO_INVALIDO', mensaje: 'Envíe un objeto (o un arreglo de objetos) con los campos de la transacción' });
  }
  const resultados = lista.map((t) => {
    const r = calcularHash(t);
    return { idTxn: t.idTxn ?? null, hash: r.hash, modo: r.modo, cadenaFirmada: r.cadena, transaccion: { ...t, hash: r.hash } };
  });
  res.json({ ok: true, requestId: req.requestId, ...(Array.isArray(cuerpo) ? { resultados } : resultados[0]) });
});

module.exports = router;
