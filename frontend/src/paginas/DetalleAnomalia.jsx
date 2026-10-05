import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/cliente';
import { ListaErrores } from '../componentes/PanelResultado';
import { ESTADO_REVISION, NOMBRE_TIPO, fmtFecha, fmtPesos } from '../util/formato';

function LineaTiempo({ lt }) {
  const txns = lt.transacciones;
  if (!txns.length) return null;
  const ms = txns.map((t) => new Date(t.fecha).getTime());
  const min = Math.min(...ms);
  const max = Math.max(...ms);
  const rango = Math.max(1, max - min);
  const pos = (m) => 4 + ((m - min) / rango) * 92;
  const involucradas = txns.filter((t) => t.involucrada);
  const ini = Math.min(...involucradas.map((t) => new Date(t.fecha).getTime()));
  const fin = Math.max(...involucradas.map((t) => new Date(t.fecha).getTime()));

  return (
    <div className="linea" aria-label="Línea de tiempo de las transacciones del usuario">
      <div className="eje-t" />
      {involucradas.length > 0 && (
        <div className="ventana" style={{ left: `${pos(ini) - 1.5}%`, width: `${pos(fin) - pos(ini) + 3}%` }} title="Ventana en el momento del disparo" />
      )}
      {txns.map((t, i) => {
        const m = new Date(t.fecha).getTime();
        return (
          <div key={t.idTxn}>
            <div className={`txn ${t.involucrada ? 'dentro' : ''} ${t.esDisparadora ? 'disparo' : ''}`} style={{ left: `${pos(m)}%` }} title={`idTxn ${t.idTxn} · ${fmtFecha(t.fecha)}`} />
            <div className={`etq ${i % 2 ? 'abajo' : ''}`} style={{ left: `${pos(m)}%` }}>
              {t.idTxn}<br />{fmtFecha(t.fecha).slice(11)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Revision({ anomalia, alCambiar }) {
  const [nota, setNota] = useState(anomalia.notaRevision || '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const estado = ESTADO_REVISION[anomalia.estadoRevision];
  const cerrada = ['REVISADA', 'DESCARTADA'].includes(anomalia.estadoRevision);

  async function cambiar(estadoRevision) {
    setEnviando(true);
    const cuerpo = { estadoRevision };
    if (nota.trim() !== (anomalia.notaRevision || '')) cuerpo.nota = nota.trim() || null;
    const r = await api('PATCH', `/api/anomalias/${anomalia.id}`, cuerpo);
    setEnviando(false);
    if (r.ok) { setError(null); alCambiar(r.cuerpo.anomalia); } else setError(r);
  }

  return (
    <section className="tarjeta" style={{ marginBottom: '1rem' }}>
      <h2>Revisión</h2>
      <p style={{ margin: '0 0 0.6rem' }}>
        <span className={`insignia ${estado.clase}`}>{estado.texto}</span>{' '}
        <span className="muted">{estado.ayuda}{anomalia.fechaRevision ? ` · cerrada el ${fmtFecha(anomalia.fechaRevision, { ms: false })}` : ''}</span>
      </p>
      <div className="campo">
        <label htmlFor="nota-revision">Nota de revisión (opcional, máx. 500)</label>
        <textarea id="nota-revision" rows={2} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} style={{ fontFamily: 'inherit' }} placeholder="Qué se verificó y con quién" />
      </div>
      <div className="botones">
        {anomalia.estadoRevision !== 'ABIERTA' && <button disabled={enviando} onClick={() => cambiar('ABIERTA')}>{cerrada ? 'Reabrir' : 'Abrir revisión'}</button>}
        {anomalia.estadoRevision !== 'REVISADA' && <button className="primario" disabled={enviando} onClick={() => cambiar('REVISADA')}>Marcar revisada</button>}
        {anomalia.estadoRevision !== 'DESCARTADA' && <button disabled={enviando} onClick={() => cambiar('DESCARTADA')}>Descartar (falso positivo)</button>}
        {nota.trim() !== (anomalia.notaRevision || '') && <button disabled={enviando} onClick={() => cambiar(anomalia.estadoRevision === 'NUEVA' ? 'ABIERTA' : anomalia.estadoRevision)}>Guardar nota</button>}
      </div>
      {error && <ListaErrores errores={error.cuerpo.errores} />}
    </section>
  );
}

export default function DetalleAnomalia() {
  const { id } = useParams();
  const [r, setR] = useState(null);
  useEffect(() => { api('GET', `/api/anomalias/${id}`).then(setR); }, [id]);
  const actualizarAnomalia = (anomalia) => setR((prev) => ({ ...prev, cuerpo: { ...prev.cuerpo, anomalia } }));

  if (!r) return <p className="vacio">Cargando…</p>;
  if (!r.ok) {
    return (
      <div className="resultado mal">
        <h3>✕ No se pudo cargar la anomalía {id}</h3>
        <div className="meta">HTTP {r.status} · requestId <code>{r.requestId}</code></div>
        <ListaErrores errores={r.cuerpo.errores} />
        <Link to="/anomalias">← Volver</Link>
      </div>
    );
  }
  const { anomalia: a, lineaTiempo: lt, nota } = r.cuerpo;

  return (
    <>
      <div className="encabezado">
        <div>
          <p><Link to="/anomalias">← Anomalías</Link></p>
          <h1>Anomalía #{a.id} · {NOMBRE_TIPO[a.tipo]}</h1>
          <p>{a.usuario} · disparada por idTxn <b className="mono">{a.idTxn}</b> el {fmtFecha(a.fechaTxn)}</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="etiqueta">Nivel</div><div className="valor">{a.nivel}</div></div>
        <div className="kpi"><div className="etiqueta">Transacciones en la ventana</div><div className="valor">{a.cantidadTransacciones}</div></div>
        <div className="kpi"><div className="etiqueta">Ventana usada</div><div className="valor">{a.ventanaSegundos} s</div>{lt.franja && <div className="detalle">Franja {lt.franja}</div>}</div>
        <div className="kpi"><div className="etiqueta">Valor de la transacción</div><div className="valor">{fmtPesos(a.valor)}</div><div className="detalle">{a.metodoPago}</div></div>
      </div>

      <Revision key={`${a.id}-${a.estadoRevision}-${a.notaRevision}`} anomalia={a} alCambiar={actualizarAnomalia} />

      <section className="tarjeta">
        <h2>Línea de tiempo</h2>
        <p className="sub">{lt.descripcion}. Rango mostrado: {fmtFecha(lt.rango.desde)} → {fmtFecha(lt.rango.hasta)}</p>
        <div className="leyenda">
          <span><i className="cuadro" style={{ background: 'var(--critical)', borderRadius: '50%' }} />Disparó la anomalía</span>
          <span><i className="cuadro" style={{ background: 'var(--series-1)', borderRadius: '50%' }} />Dentro de la ventana</span>
          <span><i className="cuadro" style={{ background: 'var(--muted)', borderRadius: '50%' }} />Fuera de la ventana</span>
        </div>
        <LineaTiempo lt={lt} />
        <div className="tabla-scroll">
          <table>
            <thead><tr><th>idTxn</th><th>Fecha</th><th className="num">Δ respecto al disparo</th><th>Estado</th><th>Método</th><th className="num">Valor</th><th>En la ventana</th></tr></thead>
            <tbody>
              {lt.transacciones.map((t) => (
                <tr key={t.idTxn} className={t.esDisparadora ? 'resaltada' : t.involucrada ? '' : 'fuera'}>
                  <td className="mono">{t.idTxn}{t.esDisparadora && ' ⚑'}</td>
                  <td className="mono">{fmtFecha(t.fecha)}</td>
                  <td className="num mono">{`${t.segundosRespectoDisparo > 0 ? '+' : ''}${t.segundosRespectoDisparo.toFixed(3)} s`}</td>
                  <td><span className={`insignia ${t.estado === 'ANOMALA' ? 'alerta' : 'ok'}`}>{t.estado}</span></td>
                  <td>{t.metodoPago}</td>
                  <td className="num">{fmtPesos(t.valor)}</td>
                  <td>{t.involucrada ? 'Sí' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {lt.pasos.length > 0 && (
        <section className="tarjeta" style={{ marginTop: '1rem' }}>
          <h2>Recorrido de la ventana deslizante</h2>
          <p className="sub">Cada paso: entra una transacción, salen por el inicio las que quedaron a más de {a.ventanaSegundos} s, y se cuenta lo que queda.</p>
          <ol className="pasos">
            {lt.pasos.map((p, i) => (
              <li key={i} className={p.esPasoDisparo ? 'disparo' : ''}>
                <span className="n">{i + 1}</span>
                <div>
                  <b>Entra</b> <code>{p.entro}</code> ({fmtFecha(p.fecha).slice(11)})
                  {p.salieron.length > 0 && <> · <b>salen</b> <code>{p.salieron.join(', ')}</code></>}
                  <br />
                  Ventana: [<code>{p.enVentana.join(', ')}</code>] → <b>{p.conteo}</b> transacción(es)
                  {p.esPasoDisparo && <> · <span className="insignia alerta">umbral superado</span></>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <p className="aviso" style={{ marginTop: '1rem' }}>{nota}</p>
    </>
  );
}
