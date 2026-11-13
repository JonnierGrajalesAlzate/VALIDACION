const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { crearApp } = require('../../src/app');
const anomaliasRepo = require('../../src/repositorios/anomalias.repo');
const fixtures = require('../fixtures/hashes-python.json');
const { limpiarBd, cerrarBd, restablecerReglas, pool } = require('../setup/utilBd');
const { txn } = require('../setup/utilTxn');
const reglas = require('../../src/config/reglas');

function activarFranjas() {
  const r = reglas.obtener();
  reglas.actualizar({ ...r, franjasHorarias: { ...r.franjasHorarias, activo: true } });
}

const app = crearApp();
const enviar = (cuerpo) => request(app).post('/api/transacciones').send(cuerpo);
const contar = async (tabla) => (await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabla}`)).rows[0].n;
const estadoDe = async (id) => (await pool.query('SELECT estado FROM transacciones WHERE id = $1', [id])).rows[0]?.estado;

beforeEach(async () => {
  await limpiarBd();
  restablecerReglas();
});
afterAll(cerrarBd);

describe('Casos de uso obligatorios', () => {
  test('Caso 1: b@b.com 10:00:01, :02, :03 → la tercera queda ANOMALA', async () => {
    const lote = ['10:00:01', '10:00:02', '10:00:03'].map((h) => txn({ user: 'b@b.com', date: `2026-09-23T${h}` }));
    const r = await enviar(lote);
    expect(r.status).toBe(201);
    expect(r.body.resumen).toMatchObject({ aceptadas: 3, rechazadas: 0, anomalias: 1 });
    expect(r.body.aceptadas[2]).toMatchObject({ estado: 'ANOMALA', anomalias: [{ tipo: 'POSIBLE_FRAUDE', nivel: 'BAJO', cantidad: 3, ventanaSegundos: 3, franja: null }] });
    expect(await estadoDe(lote[2].idTxn)).toBe('ANOMALA');
    expect(await estadoDe(lote[0].idTxn)).toBe('VALIDA');
    const a = (await pool.query('SELECT * FROM anomalias')).rows;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ transaccion_id: lote[2].idTxn, cantidad_transacciones: 3, ventana_segundos: 3, tipo: 'POSIBLE_FRAUDE' });
  });

  test('Caso 1 enviado de a una transacción por petición → también detecta la anomalía', async () => {
    const t = ['10:00:01', '10:00:02', '10:00:03'].map((h) => txn({ user: 'b@b.com', date: `2026-09-23T${h}` }));
    expect((await enviar(t[0])).status).toBe(201);
    expect((await enviar(t[1])).status).toBe(201);
    const r = await enviar(t[2]);
    expect(r.body.modo).toBe('individual');
    expect(r.body.aceptadas[0].estado).toBe('ANOMALA');
  });

  test('Caso 2: c@c.com 10:00:01, 10:00:10, 10:01:20 → NORMAL', async () => {
    const r = await enviar(['10:00:01', '10:00:10', '10:01:20'].map((h) => txn({ user: 'c@c.com', date: `2026-09-23T${h}` })));
    expect(r.status).toBe(201);
    expect(r.body.resumen.anomalias).toBe(0);
    expect(await contar('anomalias')).toBe(0);
  });

  test('Diapositiva: b@b.com 10:00:01, :05, :09 → NORMAL (no se concentran en 3 s)', async () => {
    const r = await enviar(['10:00:01', '10:00:05', '10:00:09'].map((h) => txn({ user: 'b@b.com', date: `2026-09-23T${h}` })));
    expect(r.status).toBe(201);
    expect(r.body.resumen.anomalias).toBe(0);
  });

  test('Enunciado: a@a.com 10:30:01 $50.000, :02 $30.000, :03 $20.000 → POSIBLE_FRAUDE', async () => {
    const r = await enviar([['10:30:01', 50000], ['10:30:02', 30000], ['10:30:03', 20000]]
      .map(([h, value]) => txn({ user: 'a@a.com', date: `2026-09-23T${h}`, value })));
    expect(r.body.resumen.anomalias).toBe(1);
    expect(r.body.aceptadas[2].anomalias[0]).toMatchObject({ tipo: 'POSIBLE_FRAUDE', cantidad: 3, ventanaSegundos: 3 });
  });

  test('Caso 3: tres usuarios distintos a las 10:00:01, :02, :03 → NORMAL', async () => {
    const r = await enviar([
      txn({ user: 'u1@x.com', date: '2026-09-23T10:00:01' }),
      txn({ user: 'u2@x.com', date: '2026-09-23T10:00:02' }),
      txn({ user: 'u3@x.com', date: '2026-09-23T10:00:03' }),
    ]);
    expect(r.body.resumen).toMatchObject({ aceptadas: 3, anomalias: 0, usuariosCreados: ['u1@x.com', 'u2@x.com', 'u3@x.com'] });
  });
});

describe('Errores de validación (uno por tipo)', () => {
  test("tipo incorrecto: value '50000' (string) → 422 VALIDACION_ESQUEMA", async () => {
    const t = txn();
    const r = await enviar({ ...t, value: '50000' });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, etapa: 'VALIDACION_ESQUEMA' });
    expect(r.body.errores[0]).toMatchObject({
      idTxn: t.idTxn, campo: 'value', codigo: 'TIPO_INVALIDO', recibido: '50000', esperado: expect.stringContaining('number > 0'),
      mensaje: "campo 'value' debe ser número > 0, se recibió string '50000'",
    });
    expect(r.body.requestId).toBe(r.headers['x-request-id']);
  });

  test('campo faltante', async () => {
    const t = txn();
    delete t.paymentMethod;
    const r = await enviar(t);
    expect(r.status).toBe(422);
    expect(r.body.errores[0]).toMatchObject({ campo: 'paymentMethod', codigo: 'CAMPO_FALTANTE' });
  });

  test('campo extra firmado (ip) → se acepta, no se guarda y queda como advertencia', async () => {
    const r = await enviar(txn({ ip: '192.168.1.10' }));
    expect(r.status).toBe(201);
    expect(r.body.aceptadas[0].advertencias).toEqual([expect.objectContaining({ codigo: 'CAMPOS_ADICIONALES_IGNORADOS' })]);
  });

  test('campo extra agregado DESPUÉS de firmar → HASH_INVALIDO', async () => {
    const r = await enviar({ ...txn(), descuento: 5 });
    expect(r.status).toBe(422);
    expect(r.body.errores[0]).toMatchObject({ campo: 'hash', codigo: 'HASH_INVALIDO' });
  });

  test('correo inválido', async () => {
    const r = await enviar(txn({ user: 'no-es-un-correo' }));
    expect(r.body.errores[0]).toMatchObject({ campo: 'user', codigo: 'FORMATO_INVALIDO' });
  });

  test('fecha imposible 2026-02-30', async () => {
    const r = await enviar(txn({ date: '2026-02-30T10:00:00' }));
    expect(r.body.errores[0]).toMatchObject({ campo: 'date', codigo: 'FECHA_IMPOSIBLE' });
    expect(r.body.errores[0].mensaje).toContain('febrero de 2026 tiene 28 días');
  });

  test('valor negativo', async () => {
    const r = await enviar(txn({ value: -100 }));
    expect(r.body.errores[0]).toMatchObject({ campo: 'value', codigo: 'VALOR_FUERA_DE_RANGO' });
  });

  test('hash inválido → 422 VALIDACION_HASH, sin revelar el hash correcto fuera de desarrollo', async () => {
    const t = txn();
    const r = await enviar({ ...t, value: 99999 });
    expect(r.status).toBe(422);
    expect(r.body.etapa).toBe('VALIDACION_HASH');
    expect(r.body.errores[0]).toMatchObject({ campo: 'hash', codigo: 'HASH_INVALIDO', recibido: t.hash });
    expect(r.body.errores[0].esperado).not.toMatch(/^[0-9a-f]{64}$/);
    const logTxt = fs.readFileSync(path.join(__dirname, '..', '..', 'logs', 'test.log'), 'utf8');
    expect(logTxt).toContain(`[${r.body.requestId}] [VALIDACION_HASH]`);
    expect(logTxt).toMatch(new RegExp(`idTxn=${t.idTxn} hash no coincide\\. Recibido=${t.hash.slice(0, 12)}…, Esperado=`));
  });

  test('idTxn duplicado → 409 DUPLICADOS', async () => {
    const t = txn();
    expect((await enviar(t)).status).toBe(201);
    const r = await enviar(t);
    expect(r.status).toBe(409);
    expect(r.body.etapa).toBe('DUPLICADOS');
    expect(r.body.errores[0]).toMatchObject({ codigo: 'DUPLICADO', mensaje: `idTxn=${t.idTxn} ya existe en transacciones (violación de llave única)` });
  });

  test('idTxn repetido dentro del mismo lote → se acepta la primera, la segunda 207', async () => {
    const t = txn();
    const r = await enviar([t, t]);
    expect(r.status).toBe(207);
    expect(r.body.rechazadas[0].errores[0].codigo).toBe('DUPLICADO_EN_LOTE');
  });

  test('todos los errores de una transacción juntos', async () => {
    const r = await enviar({ idTxn: '1', user: 'x', date: '2026-13-01T00:00:00', value: 0, paymentMethod: 'Bitcoin', hash: 'zz', extra: true });
    expect(r.status).toBe(422);
    expect(r.body.errores.map((e) => e.campo).sort()).toEqual(['date', 'hash', 'idTxn', 'paymentMethod', 'user', 'value']);
  });
});

describe('Recepción y parseo', () => {
  test('JSON malformado → 400 PARSEO_JSON con línea y columna', async () => {
    const r = await request(app).post('/api/transacciones').set('Content-Type', 'application/json').send('{"idTxn": 1, "user": "a@a.com",}');
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, etapa: 'PARSEO_JSON', errores: [{ codigo: 'JSON_MALFORMADO' }] });
    expect(r.body.errores[0].mensaje).toMatch(/línea 1, columna/);
  });

  test('cuerpo vacío → 400', async () => {
    const r = await request(app).post('/api/transacciones').set('Content-Type', 'application/json').send('');
    expect(r.status).toBe(400);
    expect(r.body.errores[0].codigo).toBe('CUERPO_VACIO');
  });

  test.each(['text/plain', 'application/x-www-form-urlencoded'])('Content-Type %s → el cuerpo se interpreta igual como JSON', async (tipo) => {
    const t = txn();
    const r = await request(app).post('/api/transacciones').set('Content-Type', tipo).send(JSON.stringify(t));
    expect(r.status).toBe(201);
    expect(r.body.resumen.aceptadas).toBe(1);
  });

  test('Content-Type text/plain con texto que no es JSON → 400 JSON_MALFORMADO', async () => {
    const r = await request(app).post('/api/transacciones').set('Content-Type', 'text/plain').send('idTxn=1&user=a');
    expect(r.status).toBe(400);
    expect(r.body.errores[0].codigo).toBe('JSON_MALFORMADO');
  });

  test('Bot en Python: campos extra, json.dumps() sin ordenar, montos con muchos decimales, isoformat() e idTxn float → 201', async () => {
    // Generado con Python 3 y la llave de pruebas:
    //   a["hash"] = hmac(json.dumps(a))                 (sin sort_keys ni separators)
    //   b["hash"] = hmac(json.dumps(b, sort_keys=True)) (separadores por defecto)
    const lote = '[{"idTxn": 82001, "user": "bot@correo.com", "date": "2026-09-23T10:30:01.120000", "value": 12345.678912, "paymentMethod": "nequi", "ip": "192.168.1.10", "estado": "APROBADA", "hash": "025f5288b31d753fa5c52e76afb3a1531d2396badbd246e2dab1df9b5e7c33d6"}, '
      + '{"idTxn": 82002.0, "user": "bot@correo.com", "date": "2026-09-23 18:00:00", "value": 50000.0, "paymentMethod": "Tarjeta", "hash": "195a3d716752919ccc0502dc84fbee928e42e13db549351cd375617c5566552d"}]';
    const r = await request(app).post('/api/transacciones').set('Content-Type', 'application/json').send(lote);
    expect(r.status).toBe(201);
    expect(r.body.resumen).toMatchObject({ aceptadas: 2, rechazadas: 0 });
    const codigos = (i) => r.body.aceptadas[i].advertencias.map((a) => a.codigo).sort();
    expect(codigos(0)).toEqual(['CAMPOS_ADICIONALES_IGNORADOS', 'HASH_SERIALIZACION_ALTERNATIVA', 'METODO_PAGO_NORMALIZADO', 'VALOR_REDONDEADO']);
    expect(codigos(1)).toEqual(['ENTERO_ESCRITO_COMO_DECIMAL', 'HASH_SERIALIZACION_ALTERNATIVA']);
    const filas = (await pool.query('SELECT id, valor, metodo_pago, fecha_txn FROM transacciones ORDER BY id')).rows;
    expect(filas.map((f) => [Number(f.id), f.valor, f.metodo_pago])).toEqual([[82001, 12345.68, 'Nequi'], [82002, 50000, 'Tarjeta']]);
    expect(filas[0].fecha_txn.toISOString()).toBe('2026-09-23T15:30:01.120Z');
  });

  test('modo "auto" (por defecto): SHA-256 sin llave y campos concatenados con HMAC → 201 con advertencia', async () => {
    const crypto = require('crypto');
    const { mensajeAFirmar } = require('../../src/hashing');
    const sinLlave = txn();
    sinLlave.hash = crypto.createHash('sha256').update(mensajeAFirmar(sinLlave)).digest('hex');
    const concatenada = txn();
    const texto = ['idTxn', 'user', 'date', 'value', 'paymentMethod'].map((k) => String(concatenada[k])).join('|');
    concatenada.hash = crypto.createHmac('sha256', process.env.HMAC_SECRET).update(texto).digest('hex');
    const r = await enviar([sinLlave, concatenada]);
    expect(r.status).toBe(201);
    expect(r.body.aceptadas.map((a) => a.advertencias[0].codigo)).toEqual(['HASH_SERIALIZACION_ALTERNATIVA', 'HASH_SERIALIZACION_ALTERNATIVA']);
  });

  test('modo "hmac" (estricto): SHA-256 sin llave → 422 con la causa exacta', async () => {
    const r0 = reglas.obtener();
    reglas.actualizar({ ...r0, hash: { modo: 'hmac' } });
    const { mensajeAFirmar } = require('../../src/hashing');
    const t = txn();
    const r = await enviar({ ...t, hash: require('crypto').createHash('sha256').update(mensajeAFirmar(t)).digest('hex') });
    expect(r.status).toBe(422);
    expect(r.body.errores[0]).toMatchObject({ campo: 'hash', codigo: 'HASH_INVALIDO' });
    expect(r.body.errores[0].mensaje).toContain('SHA-256 sin llave');
  });

  test('métodos de pago del bot del profesor (Apple Pay, Paypal, Google Pay) → 201', async () => {
    const r = await enviar(['Apple Pay', 'PayPal', 'google pay'].map((m, i) => txn({ paymentMethod: m, date: `2026-09-23T1${i}:00:00` })));
    expect(r.status).toBe(201);
    expect(r.body.aceptadas.map((a) => a.metodoPago)).toEqual(['Apple Pay', 'Paypal', 'Google Pay']);
  });

  test('la compatibilidad no deja pasar un hash firmado con otra llave ni tipos incorrectos', async () => {
    const otraLlave = { ...txn(), hash: 'f'.repeat(64) };
    const texto = txn({ value: '50000' });
    const r = await enviar([otraLlave, texto]);
    expect(r.status).toBe(422);
    expect(r.body.errores.map((e) => `${e.campo}:${e.codigo}`).sort()).toEqual(['hash:HASH_INVALIDO', 'value:TIPO_INVALIDO']);
  });

  test('lote vacío [] → 422', async () => {
    const r = await enviar([]);
    expect(r.status).toBe(422);
    expect(r.body.errores[0].codigo).toBe('LOTE_VACIO');
  });

  test('cuerpo que no es objeto ni arreglo (un número) → 422', async () => {
    const r = await request(app).post('/api/transacciones').set('Content-Type', 'application/json').send('42');
    expect(r.status).toBe(422);
    expect(r.body.etapa).toBe('RECEPCION');
  });
});

describe('Usuarios', () => {
  test('usuario inexistente se crea ACTIVO con nombre = parte local del correo', async () => {
    await enviar(txn({ user: 'Nuevo.Usuario@Mail.com' }));
    const u = (await pool.query('SELECT nombre, email, estado FROM usuarios')).rows[0];
    expect(u).toEqual({ nombre: 'nuevo.usuario', email: 'nuevo.usuario@mail.com', estado: 'ACTIVO' });
  });

  test('usuario INACTIVO → 422 USUARIO con mensaje claro', async () => {
    await pool.query("INSERT INTO usuarios (nombre, email, estado) VALUES ('ina', 'ina@x.com', 'INACTIVO')");
    const r = await enviar(txn({ user: 'ina@x.com' }));
    expect(r.status).toBe(422);
    expect(r.body.etapa).toBe('USUARIO');
    expect(r.body.errores[0]).toMatchObject({ campo: 'user', codigo: 'USUARIO_INACTIVO' });
    expect(r.body.errores[0].mensaje).toContain('INACTIVO');
  });
});

describe('Lotes', () => {
  test('lote mixto → 207: las válidas se guardan y se explica cada rechazo', async () => {
    const buena1 = txn({ user: 'm@m.com' });
    const buena2 = txn({ user: 'm@m.com', date: '2026-09-23T11:00:00' });
    const lote = [buena1, { ...txn(), value: '1' }, buena2, { ...txn(), hash: 'f'.repeat(64) }, 'no-soy-objeto'];
    const r = await enviar(lote);
    expect(r.status).toBe(207);
    expect(r.body.ok).toBe(true);
    expect(r.body.resumen).toMatchObject({ recibidas: 5, aceptadas: 2, rechazadas: 3 });
    expect(r.body.rechazadas.map((x) => [x.posicion, x.etapa])).toEqual([[1, 'VALIDACION_ESQUEMA'], [3, 'VALIDACION_HASH'], [4, 'VALIDACION_ESQUEMA']]);
    expect(await contar('transacciones')).toBe(2);
  });

  test('ROLLBACK: si falla la persistencia de anomalías, no queda NADA del lote', async () => {
    const espia = jest.spyOn(anomaliasRepo, 'insertarVarias').mockRejectedValueOnce(Object.assign(new Error('disco lleno (simulado)'), { code: '53100', severity: 'ERROR' }));
    const lote = ['10:00:01', '10:00:02', '10:00:03'].map((h) => txn({ user: 'rb@rb.com', date: `2026-09-23T${h}` }));
    const r = await enviar(lote);
    espia.mockRestore();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, etapa: 'PERSISTENCIA' });
    expect(r.body.errores[0].codigoPg).toBe('53100');
    expect(await contar('transacciones')).toBe(0);
    expect(await contar('usuarios')).toBe(0);
  });

  test('transacciones desordenadas → se ordenan antes de la ventana', async () => {
    const t = ['10:00:03', '10:00:01', '10:00:02'].map((h) => txn({ user: 'o@o.com', date: `2026-09-23T${h}` }));
    const r = await enviar(t);
    expect(r.body.aceptadas.find((a) => a.estado === 'ANOMALA').idTxn).toBe(t[0].idTxn);
  });

  test('anomalía que cruza entre dos lotes', async () => {
    await enviar(['10:00:01', '10:00:02'].map((h) => txn({ user: 'x2@x.com', date: `2026-09-23T${h}` })));
    const r = await enviar(txn({ user: 'x2@x.com', date: '2026-09-23T10:00:03' }));
    expect(r.body.aceptadas[0]).toMatchObject({ estado: 'ANOMALA', anomalias: [{ cantidad: 3 }] });
  });
});

describe('Límites de la ventana vía API (franjas activadas)', () => {
  beforeEach(activarFranjas);

  test('noche (ventana 3 s): justo 3.000 s → ANOMALÍA; 3.001 s → NORMAL', async () => {
    const dentro = ['00.000', '01.500', '03.000'].map((s) => txn({ user: 'l1@l.com', date: `2026-09-23T22:00:${s}` }));
    const fuera = ['00.000', '01.500', '03.001'].map((s) => txn({ user: 'l2@l.com', date: `2026-09-23T22:00:${s}` }));
    expect((await enviar(dentro)).body.resumen.anomalias).toBe(1);
    expect((await enviar(fuera)).body.resumen.anomalias).toBe(0);
  });

  test('mañana (ventana 10 s): justo 10.000 s → ANOMALÍA; 10.001 s → NORMAL', async () => {
    const dentro = ['00.000', '05.000', '10.000'].map((s) => txn({ user: 'l3@l.com', date: `2026-09-23T10:00:${s}` }));
    const fuera = ['00.000', '05.000', '10.001'].map((s) => txn({ user: 'l4@l.com', date: `2026-09-23T10:00:${s}` }));
    const r = await enviar(dentro);
    expect(r.body.aceptadas[2].anomalias[0]).toMatchObject({ tipo: 'POSIBLE_FRAUDE', cantidad: 3, ventanaSegundos: 10, franja: 'MANANA' });
    expect((await enviar(fuera)).body.resumen.anomalias).toBe(0);
  });

  test('tarde-noche (ventana 6 s): 3 transacciones en 6 s → ANOMALÍA con ventana_segundos = 6', async () => {
    const r = await enviar(['15:00:00', '15:00:03', '15:00:06'].map((h) => txn({ user: 'tarde@t.com', date: `2026-09-23T${h}` })));
    expect(r.body.aceptadas[2].anomalias[0]).toMatchObject({ cantidad: 3, ventanaSegundos: 6, franja: 'TARDE_NOCHE' });
  });

  test('ventana por franja configurable vía PUT /api/config: se guarda el valor usado', async () => {
    const cfg = (await request(app).get('/api/config')).body.reglas;
    const franjas = cfg.franjasHorarias.franjas.map((f) => (f.nombre === 'MANANA' ? { ...f, segundosVentana: 20 } : f));
    await request(app).put('/api/config').send({ ...cfg, ventanaDeslizante: { ...cfg.ventanaDeslizante, umbral: 2 }, franjasHorarias: { ...cfg.franjasHorarias, franjas } }).expect(200);
    const r = await enviar(['10:00:00', '10:00:19'].map((h) => txn({ user: 'cfg@c.com', date: `2026-09-23T${h}` })));
    expect(r.body.aceptadas[1].anomalias[0]).toMatchObject({ cantidad: 2, ventanaSegundos: 20 });
  });
});

describe('Compatibilidad con el hash de Python vía API', () => {
  test.each(fixtures.casos.slice(0, 3).map((c) => [c.descripcion, c]))('%s → 201', async (_d, caso) => {
    const r = await request(app).post('/api/transacciones').set('Content-Type', 'application/json').send(caso.jsonEnviado);
    expect(r.body.errores).toEqual([]);
    expect(r.status).toBe(201);
  });
});
