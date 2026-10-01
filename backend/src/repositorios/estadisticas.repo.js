/**
 * Métricas del dashboard. TODO se calcula con SQL en PostgreSQL
 * (COUNT ... FILTER, GROUP BY, date_trunc, EXTRACT), no en JavaScript.
 *
 * Zona horaria: "hoy", "esta semana" y la hora del mapa de calor se
 * calculan en la zona del negocio ($1 = TZ_NEGOCIO). Sin esto, a las
 * 8 p. m. de Bogotá (01:00 UTC) "hoy" ya sería mañana.
 *   fecha_txn AT TIME ZONE 'America/Bogota' → hora local sin zona
 *
 * Los periodos se miden por la fecha de la TRANSACCIÓN (fecha_txn).
 */
const { consultar } = require('../db/pool');

async function tarjetas(tz) {
  const r = await consultar(
    `WITH ahora AS (SELECT (NOW() AT TIME ZONE $1) AS l),
     t AS (SELECT tr.*, tr.fecha_txn AT TIME ZONE $1 AS fl FROM transacciones tr),
     an AS (SELECT a.*, t.fl, t.valor, t.usuario_id FROM anomalias a JOIN t ON t.id = a.transaccion_id)
     SELECT
       (SELECT COUNT(*) FROM t, ahora WHERE date_trunc('day',   t.fl) = date_trunc('day',   ahora.l))::int AS transacciones_hoy,
       (SELECT COUNT(*) FROM t, ahora WHERE date_trunc('week',  t.fl) = date_trunc('week',  ahora.l))::int AS transacciones_semana,
       (SELECT COUNT(*) FROM t, ahora WHERE date_trunc('month', t.fl) = date_trunc('month', ahora.l))::int AS transacciones_mes,
       (SELECT COUNT(*) FROM an, ahora WHERE date_trunc('day',   an.fl) = date_trunc('day',   ahora.l))::int AS anomalias_hoy,
       (SELECT COUNT(*) FROM an, ahora WHERE date_trunc('week',  an.fl) = date_trunc('week',  ahora.l))::int AS anomalias_semana,
       (SELECT COUNT(*) FROM an, ahora WHERE date_trunc('month', an.fl) = date_trunc('month', ahora.l))::int AS anomalias_mes,
       (SELECT COUNT(*) FROM t)::int  AS transacciones_total,
       (SELECT COUNT(*) FROM an)::int AS anomalias_total,
       (SELECT COUNT(*) FROM t WHERE estado = 'ANOMALA')::int AS transacciones_anomalas,
       (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE estado = 'ANOMALA') / NULLIF(COUNT(*), 0), 2) FROM t) AS porcentaje_anomalas,
       (SELECT COUNT(DISTINCT usuario_id) FROM t WHERE estado = 'ANOMALA')::int AS usuarios_afectados,
       (SELECT COALESCE(SUM(valor), 0) FROM t WHERE estado = 'ANOMALA') AS valor_sospechoso,
       (SELECT COUNT(*) FROM usuarios)::int AS usuarios_total,
       (SELECT ROUND(COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM usuarios), 0), 2) FROM t) AS promedio_transacciones_por_usuario`,
    [tz],
    { fn: 'estadisticas.tarjetas' },
  );
  const f = r.rows[0];
  // ROUND(...) devuelve NUMERIC; ya llega como Number por el type parser de pool.js.
  return f;
}

/** Usuarios con más anomalías (usuarios "recurrentes"). */
async function usuariosRecurrentes(limite = 10) {
  const r = await consultar(
    `SELECT u.id, u.email, u.estado,
            COUNT(a.id)::int                      AS anomalias,
            COUNT(DISTINCT t.id)::int             AS transacciones_anomalas,
            (SELECT COALESCE(SUM(tx.valor), 0) FROM transacciones tx
              WHERE tx.usuario_id = u.id AND tx.estado = 'ANOMALA') AS valor_sospechoso,
            MAX(t.fecha_txn)                      AS ultima_anomalia,
            (SELECT COUNT(*) FROM transacciones tx WHERE tx.usuario_id = u.id)::int AS transacciones_total
       FROM anomalias a
       JOIN transacciones t ON t.id = a.transaccion_id
       JOIN usuarios u ON u.id = t.usuario_id
      GROUP BY u.id
      ORDER BY anomalias DESC, ultima_anomalia DESC
      LIMIT $1`,
    [limite],
    { fn: 'estadisticas.usuariosRecurrentes' },
  );
  return r.rows;
}

/** "Casos más frecuentes": combinaciones tipo + nivel + método de pago. */
async function casosFrecuentes(limite = 10) {
  const r = await consultar(
    `SELECT a.tipo, a.nivel, t.metodo_pago, COUNT(*)::int AS cantidad,
            COUNT(DISTINCT t.usuario_id)::int AS usuarios, COALESCE(SUM(t.valor), 0) AS valor
       FROM anomalias a JOIN transacciones t ON t.id = a.transaccion_id
      GROUP BY a.tipo, a.nivel, t.metodo_pago
      ORDER BY cantidad DESC, a.tipo, a.nivel
      LIMIT $1`,
    [limite],
    { fn: 'estadisticas.casosFrecuentes' },
  );
  return r.rows;
}

/** Anomalías por día y tipo (últimos `dias` días con datos). */
async function evolucion(tz, dias = 90) {
  const r = await consultar(
    `SELECT to_char(date_trunc('day', t.fecha_txn AT TIME ZONE $1), 'YYYY-MM-DD') AS dia,
            COUNT(*) FILTER (WHERE a.tipo = 'POSIBLE_FRAUDE')::int        AS posible_fraude,
            COUNT(*) FILTER (WHERE a.tipo = 'EXCESO_FRANJA_HORARIA')::int AS exceso_franja,
            COUNT(*)::int AS total
       FROM anomalias a JOIN transacciones t ON t.id = a.transaccion_id
      WHERE t.fecha_txn >= (SELECT MAX(fecha_txn) FROM transacciones) - make_interval(days => $2)
      GROUP BY 1
      ORDER BY 1`,
    [tz, dias],
    { fn: 'estadisticas.evolucion' },
  );
  return r.rows;
}

/** Mapa de calor: día de la semana (1=lunes … 7=domingo) × hora local. */
async function mapaCalor(tz) {
  const r = await consultar(
    `SELECT EXTRACT(ISODOW FROM t.fecha_txn AT TIME ZONE $1)::int AS dia_semana,
            EXTRACT(HOUR   FROM t.fecha_txn AT TIME ZONE $1)::int AS hora,
            COUNT(*)::int AS cantidad
       FROM anomalias a JOIN transacciones t ON t.id = a.transaccion_id
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [tz],
    { fn: 'estadisticas.mapaCalor' },
  );
  return r.rows;
}

async function porNivel() {
  const r = await consultar(
    `SELECT a.nivel, COUNT(*)::int AS cantidad
       FROM anomalias a GROUP BY a.nivel
      ORDER BY CASE a.nivel WHEN 'BAJO' THEN 1 WHEN 'MEDIO' THEN 2 ELSE 3 END`,
    [],
    { fn: 'estadisticas.porNivel' },
  );
  return r.rows;
}

async function porTipo() {
  const r = await consultar(
    'SELECT a.tipo, COUNT(*)::int AS cantidad FROM anomalias a GROUP BY a.tipo ORDER BY cantidad DESC',
    [],
    { fn: 'estadisticas.porTipo' },
  );
  return r.rows;
}

/** Por método de pago: total de transacciones, anómalas y anomalías. */
async function porMetodoPago() {
  const r = await consultar(
    `SELECT t.metodo_pago,
            COUNT(*)::int AS transacciones,
            COUNT(*) FILTER (WHERE t.estado = 'ANOMALA')::int AS transacciones_anomalas,
            COALESCE(SUM(an.n), 0)::int AS anomalias,
            COALESCE(SUM(t.valor) FILTER (WHERE t.estado = 'ANOMALA'), 0) AS valor_sospechoso
       FROM transacciones t
       LEFT JOIN (SELECT transaccion_id, COUNT(*) AS n FROM anomalias GROUP BY transaccion_id) an ON an.transaccion_id = t.id
      GROUP BY t.metodo_pago
      ORDER BY anomalias DESC, transacciones DESC`,
    [],
    { fn: 'estadisticas.porMetodoPago' },
  );
  return r.rows;
}

module.exports = { tarjetas, usuariosRecurrentes, casosFrecuentes, evolucion, mapaCalor, porNivel, porTipo, porMetodoPago };
