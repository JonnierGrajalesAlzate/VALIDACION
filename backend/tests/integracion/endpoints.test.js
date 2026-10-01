/**
 * Endpoints de consulta y administración.
 */
const request = require('supertest');
const { crearApp } = require('../../src/app');
const { limpiarBd, cerrarBd, restablecerReglas, pool } = require('../setup/utilBd');
const { txn } = require('../setup/utilTxn');

const app = crearApp();

let lote;
beforeAll(async () => {
  await limpiarBd();
  restablecerReglas();
  lote = [
    ...['10:00:01', '10:00:02', '10:00:03'].map((h) => txn({ user: 'b@b.com', date: `2026-09-23T${h}`, paymentMethod: 'Nequi' })),
    ...['10:00:01', '10:00:10', '10:01:20'].map((h) => txn({ user: 'c@c.com', date: `2026-09-23T${h}` })),
  ];
  await request(app).post('/api/transacciones').send(lote).expect(201);
});
afterAll(cerrarBd);

describe('GET /api/transacciones', () => {
  test('lista con total y fechas en hora del negocio', async () => {
    const r = await request(app).get('/api/transacciones');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(6);
    expect(r.body.datos[0].fecha).toMatch(/-05:00$/);
  });

  test('filtros: usuario, estado y rango de fechas', async () => {
    expect((await request(app).get('/api/transacciones?usuario=b@b.com')).body.total).toBe(3);
    expect((await request(app).get('/api/transacciones?estado=ANOMALA')).body.datos.map((d) => d.idTxn)).toEqual([lote[2].idTxn]);
    expect((await request(app).get('/api/transacciones?desde=2026-09-23T10:00:05&hasta=2026-09-23T10:00:30')).body.total).toBe(1);
    expect((await request(app).get('/api/transacciones?desde=2026-09-23&hasta=2026-09-23')).body.total).toBe(6);
  });

  test('paginación', async () => {
    const r = await request(app).get('/api/transacciones?limite=2&pagina=2');
    expect(r.body.datos).toHaveLength(2);
    expect(r.body.total).toBe(6);
  });

  test('parámetro desconocido o inválido → 422 con el detalle', async () => {
    const r = await request(app).get('/api/transacciones?estdo=ANOMALA&limite=abc');
    expect(r.status).toBe(422);
    expect(r.body.errores.map((e) => e.campo).sort()).toEqual(['estdo', 'limite']);
  });

  test('estado con valor no permitido → 422 lista los valores', async () => {
    const r = await request(app).get('/api/transacciones?estado=OTRO');
    expect(r.body.errores[0].mensaje).toContain('VALIDA, ANOMALA');
  });
});

describe('GET /api/usuarios y PATCH /api/usuarios/:id', () => {
  test('lista usuarios con conteos de transacciones y anomalías', async () => {
    const r = await request(app).get('/api/usuarios');
    const b = r.body.datos.find((u) => u.email === 'b@b.com');
    expect(b).toMatchObject({ totalTransacciones: 3, totalAnomalias: 1, transaccionesAnomalas: 1, estado: 'ACTIVO' });
  });

  test('PATCH cambia el estado y la fecha_actualizacion', async () => {
    const id = (await pool.query("SELECT id FROM usuarios WHERE email = 'c@c.com'")).rows[0].id;
    const r = await request(app).patch(`/api/usuarios/${id}`).send({ estado: 'INACTIVO' });
    expect(r.status).toBe(200);
    expect(r.body.usuario.estado).toBe('INACTIVO');
    // Ahora una transacción de c@c.com se rechaza
    const t = await request(app).post('/api/transacciones').send(txn({ user: 'c@c.com', date: '2026-09-24T10:00:00' }));
    expect(t.body.errores[0].codigo).toBe('USUARIO_INACTIVO');
    await request(app).patch(`/api/usuarios/${id}`).send({ estado: 'ACTIVO' }).expect(200);
  });

  test('PATCH estricto: estado inválido o campo extra → 422', async () => {
    const r1 = await request(app).patch('/api/usuarios/1').send({ estado: 'BORRADO' });
    expect(r1.status).toBe(422);
    const r2 = await request(app).patch('/api/usuarios/1').send({ estado: 'ACTIVO', email: 'x@x.com' });
    expect(r2.status).toBe(422);
    expect(r2.body.errores[0]).toMatchObject({ campo: 'email', codigo: 'PARAMETRO_INVALIDO' });
  });

  test('PATCH usuario inexistente → 404; id no numérico → 422', async () => {
    expect((await request(app).patch('/api/usuarios/999999').send({ estado: 'ACTIVO' })).status).toBe(404);
    expect((await request(app).patch('/api/usuarios/abc').send({ estado: 'ACTIVO' })).status).toBe(422);
  });
});

describe('GET /api/anomalias', () => {
  test('lista y filtra por tipo, nivel y usuario', async () => {
    const r = await request(app).get('/api/anomalias?tipo=POSIBLE_FRAUDE&nivel=BAJO&usuario=b@b');
    expect(r.body.total).toBe(1);
    expect(r.body.datos[0]).toMatchObject({ idTxn: lote[2].idTxn, usuario: 'b@b.com', cantidadTransacciones: 3, metodoPago: 'Nequi' });
  });

  test('detalle con línea de tiempo y recorrido de la ventana', async () => {
    const id = (await request(app).get('/api/anomalias')).body.datos[0].id;
    const r = await request(app).get(`/api/anomalias/${id}`);
    expect(r.status).toBe(200);
    const lt = r.body.lineaTiempo;
    expect(lt.involucradas.sort()).toEqual(lote.slice(0, 3).map((t) => t.idTxn).sort());
    expect(lt.transacciones.find((t) => t.esDisparadora).idTxn).toBe(lote[2].idTxn);
    const paso = lt.pasos.find((p) => p.esPasoDisparo);
    expect(paso).toMatchObject({ entro: lote[2].idTxn, conteo: 3 });
  });

  test('anomalía inexistente → 404', async () => {
    const r = await request(app).get('/api/anomalias/999999');
    expect(r.status).toBe(404);
    expect(r.body.errores[0].codigo).toBe('NO_ENCONTRADO');
  });
});

describe('GET /api/estadisticas', () => {
  test('devuelve tarjetas, tablas y series', async () => {
    const r = await request(app).get('/api/estadisticas');
    expect(r.status).toBe(200);
    expect(r.body.tarjetas).toMatchObject({ transaccionesAnomalas: 1, usuariosAfectados: 1, valorSospechoso: 50000 });
    expect(r.body.tarjetas.porcentajeAnomalas).toBeCloseTo(16.67, 2);
    expect(r.body.tarjetas.anomalias.mes).toBe(1); // 23/09/2026 está en el mes de "hoy" (septiembre de 2026)
    expect(r.body.porTipo).toEqual([{ tipo: 'POSIBLE_FRAUDE', cantidad: 1 }]);
    expect(r.body.mapaCalor).toEqual([{ diaSemana: 3, hora: 10, cantidad: 1 }]); // miércoles 10 a. m.
    expect(r.body.usuariosRecurrentes[0]).toMatchObject({ email: 'b@b.com', anomalias: 1 });
    expect(r.body.casosFrecuentes[0]).toMatchObject({ tipo: 'POSIBLE_FRAUDE', nivel: 'BAJO', metodoPago: 'Nequi', cantidad: 1 });
    expect(r.body.evolucion).toEqual([{ dia: '2026-09-23', posibleFraude: 1, excesoFranja: 0, total: 1 }]);
  });
});

describe('/api/config', () => {
  test('GET devuelve las reglas', async () => {
    const r = await request(app).get('/api/config');
    expect(r.body.reglas.ventanaDeslizante).toEqual({ segundos: 3, umbral: 3 });
  });

  test('PUT inválido (franjas con hueco, umbral 1) → 422 con cada problema', async () => {
    const cfg = (await request(app).get('/api/config')).body.reglas;
    const malas = { ...cfg, ventanaDeslizante: { segundos: 3, umbral: 1 } };
    malas.franjasHorarias = { ...cfg.franjasHorarias, franjas: cfg.franjasHorarias.franjas.slice(0, 2) };
    const r = await request(app).put('/api/config').send(malas);
    expect(r.status).toBe(422);
    const campos = r.body.errores.map((e) => e.campo);
    expect(campos).toContain('ventanaDeslizante.umbral');
    expect(campos).toContain('franjasHorarias.franjas');
    expect(r.body.errores.find((e) => e.campo === 'franjasHorarias.franjas').mensaje).toContain('sin cubrir');
  });
});

describe('DELETE /api/transacciones/:id', () => {
  test('elimina la transacción y sus anomalías', async () => {
    const r = await request(app).delete(`/api/transacciones/${lote[2].idTxn}`);
    expect(r.status).toBe(200);
    expect(r.body.anomaliasEliminadas).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM anomalias')).rows[0].n).toBe(0);
  });

  test('inexistente → 404', async () => {
    expect((await request(app).delete('/api/transacciones/123456789')).status).toBe(404);
  });
});

describe('POST /api/dev/calcular-hash', () => {
  test('NO existe fuera de development (aquí NODE_ENV=test) → 404', async () => {
    expect((await request(app).post('/api/dev/calcular-hash').send({ idTxn: 1 })).status).toBe(404);
  });

  test('con las rutas de desarrollo activas devuelve un hash que la API acepta', async () => {
    const appDev = crearApp({ rutasDev: true });
    const datos = { idTxn: 777001, user: 'dev@d.com', date: '2026-09-25T09:00:00', value: 1234.5, paymentMethod: 'Efectivo' };
    const h = await request(appDev).post('/api/dev/calcular-hash').send(datos);
    expect(h.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.body.cadenaFirmada).toBe('{"date":"2026-09-25T09:00:00","idTxn":777001,"paymentMethod":"Efectivo","user":"dev@d.com","value":1234.5}');
    expect((await request(appDev).post('/api/transacciones').send(h.body.transaccion)).status).toBe(201);
  });
});
