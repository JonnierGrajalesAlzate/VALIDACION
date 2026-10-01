/** Lista de anomalías con filtros (tipo, nivel, fechas, usuario). */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, consulta } from '../api/cliente';
import { ListaErrores } from '../componentes/PanelResultado';
import { NOMBRE_TIPO, fmtFecha, fmtPesos } from '../util/formato';

const VACIO = { tipo: '', nivel: '', desde: '', hasta: '', usuario: '' };

export default function Anomalias() {
  const [params, setParams] = useSearchParams();
  const [filtros, setFiltros] = useState({ ...VACIO, ...Object.fromEntries(params) });
  const [pagina, setPagina] = useState(1);
  const [r, setR] = useState(null);

  useEffect(() => {
    const aplicados = Object.fromEntries(params);
    api('GET', `/api/anomalias${consulta({ ...aplicados, limite: 50, pagina })}`).then(setR);
  }, [params, pagina]);

  const aplicar = (ev) => {
    ev.preventDefault();
    setPagina(1);
    setParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)));
  };
  const set = (k) => (e) => setFiltros({ ...filtros, [k]: e.target.value });
  const total = r?.cuerpo?.total ?? 0;

  return (
    <>
      <div className="encabezado"><div><h1>Anomalías</h1><p>El rango de fechas se aplica sobre la fecha de la transacción.</p></div></div>
      <form className="filtros tarjeta" onSubmit={aplicar}>
        <div><label htmlFor="f-tipo">Tipo</label>
          <select id="f-tipo" value={filtros.tipo} onChange={set('tipo')}><option value="">Todos</option><option value="POSIBLE_FRAUDE">Posible fraude</option><option value="EXCESO_FRANJA_HORARIA">Exceso franja</option></select></div>
        <div><label htmlFor="f-nivel">Nivel</label>
          <select id="f-nivel" value={filtros.nivel} onChange={set('nivel')}><option value="">Todos</option><option>BAJO</option><option>MEDIO</option><option>ALTO</option></select></div>
        <div><label htmlFor="f-desde">Desde</label><input id="f-desde" type="date" value={filtros.desde} onChange={set('desde')} /></div>
        <div><label htmlFor="f-hasta">Hasta</label><input id="f-hasta" type="date" value={filtros.hasta} onChange={set('hasta')} /></div>
        <div><label htmlFor="f-usuario">Usuario</label><input id="f-usuario" value={filtros.usuario} onChange={set('usuario')} placeholder="correo o parte" /></div>
        <div style={{ flex: '0 0 auto' }}><button className="primario" type="submit">Filtrar</button> <button type="button" onClick={() => { setFiltros(VACIO); setParams({}); }}>Limpiar</button></div>
      </form>

      {r && !r.ok && <div className="resultado mal"><h3>✕ Error</h3><ListaErrores errores={r.cuerpo.errores} /></div>}
      {r && r.ok && (
        <section className="tarjeta">
          <h2>{total} anomalía(s)</h2>
          {total === 0 ? <p className="vacio">No hay anomalías con esos filtros.</p> : (
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>#</th><th>Tipo</th><th>Nivel</th><th className="num">Txn en ventana</th><th className="num">Ventana (s)</th><th>idTxn</th><th>Usuario</th><th>Fecha txn</th><th>Método</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {r.cuerpo.datos.map((a) => (
                    <tr key={a.id}>
                      <td><Link to={`/anomalias/${a.id}`}>{a.id}</Link></td>
                      <td><span className="insignia alerta">{NOMBRE_TIPO[a.tipo]}</span></td>
                      <td>{a.nivel}</td>
                      <td className="num">{a.cantidadTransacciones}</td>
                      <td className="num">{a.ventanaSegundos}</td>
                      <td className="mono">{a.idTxn}</td>
                      <td>{a.usuario}</td>
                      <td className="mono">{fmtFecha(a.fechaTxn)}</td>
                      <td>{a.metodoPago}</td>
                      <td className="num">{fmtPesos(a.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
