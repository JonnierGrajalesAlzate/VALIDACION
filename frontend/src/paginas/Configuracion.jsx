import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import PanelResultado from '../componentes/PanelResultado';

export default function Configuracion() {
  const [reglas, setReglas] = useState(null);
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState(null);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    api('GET', '/api/config').then((r) => {
      if (r.ok) { setReglas(r.cuerpo.reglas); setTexto(JSON.stringify(r.cuerpo.reglas, null, 2)); } else setResultado(r);
    });
  }, []);

  if (!reglas) return resultado ? <PanelResultado resultado={resultado} /> : <p className="vacio">Cargando…</p>;

  const v = reglas.ventanaDeslizante;
  const fh = reglas.franjasHorarias;
  const actualizarVentana = (k) => (e) => {
    const nuevas = { ...reglas, ventanaDeslizante: { ...v, [k]: e.target.value === '' ? '' : Number(e.target.value) } };
    setReglas(nuevas);
    setTexto(JSON.stringify(nuevas, null, 2));
  };

  async function guardar() {
    setAviso('');
    const r = await api('PUT', '/api/config', texto);
    if (r.ok) {
      setReglas(r.cuerpo.reglas);
      setTexto(JSON.stringify(r.cuerpo.reglas, null, 2));
      setResultado(null);
      setAviso(`✓ ${r.cuerpo.mensaje}`);
    } else setResultado(r);
  }

  return (
    <>
      <div className="encabezado"><div><h1>Configuración</h1><p>Se guarda en <code>backend/config/reglas.json</code>. Aplica a las transacciones que lleguen después.</p></div></div>
      <div className="grid g2">
        <section className="tarjeta">
          <h2>Ventana deslizante</h2>
          <div className="fila">
            <div className="campo"><label htmlFor="c-seg">Ventana fija sin franjas (segundos)</label><input id="c-seg" type="number" min="1" value={v.segundos} onChange={actualizarVentana('segundos')} disabled={fh.activo} title={fh.activo ? 'Con las franjas activas, la ventana depende de la hora de la transacción' : undefined} /></div>
            <div className="campo"><label htmlFor="c-umb">Umbral (transacciones)</label><input id="c-umb" type="number" min="2" value={v.umbral} onChange={actualizarVentana('umbral')} /></div>
          </div>
          <p className="aviso">Regla: {v.umbral} o más transacciones del mismo usuario con (fecha_actual − fecha_txn) ≤ {fh.activo ? 'la ventana de la franja de la transacción' : `${v.segundos} s`} → POSIBLE_FRAUDE.</p>
          <h2 style={{ marginTop: '1rem' }}>Ventana por franja horaria ({fh.activo ? 'activa' : 'desactivada: se usa la ventana fija'})</h2>
          <table>
            <thead><tr><th>Franja</th><th>Desde</th><th>Hasta</th><th className="num">Ventana</th></tr></thead>
            <tbody>{fh.franjas.map((f) => <tr key={f.nombre}><td>{f.nombre}</td><td className="mono">{f.desde}</td><td className="mono">{f.hasta}</td><td className="num">{f.segundosVentana} s</td></tr>)}</tbody>
          </table>
          <p className="sub" style={{ marginTop: '0.5rem' }}>Niveles: MEDIO desde excedente {reglas.niveles.medioDesdeExcedente}, ALTO desde {reglas.niveles.altoDesdeExcedente}. Modo de hash: {reglas.hash.modo}.</p>
        </section>
        <section className="tarjeta">
          <h2>Editar JSON completo</h2>
          <textarea rows={22} value={texto} onChange={(e) => setTexto(e.target.value)} spellCheck={false} aria-label="Reglas en JSON" />
          <div className="botones"><button className="primario" onClick={guardar}>Guardar</button></div>
          {aviso && <p className="aviso">{aviso}</p>}
        </section>
      </div>
      {resultado && <div style={{ marginTop: '1rem' }}><PanelResultado resultado={resultado} /></div>}
    </>
  );
}
