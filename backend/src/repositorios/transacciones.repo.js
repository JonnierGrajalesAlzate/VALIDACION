/**
 * Acceso a la tabla transacciones. Solo SQL parametrizado.
 */
const { consultar, enTransaccion, pool } = require('../db/pool');
const { crearFiltros } = require('./sqlUtil');

/** De la lista de ids, cuáles ya existen (para detectar duplicados). */
async function idsExistentes(ids, cliente = pool) {
  if (!ids.length) return new Set();
  const r = await consultar(
    'SELECT id FROM transacciones WHERE id = ANY($1::bigint[])',
    [ids],
    { fn: 'transacciones.idsExistentes' },
    cliente,
  );
  return new Set(r.rows.map((f) => f.id));
}

/**
 * Transacciones ya guardadas de varios usuarios, cada uno en su propio
 * rango de fechas (las que todavía caben en la ventana del lote nuevo).
 * @param {Array<{usuarioId:number, desdeMs:number, hastaMs:number}>} rangos
 */
async function historicoPorRangos(rangos, cliente = pool) {
  if (!rangos.length) return [];
  const r = await consultar(
    `SELECT t.id, t.usuario_id, u.email, t.fecha_txn
       FROM unnest($1::bigint[], $2::timestamptz[], $3::timestamptz[]) AS r(usuario_id, desde, hasta)
       JOIN transacciones t ON t.usuario_id = r.usuario_id AND t.fecha_txn BETWEEN r.desde AND r.hasta
       JOIN usuarios u ON u.id = t.usuario_id
      ORDER BY t.fecha_txn, t.id`,
    [
      rangos.map((x) => x.usuarioId),
      rangos.map((x) => new Date(x.desdeMs)),
      rangos.map((x) => new Date(x.hastaMs)),
    ],
    { fn: 'transacciones.historicoPorRangos' },
    cliente,
  );
  return r.rows.map((f) => ({ id: f.id, usuarioId: f.usuario_id, email: f.email, fechaMs: f.fecha_txn.getTime() }));
}

/** Inserta varias transacciones en UNA sola sentencia (unnest de arreglos). */
async function insertarVarias(filas, cliente = pool) {
  if (!filas.length) return 0;
  const r = await consultar(
    `INSERT INTO transacciones (id, usuario_id, valor, fecha_txn, estado, hash, metodo_pago)
     SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::numeric[], $4::timestamptz[], $5::text[], $6::text[], $7::text[])`,
    [
      filas.map((f) => f.id),
      filas.map((f) => f.usuarioId),
      filas.map((f) => f.valor),
      filas.map((f) => new Date(f.fechaMs)),
      filas.map((f) => f.estado),
      filas.map((f) => f.hash),
      filas.map((f) => f.metodoPago),
    ],
    { fn: 'transacciones.insertarVarias' },
    cliente,
  );
  return r.rowCount;
}

/** Listado con filtros y paginación. */
async function listar({ usuario, desde, hasta, estado, metodoPago, limite, pagina }) {
  const f = crearFiltros();
  if (usuario) f.agregar('u.email ILIKE ?', `%${usuario}%`);
  if (desde) f.agregar('t.fecha_txn >= ?', desde);
  if (hasta) f.agregar('t.fecha_txn <= ?', hasta);
  if (estado) f.agregar('t.estado = ?', estado);
  if (metodoPago) f.agregar('t.metodo_pago = ?', metodoPago);
  const pLimite = f.param(limite);
  const pOffset = f.param((pagina - 1) * limite);
  const r = await consultar(
    `SELECT t.id, t.usuario_id, u.email, t.valor, t.fecha_txn, t.estado, t.hash, t.metodo_pago,
            t.fecha_creacion, t.fecha_actualizacion,
            (SELECT COUNT(*) FROM anomalias a WHERE a.transaccion_id = t.id)::int AS total_anomalias,
            COUNT(*) OVER()::int AS total_filas
       FROM transacciones t
       JOIN usuarios u ON u.id = t.usuario_id
       ${f.where()}
      ORDER BY t.fecha_txn DESC, t.id DESC
      LIMIT ${pLimite} OFFSET ${pOffset}`,
    f.params,
    { fn: 'transacciones.listar' },
  );
  return { filas: r.rows, total: r.rows[0] ? r.rows[0].total_filas : 0 };
}

/** Transacciones de un usuario en un rango (para la línea de tiempo de una anomalía). */
async function deUsuarioEnRango(usuarioId, desde, hasta) {
  const r = await consultar(
    `SELECT t.id, t.valor, t.fecha_txn, t.estado, t.metodo_pago,
            COALESCE(array_agg(a.tipo) FILTER (WHERE a.id IS NOT NULL), '{}') AS tipos_anomalia
       FROM transacciones t
       LEFT JOIN anomalias a ON a.transaccion_id = t.id
      WHERE t.usuario_id = $1 AND t.fecha_txn BETWEEN $2 AND $3
      GROUP BY t.id
      ORDER BY t.fecha_txn, t.id`,
    [usuarioId, desde, hasta],
    { fn: 'transacciones.deUsuarioEnRango' },
  );
  return r.rows;
}

/** Elimina una transacción (sus anomalías se borran por ON DELETE CASCADE). */
async function eliminar(id) {
  return enTransaccion(async (cliente) => {
    const an = await consultar('SELECT COUNT(*)::int AS n FROM anomalias WHERE transaccion_id = $1', [id], { fn: 'transacciones.eliminar' }, cliente);
    const r = await consultar(
      `DELETE FROM transacciones t USING usuarios u
        WHERE t.id = $1 AND u.id = t.usuario_id
        RETURNING t.id, u.email, t.valor, t.fecha_txn, t.estado, t.metodo_pago`,
      [id],
      { fn: 'transacciones.eliminar' },
      cliente,
    );
    return r.rows[0] ? { ...r.rows[0], anomalias_eliminadas: an.rows[0].n } : null;
  }, { fn: 'transacciones.eliminar' });
}

module.exports = { idsExistentes, historicoPorRangos, insertarVarias, listar, deUsuarioEnRango, eliminar };
