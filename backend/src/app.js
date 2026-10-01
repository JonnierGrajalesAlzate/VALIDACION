/**
 * Construcción de la aplicación Express.
 *
 * Está separada de server.js (que hace app.listen) para que Supertest
 * pueda probar la API sin abrir un puerto real.
 */
const express = require('express');
const { requestId } = require('./middleware/requestId');
const { parseoJson } = require('./middleware/parseoJson');
const { manejadorErrores, rutaNoEncontrada } = require('./middleware/manejadorErrores');
const env = require('./config/env');

/**
 * @param {object} [opciones]
 * @param {boolean} [opciones.rutasDev] registra /api/dev/* (por defecto solo en development)
 */
function crearApp({ rutasDev = env.NODE_ENV === 'development' } = {}) {
  const app = express();
  app.disable('x-powered-by'); // no revelar la tecnología del servidor

  // CORS mínimo para desarrollo: el frontend de Vite corre en otro puerto.
  // (En desarrollo Vite usa un proxy, así que esto es solo por si se llama directo.)
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Expose-Headers', 'X-Request-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  // El orden importa: primero el requestId (para que TODO lo demás lo tenga),
  // luego el parseo del JSON.
  app.use(requestId);
  app.use(parseoJson);

  app.use('/api/health', require('./rutas/health'));
  app.use('/api/transacciones', require('./rutas/transacciones'));
  app.use('/api/usuarios', require('./rutas/usuarios'));
  app.use('/api/anomalias', require('./rutas/anomalias'));
  app.use('/api/estadisticas', require('./rutas/estadisticas'));
  app.use('/api/config', require('./rutas/config'));
  // El endpoint que calcula hashes NO existe fuera de desarrollo.
  if (rutasDev) app.use('/api/dev', require('./rutas/dev'));

  // 404 y manejador global de errores SIEMPRE al final.
  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return app;
}

module.exports = { crearApp };
