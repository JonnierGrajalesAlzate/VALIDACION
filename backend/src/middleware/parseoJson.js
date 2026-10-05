const { AsyncResource } = require('async_hooks');
const express = require('express');
const { ErrorApp } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { establecerEtapa } = require('../logging/contexto');
const { crearLogger } = require('../logging/logger');
const { parsearJsonConservandoNumeros } = require('../validacion/jsonCrudo');

const log = crearLogger(__filename);
const LIMITE = '5mb';
const METODOS_CON_CUERPO = new Set(['POST', 'PUT', 'PATCH']);

const leerCrudo = express.raw({ type: () => true, limit: LIMITE });

function parseoJson(req, res, next) {
  if (!METODOS_CON_CUERPO.has(req.method)) return next();

  leerCrudo(req, res, AsyncResource.bind((err) => {
    establecerEtapa(ETAPAS.PARSEO_JSON);
    if (err) {
      if (err.type === 'entity.too.large') {
        return next(new ErrorApp({
          etapa: ETAPAS.RECEPCION,
          codigo: 'CUERPO_DEMASIADO_GRANDE',
          mensaje: `El cuerpo de la petición supera el límite de ${LIMITE}. Divida el lote en envíos más pequeños.`,
        }));
      }
      return next(err);
    }

    const texto = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    req.cuerpoCrudo = texto;

    if (texto.trim() === '') {
      return next(new ErrorApp({
        etapa: ETAPAS.PARSEO_JSON,
        codigo: 'CUERPO_VACIO',
        mensaje: 'El cuerpo de la petición está vacío: se esperaba un JSON (un objeto o un arreglo de objetos).',
      }));
    }

    const tipo = req.get('Content-Type') || '';
    if (!/^application\/(.+\+)?json\b/i.test(tipo)) {
      return next(new ErrorApp({
        etapa: ETAPAS.RECEPCION,
        codigo: 'CONTENT_TYPE_INVALIDO',
        mensaje: `La cabecera Content-Type debe ser "application/json"; se recibió "${tipo || '(ninguna)'}".`,
        errores: [{
          idTxn: null, campo: 'Content-Type', codigo: 'CONTENT_TYPE_INVALIDO',
          mensaje: `La cabecera Content-Type debe ser "application/json"; se recibió "${tipo || '(ninguna)'}".`,
          recibido: tipo || null, esperado: 'application/json',
        }],
      }));
    }

    try {
      req.body = parsearJsonConservandoNumeros(texto.replace(/^﻿/, ''));
      log.debug({ fn: 'parseoJson', bytes: Buffer.byteLength(texto) }, 'JSON parseado correctamente');
      return next();
    } catch (e) {
      log.warn(
        { fn: 'parseoJson', linea: e.linea, columna: e.columna, fragmento: e.fragmento, errorOriginal: e.mensajeOriginal },
        `PARSEO_JSON: ${e.message}`,
      );
      return next(new ErrorApp({
        etapa: ETAPAS.PARSEO_JSON,
        codigo: 'JSON_MALFORMADO',
        mensaje: e.message,
        errores: [{
          idTxn: null, campo: null, codigo: 'JSON_MALFORMADO', mensaje: e.message,
          recibido: e.fragmento, esperado: 'JSON válido (comillas dobles, sin comas sobrantes, sin comentarios)',
          linea: e.linea, columna: e.columna,
        }],
      }));
    }
  }));
}

module.exports = { parseoJson };
