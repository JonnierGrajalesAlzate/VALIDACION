/**
 * Formulario de registro de transacciones.
 *
 * La validación del cliente es solo una AYUDA en vivo: la validación real y
 * definitiva la hace el backend. Por eso el botón "Enviar" no se bloquea
 * aunque haya errores: así se puede comprobar qué responde el servidor.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/cliente';
import PanelResultado from '../componentes/PanelResultado';
import { ahoraIsoLocal } from '../util/formato';

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const METODOS_POR_DEFECTO = ['Tarjeta', 'Efectivo', 'Nequi', 'Daviplata', 'Transferencia'];

const idNuevo = () => Number(String(Date.now()).slice(-9));

function formularioInicial() {
  return { idTxn: String(idNuevo()), user: 'aa@aa.com', date: ahoraIsoLocal(), value: '50000', paymentMethod: 'Tarjeta', hash: '' };
}

/** Validación en vivo (espejo simplificado de las reglas del backend). */
function validarCliente(f, metodos) {
  const e = {};
  if (!/^\d+$/.test(f.idTxn) || Number(f.idTxn) <= 0) e.idTxn = 'Debe ser un entero positivo.';
  if (!RE_CORREO.test(f.user)) e.user = 'Formato de correo inválido (ej. aa@aa.com).';
  const m = RE_FECHA.exec(f.date);
  if (!m) e.date = 'Formato esperado AAAA-MM-DDTHH:mm:ss.SSS';
  else {
    const dias = new Date(Number(m[1]), Number(m[2]), 0).getDate();
    if (Number(m[2]) < 1 || Number(m[2]) > 12) e.date = `El mes ${m[2]} no existe.`;
    else if (Number(m[3]) < 1 || Number(m[3]) > dias) e.date = `Ese mes tiene ${dias} días.`;
    else if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) e.date = 'Hora imposible.';
  }
  const v = Number(f.value);
  if (f.value.trim() === '' || !Number.isFinite(v)) e.value = 'Debe ser un número.';
  else if (v <= 0) e.value = 'Debe ser mayor que 0.';
  else if (!/^\d+(\.\d{1,2})?$/.test(f.value.trim())) e.value = 'Máximo 2 decimales.';
  if (!metodos.includes(f.paymentMethod)) e.paymentMethod = `Debe ser uno de: ${metodos.join(', ')}.`;
  if (f.hash && !/^[0-9a-fA-F]{64}$/.test(f.hash)) e.hash = 'Debe tener 64 caracteres hexadecimales (use "Calcular hash").';
  if (!f.hash) e.hash = 'Falta el hash: use "Calcular hash".';
  return e;
}

/** Convierte el formulario en la transacción con los TIPOS correctos. */
function aTransaccion(f) {
  return { idTxn: Number(f.idTxn), user: f.user, date: f.date, value: Number(f.value), paymentMethod: f.paymentMethod, hash: f.hash };
}

/** Los 3 casos de uso del enunciado (sin hash; se firman al cargarlos). */
function casoDeUso(n) {
  const base = idNuevo() * 10;
  const hoy = ahoraIsoLocal().slice(0, 10);
  const t = (i, user, hora) => ({ idTxn: base + i, user, date: `${hoy}T${hora}`, value: 9500, paymentMethod: 'Tarjeta' });
  if (n === 1) return [t(1, 'b@b.com', '10:00:01.000'), t(2, 'b@b.com', '10:00:02.000'), t(3, 'b@b.com', '10:00:03.000')];
  if (n === 2) return [t(1, 'c@c.com', '10:00:01.000'), t(2, 'c@c.com', '10:00:10.000'), t(3, 'c@c.com', '10:01:20.000')];
  return [t(1, 'x1@appresso.test', '10:00:01.000'), t(2, 'x2@appresso.test', '10:00:02.000'), t(3, 'x3@appresso.test', '10:00:03.000')];
}

const DESCRIPCION_CASO = {
  1: 'Caso 1 — b@b.com a las 10:00:01, :02, :03 → se espera ANOMALÍA en la tercera (si ya lo envió hoy, la ventana también contará las anteriores y el nivel subirá)',
  2: 'Caso 2 — c@c.com a las 10:00:01, 10:00:10, 10:01:20 → se espera NORMAL',
  3: 'Caso 3 — tres usuarios distintos a las 10:00:01, :02, :03 → se espera NORMAL',
};

export default function Registro() {
  const [f, setF] = useState(formularioInicial);
  const [tocado, setTocado] = useState({});
  const [metodos, setMetodos] = useState(METODOS_POR_DEFECTO);
  const [resultado, setResultado] = useState(null);
  const [cadena, setCadena] = useState('');
  const [lote, setLote] = useState('');
  const [notaLote, setNotaLote] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api('GET', '/api/config').then((r) => { if (r.ok) setMetodos(r.cuerpo.reglas.metodosPago); });
  }, []);

  const errores = useMemo(() => validarCliente(f, metodos), [f, metodos]);
  const cambiar = (campo) => (ev) => {
    setF({ ...f, [campo]: ev.target.value, ...(campo !== 'hash' ? { hash: '' } : {}) });
    setTocado({ ...tocado, [campo]: true });
    if (campo !== 'hash') setCadena('');
  };

  async function calcularHash(datos) {
    const r = await api('POST', '/api/dev/calcular-hash', datos);
    if (!r.ok) {
      setResultado(r.status === 404
        ? { ...r, cuerpo: { ...r.cuerpo, mensaje: 'El endpoint de desarrollo /api/dev/calcular-hash solo existe con NODE_ENV=development en backend/.env' } }
        : r);
      return null;
    }
    return r.cuerpo;
  }

  async function onCalcularHash() {
    setOcupado(true);
    const { hash, ...sinHash } = aTransaccion(f); // eslint-disable-line no-unused-vars
    const r = await calcularHash(sinHash);
    if (r) { setF({ ...f, hash: r.hash }); setCadena(r.cadenaFirmada); setTocado({ ...tocado, hash: true }); }
    setOcupado(false);
  }

  async function enviar(cuerpo) {
    setOcupado(true);
    const r = await api('POST', '/api/transacciones', cuerpo);
    setResultado(r);
    setOcupado(false);
    return r;
  }

  async function onEnviar(ev) {
    ev.preventDefault();
    setTocado({ idTxn: true, user: true, date: true, value: true, paymentMethod: true, hash: true });
    const r = await enviar(aTransaccion(f));
    if (r.status === 201) setF({ ...f, idTxn: String(idNuevo()), date: ahoraIsoLocal(), hash: '' });
  }

  async function onCorromperHash() {
    // Cambia el último carácter del hash: el servidor debe responder HASH_INVALIDO.
    let hash = f.hash;
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
      const { hash: _h, ...sinHash } = aTransaccion(f); // eslint-disable-line no-unused-vars
      const r = await calcularHash(sinHash);
      if (!r) return;
      hash = r.hash;
    }
    const corrupto = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0');
    setF({ ...f, hash: corrupto });
    await enviar({ ...aTransaccion(f), hash: corrupto });
  }

  async function onTipoIncorrecto() {
    // value e idTxn como STRING, firmados así: el error debe ser de TIPO, no de hash.
    const datos = { idTxn: String(f.idTxn), user: f.user, date: f.date, value: String(f.value), paymentMethod: f.paymentMethod };
    const r = await calcularHash(datos);
    if (!r) return;
    await enviar({ ...datos, hash: r.hash });
  }

  async function onCargarCaso(n) {
    setOcupado(true);
    const r = await calcularHash(casoDeUso(n));
    setOcupado(false);
    if (!r) return;
    setLote(JSON.stringify(r.resultados.map((x) => x.transaccion), null, 2));
    setNotaLote(DESCRIPCION_CASO[n]);
  }

  async function onEnviarLote() {
    // Se envía el texto TAL CUAL (si está malformado, el backend responde 400 con línea y columna).
    await enviar(lote);
  }

  const err = (campo) => (tocado[campo] && errores[campo] ? <div className="error-campo">{errores[campo]}</div> : null);
  const cls = (campo) => `campo ${tocado[campo] && errores[campo] ? 'invalido' : ''}`;

  return (
    <>
      <div className="encabezado">
        <div>
          <h1>Registrar transacciones</h1>
          <p>Validación en vivo en el navegador; la validación definitiva (tipos estrictos y hash) la hace el backend.</p>
        </div>
      </div>

      <div className="grid g2">
        <section className="tarjeta">
          <h2>Una transacción</h2>
          <form onSubmit={onEnviar} noValidate>
            <div className="fila">
              <div className={cls('idTxn')}>
                <label htmlFor="idTxn">idTxn</label>
                <input id="idTxn" inputMode="numeric" value={f.idTxn} onChange={cambiar('idTxn')} />
                {err('idTxn')}
              </div>
              <div className={cls('user')}>
                <label htmlFor="user">user (correo)</label>
                <input id="user" type="email" value={f.user} onChange={cambiar('user')} />
                {err('user')}
              </div>
            </div>
            <div className="fila">
              <div className={cls('date')}>
                <label htmlFor="date">date (ISO 8601, hora de Bogotá si no trae zona)</label>
                <input id="date" className="mono" value={f.date} onChange={cambiar('date')} />
                {err('date')}
                <div className="botones"><button type="button" className="chico" onClick={() => setF({ ...f, date: ahoraIsoLocal(), hash: '' })}>Ahora</button></div>
              </div>
              <div className={cls('value')}>
                <label htmlFor="value">value (COP)</label>
                <input id="value" inputMode="decimal" value={f.value} onChange={cambiar('value')} />
                {err('value')}
              </div>
            </div>
            <div className={cls('paymentMethod')}>
              <label htmlFor="paymentMethod">paymentMethod</label>
              <select id="paymentMethod" value={f.paymentMethod} onChange={cambiar('paymentMethod')}>
                {metodos.map((m) => <option key={m}>{m}</option>)}
              </select>
              {err('paymentMethod')}
            </div>
            <div className={cls('hash')}>
              <label htmlFor="hash">hash (HMAC-SHA256, 64 hex)</label>
              <input id="hash" className="mono" value={f.hash} onChange={cambiar('hash')} placeholder="Use «Calcular hash»" />
              {err('hash')}
              {cadena && <div className="ayuda">Cadena firmada: <code>{cadena}</code></div>}
            </div>
            <div className="botones">
              <button type="button" onClick={onCalcularHash} disabled={ocupado}>Calcular hash</button>
              <button type="submit" className="primario" disabled={ocupado}>Enviar</button>
            </div>
            <div className="botones">
              <button type="button" className="peligro" onClick={onCorromperHash} disabled={ocupado}>Corromper hash y enviar</button>
              <button type="button" className="peligro" onClick={onTipoIncorrecto} disabled={ocupado}>Enviar con tipo incorrecto</button>
            </div>
          </form>
        </section>

        <section className="tarjeta">
          <h2>Lote en JSON</h2>
          <p className="sub">Pegue un arreglo de transacciones o cargue un caso de uso (se firma con el endpoint de desarrollo y con ids nuevos).</p>
          <div className="botones">
            <button type="button" onClick={() => onCargarCaso(1)} disabled={ocupado}>Caso 1 · anomalía</button>
            <button type="button" onClick={() => onCargarCaso(2)} disabled={ocupado}>Caso 2 · normal</button>
            <button type="button" onClick={() => onCargarCaso(3)} disabled={ocupado}>Caso 3 · usuarios distintos</button>
          </div>
          {notaLote && <p className="aviso">{notaLote}</p>}
          <label htmlFor="lote">JSON</label>
          <textarea id="lote" rows={16} value={lote} onChange={(e) => { setLote(e.target.value); setNotaLote(''); }} placeholder='[ { "idTxn": 10001, "user": "aa@aa.com", ... } ]' spellCheck={false} />
          <div className="botones">
            <button type="button" className="primario" onClick={onEnviarLote} disabled={ocupado || !lote.trim()}>Enviar lote</button>
            <button type="button" onClick={() => { setLote(''); setNotaLote(''); }} disabled={!lote}>Limpiar</button>
          </div>
        </section>
      </div>

      <section style={{ marginTop: '1rem' }}>
        <h2>Resultado</h2>
        {resultado ? <PanelResultado resultado={resultado} /> : <p className="aviso">Aquí aparecerá la respuesta del servidor. Los errores también se imprimen en la consola del navegador (F12) con su requestId.</p>}
      </section>
    </>
  );
}
