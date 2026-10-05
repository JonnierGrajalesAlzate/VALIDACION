const express = require('express');
const { requestId } = require('./middleware/requestId');
const { parseoJson } = require('./middleware/parseoJson');
const { manejadorErrores, rutaNoEncontrada } = require('./middleware/manejadorErrores');
const env = require('./config/env');

function crearApp({ rutasDev = env.NODE_ENV === 'development' } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Expose-Headers', 'X-Request-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  app.use(requestId);
  app.use(parseoJson);

  app.use('/api/health', require('./rutas/health'));
  app.use('/api/transacciones', require('./rutas/transacciones'));
  app.use('/api/usuarios', require('./rutas/usuarios'));
  app.use('/api/anomalias', require('./rutas/anomalias'));
  app.use('/api/estadisticas', require('./rutas/estadisticas'));
  app.use('/api/config', require('./rutas/config'));
  if (rutasDev) app.use('/api/dev', require('./rutas/dev'));

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return app;
}

module.exports = { crearApp };
