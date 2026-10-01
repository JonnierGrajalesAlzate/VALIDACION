/**
 * /api/config
 *   GET → reglas vigentes (ventana, umbral, franjas, niveles, métodos de pago, modo hash, lote)
 *   PUT → reemplaza las reglas (objeto COMPLETO, validado con Zod) y las guarda en config/reglas.json
 *
 * Los cambios aplican a las transacciones que lleguen DESPUÉS; las
 * anomalías ya registradas conservan el ventana_segundos con que se detectaron.
 */
const { Router } = require('express');
const reglas = require('../config/reglas');
const { ErrorApp } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { establecerEtapa } = require('../logging/contexto');
const { crearLogger } = require('../logging/logger');
const env = require('../config/env');

const log = crearLogger(__filename);
const router = Router();

router.get('/', (req, res) => {
  establecerEtapa(ETAPAS.CONFIGURACION);
  res.json({ ok: true, requestId: req.requestId, zonaHoraria: env.TZ_NEGOCIO, archivo: reglas.RUTA, reglas: reglas.obtener() });
});

router.put('/', (req, res) => {
  establecerEtapa(ETAPAS.CONFIGURACION);
  let nuevas;
  try {
    nuevas = reglas.actualizar(req.body);
  } catch (err) {
    if (!err.detalles) throw err;
    throw new ErrorApp({
      etapa: ETAPAS.CONFIGURACION,
      codigo: 'CONFIGURACION_INVALIDA',
      mensaje: err.message,
      errores: err.detalles.map((d) => ({ idTxn: null, campo: d.campo, codigo: 'CONFIGURACION_INVALIDA', mensaje: `${d.campo}: ${d.mensaje}`, recibido: null, esperado: null })),
    });
  }
  log.info({ fn: 'actualizar', ventana: nuevas.ventanaDeslizante, modoFranjas: nuevas.franjasHorarias.modo }, 'Configuración de reglas actualizada');
  res.json({ ok: true, requestId: req.requestId, mensaje: 'Configuración actualizada; aplica a las transacciones que lleguen desde ahora', reglas: nuevas });
});

module.exports = router;
