/**
 * Acceso a la tabla anomalias. Solo SQL parametrizado.
 */
const { consultar, pool } = require('../db/pool');
const { crearFiltros } = require('./sqlUtil');

/** Inserta varias anomalías en una sola sentencia. */
async function insertarVarias(filas, cliente = pool) {
  if (!filas.length) return [];
  const r = await consultar(
    `INSERT INTO anomalias (transaccion_id, tipo, nivel, cantidad_transacciones, ventana_segundos)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::int[], $5::int[])
     RETURNING id, transaccion_id, tipo`,
    [
      filas.map((f) => f.transaccionId),
      filas.map((f) => f.tipo),
      filas.map((f) => f.nivel),
      filas.map((f) => f.cantidad),
      filas.map((f) => f.ventanaSegundos),
    ],
    { fn: 'anomalias.insertarVarias' },
    cliente,
  );
  return r.rows;
}

const SELECT_BASE = `
  SELECT a.id, a.transaccion_id, a.tipo, a.nivel, a.cantidad_transacciones, a.ventana_segundos,
         a.fecha_creacion, a.fecha_actualizacion,
         t.valor, t.fecha_txn, t.metodo_pago, t.estado AS estado_transaccion,
         u.id AS usuario_id, u.email, u.nombre, u.estado AS estado_usuario
    FROM anomalias a
    JOIN transacciones t ON t.id = a.transaccion_id
    JOIN usuarios u ON u.id = t.usuario_id`;

/**
 * Listado con filtros. El rango de fechas se aplica sobre la fecha de la
 * transacción (fecha_txn: cuándo ocurrió), no sobre fecha_creacion
 * (cuándo se registró en el sistema).
 */
async function listar({ tipo, nivel, desde, hasta, usuario, limite, pagina }) {
  const f = crearFiltros();
  if (tipo) f.agregar('a.tipo = ?', tipo);
  if (nivel) f.agregar('a.nivel = ?', nivel);
  if (desde) f.agregar('t.fecha_txn >= ?', desde);
  if (hasta) f.agregar('t.fecha_txn <= ?', hasta);
  if (usuario) f.agregar('u.email ILIKE ?', `%${usuario}%`);
  const pLimite = f.param(limite);
  const pOffset = f.param((pagina - 1) * limite);
  const r = await consultar(
    `SELECT * , COUNT(*) OVER()::int AS total_filas FROM (${SELECT_BASE} ${f.where()}) x
      ORDER BY fecha_txn DESC, id DESC
      LIMIT ${pLimite} OFFSET ${pOffset}`,
    f.params,
    { fn: 'anomalias.listar' },
  );
  return { filas: r.rows, total: r.rows[0] ? r.rows[0].total_filas : 0 };
}

async function obtenerPorId(id) {
  const r = await consultar(`${SELECT_BASE} WHERE a.id = $1`, [id], { fn: 'anomalias.obtenerPorId' });
  return r.rows[0] || null;
}

module.exports = { insertarVarias, listar, obtenerPorId };
