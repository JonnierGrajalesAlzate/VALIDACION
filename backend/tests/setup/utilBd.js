const fs = require('fs');
const path = require('path');
const { pool } = require('../../src/db/pool');
const reglas = require('../../src/config/reglas');

async function limpiarBd() {
  await pool.query('TRUNCATE TABLE anomalias, transacciones, usuarios RESTART IDENTITY');
}

function restablecerReglas() {
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'reglas.json'), 'utf8'));
  reglas.actualizar(original);
}

async function cerrarBd() {
  await pool.end();
}

module.exports = { limpiarBd, restablecerReglas, cerrarBd, pool };
