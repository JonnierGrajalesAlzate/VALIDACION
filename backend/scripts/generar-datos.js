const fs = require('fs');
const { DateTime } = require('luxon');
const env = require('../src/config/env');
const { generarTransacciones, firmar, crearAleatorio } = require('./lib/generador');

function leerOpciones(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const clave = argv[i].slice(2);
    const siguiente = argv[i + 1];
    if (siguiente === undefined || siguiente.startsWith('--')) o[clave] = true;
    else {
      o[clave] = siguiente;
      i += 1;
    }
  }
  return o;
}

function casosDeUso(idInicial, dia) {
  let id = idInicial;
  const t = (user, hora) => ({ idTxn: id++, user, date: `${dia}T${hora}`, value: 9500, paymentMethod: 'Tarjeta' });
  return [
    t('b@b.com', '10:00:01'), t('b@b.com', '10:00:02'), t('b@b.com', '10:00:03'),
    t('c@c.com', '10:00:01'), t('c@c.com', '10:00:10'), t('c@c.com', '10:01:20'),
    t('d@d.com', '10:00:01'), t('e@e.com', '10:00:02'), t('f@f.com', '10:00:03'),
  ];
}

function invalidas(n, idInicial, rnd) {
  let id = idInicial;
  const base = () => firmar({ idTxn: id++, user: 'error@appresso.test', date: '2026-09-23T10:30:01.120', value: 50000, paymentMethod: 'Tarjeta' });
  const generadores = [
    () => ({ ...base(), value: '50000' }),
    () => ({ ...base(), idTxn: String(id) }),
    () => { const t = base(); delete t.paymentMethod; return t; },
    () => ({ ...base(), descuento: 10 }),
    () => ({ ...base(), user: 'correo-invalido' }),
    () => ({ ...base(), date: '2026-02-30T10:00:00' }),
    () => ({ ...base(), value: -100 }),
    () => ({ ...base(), hash: 'f'.repeat(64) }),
    () => ({ ...base(), paymentMethod: 'Bitcoin' }),
  ];
  return Array.from({ length: n }, (_, i) => generadores[i % generadores.length](rnd));
}

async function main() {
  const o = leerOpciones(process.argv.slice(2));
  const dias = Number(o['cantidad-dias'] || 7);
  const desde = o.desde || DateTime.now().setZone(env.TZ_NEGOCIO).minus({ days: dias - 1 }).toISODate();
  const nUsuarios = Number(o.usuarios || 8);
  const idInicial = Number(o['id-inicial'] || (Math.floor(Date.now() / 1000) % 100000000) * 10);
  const rnd = crearAleatorio(idInicial);

  const usuarios = Array.from({ length: nUsuarios }, (_, i) => `usuario${i + 1}@appresso.test`);
  let lista = generarTransacciones({
    desde, dias, usuarios, porDia: Number(o['por-dia'] || 15), rafagas: Number(o.rafagas || 4), idInicial, semilla: idInicial,
  }).map(firmar);

  if (o.casos) lista = lista.concat(casosDeUso(idInicial + lista.length + 1, desde).map(firmar));
  if (o.invalidas) lista = lista.concat(invalidas(Number(o.invalidas), idInicial + lista.length + 100, rnd));

  const json = JSON.stringify(lista, null, 2);
  if (o.salida) {
    fs.writeFileSync(o.salida, `${json}\n`, 'utf8');
    console.log(`[OK] ${lista.length} transacciones guardadas en ${o.salida} (firmadas con el HMAC_SECRET del .env)`);
  } else if (!o.enviar) {
    console.log(json);
  }

  if (o.enviar) {
    const r = await fetch(o.enviar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
    const cuerpo = await r.json();
    console.log(`[HTTP ${r.status}] requestId=${cuerpo.requestId} → ${cuerpo.mensaje || ''}`);
    for (const rech of cuerpo.rechazadas || []) {
      for (const e of rech.errores) console.log(`   ✗ [${e.etapa}] ${rech.idTxn ?? `posición ${rech.posicion}`}: ${e.mensaje}`);
    }
  }
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
});
