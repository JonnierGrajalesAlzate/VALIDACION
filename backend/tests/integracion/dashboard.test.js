const request = require('supertest');
const { DateTime } = require('luxon');
const { crearApp } = require('../../src/app');
const env = require('../../src/config/env');
const { limpiarBd, cerrarBd, restablecerReglas, pool } = require('../setup/utilBd');
const { txn } = require('../setup/utilTxn');

const app = crearApp();
const enviar = (cuerpo) => request(app).post('/api/transacciones').send(cuerpo);
const estadisticas = async () => (await request(app).get('/api/estadisticas').expect(200)).body;

const rafaga3 = (user, dia, hora) => ['01', '02', '03'].map((s) => txn({ user, date: `${dia}T${hora}:${s}` }));

beforeAll(async () => {
  await limpiarBd();
  restablecerReglas();
  const noche = ['00.0', '00.5', '01.0', '01.5', '02.0', '02.5'].map((s) => txn({ user: 'noche@n.com', date: `2026-08-05T22:00:${s}` }));
  await enviar([...rafaga3('a@a.com', '2026-08-01', '10:00'), ...rafaga3('a@a.com', '2026-08-04', '10:00'), ...noche]).expect(201);
});
afterAll(cerrarBd);

describe('Estados de revisión: PATCH /api/anomalias/:id', () => {
  let id;
  beforeAll(async () => {
    id = (await request(app).get('/api/anomalias?usuario=a@a.com')).body.datos[0].id;
  });

  test('toda anomalía nace NUEVA', async () => {
    const r = await request(app).get('/api/anomalias');
    expect(r.body.datos.map((a) => a.estadoRevision)).toEqual(Array(6).fill('NUEVA'));
    expect(r.body.datos[0]).toMatchObject({ notaRevision: null, fechaRevision: null });
  });

  test('ABIERTA → REVISADA con nota → fecha de revisión; DESCARTADA sin nota conserva la nota', async () => {
    const abierta = await request(app).patch(`/api/anomalias/${id}`).send({ estadoRevision: 'ABIERTA' });
    expect(abierta.status).toBe(200);
    expect(abierta.body.anomalia).toMatchObject({ id, estadoRevision: 'ABIERTA', fechaRevision: null });

    const revisada = await request(app).patch(`/api/anomalias/${id}`).send({ estadoRevision: 'REVISADA', nota: '  Cliente confirmó compras  ' });
    expect(revisada.body.anomalia).toMatchObject({ estadoRevision: 'REVISADA', notaRevision: 'Cliente confirmó compras' });
    expect(revisada.body.anomalia.fechaRevision).toMatch(/-05:00$/);

    const descartada = await request(app).patch(`/api/anomalias/${id}`).send({ estadoRevision: 'DESCARTADA' });
    expect(descartada.body.anomalia).toMatchObject({ estadoRevision: 'DESCARTADA', notaRevision: 'Cliente confirmó compras' });

    const reabierta = await request(app).patch(`/api/anomalias/${id}`).send({ estadoRevision: 'ABIERTA', nota: null });
    expect(reabierta.body.anomalia).toMatchObject({ estadoRevision: 'ABIERTA', notaRevision: null, fechaRevision: null });
  });

  test('el detalle (GET /:id) incluye el estado de revisión', async () => {
    const r = await request(app).get(`/api/anomalias/${id}`);
    expect(r.body.anomalia.estadoRevision).toBe('ABIERTA');
  });

  test('NUEVA no se asigna a mano; campo extra, nota larga o tipo incorrecto → 422', async () => {
    const nueva = await request(app).patch(`/api/anomalias/${id}`).send({ estadoRevision: 'NUEVA' });
    expect(nueva.status).toBe(422);
    expect(nueva.body.errores[0].mensaje).toContain('ABIERTA, REVISADA, DESCARTADA');
    const extra = await request(app).patch(`/api/anomalias/${id}`).send({ estadoRevision: 'ABIERTA', nivel: 'BAJO' });
    expect(extra.status).toBe(422);
    expect(extra.body.errores[0]).toMatchObject({ campo: 'nivel', codigo: 'PARAMETRO_INVALIDO' });
    expect((await request(app).patch(`/api/anomalias/${id}`).send({ estadoRevision: 'ABIERTA', nota: 'x'.repeat(501) })).status).toBe(422);
    expect((await request(app).patch(`/api/anomalias/${id}`).send({ estadoRevision: 'ABIERTA', nota: 5 })).status).toBe(422);
    expect((await request(app).patch(`/api/anomalias/${id}`).send([])).status).toBe(422);
  });

  test('inexistente → 404; id no numérico → 422', async () => {
    expect((await request(app).patch('/api/anomalias/999999').send({ estadoRevision: 'ABIERTA' })).status).toBe(404);
    expect((await request(app).patch('/api/anomalias/abc').send({ estadoRevision: 'ABIERTA' })).status).toBe(422);
  });

  test('filtro ?estadoRevision= en el listado y contadores en el dashboard', async () => {
    const otra = (await request(app).get('/api/anomalias?usuario=noche@n.com')).body.datos[0].id;
    await request(app).patch(`/api/anomalias/${otra}`).send({ estadoRevision: 'REVISADA' }).expect(200);
    expect((await request(app).get('/api/anomalias?estadoRevision=ABIERTA')).body.datos.map((a) => a.id)).toEqual([id]);
    expect((await request(app).get('/api/anomalias?estadoRevision=NUEVA')).body.total).toBe(4);
    expect((await request(app).get('/api/anomalias?estadoRevision=OTRO')).status).toBe(422);
    expect((await estadisticas()).revision).toEqual({ nuevas: 4, abiertas: 1, revisadas: 1, descartadas: 0 });
  });
});

describe('GET /api/estadisticas: métricas agregadas', () => {
  test('evolución diaria: días sin anomalías en 0, media móvil de 7 días y picos repentinos', async () => {
    const { evolucion } = await estadisticas();
    expect(evolucion.map((d) => [d.dia, d.total, d.pico])).toEqual([
      ['2026-08-01', 1, false],
      ['2026-08-02', 0, false],
      ['2026-08-03', 0, false],
      ['2026-08-04', 1, false],
      ['2026-08-05', 4, true],
    ]);
    expect(evolucion[4]).toMatchObject({ mediaMovil: 1.2, promedioPrevio: 0.5 });
  });

  test('por hora: las 24 horas con transacciones y anomalías', async () => {
    const { porHora } = await estadisticas();
    expect(porHora).toHaveLength(24);
    expect(porHora[10]).toEqual({ hora: 10, transacciones: 6, anomalias: 2 });
    expect(porHora[22]).toEqual({ hora: 22, transacciones: 6, anomalias: 4 });
    expect(porHora[15]).toEqual({ hora: 15, transacciones: 0, anomalias: 0 });
  });

  test('por franja horaria: actividad de cada franja con su ventana', async () => {
    const { porFranja } = await estadisticas();
    expect(porFranja.map((f) => [f.franja, f.segundosVentana, f.transacciones, f.anomalias, f.usuarios])).toEqual([
      ['MANANA', 10, 6, 2, 1],
      ['TARDE_NOCHE', 6, 0, 0, 0],
      ['NOCHE_MADRUGADA', 3, 6, 4, 1],
    ]);
  });

  test('múltiples transacciones: anomalías por cantidad en la ventana y la ráfaga mayor', async () => {
    const { multiplesTransacciones: m } = await estadisticas();
    expect(m.porCantidad.map((c) => [c.cantidad, c.anomalias])).toEqual([[3, 3], [4, 1], [5, 1], [6, 1]]);
    expect(m.porCantidad[3].masDe).toBe(true);
    expect(m.rafagaMayor).toMatchObject({ cantidad: 6, ventanaSegundos: 3, usuario: 'noche@n.com' });
  });

  test('tendencias: hoy hasta ahora vs. ayer hasta la misma hora', async () => {
    const ahora = DateTime.now().setZone(env.TZ_NEGOCIO);
    const local = (dt) => dt.toFormat("yyyy-MM-dd'T'HH:mm:ss");
    const hoy = [5, 4, 3].map((s) => txn({ user: 'hoy@h.com', date: local(ahora.minus({ seconds: s })) }));
    const ayer = [8, 7, 6].map((s) => txn({ user: 'ayer@a.com', date: local(ahora.minus({ days: 1, seconds: s })) }));
    if (ahora.diff(ahora.startOf('day'), 'seconds').seconds < 10) return;
    await enviar([...hoy, ...ayer]).expect(201);

    const { tarjetas, tendencias } = await estadisticas();
    expect(tarjetas.transacciones.hoy).toBe(3);
    expect(tarjetas.anomalias.hoy).toBe(1);
    expect(tendencias.transacciones.hoy).toEqual({ actual: 3, anterior: 3, variacion: 0 });
    expect(tendencias.anomalias.hoy).toEqual({ actual: 1, anterior: 1, variacion: 0 });
    expect(tarjetas.anomalias.semana).toBeGreaterThanOrEqual(1);
    expect(tarjetas.anomalias.mes).toBeGreaterThanOrEqual(1);
  });

  test('sin datos: series vacías y variación null (no divide por cero)', async () => {
    await pool.query('TRUNCATE TABLE anomalias, transacciones, usuarios RESTART IDENTITY');
    const r = await estadisticas();
    expect(r.evolucion).toEqual([]);
    expect(r.multiplesTransacciones).toEqual({ porCantidad: [], rafagaMayor: null });
    expect(r.tendencias.anomalias.hoy).toEqual({ actual: 0, anterior: 0, variacion: null });
    expect(r.porHora.every((h) => h.transacciones === 0)).toBe(true);
  });
});
