import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/cliente';
import { ListaErrores } from '../componentes/PanelResultado';
import { BarrasCantidad, BarrasMetodo, BarrasNivel, GraficaEvolucion, GraficaPorHora, MapaCalor } from '../componentes/Graficas';
import { ESTADO_REVISION, NOMBRE_TIPO, fmtFecha, fmtNum, fmtPct, fmtPesos, fmtVariacion, nombreFranja } from '../util/formato';
import { useTema } from '../util/useTema';

function Kpi({ etiqueta, valor, detalle }) {
  return (
    <div className="kpi">
      <div className="etiqueta">{etiqueta}</div>
      <div className="valor">{valor}</div>
      {detalle && <div className="detalle">{detalle}</div>}
    </div>
  );
}

function Periodo({ titulo, anomalias, transacciones, contra }) {
  return (
    <div className="periodo">
      <div className="etiqueta">{titulo}</div>
      <div className="valor">{fmtNum(anomalias.actual)} <span>anomalías</span></div>
      <div className="detalle">{fmtVariacion(anomalias, contra)}</div>
      <div className="secundario">
        {fmtNum(transacciones.actual)} transacciones <span className="muted">· {fmtVariacion(transacciones, contra)}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const tema = useTema();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await api('GET', '/api/estadisticas');
    if (r.ok) { setDatos(r.cuerpo); setError(null); } else setError(r);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (error) {
    return (
      <div className="resultado mal">
        <h3>✕ No se pudieron cargar las estadísticas</h3>
        <div className="meta">HTTP {error.status} · requestId <code>{error.requestId}</code></div>
        <p>{error.cuerpo.mensaje}</p>
        <ListaErrores errores={error.cuerpo.errores} />
        <button onClick={cargar}>Reintentar</button>
      </div>
    );
  }
  if (!datos) return <p className="vacio">Cargando…</p>;
  const t = datos.tarjetas;
  const tend = datos.tendencias;
  const rev = datos.revision;
  const totalRevision = rev.nuevas + rev.abiertas + rev.revisadas + rev.descartadas;

  return (
    <>
      <div className="encabezado">
        <div>
          <h1>Dashboard de anomalías</h1>
          <p>Periodos según la fecha de la transacción, en hora de {datos.zonaHoraria}. Actualizado {fmtFecha(datos.generado, { ms: false })}.</p>
        </div>
        <button onClick={cargar} disabled={cargando}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
      </div>

      <div className="periodos" aria-label="Anomalías y transacciones por periodo">
        <Periodo titulo="Hoy" anomalias={tend.anomalias.hoy} transacciones={tend.transacciones.hoy} contra="ayer a esta hora" />
        <Periodo titulo="Esta semana" anomalias={tend.anomalias.semana} transacciones={tend.transacciones.semana} contra="la semana pasada" />
        <Periodo titulo="Este mes" anomalias={tend.anomalias.mes} transacciones={tend.transacciones.mes} contra="el mes pasado" />
      </div>

      <div className="kpis">
        <Kpi etiqueta="Transacciones con anomalía" valor={fmtPct(t.porcentajeAnomalas)} detalle={`${fmtNum(t.transaccionesAnomalas)} de ${fmtNum(t.transacciones.total)}`} />
        <Kpi etiqueta="Usuarios afectados" valor={fmtNum(t.usuariosAfectados)} detalle={`de ${fmtNum(t.usuariosTotal)} usuarios`} />
        <Kpi etiqueta="Valor sospechoso" valor={fmtPesos(t.valorSospechoso)} detalle="suma de transacciones ANOMALA" />
        <Kpi etiqueta="Promedio por usuario" valor={fmtNum(t.promedioTransaccionesPorUsuario)} detalle="transacciones / usuarios" />
        <Kpi etiqueta="Total histórico" valor={fmtNum(t.anomalias.total)} detalle={`anomalías en ${fmtNum(t.transacciones.total)} transacciones`} />
      </div>

      <section className="tarjeta" style={{ marginBottom: '1rem' }}>
        <h2>Estado de revisión <span className="sub-h">{fmtNum(rev.nuevas + rev.abiertas)} pendientes de {fmtNum(totalRevision)}</span></h2>
        <div className="revision">
          {[['NUEVA', rev.nuevas], ['ABIERTA', rev.abiertas], ['REVISADA', rev.revisadas], ['DESCARTADA', rev.descartadas]].map(([estado, n]) => (
            <Link key={estado} className="kpi enlace" to={`/anomalias?estadoRevision=${estado}`}>
              <div className="etiqueta"><span className={`insignia ${ESTADO_REVISION[estado].clase}`}>{ESTADO_REVISION[estado].plural}</span></div>
              <div className="valor">{fmtNum(n)}</div>
              <div className="detalle">{ESTADO_REVISION[estado].ayuda}{totalRevision ? ` · ${fmtNum(Math.round((1000 * n) / totalRevision) / 10)} %` : ''}</div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid g2">
        <section className="tarjeta">
          <h2>Evolución temporal</h2>
          <p className="sub">Anomalías por día (últimos 90 días con datos), tendencia y picos repentinos</p>
          <GraficaEvolucion datos={datos.evolucion} tema={tema} />
        </section>
        <section className="tarjeta">
          <h2>Distribución por hora</h2>
          <p className="sub">Día de la semana × hora local; más oscuro = más anomalías</p>
          <MapaCalor datos={datos.mapaCalor} tema={tema} />
        </section>
      </div>

      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <section className="tarjeta">
          <h2>Actividad por hora</h2>
          <p className="sub">Horas con más anomalías y periodos de actividad; el fondo marca las franjas horarias</p>
          <GraficaPorHora datos={datos.porHora} franjas={datos.porFranja.map((f) => ({ nombre: f.franja, desde: f.desde, hasta: f.hasta, segundosVentana: f.segundosVentana }))} tema={tema} />
        </section>
        <section className="tarjeta">
          <h2>Por franja horaria</h2>
          <p className="sub">Cada franja usa su propio tamaño de ventana deslizante</p>
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>Franja</th><th>Horario</th><th className="num">Ventana</th><th className="num">Transacciones</th><th className="num">Anomalías</th><th className="num">% anómalas</th><th className="num">Usuarios</th></tr></thead>
              <tbody>
                {datos.porFranja.map((f) => (
                  <tr key={f.franja}>
                    <td>{nombreFranja(f.franja)}</td>
                    <td className="mono">{f.desde} → {f.hasta}</td>
                    <td className="num">{f.segundosVentana} s</td>
                    <td className="num">{fmtNum(f.transacciones)}</td>
                    <td className="num">{fmtNum(f.anomalias)}</td>
                    <td className="num">{f.transacciones ? fmtPct(Math.round((1000 * f.transaccionesAnomalas) / f.transacciones) / 10) : '—'}</td>
                    <td className="num">{fmtNum(f.usuarios)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginTop: '1.25rem' }}>Múltiples transacciones</h2>
          <p className="sub">Anomalías según cuántas transacciones del mismo usuario cayeron en la ventana</p>
          <BarrasCantidad datos={datos.multiplesTransacciones} rafagaMayor={datos.multiplesTransacciones.rafagaMayor} tema={tema} />
        </section>
      </div>

      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <section className="tarjeta">
          <h2>Anomalías por nivel</h2>
          <BarrasNivel datos={datos.porNivel} tema={tema} />
        </section>
        <section className="tarjeta">
          <h2>Métodos de pago</h2>
          <BarrasMetodo datos={datos.porMetodoPago} tema={tema} />
        </section>
      </div>

      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <section className="tarjeta">
          <h2>Usuarios recurrentes</h2>
          <p className="sub">Usuarios con más anomalías</p>
          {datos.usuariosRecurrentes.length === 0 ? <p className="vacio">Sin anomalías.</p> : (
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>Usuario</th><th className="num">Anomalías</th><th className="num">Txn anómalas / total</th><th className="num">Valor sospechoso</th><th>Última</th></tr></thead>
                <tbody>
                  {datos.usuariosRecurrentes.map((u) => (
                    <tr key={u.id}>
                      <td><Link to={`/anomalias?usuario=${encodeURIComponent(u.email)}`}>{u.email}</Link>{u.estado === 'INACTIVO' && <> <span className="insignia mal">INACTIVO</span></>}</td>
                      <td className="num">{u.anomalias}</td>
                      <td className="num">{u.transaccionesAnomalas} / {u.transaccionesTotal}</td>
                      <td className="num">{fmtPesos(u.valorSospechoso)}</td>
                      <td className="mono">{fmtFecha(u.ultimaAnomalia, { ms: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="tarjeta">
          <h2>Casos más recurrentes</h2>
          <p className="sub">Combinaciones de tipo, nivel y método de pago</p>
          {datos.casosFrecuentes.length === 0 ? <p className="vacio">Sin anomalías.</p> : (
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>Tipo</th><th>Nivel</th><th>Método</th><th className="num">Casos</th><th className="num">Usuarios</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {datos.casosFrecuentes.map((c, i) => (
                    <tr key={i}>
                      <td>{NOMBRE_TIPO[c.tipo] || c.tipo}</td><td>{c.nivel}</td><td>{c.metodoPago}</td>
                      <td className="num">{c.cantidad}</td><td className="num">{c.usuarios}</td><td className="num">{fmtPesos(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <p className="aviso" style={{ marginTop: '1rem' }}>
        La <b>línea de tiempo</b> de cada anomalía y la <b>visualización de la ventana deslizante</b> paso a paso están en su detalle:
        entre por <Link to="/anomalias">Anomalías</Link> o por la ráfaga más grande de arriba.
      </p>
    </>
  );
}
