const { spawnSync } = require('child_process');
const path = require('path');
const fixtures = require('../fixtures/hashes-python.json');
const { calcularHash, verificarHash, reprFloatPython, mensajeAFirmar } = require('../../src/hashing');
const { parsearJsonConservandoNumeros } = require('../../src/validacion/jsonCrudo');

const opcionesHmac = { modo: 'hmac', secreto: fixtures.secreto };

describe('Compatibilidad con Python (fixtures)', () => {
  test.each(fixtures.casos.map((c) => [c.descripcion, c]))('%s', (_desc, caso) => {
    const txn = parsearJsonConservandoNumeros(caso.jsonEnviado);
    const hmac = calcularHash(txn, opcionesHmac);
    expect(hmac.cadena).toBe(caso.cadenaFirmada);
    expect(hmac.hash).toBe(caso.hmac);
    expect(calcularHash(txn, { modo: 'sha256' }).hash).toBe(caso.sha256);
    expect(verificarHash(txn, opcionesHmac).valido).toBe(true);
  });

  test('repr(float) de Python para 410 valores de distintas magnitudes', () => {
    for (const [reprPython, dumpsPython] of fixtures.floats) {
      expect(reprFloatPython(Number(reprPython))).toBe(reprPython);
      expect(reprFloatPython(Number(dumpsPython))).toBe(dumpsPython);
    }
  });
});

describe('Compatibilidad con Python (en vivo)', () => {
  const py = spawnSync('python', [path.join(__dirname, '..', '..', 'scripts', 'hash_profesor.py'), '--stdout'], { encoding: 'utf8' });
  const hayPython = py.status === 0;
  (hayPython ? test : test.skip)('ejecuta el script Python y compara cada hash', () => {
    const vivo = JSON.parse(py.stdout);
    for (const caso of vivo.casos) {
      const txn = parsearJsonConservandoNumeros(caso.jsonEnviado);
      expect(calcularHash(txn, opcionesHmac).hash).toBe(caso.hmac);
    }
  });
});

describe('Verificación', () => {
  const base = '{"idTxn": 10001, "user": "aa@aa.com", "date": "2026-09-23T10:30:01.120", "value": 50000, "paymentMethod": "Tarjeta", "hash": "HASH"}';

  test('el orden de las claves en el JSON recibido no afecta el hash', () => {
    const a = parsearJsonConservandoNumeros(base);
    const b = parsearJsonConservandoNumeros('{"value":50000,"paymentMethod":"Tarjeta","hash":"x","user":"aa@aa.com","idTxn":10001,"date":"2026-09-23T10:30:01.120"}');
    expect(mensajeAFirmar(a)).toBe(mensajeAFirmar(b));
  });

  test('50000 y 50000.0 producen hashes DISTINTOS (como en Python)', () => {
    const entero = parsearJsonConservandoNumeros(base);
    const flotante = parsearJsonConservandoNumeros(base.replace('50000', '50000.0'));
    expect(calcularHash(entero, opcionesHmac).hash).not.toBe(calcularHash(flotante, opcionesHmac).hash);
  });

  test('hash corrupto → inválido, y devuelve recibido y esperado', () => {
    const txn = parsearJsonConservandoNumeros(base.replace('HASH', 'f'.repeat(64)));
    const r = verificarHash(txn, opcionesHmac);
    expect(r.valido).toBe(false);
    expect(r.recibido).toBe('f'.repeat(64));
    expect(r.esperado).toMatch(/^[0-9a-f]{64}$/);
  });

  test('acepta el hash en MAYÚSCULAS', () => {
    const caso = fixtures.casos[0];
    const txn = parsearJsonConservandoNumeros(caso.jsonEnviado.replace(caso.hmac, caso.hmac.toUpperCase()));
    expect(verificarHash(txn, opcionesHmac).valido).toBe(true);
  });

  test('otra llave → hash distinto', () => {
    const txn = parsearJsonConservandoNumeros(fixtures.casos[0].jsonEnviado);
    expect(verificarHash(txn, { modo: 'hmac', secreto: 'otra-llave' }).valido).toBe(false);
  });
});
