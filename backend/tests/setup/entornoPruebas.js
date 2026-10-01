/**
 * Se ejecuta antes de CADA archivo de prueba (setupFiles de Jest).
 * Fija el entorno de pruebas ANTES de que se cargue src/config/env.js.
 */
process.env.NODE_ENV = 'test';
process.env.REGLAS_PATH = 'tests/.tmp/reglas.json';
// Secreto fijo para que los hash de las pruebas sean reproducibles.
process.env.HMAC_SECRET = 'secreto-de-pruebas';
