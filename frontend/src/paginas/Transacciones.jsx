/** Lista de transacciones con filtros; permite eliminar (para limpiar pruebas). */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, consulta } from '../api/cliente';
import { ListaErrores } from '../componentes/PanelResultado';
import { fmtFecha, fmtPesos } from '../util/formato';

const VACIO = { usuario: '', estado: '', desde: '', hasta: '' };

export default function Transacciones() {
  const [params, setParams] = useSearchParams();
  const [filtros, setFiltros] = useState({ ...VACIO, ...Object.fromEntries(params) });
  const [pagina, setPagina] = useState(1);
  const [r, setR] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    api('GET', `/api/transacciones${consulta({ ...Object.fromEntries(params), limite: 50, pagina })}`).then(setR);
  }, [params, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  async function eliminar(t) {
    if (!window.confirm(`¿Eliminar la transacción ${t.idTxn}? También se eliminarán sus anomalías.`)) return;
    const res = await api('DELETE', `/api/transacciones/${t.idTxn}`);
    setAviso(res);
    cargar();
  }

  const set = (k) => (e) => setFiltros({ ...filtros, [k]: e.target.value });
  const total = r?.cuerpo?.total ?? 0;

  return (
    <>
      <div className="encabezado"><div><h1>Transacciones</h1></div></div>
      <form className="filtros tarjeta" onSubmit={(e) => { e.preventDefault(); setPagina(1); setParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v))); }}>
        <div><label htmlFor="t-usuario">Usuario</label><input id="t-usuario" value={filtros.usuario} onChange={set('usuario')} placeholder="correo o parte" /></div>
        <div><label htmlFor="t-estado">Estado</label><select id="t-estado" value={filtros.estado} onChange={set('estado')}><option value="">Todos</option><option>VALIDA</option><option>ANOMALA</option></select></div>
        <div><label htmlFor="t-desde">Desde</label><input id="t-desde" type="date" value={filtros.desde} onChange={set('desde')} /></div>
        <div><label htmlFor="t-hasta">Hasta</label><input id="t-hasta" type="date" value={filtros.hasta} onChange={set('hasta')} /></div>
        <div style={{ flex: '0 0 auto' }}><button className="primario" type="submit">Filtrar</button> <button type="button" onClick={() => { setFiltros(VACIO); setParams({}); }}>Limpiar</button></div>
      </form>
      {aviso && (aviso.ok ? <p className="aviso">✓ {aviso.cuerpo.mensaje}</p> : <div className="resultado mal"><ListaErrores errores={aviso.cuerpo.errores} /></div>)}
      {r && !r.ok && <div className="resultado mal"><h3>✕ Error</h3><ListaErrores errores={r.cuerpo.errores} /></div>}
      {r && r.ok && (
        <section className="tarjeta">
          <h2>{total} transacción(es)</h2>
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>idTxn</th><th>Usuario</th><th>Fecha</th><th className="num">Valor</th><th>Método</th><th>Estado</th><th className="num">Anomalías</th><th>Hash</th><th /></tr></thead>
              <tbody>
                {r.cuerpo.datos.map((t) => (
                  <tr key={t.idTxn} className={t.estado === 'ANOMALA' ? 'resaltada' : ''}>
                    <td className="mono">{t.idTxn}</td>
                    <td>{t.usuario}</td>
                    <td className="mono">{fmtFecha(t.fecha)}</td>
                    <td className="num">{fmtPesos(t.valor)}</td>
                    <td>{t.metodoPago}</td>
                    <td><span className={`insignia ${t.estado === 'ANOMALA' ? 'alerta' : 'ok'}`}>{t.estado}</span></td>
                    <td className="num">{t.totalAnomalias}</td>
                    <td className="mono" title={t.hash}>{t.hash.slice(0, 10)}…</td>
                    <td><button className="chico peligro" onClick={() => eliminar(t)}>Eliminar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="botones">
            <button disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
            <span className="muted" style={{ alignSelf: 'center' }}>Página {pagina} de {Math.max(1, Math.ceil(total / 50))}</span>
            <button disabled={pagina * 50 >= total} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
          </div>
        </section>
      )}
    </>
  );
}
