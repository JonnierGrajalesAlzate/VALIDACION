let log;
let vaciarLogs = async () => {};

process.on('unhandledRejection', (razon) => {
  const err = razon instanceof Error ? razon : new Error(String(razon));
  const { obtenerContexto } = require('./logging/contexto');
  const etapa = obtenerContexto().etapa || 'DESCONOCIDA';
  if (log) log.error({ fn: 'unhandledRejection', etapa, error: err }, `${etapa}: promesa rechazada sin manejar: ${err.message}`);
  else console.error('[unhandledRejection]', err);
});

process.on('uncaughtException', (err) => {
  const { obtenerContexto } = require('./logging/contexto');
  const etapa = obtenerContexto().etapa || 'DESCONOCIDA';
  if (log) log.error({ fn: 'uncaughtException', etapa, error: err }, `${etapa}: excepción no capturada: ${err.message}. El proceso se detiene para no quedar en un estado inconsistente.`);
  else console.error('[uncaughtException]', err);
  vaciarLogs().finally(() => process.exit(1));
});

async function iniciar() {
  let env;
  try {
    env = require('./config/env');
  } catch (err) {
    console.error(`\n[ARRANQUE] ${err.message}\n`);
    process.exit(1);
  }

  ({ vaciarLogs } = require('./logging/logger'));
  log = require('./logging/logger').crearLogger(__filename);
  const { verificarEsquema } = require('./db/verificarEsquema');
  const reglas = require('./config/reglas');
  const { crearApp } = require('./app');

  log.info({ fn: 'iniciar', etapa: 'ARRANQUE', entorno: env.NODE_ENV, bd: `${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}` }, 'Iniciando Appresso API');

  try {
    reglas.cargar();
  } catch (err) {
    log.error({ fn: 'iniciar', etapa: 'ARRANQUE', incluirStack: false, error: err }, `No se pudo cargar la configuración de reglas: ${err.message}`);
    await vaciarLogs();
    process.exit(1);
  }

  const bd = await verificarEsquema();
  if (!bd.ok) {
    for (const problema of bd.problemas) {
      log.error({ fn: 'iniciar', etapa: 'ARRANQUE', ...(bd.original || {}) }, `Arranque detenido: ${problema}`);
    }
    await vaciarLogs();
    process.exit(1);
  }
  log.info({ fn: 'iniciar', etapa: 'ARRANQUE', latenciaMs: bd.latenciaMs, version: bd.version }, 'PostgreSQL conectado y con las 3 tablas completas');

  const app = crearApp();
  const servidor = app.listen(env.PORT, () => {
    log.info({ fn: 'iniciar', etapa: 'ARRANQUE' }, `Servidor escuchando en http://localhost:${env.PORT}`);
  });
  servidor.on('error', async (err) => {
    const mensaje = err.code === 'EADDRINUSE'
      ? `El puerto ${env.PORT} ya está en uso. Cierre el otro proceso o cambie PORT en backend/.env`
      : `No se pudo abrir el puerto ${env.PORT}: ${err.message}`;
    log.error({ fn: 'listen', etapa: 'ARRANQUE', errorCodigo: err.code }, mensaje);
    await vaciarLogs();
    process.exit(1);
  });
}

iniciar();
