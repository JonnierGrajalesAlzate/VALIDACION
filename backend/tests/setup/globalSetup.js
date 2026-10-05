const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  const env = require('../../src/config/env');
  const { traducirErrorPg } = require('../../src/errores/traductorPg');

  if (env.PGDATABASE_TEST.toLowerCase() === (process.env.PGDATABASE || '').toLowerCase()) {
    throw new Error('PGDATABASE_TEST no puede ser igual a PGDATABASE: las pruebas borran los datos.');
  }

  const base = { host: env.PGHOST, port: env.PGPORT, user: env.PGUSER, password: env.PGPASSWORD };

  const admin = new Client({ ...base, database: 'postgres' });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`[pruebas] ${traducirErrorPg(err).mensaje}`);
  }
  const existe = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [env.PGDATABASE_TEST]);
  if (!existe.rowCount) {
    await admin.query(`CREATE DATABASE "${env.PGDATABASE_TEST}"`);
  }
  await admin.end();

  const cliente = new Client({ ...base, database: env.PGDATABASE_TEST });
  await cliente.connect();
  const dirBd = path.join(__dirname, '..', '..', '..', 'database');
  for (const archivo of ['reset.sql', 'schema.sql']) {
    await cliente.query(fs.readFileSync(path.join(dirBd, archivo), 'utf8'));
  }
  await cliente.end();

  const dirTmp = path.join(__dirname, '..', '.tmp');
  fs.mkdirSync(dirTmp, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', '..', 'config', 'reglas.json'), path.join(dirTmp, 'reglas.json'));
};
