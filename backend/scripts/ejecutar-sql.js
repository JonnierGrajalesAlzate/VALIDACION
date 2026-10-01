/**
 * Ejecuta uno o varios archivos .sql contra la base de datos del .env
 * (alternativa a pgAdmin 4 para quien prefiera la terminal).
 *
 * Uso: node scripts/ejecutar-sql.js ../database/schema.sql [otro.sql ...]
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = require('../src/config/env');
const { traducirErrorPg } = require('../src/errores/traductorPg');

async function main() {
  const archivos = process.argv.slice(2);
  if (!archivos.length) {
    console.error('Uso: node scripts/ejecutar-sql.js <archivo.sql> [más archivos...]');
    process.exit(1);
  }
  const cliente = new Client({
    host: env.PGHOST, port: env.PGPORT, user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE,
  });
  try {
    await cliente.connect();
  } catch (err) {
    console.error(`[ERROR] ${traducirErrorPg(err).mensaje}`);
    process.exit(1);
  }
  for (const archivo of archivos) {
    const ruta = path.resolve(process.cwd(), archivo);
    const sql = fs.readFileSync(ruta, 'utf8');
    try {
      // Sin parámetros, `query` admite varias sentencias en un solo texto.
      await cliente.query(sql);
      console.log(`[OK] ${path.basename(ruta)} ejecutado en ${env.PGDATABASE}`);
    } catch (err) {
      const t = traducirErrorPg(err);
      console.error(`[ERROR] ${path.basename(ruta)}: ${t.mensaje}\n        PG ${t.original.codigoPg}: ${t.original.mensajePg}`);
      await cliente.end();
      process.exit(1);
    }
  }
  await cliente.end();
}

main();
