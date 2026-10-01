/**
 * Algoritmo de ventana deslizante y franjas horarias (lógica pura, sin BD).
 * Las horas se escriben en hora de Bogotá (UTC-5).
 */
const { detectarAnomalias, simularVentana, ColaVentana } = require('../../src/ventana/ventanaDeslizante');
const { obtenerFranja } = require('../../src/ventana/franjas');
const reglas = require('../../src/config/reglas');

const BASE = reglas.obtener();
// Para aislar la regla de fraude, en varias pruebas se apagan las franjas.
const SIN_FRANJAS = { ...BASE, franjasHorarias: { ...BASE.franjasHorarias, activo: false } };

/** '2026-09-23T10:00:01' (hora Bogotá) → ms */
const ms = (local) => Date.parse(`${local}-05:00`);
let siguienteId = 1;
const txn = (email, local, id = siguienteId++) => ({ id, email, fechaMs: ms(local) });

function detectar(nuevas, { historico = [], r = SIN_FRANJAS } = {}) {
  return detectarAnomalias({ historico, nuevas, reglas: r });
}
const anomalas = (res) => [...res].filter(([, v]) => v.estado === 'ANOMALA').map(([id]) => id);

describe('Casos obligatorios del enunciado', () => {
  test('Caso 1: b@b.com 10:00:01, :02, :03 → ANOMALÍA en la tercera', () => {
    const t = [txn('b@b.com', '2026-09-23T10:00:01'), txn('b@b.com', '2026-09-23T10:00:02'), txn('b@b.com', '2026-09-23T10:00:03')];
    const res = detectar(t);
    expect(anomalas(res)).toEqual([t[2].id]);
    expect(res.get(t[2].id).anomalias[0]).toMatchObject({ tipo: 'POSIBLE_FRAUDE', nivel: 'BAJO', cantidad: 3, ventanaSegundos: 3 });
  });

  test('Caso 2: c@c.com 10:00:01, 10:00:10, 10:01:20 → NORMAL', () => {
    const res = detectar([txn('c@c.com', '2026-09-23T10:00:01'), txn('c@c.com', '2026-09-23T10:00:10'), txn('c@c.com', '2026-09-23T10:01:20')]);
    expect(anomalas(res)).toEqual([]);
  });

  test('Caso 3: tres usuarios distintos a las 10:00:01, :02, :03 → NORMAL (ventanas separadas)', () => {
    const res = detectar([txn('x@x.com', '2026-09-23T10:00:01'), txn('y@y.com', '2026-09-23T10:00:02'), txn('z@z.com', '2026-09-23T10:00:03')]);
    expect(anomalas(res)).toEqual([]);
  });

  test('Ejemplo del enunciado: 10:00:01, 10:00:05, 10:00:09 → NORMAL', () => {
    const res = detectar([txn('d@d.com', '2026-09-23T10:00:01'), txn('d@d.com', '2026-09-23T10:00:05'), txn('d@d.com', '2026-09-23T10:00:09')]);
    expect(anomalas(res)).toEqual([]);
  });
});

describe('Límites exactos de la ventana', () => {
  test('justo en 3 s (3.000) → dentro → ANOMALÍA', () => {
    const t = [txn('e@e.com', '2026-09-23T10:00:00.000'), txn('e@e.com', '2026-09-23T10:00:01.500'), txn('e@e.com', '2026-09-23T10:00:03.000')];
    expect(anomalas(detectar(t))).toEqual([t[2].id]);
  });

  test('a 3.001 s → la primera sale → NORMAL', () => {
    const t = [txn('e@e.com', '2026-09-23T10:00:00.000'), txn('e@e.com', '2026-09-23T10:00:01.500'), txn('e@e.com', '2026-09-23T10:00:03.001')];
    const res = detectar(t);
    expect(anomalas(res)).toEqual([]);
    expect(res.get(t[2].id).traza.salieron).toEqual([t[0].id]);
  });

  test('misma fecha exacta para 3 transacciones → ANOMALÍA', () => {
    const t = [1, 2, 3].map(() => txn('f@f.com', '2026-09-23T10:00:00'));
    expect(anomalas(detectar(t))).toHaveLength(1);
  });
});

describe('Orden y lotes', () => {
  test('transacciones desordenadas → se ordenan antes de procesar', () => {
    const t3 = txn('g@g.com', '2026-09-23T10:00:03');
    const t1 = txn('g@g.com', '2026-09-23T10:00:01');
    const t2 = txn('g@g.com', '2026-09-23T10:00:02');
    expect(anomalas(detectar([t3, t1, t2]))).toEqual([t3.id]);
  });

  test('anomalía que cruza entre dos lotes (histórico de la BD + nueva)', () => {
    const historico = [txn('h@h.com', '2026-09-23T10:00:01'), txn('h@h.com', '2026-09-23T10:00:02')];
    const nueva = txn('h@h.com', '2026-09-23T10:00:03');
    const res = detectar([nueva], { historico });
    expect(res.get(nueva.id).anomalias[0]).toMatchObject({ tipo: 'POSIBLE_FRAUDE', cantidad: 3 });
  });

  test('llegada tardía: la nueva cae ENTRE dos guardadas → la anomalía se asocia a la nueva', () => {
    const historico = [txn('i@i.com', '2026-09-23T10:00:01'), txn('i@i.com', '2026-09-23T10:00:03')];
    const nueva = txn('i@i.com', '2026-09-23T10:00:02');
    const res = detectar([nueva], { historico });
    expect(res.get(nueva.id).estado).toBe('ANOMALA');
    expect(res.get(nueva.id).anomalias[0].cantidad).toBe(3);
  });

  test('histórico que ya era anómalo no genera anomalías nuevas si la nueva está fuera', () => {
    const historico = [txn('j@j.com', '2026-09-23T10:00:01'), txn('j@j.com', '2026-09-23T10:00:02'), txn('j@j.com', '2026-09-23T10:00:03')];
    const nueva = txn('j@j.com', '2026-09-23T10:00:10');
    expect(anomalas(detectar([nueva], { historico }))).toEqual([]);
  });
});

describe('Niveles', () => {
  test('3 → BAJO, 4 y 5 → MEDIO, 6 → ALTO', () => {
    const t = ['00.0', '00.5', '01.0', '01.5', '02.0', '02.5'].map((s) => txn('k@k.com', `2026-09-23T10:00:${s}`));
    const res = detectar(t);
    expect(t.slice(2).map((x) => res.get(x.id).anomalias[0].nivel)).toEqual(['BAJO', 'MEDIO', 'MEDIO', 'ALTO']);
    expect(t.slice(2).map((x) => res.get(x.id).anomalias[0].cantidad)).toEqual([3, 4, 5, 6]);
  });

  test('ventana y umbral configurables', () => {
    const r = { ...SIN_FRANJAS, ventanaDeslizante: { segundos: 10, umbral: 2 } };
    const t = [txn('l@l.com', '2026-09-23T10:00:00'), txn('l@l.com', '2026-09-23T10:00:09')];
    expect(detectar(t, { r }).get(t[1].id).anomalias[0]).toMatchObject({ cantidad: 2, ventanaSegundos: 10 });
  });
});

describe('Franjas horarias', () => {
  const franjas = BASE.franjasHorarias.franjas;
  const nombre = (local) => obtenerFranja(ms(local), franjas).nombre;

  test('límites exactos de cada franja', () => {
    expect(nombre('2026-09-23T05:00:00')).toBe('NOCHE_MADRUGADA');
    expect(nombre('2026-09-23T05:00:01')).toBe('MANANA');
    expect(nombre('2026-09-23T12:00:00')).toBe('MANANA');
    expect(nombre('2026-09-23T12:00:00.999')).toBe('MANANA'); // se trunca al segundo
    expect(nombre('2026-09-23T12:00:01')).toBe('TARDE_NOCHE');
    expect(nombre('2026-09-23T20:00:00')).toBe('TARDE_NOCHE');
    expect(nombre('2026-09-23T20:00:01')).toBe('NOCHE_MADRUGADA');
    expect(nombre('2026-09-23T00:00:00')).toBe('NOCHE_MADRUGADA');
  });

  test('la noche cruza la medianoche: 23:00 del 23 y 02:00 del 24 son la MISMA ocurrencia', () => {
    const a = obtenerFranja(ms('2026-09-23T23:00:00'), franjas);
    const b = obtenerFranja(ms('2026-09-24T02:00:00'), franjas);
    expect(a.clave).toBe(b.clave);
    expect(a.clave).toBe('NOCHE_MADRUGADA|2026-09-23');
    expect(a.duracionSegundos).toBe(9 * 3600);
  });

  test('4 transacciones en la misma noche (cruzando medianoche) → la 4.ª excede el límite de 3', () => {
    const t = ['2026-09-23T21:00:00', '2026-09-23T23:30:00', '2026-09-24T01:00:00', '2026-09-24T04:59:59'].map((f) => txn('m@m.com', f));
    const res = detectar(t, { r: BASE });
    expect(anomalas(res)).toEqual([t[3].id]);
    expect(res.get(t[3].id).anomalias[0]).toMatchObject({ tipo: 'EXCESO_FRANJA_HORARIA', franja: 'NOCHE_MADRUGADA', cantidad: 4, limite: 3, nivel: 'BAJO' });
  });

  test('3 en la noche del 23 y 1 en la noche del 24 → NORMAL (ocurrencias distintas)', () => {
    const t = ['2026-09-23T21:00:00', '2026-09-23T22:00:00', '2026-09-24T01:00:00', '2026-09-24T21:00:00'].map((f) => txn('n@n.com', f));
    expect(anomalas(detectar(t, { r: BASE }))).toEqual([]);
  });

  test('mañana: la transacción 11 excede el límite de 10', () => {
    const t = Array.from({ length: 11 }, (_, i) => txn('o@o.com', `2026-09-23T${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`));
    const res = detectar(t, { r: BASE });
    expect(anomalas(res)).toEqual([t[10].id]);
  });

  test('una transacción puede disparar los DOS tipos a la vez', () => {
    const t = ['2026-09-23T22:00:00', '2026-09-23T22:30:00', '2026-09-23T23:00:00', '2026-09-23T23:00:01', '2026-09-23T23:00:02'].map((f) => txn('p@p.com', f));
    const tipos = detectar(t, { r: BASE }).get(t[4].id).anomalias.map((a) => a.tipo).sort();
    expect(tipos).toEqual(['EXCESO_FRANJA_HORARIA', 'POSIBLE_FRAUDE']);
  });

  test('modo MOVIL: cuenta en una ventana móvil de N segundos', () => {
    const r = { ...BASE, franjasHorarias: { ...BASE.franjasHorarias, modo: 'MOVIL', segundosVentanaMovil: 3600 } };
    // Noche (límite 3): 4 en menos de 1 hora → excede; separadas > 1 h → no.
    const juntas = ['2026-09-23T21:00:00', '2026-09-23T21:10:00', '2026-09-23T21:20:00', '2026-09-23T21:30:00'].map((f) => txn('q@q.com', f));
    expect(anomalas(detectar(juntas, { r }))).toEqual([juntas[3].id]);
    const separadas = ['2026-09-23T21:00:00', '2026-09-23T22:10:00', '2026-09-23T23:20:00', '2026-09-24T00:30:00'].map((f) => txn('s@s.com', f));
    expect(anomalas(detectar(separadas, { r }))).toEqual([]);
  });
});

describe('Estructuras', () => {
  test('ColaVentana: saca por el inicio y cuenta lo que queda', () => {
    const c = new ColaVentana(3000);
    c.agregar({ id: 1, fechaMs: 0, esNueva: true });
    c.agregar({ id: 2, fechaMs: 1000, esNueva: true });
    const salieron = c.agregar({ id: 3, fechaMs: 4000, esNueva: true });
    expect(salieron.map((s) => s.id)).toEqual([1]);
    expect(c.contenido().map((e) => e.id)).toEqual([2, 3]);
  });

  test('simularVentana: paso a paso qué entró y qué salió', () => {
    const pasos = simularVentana([{ id: 1, fechaMs: 0 }, { id: 2, fechaMs: 5000 }, { id: 3, fechaMs: 6000 }], 3);
    expect(pasos.map((p) => [p.entro, p.salieron, p.conteo])).toEqual([[1, [], 1], [2, [1], 1], [3, [], 2]]);
  });

  test('10 000 transacciones de un usuario se procesan rápido (O(n))', () => {
    const t = Array.from({ length: 10000 }, (_, i) => ({ id: 100000 + i, email: 'r@r.com', fechaMs: i * 1000 }));
    const inicio = Date.now();
    const res = detectar(t);
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(anomalas(res)).toHaveLength(10000 - 2); // cada 1 s, siempre hay 4 en 3 s desde la 3.ª
  });
});
