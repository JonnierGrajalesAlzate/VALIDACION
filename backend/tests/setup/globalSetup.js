/**
 * Se ejecuta UNA vez antes de todas las pruebas:
 *  1. Crea la base de datos de pruebas (PGDATABASE_TEST) si no existe.
 *  2. Borra y recrea sus tablas con database/reset.sql + schema.sql, para
 *     que las pruebas siempre corran contra el esquema actual.
 *  3. Copia config/reglas.json a tests/.tmp para que las pruebas de
 *     PUT /api/config no modifiquen la configuración real.
 *
 * Nunca toca la base de datos real (PGDATABASE): se conecta a la base
 * "postgres" solo para crear la de pruebas.
 */
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
    // Un nombre de base de datos no se puede pasar como parámetro ($1) en
    // CREATE DATABASE; por eso env.js exige que solo tenga [a-z0-9_].
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
