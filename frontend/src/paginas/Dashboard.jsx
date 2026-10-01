/**
 * Dashboard: todas las cifras vienen de GET /api/estadisticas, que las
 * calcula con SQL en PostgreSQL.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/cliente';
import { ListaErrores } from '../componentes/PanelResultado';
import { BarrasMetodo, BarrasNivel, BarrasTipo, GraficaEvolucion, MapaCalor } from '../componentes/Graficas';
import { NOMBRE_TIPO, fmtFecha, fmtNum, fmtPct, fmtPesos } from '../util/formato';
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

  return (
    <>
      <div className="encabezado">
        <div>
          <h1>Dashboard de anomalías</h1>
          <p>Periodos según la fecha de la transacción, en hora de {datos.zonaHoraria}. Actualizado {fmtFecha(datos.generado, { ms: false })}.</p>
        </div>
        <button onClick={cargar} disabled={cargando}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
      </div>

      <div className="kpis">
        <Kpi etiqueta="Transacciones hoy" valor={fmtNum(t.transacciones.hoy)} detalle={`Semana ${fmtNum(t.transacciones.semana)} · Mes ${fmtNum(t.transacciones.mes)}`} />
        <Kpi etiqueta="Anomalías hoy" valor={fmtNum(t.anomalias.hoy)} detalle={`Semana ${fmtNum(t.anomalias.semana)} · Mes ${fmtNum(t.anomalias.mes)}`} />
        <Kpi etiqueta="Transacciones con anomalía" valor={fmtPct(t.porcentajeAnomalas)} detalle={`${fmtNum(t.transaccionesAnomalas)} de ${fmtNum(t.transacciones.total)}`} />
        <Kpi etiqueta="Usuarios afectados" valor={fmtNum(t.usuariosAfectados)} detalle={`de ${fmtNum(t.usuariosTotal)} usuarios`} />
        <Kpi etiqueta="Valor sospechoso" valor={fmtPesos(t.valorSospechoso)} detalle="suma de transacciones ANOMALA" />
        <Kpi etiqueta="Promedio por usuario" valor={fmtNum(t.promedioTransaccionesPorUsuario)} detalle="transacciones / usuarios" />
      </div>

      <div className="grid g2">
        <section className="tarjeta">
          <h2>Evolución de anomalías</h2>
          <p className="sub">Anomalías por día (últimos 90 días con datos)</p>
          <GraficaEvolucion datos={datos.evolucion} tema={tema} />
        </section>
        <section className="tarjeta">
          <h2>Distribución por hora</h2>
          <p className="sub">Día de la semana × hora local; más oscuro = más anomalías</p>
          <MapaCalor datos={datos.mapaCalor} tema={tema} />
        </section>
      </div>

      <div className="grid g3" style={{ marginTop: '1rem' }}>
        <section className="tarjeta">
          <h2>Por nivel</h2>
          <BarrasNivel datos={datos.porNivel} tema={tema} />
        </section>
        <section className="tarjeta">
          <h2>Por tipo</h2>
          <BarrasTipo datos={datos.porTipo} tema={tema} />
        </section>
        <section className="tarjeta">
          <h2>Por método de pago</h2>
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
          <h2>Casos más frecuentes</h2>
          <p className="sub">Combinaciones de tipo, nivel y método de pago</p>
          {datos.casosFrecuentes.length === 0 ? <p className="vacio">Sin anomalías.</p> : (
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>Tipo</th><th>Nivel</th><th>Método</th><th className="num">Casos</th><th className="num">Usuarios</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {datos.casosFrecuentes.map((c, i) => (
                    <tr key={i}>
                      <td>{NOMBRE_TIPO[c.tipo]}</td><td>{c.nivel}</td><td>{c.metodoPago}</td>
                      <td className="num">{c.cantidad}</td><td className="num">{c.usuarios}</td><td className="num">{fmtPesos(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="tarjeta" style={{ marginTop: '1rem' }}>
        <h2>Estados de revisión de anomalías</h2>
        <p className="aviso">
          Pendiente de aprobación: la tabla <code>anomalias</code> no tiene una columna de estado de revisión
          (nueva, abierta, revisada, descartada). La migración propuesta está en
          <code> database/propuestas/001_estado_revision_anomalias.sql</code> y explicada en <code>DECISIONES.md</code>.
          Cuando se apruebe, aquí aparecerán los contadores y el flujo de revisión.
        </p>
      </section>
    </>
  );
}
