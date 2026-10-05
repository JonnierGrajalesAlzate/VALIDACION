const fs = require('fs');
const path = require('path');
const env = require('../src/config/env');
const reglas = require('../src/config/reglas');
const { detectarAnomalias } = require('../src/ventana/ventanaDeslizante');
const { parsearFechaIso } = require('../src/validacion/fechas');
const { generarTransacciones, firmar } = require('./lib/generador');

const R = reglas.obtener();
const ID_INICIAL = 900001;

let id = ID_INICIAL;
const caso = (user, hora, metodo = 'Tarjeta') => ({ idTxn: id++, user, date: `2026-09-01T${hora}`, value: 9500, paymentMethod: metodo });
const casos = [
  caso('b@b.com', '10:00:01.000', 'Nequi'), caso('b@b.com', '10:00:02.000', 'Nequi'), caso('b@b.com', '10:00:03.000', 'Nequi'),
  caso('c@c.com', '10:00:01.000'), caso('c@c.com', '10:00:10.000'), caso('c@c.com', '10:01:20.000'),
  caso('d@d.com', '10:00:01.000'), caso('e@e.com', '10:00:02.000'), caso('f@f.com', '10:00:03.000'),
];

const inactivo = [
  { idTxn: id++, user: 'inactivo@appresso.com', date: '2026-09-01T08:15:00.000', value: 6000, paymentMethod: 'Efectivo' },
  { idTxn: id++, user: 'inactivo@appresso.com', date: '2026-09-01T08:45:30.250', value: 7800, paymentMethod: 'Efectivo' },
];

const usuarios = ['ana@appresso.com', 'luis@appresso.com', 'maria@appresso.com', 'jorge@appresso.com', 'sofia@appresso.com',
  'camilo@appresso.com', 'valentina@appresso.com', 'andres@appresso.com', 'b@b.com', 'aa@aa.com'];
const mes = generarTransacciones({ desde: '2026-09-02', dias: 29, usuarios, porDia: 12, rafagas: 14, idInicial: id, semilla: 2026 });

const todas = [...casos, ...inactivo, ...mes].map(firmar);

const conMs = todas.map((t) => ({ ...t, fechaMs: parsearFechaIso(t.date).fecha.toMillis() }));
const deteccion = detectarAnomalias({ historico: [], nuevas: conMs.map((t) => ({ id: t.idTxn, email: t.user, fechaMs: t.fechaMs })), reglas: R });

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const emails = [...new Set(todas.map((t) => t.user))].sort();
const lineas = [];
lineas.push(`-- =====================================================================
--  Appresso — Datos de ejemplo (GENERADO por backend/scripts/generar-seed.js)
--  No editar a mano: modifique el script y ejecute  npm run generar:seed
--
--  Ejecútelo en pgAdmin 4 (Query Tool) DESPUÉS de schema.sql, con las
--  tablas vacías (si ya hay datos: database/limpiar-datos.sql).
--
--  Hashes firmados con HMAC_SECRET = "${env.HMAC_SECRET}"
--  (si su .env usa otra llave, regenere el seed).
--  Umbral: ${R.ventanaDeslizante.umbral}; ventana ${R.franjasHorarias.activo ? `según la franja: ${R.franjasHorarias.franjas.map((f) => `${f.nombre} ${f.segundosVentana} s`).join(', ')}` : `fija de ${R.ventanaDeslizante.segundos} s`}.
--
--  Casos de uso (01/09/2026, ids ${ID_INICIAL}–${ID_INICIAL + 8}):
--    1. b@b.com 10:00:01, :02, :03          → ANOMALÍA en la tercera (${ID_INICIAL + 2})
--    2. c@c.com 10:00:01, 10:00:10, 10:01:20 → NORMAL
--    3. d@d.com, e@e.com, f@f.com            → NORMAL (ventanas separadas)
--  Usuario INACTIVO: inactivo@appresso.com
--  Total: ${todas.length} transacciones, ${emails.length} usuarios.
-- =====================================================================

BEGIN;
`);

lineas.push('-- Usuarios (nombre = parte local del correo, como hace la API)');
lineas.push('INSERT INTO usuarios (nombre, email, estado) VALUES');
lineas.push(`${emails.map((e) => `  (${q(e.split('@')[0])}, ${q(e)}, ${q(e === 'inactivo@appresso.com' ? 'INACTIVO' : 'ACTIVO')})`).join(',\n')};\n`);

lineas.push('-- Transacciones (usuario_id se busca por correo)');
lineas.push('INSERT INTO transacciones (id, usuario_id, valor, fecha_txn, estado, hash, metodo_pago)');
lineas.push('SELECT v.id, u.id, v.valor, v.fecha_txn, v.estado, v.hash, v.metodo_pago FROM (VALUES');
lineas.push(`${conMs
  .sort((a, b) => a.fechaMs - b.fechaMs)
  .map((t) => `  (${t.idTxn}, ${q(t.user)}, ${t.value}, ${q(`${t.date}-05:00`)}::timestamptz, ${q(deteccion.get(t.idTxn).estado)}, ${q(t.hash)}, ${q(t.paymentMethod)})`)
  .join(',\n')}`);
lineas.push(') AS v(id, email, valor, fecha_txn, estado, hash, metodo_pago)\nJOIN usuarios u ON u.email = v.email;\n');

const fechaMsDe = new Map(conMs.map((t) => [t.idTxn, t.fechaMs]));
const anomalias = [];
for (const [idTxn, r] of deteccion) for (const a of r.anomalias) anomalias.push({ idTxn, fechaMs: fechaMsDe.get(idTxn), ...a });

const ultimaMs = Math.max(...anomalias.map((a) => a.fechaMs));
const CICLO = [
  { estado: 'REVISADA', nota: 'Cliente confirmó que no reconoce las compras; tarjeta bloqueada' },
  { estado: 'DESCARTADA', nota: 'Falso positivo: pedido grupal en la barra' },
  { estado: 'ABIERTA', nota: null },
  { estado: 'REVISADA', nota: 'Ráfaga confirmada con el punto de venta' },
];
let iCiclo = 0;
for (const a of anomalias.sort((x, y) => x.fechaMs - y.fechaMs || x.idTxn - y.idTxn)) {
  const reciente = ultimaMs - a.fechaMs < 7 * 86400000;
  const r = reciente ? { estado: 'NUEVA', nota: null } : CICLO[iCiclo++ % CICLO.length];
  a.estadoRevision = r.estado;
  a.notaRevision = r.nota;
  a.fechaRevision = ['REVISADA', 'DESCARTADA'].includes(r.estado) ? new Date(a.fechaMs + 86400000).toISOString() : null;
}
if (anomalias.length) {
  lineas.push('-- Anomalías (calculadas con el algoritmo de ventana deslizante de la API)');
  lineas.push('INSERT INTO anomalias (transaccion_id, tipo, nivel, cantidad_transacciones, ventana_segundos, estado_revision, nota_revision, fecha_revision) VALUES');
  const sql = (v) => (v === null ? 'NULL' : q(v));
  lineas.push(`${anomalias.map((a) => `  (${a.idTxn}, ${q(a.tipo)}, ${q(a.nivel)}, ${a.cantidad}, ${a.ventanaSegundos}, ${q(a.estadoRevision)}, ${sql(a.notaRevision)}, ${a.fechaRevision ? `${q(a.fechaRevision)}::timestamptz` : 'NULL'})`).join(',\n')};\n`);
}
lineas.push('COMMIT;\n');

const ruta = path.join(__dirname, '..', '..', 'database', 'seed.sql');
fs.writeFileSync(ruta, lineas.join('\n'), 'utf8');
const porRevision = anomalias.reduce((m, a) => ({ ...m, [a.estadoRevision]: (m[a.estadoRevision] || 0) + 1 }), {});
console.log(`[OK] ${path.normalize(ruta)}: ${todas.length} transacciones, ${emails.length} usuarios, ${anomalias.length} anomalías ${JSON.stringify(porRevision)}`);
