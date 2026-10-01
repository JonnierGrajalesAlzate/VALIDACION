/**
 * Muestra la respuesta de la API de forma legible:
 *  - aceptada / rechazada / anomalía detectada (ícono + texto, no solo color)
 *  - cada error campo por campo: etapa, código, mensaje, recibido y esperado
 *  - el requestId, para buscarlo en backend/logs/app.log
 */
import { Link } from 'react-router-dom';
import { NOMBRE_TIPO, fmtFecha } from '../util/formato';

function mostrar(valor) {
  if (valor === null || valor === undefined) return <span className="muted">—</span>;
  if (typeof valor === 'string') return <code>"{valor}"</code>;
  return <code>{JSON.stringify(valor)}</code>;
}

export function ListaErrores({ errores }) {
  if (!errores || !errores.length) return null;
  return errores.map((e, i) => (
    <div className="error-item" key={i}>
      <div className="titulo">
        <span className="insignia mal">{e.codigo}</span>
        {e.etapa && <span className="insignia">{e.etapa}</span>}
        {e.idTxn !== null && e.idTxn !== undefined && <span className="mono">idTxn={e.idTxn}</span>}
        {e.posicion !== undefined && <span className="mono">posición {e.posicion}</span>}
        {e.campo && <span>campo <b className="mono">{e.campo}</b></span>}
      </div>
      <p className="mensaje">{e.mensaje}</p>
      {(e.recibido !== null || e.esperado) && (
        <dl>
          <dt>recibido</dt>
          <dd>{mostrar(e.recibido)}{e.tipoRecibido ? <span className="muted"> ({e.tipoRecibido})</span> : null}</dd>
          <dt>esperado</dt>
          <dd>{e.esperado ?? '—'}</dd>
          {e.codigoPg && (<><dt>PostgreSQL</dt><dd className="mono">{e.codigoPg}: {e.mensajePg}</dd></>)}
        </dl>
      )}
    </div>
  ));
}

export default function PanelResultado({ resultado }) {
  if (!resultado) return null;
  const { status, cuerpo, requestId } = resultado;
  const aceptadas = cuerpo.aceptadas || [];
  const rechazadas = cuerpo.rechazadas || [];
  const conAnomalia = aceptadas.filter((a) => a.estado === 'ANOMALA');

  let clase = 'mal';
  let titulo = 'Rechazada';
  let icono = '✕';
  if (cuerpo.ok && conAnomalia.length) { clase = 'alerta'; titulo = `Aceptada con ${conAnomalia.length === 1 ? 'anomalía detectada' : `${conAnomalia.length} transacciones anómalas`}`; icono = '⚠'; }
  else if (cuerpo.ok && rechazadas.length) { clase = 'alerta'; titulo = 'Lote parcialmente aceptado'; icono = '⚠'; }
  else if (cuerpo.ok) { clase = 'ok'; titulo = aceptadas.length > 1 ? 'Lote aceptado' : 'Aceptada'; icono = '✓'; }

  // Errores generales (sin aceptadas/rechazadas): parseo, recepción, BD...
  const erroresGenerales = !cuerpo.aceptadas && cuerpo.errores ? cuerpo.errores.map((e) => ({ etapa: cuerpo.etapa, ...e })) : [];

  return (
    <div className={`resultado ${clase}`} role="status" aria-live="polite">
      <h3><span aria-hidden="true">{icono}</span> {titulo}</h3>
      <div className="meta">
        HTTP <b>{status || 'sin respuesta'}</b> · etapa <b>{cuerpo.etapa}</b> · requestId <code>{requestId}</code>
      </div>
      {cuerpo.mensaje && <p style={{ margin: '0 0 0.5rem' }}>{cuerpo.mensaje}</p>}

      {aceptadas.length > 0 && (
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr><th>idTxn</th><th>Usuario</th><th>Fecha</th><th>Estado</th><th>Ventana al entrar</th><th>Anomalías</th></tr>
            </thead>
            <tbody>
              {aceptadas.map((a) => (
                <tr key={a.idTxn} className={a.estado === 'ANOMALA' ? 'resaltada' : ''}>
                  <td className="mono">{a.idTxn}</td>
                  <td>{a.usuario}</td>
                  <td className="mono">{fmtFecha(a.fecha)}</td>
                  <td><span className={`insignia ${a.estado === 'ANOMALA' ? 'alerta' : 'ok'}`}>{a.estado}</span></td>
                  <td className="mono">
                    {a.ventana ? `${a.ventana.conteo} en ${a.ventana.ventanaSegundos} s` : '—'}
                    {a.ventana?.salieron?.length ? <div className="muted">salieron: {a.ventana.salieron.join(', ')}</div> : null}
                  </td>
                  <td>
                    {a.anomalias.length === 0 && <span className="muted">—</span>}
                    {a.anomalias.map((an) => (
                      <div key={an.tipo}>
                        <Link to={`/anomalias/${an.id}`}>{NOMBRE_TIPO[an.tipo]}</Link> · {an.nivel} · {an.cantidad} txn
                        {an.franja ? ` (franja ${an.franja}, límite ${an.limite})` : ` en ${an.ventanaSegundos} s`}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rechazadas.length > 0 && (
        <>
          <h3 style={{ marginTop: '0.9rem' }}>Rechazadas ({rechazadas.length})</h3>
          {rechazadas.map((r) => (
            <div key={`${r.posicion}-${r.idTxn}`}>
              <ListaErrores errores={r.errores} />
            </div>
          ))}
        </>
      )}
      <ListaErrores errores={erroresGenerales} />
    </div>
  );
}
