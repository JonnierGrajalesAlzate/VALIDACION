/**
 * POST /api/dev/calcular-hash — SOLO existe con NODE_ENV=development.
 *
 * Devuelve el hash correcto de una transacción (con la misma lógica que se
 * usa al validar) y la cadena exacta que se firmó, para armar pruebas.
 * Acepta el objeto con o sin el campo "hash" y NO valida los tipos: así se
 * puede firmar, por ejemplo, un value "50000" (string) y comprobar que la
 * API lo rechaza por TIPO y no por HASH.
 *
 * En producción esta ruta no se registra: sería un "firmador" de
 * transacciones falsas para cualquiera.
 */
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
