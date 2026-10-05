const { calcularHash } = require('../../src/hashing');

let contador = 50000;

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

function txnFirmadaYAlterada(cambios, alterar) {
  const t = txn(cambios);
  return { ...t, ...alterar };
}

module.exports = { txn, txnFirmadaYAlterada };
