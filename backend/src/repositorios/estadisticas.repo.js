const { consultar } = require('../db/pool');
const { horaASegundos } = require('../config/reglas');

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
       (SELECT COUNT(*) FROM t, ahora WHERE t.fl >= date_trunc('day',   ahora.l) - interval '1 day'   AND t.fl < ahora.l - interval '1 day')::int   AS transacciones_ayer,
       (SELECT COUNT(*) FROM t, ahora WHERE t.fl >= date_trunc('week',  ahora.l) - interval '1 week'  AND t.fl < ahora.l - interval '1 week')::int  AS transacciones_semana_anterior,
       (SELECT COUNT(*) FROM t, ahora WHERE t.fl >= date_trunc('month', ahora.l) - interval '1 month' AND t.fl < ahora.l - interval '1 month')::int AS transacciones_mes_anterior,
       (SELECT COUNT(*) FROM an, ahora WHERE an.fl >= date_trunc('day',   ahora.l) - interval '1 day'   AND an.fl < ahora.l - interval '1 day')::int   AS anomalias_ayer,
       (SELECT COUNT(*) FROM an, ahora WHERE an.fl >= date_trunc('week',  ahora.l) - interval '1 week'  AND an.fl < ahora.l - interval '1 week')::int  AS anomalias_semana_anterior,
       (SELECT COUNT(*) FROM an, ahora WHERE an.fl >= date_trunc('month', ahora.l) - interval '1 month' AND an.fl < ahora.l - interval '1 month')::int AS anomalias_mes_anterior,
       (SELECT COUNT(*) FROM anomalias WHERE estado_revision = 'NUEVA')::int      AS revision_nuevas,
       (SELECT COUNT(*) FROM anomalias WHERE estado_revision = 'ABIERTA')::int    AS revision_abiertas,
       (SELECT COUNT(*) FROM anomalias WHERE estado_revision = 'REVISADA')::int   AS revision_revisadas,
       (SELECT COUNT(*) FROM anomalias WHERE estado_revision = 'DESCARTADA')::int AS revision_descartadas,
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
  return f;
}

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

async function evolucion(tz, dias = 90) {
  const r = await consultar(
    `WITH d AS (
       SELECT (t.fecha_txn AT TIME ZONE $1)::date AS dia, COUNT(*)::int AS total
         FROM anomalias a JOIN transacciones t ON t.id = a.transaccion_id
        WHERE t.fecha_txn >= (SELECT MAX(fecha_txn) FROM transacciones) - make_interval(days => $2)
        GROUP BY 1
     ),
     s AS (
       SELECT g::date AS dia, COALESCE(d.total, 0) AS total
         FROM generate_series((SELECT MIN(dia) FROM d), (SELECT MAX(dia) FROM d), interval '1 day') AS g
         LEFT JOIN d ON d.dia = g::date
     ),
     m AS (
       SELECT dia, total,
              AVG(total) OVER (ORDER BY dia ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS media_movil,
              AVG(total) OVER (ORDER BY dia ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS promedio_previo,
              COUNT(*)   OVER (ORDER BY dia ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS dias_previos
         FROM s
     )
     SELECT to_char(dia, 'YYYY-MM-DD') AS dia, total,
            ROUND(media_movil, 2) AS media_movil,
            ROUND(COALESCE(promedio_previo, 0), 2) AS promedio_previo,
            (dias_previos >= 3 AND total >= 3 AND total >= 2 * COALESCE(promedio_previo, 0)) AS pico
       FROM m
      ORDER BY dia`,
    [tz, dias],
    { fn: 'estadisticas.evolucion' },
  );
  return r.rows;
}

async function porHora(tz) {
  const r = await consultar(
    `SELECT h.hora,
            COALESCE(tx.n, 0)::int AS transacciones,
            COALESCE(an.n, 0)::int AS anomalias
       FROM generate_series(0, 23) AS h(hora)
       LEFT JOIN (SELECT EXTRACT(HOUR FROM fecha_txn AT TIME ZONE $1)::int AS hora, COUNT(*) AS n
                    FROM transacciones GROUP BY 1) tx ON tx.hora = h.hora
       LEFT JOIN (SELECT EXTRACT(HOUR FROM t.fecha_txn AT TIME ZONE $1)::int AS hora, COUNT(*) AS n
                    FROM anomalias a JOIN transacciones t ON t.id = a.transaccion_id GROUP BY 1) an ON an.hora = h.hora
      ORDER BY h.hora`,
    [tz],
    { fn: 'estadisticas.porHora' },
  );
  return r.rows;
}

async function porFranja(tz, franjas) {
  const r = await consultar(
    `WITH f AS (
       SELECT * FROM unnest($2::text[], $3::int[], $4::int[]) WITH ORDINALITY AS f(nombre, desde, hasta, orden)
     ),
     t AS (
       SELECT tr.id, tr.usuario_id, tr.estado, COALESCE(an.n, 0) AS anomalias,
              FLOOR(EXTRACT(EPOCH FROM (tr.fecha_txn AT TIME ZONE $1)::time))::int AS seg
         FROM transacciones tr
         LEFT JOIN (SELECT transaccion_id, COUNT(*) AS n FROM anomalias GROUP BY 1) an ON an.transaccion_id = tr.id
     )
     SELECT f.nombre,
            COUNT(t.id)::int AS transacciones,
            COUNT(t.id) FILTER (WHERE t.estado = 'ANOMALA')::int AS transacciones_anomalas,
            COALESCE(SUM(t.anomalias), 0)::int AS anomalias,
            COUNT(DISTINCT t.usuario_id)::int AS usuarios
       FROM f
       LEFT JOIN t ON CASE WHEN f.desde <= f.hasta THEN t.seg BETWEEN f.desde AND f.hasta
                           ELSE t.seg >= f.desde OR t.seg <= f.hasta END
      GROUP BY f.nombre, f.orden
      ORDER BY f.orden`,
    [tz, franjas.map((f) => f.nombre), franjas.map((f) => horaASegundos(f.desde)), franjas.map((f) => horaASegundos(f.hasta))],
    { fn: 'estadisticas.porFranja' },
  );
  return r.rows;
}

async function porCantidad() {
  const r = await consultar(
    `SELECT LEAST(a.cantidad_transacciones, 6)::int AS grupo,
            COUNT(*)::int AS anomalias,
            COUNT(DISTINCT t.usuario_id)::int AS usuarios
       FROM anomalias a JOIN transacciones t ON t.id = a.transaccion_id
      GROUP BY 1
      ORDER BY 1`,
    [],
    { fn: 'estadisticas.porCantidad' },
  );
  return r.rows;
}

async function rafagaMayor() {
  const r = await consultar(
    `SELECT a.id, a.cantidad_transacciones, a.ventana_segundos, u.email, t.fecha_txn
       FROM anomalias a
       JOIN transacciones t ON t.id = a.transaccion_id
       JOIN usuarios u ON u.id = t.usuario_id
      ORDER BY a.cantidad_transacciones DESC, t.fecha_txn DESC
      LIMIT 1`,
    [],
    { fn: 'estadisticas.rafagaMayor' },
  );
  return r.rows[0] || null;
}

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

module.exports = {
  tarjetas, usuariosRecurrentes, casosFrecuentes, evolucion, mapaCalor, porHora, porFranja, porCantidad, rafagaMayor, porNivel, porTipo, porMetodoPago,
};
