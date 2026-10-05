const { detectarAnomalias, simularVentana, rangoHistorico, ColaVentana } = require('../../src/ventana/ventanaDeslizante');
const { obtenerFranja, ventanaPara } = require('../../src/ventana/franjas');
const reglas = require('../../src/config/reglas');

const BASE = reglas.obtener();
const SIN_FRANJAS = { ...BASE, franjasHorarias: { ...BASE.franjasHorarias, activo: false } };

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

  test('Ejemplo del enunciado con ventana de 3 s: 10:00:01, 10:00:05, 10:00:09 → NORMAL', () => {
    const res = detectar([txn('d@d.com', '2026-09-23T10:00:01'), txn('d@d.com', '2026-09-23T10:00:05'), txn('d@d.com', '2026-09-23T10:00:09')]);
    expect(anomalas(res)).toEqual([]);
  });
});

describe('Casos obligatorios con la ventana de la franja (10:00 → MAÑANA, 10 s)', () => {
  test('Caso 1 → ANOMALÍA en la tercera; Caso 2 y Caso 3 → NORMAL', () => {
    const c1 = ['10:00:01', '10:00:02', '10:00:03'].map((h) => txn('b1@b.com', `2026-09-23T${h}`));
    const c2 = ['10:00:01', '10:00:10', '10:01:20'].map((h) => txn('c1@c.com', `2026-09-23T${h}`));
    const c3 = [txn('x1@x.com', '2026-09-23T10:00:01'), txn('y1@y.com', '2026-09-23T10:00:02'), txn('z1@z.com', '2026-09-23T10:00:03')];
    expect(anomalas(detectar([...c1, ...c2, ...c3], { r: BASE }))).toEqual([c1[2].id]);
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

describe('Ventana según la franja horaria', () => {
  const franjas = BASE.franjasHorarias.franjas;
  const nombre = (local) => obtenerFranja(ms(local), franjas).nombre;

  test('límites exactos de cada franja', () => {
    expect(nombre('2026-09-23T05:00:00')).toBe('NOCHE_MADRUGADA');
    expect(nombre('2026-09-23T05:00:01')).toBe('MANANA');
    expect(nombre('2026-09-23T12:00:00')).toBe('MANANA');
    expect(nombre('2026-09-23T12:00:00.999')).toBe('MANANA');
    expect(nombre('2026-09-23T12:00:01')).toBe('TARDE_NOCHE');
    expect(nombre('2026-09-23T20:00:00')).toBe('TARDE_NOCHE');
    expect(nombre('2026-09-23T20:00:01')).toBe('NOCHE_MADRUGADA');
    expect(nombre('2026-09-23T00:00:00')).toBe('NOCHE_MADRUGADA');
  });

  test('tamaño de la ventana: mañana 10 s, tarde-noche 6 s, noche-madrugada 3 s', () => {
    expect(ventanaPara(ms('2026-09-23T08:00:00'), BASE)).toEqual({ segundos: 10, franja: 'MANANA' });
    expect(ventanaPara(ms('2026-09-23T15:00:00'), BASE)).toEqual({ segundos: 6, franja: 'TARDE_NOCHE' });
    expect(ventanaPara(ms('2026-09-23T23:00:00'), BASE)).toEqual({ segundos: 3, franja: 'NOCHE_MADRUGADA' });
    expect(ventanaPara(ms('2026-09-24T02:00:00'), BASE)).toEqual({ segundos: 3, franja: 'NOCHE_MADRUGADA' });
    expect(ventanaPara(ms('2026-09-23T08:00:00'), SIN_FRANJAS)).toEqual({ segundos: 3, franja: null });
  });

  test('límite exacto de cada ventana: justo en N s → ANOMALÍA; N s + 1 ms → NORMAL', () => {
    for (const [hora, n] of [['08', 10], ['15', 6], ['23', 3]]) {
      const base = ms(`2026-09-23T${hora}:00:00`);
      const grupo = (fin) => [0, 1, fin].map((d) => ({ id: siguienteId++, email: `lim${hora}@x.com`, fechaMs: base + d }));
      const dentro = grupo(n * 1000);
      const res = detectar(dentro, { r: BASE });
      expect(anomalas(res)).toEqual([dentro[2].id]);
      expect(res.get(dentro[2].id).anomalias[0]).toMatchObject({ ventanaSegundos: n, cantidad: 3 });
      expect(anomalas(detectar(grupo(n * 1000 + 1), { r: BASE }))).toEqual([]);
    }
  });

  test('las mismas 3 transacciones (cada 4 s) son ANOMALÍA en la mañana y NORMAL en la noche', () => {
    const manana = ['10:00:01', '10:00:05', '10:00:09'].map((h) => txn('mn@m.com', `2026-09-23T${h}`));
    const noche = ['22:00:01', '22:00:05', '22:00:09'].map((h) => txn('nc@n.com', `2026-09-23T${h}`));
    const res = detectar([...manana, ...noche], { r: BASE });
    expect(anomalas(res)).toEqual([manana[2].id]);
    expect(res.get(manana[2].id).anomalias[0]).toMatchObject({ tipo: 'POSIBLE_FRAUDE', franja: 'MANANA', ventanaSegundos: 10 });
  });

  test('tarde-noche: 3 en 5 s → ANOMALÍA; 3 en 7 s → NORMAL', () => {
    const juntas = ['15:00:00', '15:00:03', '15:00:05'].map((h) => txn('t1@t.com', `2026-09-23T${h}`));
    const separadas = ['15:00:00', '15:00:04', '15:00:07'].map((h) => txn('t2@t.com', `2026-09-23T${h}`));
    const res = detectar([...juntas, ...separadas], { r: BASE });
    expect(anomalas(res)).toEqual([juntas[2].id]);
  });

  test('la ventana la decide la hora de la transacción que LLEGA (cambio de franja)', () => {
    const t = ['04:59:55', '04:59:58', '05:00:03'].map((h) => txn('cambio@c.com', `2026-09-23T${h}`));
    const res = detectar(t, { r: BASE });
    expect(anomalas(res)).toEqual([t[2].id]);
    expect(res.get(t[2].id).traza).toMatchObject({ ventanaSegundos: 10, franja: 'MANANA', conteo: 3 });

    const u = ['19:59:55', '19:59:58', '20:00:03'].map((h) => txn('cambio2@c.com', `2026-09-23T${h}`));
    const res2 = detectar(u, { r: BASE });
    expect(anomalas(res2)).toEqual([]);
    expect(res2.get(u[2].id).traza).toMatchObject({ ventanaSegundos: 3, conteo: 1 });
  });

  test('cruce de medianoche: la noche sigue usando la ventana de 3 s', () => {
    const t = ['2026-09-23T23:59:58', '2026-09-24T00:00:00', '2026-09-24T00:00:01'].map((f) => txn('medianoche@m.com', f));
    const res = detectar(t, { r: BASE });
    expect(anomalas(res)).toEqual([t[2].id]);
    expect(res.get(t[2].id).anomalias[0]).toMatchObject({ franja: 'NOCHE_MADRUGADA', ventanaSegundos: 3 });
  });

  test('ventana por franja configurable', () => {
    const r = { ...BASE, franjasHorarias: { ...BASE.franjasHorarias, franjas: franjas.map((f) => ({ ...f, segundosVentana: f.nombre === 'NOCHE_MADRUGADA' ? 60 : f.segundosVentana })) } };
    const t = ['23:00:00', '23:00:30', '23:00:59'].map((h) => txn('cfg@c.com', `2026-09-23T${h}`));
    expect(detectar(t, { r }).get(t[2].id).anomalias[0]).toMatchObject({ ventanaSegundos: 60, cantidad: 3 });
  });

  test('anomalía entre dos lotes en la mañana: el histórico se carga con la ventana más grande', () => {
    expect(rangoHistorico([ms('2026-09-23T10:00:20')], BASE)).toEqual({ desdeMs: ms('2026-09-23T10:00:10'), hastaMs: ms('2026-09-23T10:00:30') });
    const historico = [txn('lote@l.com', '2026-09-23T10:00:11'), txn('lote@l.com', '2026-09-23T10:00:15')];
    const nueva = txn('lote@l.com', '2026-09-23T10:00:20');
    expect(detectar([nueva], { historico, r: BASE }).get(nueva.id).anomalias[0]).toMatchObject({ cantidad: 3, ventanaSegundos: 10 });
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
    expect(anomalas(res)).toHaveLength(10000 - 2);
  });
});
