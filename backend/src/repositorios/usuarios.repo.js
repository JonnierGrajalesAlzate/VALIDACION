/**
 * Acceso a la tabla usuarios. Solo SQL parametrizado.
 */
const { consultar, pool } = require('../db/pool');
const { crearFiltros } = require('./sqlUtil');

/** Usuarios cuyos correos están en la lista. */
async function buscarPorEmails(emails, cliente = pool) {
  const r = await consultar(
    'SELECT id, nombre, email, estado FROM usuarios WHERE email = ANY($1::text[])',
    [emails],
    { fn: 'usuarios.buscarPorEmails' },
    cliente,
  );
  return r.rows;
}

/**
 * Crea (con estado ACTIVO) los usuarios que no existan.
 * unnest() convierte los dos arreglos en filas: una sola consulta para N
 * usuarios. ON CONFLICT DO NOTHING evita fallar si otro proceso lo creó.
 */
async function crearSiNoExisten(usuarios, cliente = pool) {
  if (!usuarios.length) return [];
  const r = await consultar(
    `INSERT INTO usuarios (email, nombre, estado)
     SELECT email, nombre, 'ACTIVO' FROM unnest($1::text[], $2::text[]) AS n(email, nombre)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, nombre, email, estado`,
    [usuarios.map((u) => u.email), usuarios.map((u) => u.nombre)],
    { fn: 'usuarios.crearSiNoExisten' },
    cliente,
  );
  return r.rows;
}

/** Lista de usuarios con su cantidad de transacciones y anomalías. */
async function listarConConteos({ estado, email } = {}) {
  const f = crearFiltros();
  if (estado) f.agregar('u.estado = ?', estado);
  if (email) f.agregar('u.email ILIKE ?', `%${email}%`);
  const r = await consultar(
    `SELECT u.id, u.nombre, u.email, u.estado, u.fecha_creacion, u.fecha_actualizacion,
            COALESCE(t.total, 0)::int            AS total_transacciones,
            COALESCE(t.anomalas, 0)::int         AS transacciones_anomalas,
            COALESCE(a.total, 0)::int            AS total_anomalias,
            COALESCE(t.valor_total, 0)           AS valor_total,
            t.ultima                             AS ultima_transaccion
       FROM usuarios u
       LEFT JOIN (SELECT usuario_id, COUNT(*) AS total,
                         COUNT(*) FILTER (WHERE estado = 'ANOMALA') AS anomalas,
                         SUM(valor) AS valor_total, MAX(fecha_txn) AS ultima
                    FROM transacciones GROUP BY usuario_id) t ON t.usuario_id = u.id
       LEFT JOIN (SELECT tr.usuario_id, COUNT(*) AS total
                    FROM anomalias an JOIN transacciones tr ON tr.id = an.transaccion_id
                   GROUP BY tr.usuario_id) a ON a.usuario_id = u.id
       ${f.where()}
      ORDER BY total_anomalias DESC, total_transacciones DESC, u.email`,
    f.params,
    { fn: 'usuarios.listarConConteos' },
  );
  return r.rows;
}

async function cambiarEstado(id, estado) {
  const r = await consultar(
    'UPDATE usuarios SET estado = $2 WHERE id = $1 RETURNING id, nombre, email, estado, fecha_creacion, fecha_actualizacion',
    [id, estado],
    { fn: 'usuarios.cambiarEstado' },
  );
  return r.rows[0] || null;
}

module.exports = { buscarPorEmails, crearSiNoExisten, listarConConteos, cambiarEstado };
