/**
 * Verificación de la base de datos al arrancar (y en /api/health).
 *
 * Revisa, en este orden:
 *  1. que haya conexión (host, puerto, credenciales, base de datos),
 *  2. que existan las 3 tablas,
 *  3. que cada tabla tenga todas las columnas del modelo.
 * y devuelve una lista precisa de lo que falta, en vez de fallar luego con
 * un "relation does not exist" en medio de una petición.
 */
const { pool } = require('./pool');
const { traducirErrorPg } = require('../errores/traductorPg');

// Modelo de datos acordado (no se agrega ni se quita nada sin aprobación).
const MODELO = {
  usuarios: ['id', 'nombre', 'email', 'estado', 'fecha_creacion', 'fecha_actualizacion'],
  transacciones: ['id', 'usuario_id', 'valor', 'fecha_txn', 'estado', 'hash', 'metodo_pago', 'fecha_creacion', 'fecha_actualizacion'],
  anomalias: ['id', 'transaccion_id', 'tipo', 'nivel', 'cantidad_transacciones', 'ventana_segundos', 'fecha_creacion', 'fecha_actualizacion'],
};

/**
 * @returns {Promise<{ok: boolean, latenciaMs?: number, version?: string, problemas: string[], codigo?: string, original?: object}>}
 */
async function verificarEsquema() {
  const inicio = Date.now();
  let version;
  try {
    const r = await pool.query('SELECT version() AS version');
    version = r.rows[0].version;
  } catch (err) {
    const t = traducirErrorPg(err);
    return { ok: false, problemas: [t.mensaje], codigo: t.codigo, original: t.original };
  }
  const latenciaMs = Date.now() - inicio;

  let r;
  try {
    r = await pool.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])`,
      [Object.keys(MODELO)],
    );
  } catch (err) {
    const t = traducirErrorPg(err);
    return { ok: false, problemas: [t.mensaje], codigo: t.codigo, original: t.original };
  }

  const columnasPorTabla = {};
  for (const fila of r.rows) {
    (columnasPorTabla[fila.table_name] ||= new Set()).add(fila.column_name);
  }

  const problemas = [];
  for (const [tabla, columnas] of Object.entries(MODELO)) {
    const existentes = columnasPorTabla[tabla];
    if (!existentes) {
      problemas.push(`Falta la tabla "${tabla}". Ejecute database/schema.sql en la base de datos.`);
      continue;
    }
    const faltantes = columnas.filter((c) => !existentes.has(c));
    if (faltantes.length) {
      problemas.push(`A la tabla "${tabla}" le faltan las columnas: ${faltantes.join(', ')}.`);
    }
  }

  return { ok: problemas.length === 0, latenciaMs, version, problemas };
}

module.exports = { verificarEsquema, MODELO };
