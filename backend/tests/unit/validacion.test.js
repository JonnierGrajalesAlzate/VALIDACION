const { validarTransaccion } = require('../../src/validacion/esquemaTransaccion');
const { parsearJsonConservandoNumeros } = require('../../src/validacion/jsonCrudo');
const { parsearFechaIso } = require('../../src/validacion/fechas');
const reglas = require('../../src/config/reglas');

const R = reglas.obtener();
const HASH = 'ab'.repeat(32);
const valida = () => ({ idTxn: 10001, user: 'aa@aa.com', date: '2026-09-23T10:30:01.120', value: 50000, paymentMethod: 'Tarjeta', hash: HASH });
const validar = (obj) => validarTransaccion(obj, 0, R);
const deTexto = (texto) => validarTransaccion(parsearJsonConservandoNumeros(texto), 0, R);
const error = (r, campo) => r.errores.find((e) => e.campo === campo);

test('transacción válida → datos normalizados', () => {
  const r = validar({ ...valida(), user: 'AA@aa.com', hash: HASH.toUpperCase() });
  expect(r.ok).toBe(true);
  expect(r.datos.email).toBe('aa@aa.com');
  expect(r.datos.nombre).toBe('aa');
  expect(r.datos.hash).toBe(HASH);
  expect(new Date(r.datos.fechaMs).toISOString()).toBe('2026-09-23T15:30:01.120Z');
});

describe('Tipos (sin coerción)', () => {
  test("value como string '50000' → TIPO_INVALIDO con mensaje exacto", () => {
    const r = validar({ ...valida(), value: '50000' });
    expect(r.ok).toBe(false);
    expect(error(r, 'value')).toMatchObject({
      idTxn: 10001, codigo: 'TIPO_INVALIDO', recibido: '50000', tipoRecibido: 'string',
      mensaje: "campo 'value' debe ser número > 0, se recibió string '50000'",
    });
  });

  test("idTxn como string '10001' → se rechaza, no se convierte", () => {
    const r = validar({ ...valida(), idTxn: '10001' });
    expect(error(r, 'idTxn').codigo).toBe('TIPO_INVALIDO');
    expect(r.idTxn).toBeNull();
  });

  test.each([['10001.0', 10001], ['1e4', 10000]])('idTxn escrito %s → aceptado como %d, con advertencia', (texto, id) => {
    const r = deTexto(`{"idTxn":${texto},"user":"aa@aa.com","date":"2026-09-23T10:30:01","value":5,"paymentMethod":"Tarjeta","hash":"${HASH}"}`);
    expect(r.ok).toBe(true);
    expect(r.datos.idTxn).toBe(id);
    expect(r.datos.advertencias[0].codigo).toBe('ENTERO_ESCRITO_COMO_DECIMAL');
  });

  test('idTxn decimal 1.5, negativo y cero', () => {
    expect(error(validar({ ...valida(), idTxn: 1.5 }), 'idTxn').codigo).toBe('TIPO_INVALIDO');
    expect(error(validar({ ...valida(), idTxn: -1 }), 'idTxn').codigo).toBe('VALOR_FUERA_DE_RANGO');
    expect(error(validar({ ...valida(), idTxn: 0 }), 'idTxn').codigo).toBe('VALOR_FUERA_DE_RANGO');
  });

  test.each([
    ['null', null, 'TIPO_INVALIDO'],
    ['negativo', -100, 'VALOR_FUERA_DE_RANGO'],
    ['cero', 0, 'VALOR_FUERA_DE_RANGO'],
    ['booleano', true, 'TIPO_INVALIDO'],
    ['que redondeado queda en 0', 0.001, 'VALOR_FUERA_DE_RANGO'],
    ['demasiado grande', 1e13, 'VALOR_FUERA_DE_RANGO'],
  ])('value %s → %s', (_n, valor, codigo) => {
    expect(error(validar({ ...valida(), value: valor }), 'value').codigo).toBe(codigo);
  });

  test('user con más de 64 caracteres antes de @ → VALOR_FUERA_DE_RANGO (usuarios.nombre VARCHAR(120))', () => {
    expect(validar({ ...valida(), user: `${'a'.repeat(64)}@aa.com` }).ok).toBe(true);
    const e = error(validar({ ...valida(), user: `${'a'.repeat(65)}@aa.com` }), 'user');
    expect(e).toMatchObject({ codigo: 'VALOR_FUERA_DE_RANGO' });
    expect(e.mensaje).toContain('máximo es 64');
  });

  test.each([
    ['10.123', 10.12], ['1.005', 1.01], ['12345.678912', 12345.68], ['0.015', 0.02],
  ])('value %s con más de 2 decimales → se redondea a %d (como NUMERIC(14,2))', (texto, esperado) => {
    const r = deTexto(`{"idTxn":1,"user":"aa@aa.com","date":"2026-09-23T10:30:01","value":${texto},"paymentMethod":"Tarjeta","hash":"${HASH}"}`);
    expect(r.ok).toBe(true);
    expect(r.datos.valor).toBe(esperado);
    expect(r.datos.advertencias[0].codigo).toBe('VALOR_REDONDEADO');
  });

  test.each(['nequi', 'NEQUI', ' Nequi ', 'Néqui'])('paymentMethod %p → se guarda como "Nequi"', (m) => {
    const r = validar({ ...valida(), paymentMethod: m });
    expect(r.ok).toBe(true);
    expect(r.datos.metodoPago).toBe('Nequi');
  });

  test('value "NaN"/"Infinity" como string → TIPO_INVALIDO', () => {
    expect(error(validar({ ...valida(), value: 'NaN' }), 'value').codigo).toBe('TIPO_INVALIDO');
    expect(error(validar({ ...valida(), value: 'Infinity' }), 'value').codigo).toBe('TIPO_INVALIDO');
  });

  test('value con 2 decimales es válido', () => {
    expect(validar({ ...valida(), value: 12345.67 }).ok).toBe(true);
  });
});

describe('Campos', () => {
  test('campo faltante → CAMPO_FALTANTE', () => {
    const t = valida();
    delete t.hash;
    const r = validar(t);
    expect(error(r, 'hash')).toMatchObject({ codigo: 'CAMPO_FALTANTE', tipoRecibido: 'ausente' });
  });

  test('campos extra (ip, estado) → se aceptan con advertencia', () => {
    const r = validar({ ...valida(), ip: '10.0.0.1', estado: 'APROBADA' });
    expect(r.ok).toBe(true);
    expect(r.datos.advertencias).toEqual([expect.objectContaining({ codigo: 'CAMPOS_ADICIONALES_IGNORADOS' })]);
  });

  test('devuelve TODOS los errores juntos, no solo el primero', () => {
    const r = validar({ idTxn: '1', user: 'no-es-correo', date: '2026-02-30T10:00:00', value: -5, paymentMethod: 'Bitcoin', hash: 'xyz', otro: 1 });
    expect(r.errores.map((e) => e.campo).sort()).toEqual(['date', 'hash', 'idTxn', 'paymentMethod', 'user', 'value']);
  });

  test('el elemento no es un objeto → TIPO_INVALIDO con su posición', () => {
    const r = validarTransaccion([1, 2], 3, R);
    expect(r.errores[0]).toMatchObject({ codigo: 'TIPO_INVALIDO', posicion: 3, tipoRecibido: 'array' });
  });
});

describe('user, paymentMethod y hash', () => {
  test.each(['aa', 'aa@', '@aa.com', 'aa@aa', 'a a@aa.com'])('correo inválido %p → FORMATO_INVALIDO', (correo) => {
    expect(error(validar({ ...valida(), user: correo }), 'user').codigo).toBe('FORMATO_INVALIDO');
  });

  test('método de pago no permitido → lista los permitidos', () => {
    const e = error(validar({ ...valida(), paymentMethod: 'Bitcoin' }), 'paymentMethod');
    expect(e.codigo).toBe('METODO_PAGO_NO_PERMITIDO');
    expect(e.mensaje).toContain('Nequi');
  });

  test('método de pago vacío → FORMATO_INVALIDO', () => {
    expect(error(validar({ ...valida(), paymentMethod: '   ' }), 'paymentMethod').mensaje).toContain('no puede estar vacío');
  });

  test.each(['abc', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])('hash inválido %p', (h) => {
    expect(error(validar({ ...valida(), hash: h }), 'hash').codigo).toBe('FORMATO_INVALIDO');
  });
});

describe('Fechas', () => {
  test.each([
    ['2026-02-30T10:00:00', 'FECHA_IMPOSIBLE', 'febrero de 2026 tiene 28 días'],
    ['2028-02-30T10:00:00', 'FECHA_IMPOSIBLE', 'febrero de 2028 tiene 29 días'],
    ['2026-13-01T10:00:00', 'FECHA_IMPOSIBLE', 'mes 13'],
    ['2026-09-23T24:00:00', 'FECHA_IMPOSIBLE', 'hora imposible'],
    ['2026-09-23T10:60:00', 'FECHA_IMPOSIBLE', 'minuto imposible'],
    ['2026-09-23', 'FORMATO_INVALIDO', 'falta la hora'],
    ['23/09/2026 10:00', 'FORMATO_INVALIDO', 'año-mes-día'],
    ['2026-09-23T10:00:00.1234567890', 'FORMATO_INVALIDO', 'máximo 9 decimales'],
    ['2026-09-31 10:00:00', 'FECHA_IMPOSIBLE', 'septiembre de 2026 tiene 30 días'],
  ])('%s → %s', (fecha, codigo, texto) => {
    const e = error(validar({ ...valida(), date: fecha }), 'date');
    expect(e.codigo).toBe(codigo);
    expect(e.mensaje).toContain(texto);
  });

  test('con zona horaria explícita se respeta', () => {
    expect(parsearFechaIso('2026-09-23T10:00:00Z').fecha.toMillis()).toBe(Date.UTC(2026, 8, 23, 10));
    expect(parsearFechaIso('2026-09-23T10:00:00+02:00').fecha.toMillis()).toBe(Date.UTC(2026, 8, 23, 8));
  });

  test('sin zona → America/Bogota; milisegundos opcionales (1 a 3 dígitos)', () => {
    expect(parsearFechaIso('2026-09-23T10:00:00').fecha.toMillis()).toBe(Date.UTC(2026, 8, 23, 15));
    expect(parsearFechaIso('2026-09-23T10:00:00.5').fecha.toMillis()).toBe(Date.UTC(2026, 8, 23, 15, 0, 0, 500));
  });

  test('formatos de Python: isoformat() con microsegundos y str(datetime) con espacio (se trunca a ms)', () => {
    const esperado = Date.UTC(2026, 8, 23, 15, 30, 1, 120);
    expect(parsearFechaIso('2026-09-23T10:30:01.120999').fecha.toMillis()).toBe(esperado);
    expect(parsearFechaIso('2026-09-23 10:30:01.120000').fecha.toMillis()).toBe(esperado);
    expect(validar({ ...valida(), date: '2026-09-23T10:30:01.120000' }).ok).toBe(true);
  });

  test('date como número → TIPO_INVALIDO', () => {
    expect(error(validar({ ...valida(), date: 1758641401120 }), 'date').codigo).toBe('TIPO_INVALIDO');
  });
});
