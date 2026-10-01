/**
 * Utilidades de base de datos para las pruebas.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../src/db/pool');
const reglas = require('../../src/config/reglas');

/** Vacía las 3 tablas (se llama en beforeAll/beforeEach de cada suite). */
async function limpiarBd() {
  await pool.query('TRUNCATE TABLE anomalias, transacciones, usuarios RESTART IDENTITY');
}

/** Restaura las reglas por defecto (por si una prueba las cambió). */
function restablecerReglas() {
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'reglas.json'), 'utf8'));
  reglas.actualizar(original);
}

async function cerrarBd() {
  await pool.end();
}

module.exports = { limpiarBd, restablecerReglas, cerrarBd, pool };
