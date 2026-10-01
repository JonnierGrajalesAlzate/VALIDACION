/**
 * Ayudas para armar transacciones de prueba con hash válido.
 */
const { calcularHash } = require('../../src/hashing');

let contador = 50000;

/** Crea una transacción válida (firmada) con los cambios indicados. */
function txn(cambios = {}) {
  contador += 1;
  const base = {
    idTxn: contador,
    user: 'aa@aa.com',
    date: '2026-09-23T10:30:01.120',
    value: 50000,
    paymentMethod: 'Tarjeta',
    ...cambios,
  };
  delete base.hash;
  return { ...base, hash: calcularHash(base).hash };
}

/** Igual que txn() pero aplica `alterar` DESPUÉS de firmar (para romper tipos con hash "correcto"). */
function txnFirmadaYAlterada(cambios, alterar) {
  const t = txn(cambios);
  return { ...t, ...alterar };
}

module.exports = { txn, txnFirmadaYAlterada };
