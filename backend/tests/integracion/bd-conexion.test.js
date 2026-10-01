/**
 * Fase 1 — Base de datos y conexión.
 * Verifica el esquema, las restricciones, el trigger de fecha_actualizacion,
 * la traducción de errores de PostgreSQL y el endpoint /api/health.
 */
const request = require('supertest');
const { Client } = require('pg');
const env = require('../../src/config/env');
const { crearApp } = require('../../src/app');
const { verificarEsquema } = require('../../src/db/verificarEsquema');
const { traducirErrorPg } = require('../../src/errores/traductorPg');
const { consultar } = require('../../src/db/pool');
const { limpiarBd, cerrarBd, pool } = require('../setup/utilBd');

const app = crearApp();
const HASH = 'a'.repeat(64);

beforeEach(limpiarBd);
afterAll(cerrarBd);

async function crearUsuario(email = 'aa@aa.com', estado = 'ACTIVO') {
  const r = await pool.query('INSERT INTO usuarios (nombre, email, estado) VALUES ($1, $2, $3) RETURNING *', [email.split('@')[0], email, estado]);
  return r.rows[0];
}

describe('Esquema', () => {
  test('usa la base de datos de pruebas, nunca la real', () => {
    expect(env.PGDATABASE).toBe(env.PGDATABASE_TEST);
  });

  test('verificarEsquema encuentra las 3 tablas con todas sus columnas', async () => {
    const r = await verificarEsquema();
    expect(r.problemas).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('el trigger actualiza fecha_actualizacion en cada UPDATE', async () => {
    const u = await crearUsuario();
    await new Promise((res) => setTimeout(res, 20));
    const r = await pool.query("UPDATE usuarios SET estado = 'INACTIVO' WHERE id = $1 RETURNING fecha_creacion, fecha_actualizacion", [u.id]);
    expect(r.rows[0].fecha_actualizacion.getTime()).toBeGreaterThan(r.rows[0].fecha_creacion.getTime());
  });

  test('fecha_txn conserva los milisegundos', async () => {
    const u = await crearUsuario();
    await pool.query('INSERT INTO transacciones (id, usuario_id, valor, fecha_txn, hash, metodo_pago) VALUES ($1,$2,$3,$4,$5,$6)', [1, u.id, 100, '2026-09-23T10:30:01.120-05:00', HASH, 'Tarjeta']);
    const r = await pool.query('SELECT fecha_txn FROM transacciones WHERE id = 1');
    expect(r.rows[0].fecha_txn.toISOString()).toBe('2026-09-23T15:30:01.120Z');
  });

  test('borrar una transacción borra sus anomalías (ON DELETE CASCADE)', async () => {
    const u = await crearUsuario();
    await pool.query('INSERT INTO transacciones (id, usuario_id, valor, fecha_txn, hash, metodo_pago, estado) VALUES (1,$1,100,NOW(),$2,$3,$4)', [u.id, HASH, 'Nequi', 'ANOMALA']);
    await pool.query("INSERT INTO anomalias (transaccion_id, tipo, nivel, cantidad_transacciones, ventana_segundos) VALUES (1, 'POSIBLE_FRAUDE', 'BAJO', 3, 3)");
    await pool.query('DELETE FROM transacciones WHERE id = 1');
    const r = await pool.query('SELECT COUNT(*)::int AS n FROM anomalias');
    expect(r.rows[0].n).toBe(0);
  });
});

describe('Traducción de errores de PostgreSQL', () => {
  test('23505: idTxn duplicado → mensaje claro con el id', async () => {
    const u = await crearUsuario();
    const sql = 'INSERT INTO transacciones (id, usuario_id, valor, fecha_txn, hash, metodo_pago) VALUES ($1,$2,$3,NOW(),$4,$5)';
    await consultar(sql, [10003, u.id, 100, HASH, 'Tarjeta']);
    await expect(consultar(sql, [10003, u.id, 100, HASH, 'Tarjeta'])).rejects.toMatchObject({
      codigo: 'DUPLICADO',
      message: 'idTxn=10003 ya existe en transacciones (violación de llave única)',
    });
  });

  test('23514: CHECK violado (valor = 0) → nombra la restricción', async () => {
    const u = await crearUsuario();
    const err = await consultar('INSERT INTO transacciones (id, usuario_id, valor, fecha_txn, hash, metodo_pago) VALUES (1,$1,0,NOW(),$2,$3)', [u.id, HASH, 'Tarjeta']).catch((e) => e);
    expect(err.codigo).toBe('VALOR_NO_PERMITIDO');
    expect(err.message).toContain('ck_transacciones_valor');
    expect(err.errores[0].codigoPg).toBe('23514');
  });

  test('23503: llave foránea (usuario inexistente)', async () => {
    const err = await consultar('INSERT INTO transacciones (id, usuario_id, valor, fecha_txn, hash, metodo_pago) VALUES (1,999,10,NOW(),$1,$2)', [HASH, 'Tarjeta']).catch((e) => e);
    expect(err.codigo).toBe('LLAVE_FORANEA');
    expect(err.message).toContain('usuario_id=999');
  });

  test('22P02: tipo inválido', async () => {
    const err = await consultar('SELECT $1::bigint', ['abc']).catch((e) => e);
    expect(err.codigo).toBe('TIPO_INVALIDO');
    expect(err.errores[0].codigoPg).toBe('22P02');
  });

  test('42P01: tabla inexistente → sugiere ejecutar schema.sql', async () => {
    const err = await consultar('SELECT * FROM tabla_que_no_existe').catch((e) => e);
    expect(err.codigo).toBe('BD_TABLA_NO_EXISTE');
    expect(err.message).toContain('schema.sql');
  });

  test('ECONNREFUSED: indica host, puerto y base, sin la contraseña', async () => {
    const c = new Client({ host: '127.0.0.1', port: 1, user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE, connectionTimeoutMillis: 3000 });
    const err = await c.connect().catch((e) => e);
    const t = traducirErrorPg(err);
    expect(t.codigo).toBe('BD_SIN_CONEXION');
    expect(t.mensaje).toContain(`base_de_datos=${env.PGDATABASE}`);
    expect(t.mensaje).not.toContain(env.PGPASSWORD);
  });

  test('28P01: contraseña incorrecta → mensaje de credenciales', async () => {
    const c = new Client({ host: env.PGHOST, port: env.PGPORT, user: env.PGUSER, password: 'clave-incorrecta-xyz', database: env.PGDATABASE });
    const err = await c.connect().catch((e) => e);
    const t = traducirErrorPg(err);
    expect(t.original.codigoPg).toBe('28P01');
    expect(t.codigo).toBe('BD_CREDENCIALES');
    expect(t.mensaje).toContain('PGPASSWORD');
    expect(t.mensaje).not.toContain('clave-incorrecta-xyz');
  });
});

describe('GET /api/health', () => {
  test('200 con la BD conectada y requestId', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.baseDeDatos.estado).toBe('CONECTADA');
    expect(r.body.requestId).toBe(r.headers['x-request-id']);
  });

  test('ruta inexistente → 404 con estructura fija de error', async () => {
    const r = await request(app).get('/api/no-existe');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ ok: false, etapa: 'RECEPCION', errores: [{ codigo: 'RUTA_NO_ENCONTRADA' }] });
    expect(r.body.requestId).toBeTruthy();
  });

  test('JSON malformado → 400 con línea y columna', async () => {
    const r = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{"idTxn": 1,, }');
    expect(r.status).toBe(400);
    expect(r.body.etapa).toBe('PARSEO_JSON');
    expect(r.body.errores[0].codigo).toBe('JSON_MALFORMADO');
    expect(r.body.errores[0].mensaje).toMatch(/línea 1, columna \d+/);
  });
});
