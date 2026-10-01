/** Ver y cambiar las reglas (GET/PUT /api/config): ventana, umbral, franjas, niveles. */
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
  const actualizarVentana = (k) => (e) => {
    // Se envía como número; si no es entero el backend lo rechaza con el detalle.
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
            <div className="campo"><label htmlFor="c-seg">Tamaño de la ventana (segundos)</label><input id="c-seg" type="number" min="1" value={v.segundos} onChange={actualizarVentana('segundos')} /></div>
            <div className="campo"><label htmlFor="c-umb">Umbral (transacciones)</label><input id="c-umb" type="number" min="2" value={v.umbral} onChange={actualizarVentana('umbral')} /></div>
          </div>
          <p className="aviso">Regla: {v.umbral} o más transacciones del mismo usuario con (fecha_actual − fecha_txn) ≤ {v.segundos} s → POSIBLE_FRAUDE.</p>
          <h2 style={{ marginTop: '1rem' }}>Franjas horarias ({reglas.franjasHorarias.activo ? `activas, modo ${reglas.franjasHorarias.modo}` : 'desactivadas'})</h2>
          <table>
            <thead><tr><th>Franja</th><th>Desde</th><th>Hasta</th><th className="num">Límite</th></tr></thead>
            <tbody>{reglas.franjasHorarias.franjas.map((f) => <tr key={f.nombre}><td>{f.nombre}</td><td className="mono">{f.desde}</td><td className="mono">{f.hasta}</td><td className="num">{f.limite}</td></tr>)}</tbody>
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
