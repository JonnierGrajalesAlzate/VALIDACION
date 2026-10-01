/**
 * Generador de transacciones de prueba (lo usan generar-datos.js y generar-seed.js).
 * Usa un generador pseudoaleatorio con semilla: con la misma semilla
 * siempre produce los mismos datos (reproducible).
 */
const { DateTime } = require('luxon');
const { calcularHash } = require('../../src/hashing');
const env = require('../../src/config/env');

/** PRNG mulberry32: pequeño, rápido y determinista. */
function crearAleatorio(semilla = 2026) {
  let a = semilla >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.entero = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
  rnd.elegir = (lista) => lista[Math.floor(rnd() * lista.length)];
  return rnd;
}

const METODOS = ['Tarjeta', 'Tarjeta', 'Nequi', 'Nequi', 'Daviplata', 'Efectivo', 'Transferencia'];
const PRECIOS = [4500, 6000, 7800, 9500, 12000, 15500, 18000, 22000, 35000, 50000];

/** Fecha local (Bogotá) sin zona con milisegundos: "2026-09-23T10:30:01.120". */
function textoFecha(dt) {
  return dt.setZone(env.TZ_NEGOCIO).toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS");
}

/** Firma una transacción (sin hash) y la devuelve con su hash. */
function firmar(t) {
  return { ...t, hash: calcularHash(t).hash };
}

/**
 * Genera transacciones "normales" a lo largo de varios días, con hora más
 * probable en la mañana, más algunas ráfagas sospechosas.
 */
function generarTransacciones({ desde, dias, usuarios, porDia, rafagas, idInicial, semilla }) {
  const rnd = crearAleatorio(semilla);
  const lista = [];
  let id = idInicial;
  const inicio = DateTime.fromISO(desde, { zone: env.TZ_NEGOCIO }).startOf('day');

  for (let d = 0; d < dias; d += 1) {
    const dia = inicio.plus({ days: d });
    const n = rnd.entero(Math.max(1, porDia - 4), porDia + 4);
    for (let i = 0; i < n; i += 1) {
      // Horas pico de una cafetería: 7-10 a. m. y 2-5 p. m.; pocas de noche.
      const r = rnd();
      const hora = r < 0.45 ? rnd.entero(6, 10) : r < 0.85 ? rnd.entero(12, 18) : rnd.elegir([19, 20, 21, 22, 23, 0, 1, 5]);
      const dt = dia.set({ hour: hora, minute: rnd.entero(0, 59), second: rnd.entero(0, 59), millisecond: rnd.entero(0, 999) });
      lista.push({ idTxn: id++, user: rnd.elegir(usuarios), date: textoFecha(dt), value: rnd.elegir(PRECIOS), paymentMethod: rnd.elegir(METODOS) });
    }
  }

  // Ráfagas: 3 a 6 compras del mismo usuario en menos de 3 segundos (posible fraude).
  for (let k = 0; k < rafagas; k += 1) {
    const usuario = rnd.elegir(usuarios);
    const dia = inicio.plus({ days: rnd.entero(0, dias - 1) });
    const hora = rnd.elegir([8, 9, 11, 15, 16, 21, 23]);
    let dt = dia.set({ hour: hora, minute: rnd.entero(0, 59), second: rnd.entero(0, 50), millisecond: rnd.entero(0, 999) });
    const tam = rnd.entero(3, 6);
    const metodo = rnd.elegir(METODOS);
    for (let j = 0; j < tam; j += 1) {
      lista.push({ idTxn: id++, user: usuario, date: textoFecha(dt), value: rnd.elegir(PRECIOS), paymentMethod: metodo });
      dt = dt.plus({ milliseconds: rnd.entero(150, 900) });
    }
  }
  return lista;
}

module.exports = { crearAleatorio, generarTransacciones, firmar, textoFecha };
