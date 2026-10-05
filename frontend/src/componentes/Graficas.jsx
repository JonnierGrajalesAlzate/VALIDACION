import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { DIAS, fmtFecha, fmtNum, fmtPesos, horaASegundos, nombreFranja } from '../util/formato';

function Tabla({ columnas, filas }) {
  return (
    <details>
      <summary>Ver datos en tabla</summary>
      <div className="tabla-scroll">
        <table>
          <thead><tr>{columnas.map((c) => <th key={c.k} className={c.num ? 'num' : ''}>{c.t}</th>)}</tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>{columnas.map((c) => <td key={c.k} className={c.num ? 'num' : ''}>{c.f ? c.f(f[c.k], f) : f[c.k]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function TooltipSimple({ active, payload, label, titulo, formatear = fmtNum }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="tooltip">
      <div className="t-titulo">{titulo ? titulo(label, payload) : label}</div>
      {payload.map((p) => (
        <div className="t-fila" key={p.dataKey}>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: p.color || p.payload.fill, marginRight: 6 }} />{p.name}</span>
          <b>{formatear(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

const diaCorto = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function GraficaEvolucion({ datos, tema }) {
  if (!datos.length) return <p className="vacio">Aún no hay anomalías registradas.</p>;
  const eje = { stroke: tema.border, tick: { fill: tema['text-2'], fontSize: 12 }, tickLine: false };
  const picos = datos.filter((d) => d.pico);
  const PuntoPico = ({ cx, cy, payload, index }) => (payload.pico
    ? <circle key={index} cx={cx} cy={cy} r={5} fill={tema['series-1']} stroke={tema.surface} strokeWidth={2} />
    : <g key={index} />);

  const ultimo = datos[datos.length - 1];
  const hace7 = datos.length > 7 ? datos[datos.length - 8] : null;
  let tendencia = null;
  if (hace7) {
    const dif = ultimo.mediaMovil - hace7.mediaMovil;
    tendencia = Math.abs(dif) < 0.05 ? 'estable' : dif > 0 ? 'al alza' : 'a la baja';
  }

  return (
    <>
      <div className="leyenda" aria-hidden="true">
        <span><i style={{ background: tema['series-1'] }} />Anomalías por día</span>
        <span><i style={{ background: `repeating-linear-gradient(90deg, ${tema['text-2']} 0 4px, transparent 4px 7px)` }} />Tendencia (media móvil 7 días)</span>
        <span><i className="cuadro" style={{ background: tema['series-1'], borderRadius: '50%', outline: `2px solid ${tema.surface}` }} />Pico repentino</span>
      </div>
      <div style={{ width: '100%', height: 260 }} role="img" aria-label="Evolución diaria de anomalías con tendencia y picos">
        <ResponsiveContainer>
          <LineChart data={datos} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={tema.border} strokeOpacity={0.6} vertical={false} />
            <XAxis dataKey="dia" tickFormatter={diaCorto} {...eje} minTickGap={18} />
            <YAxis allowDecimals={false} {...eje} axisLine={false} width={44} />
            <Tooltip
              content={<TooltipSimple titulo={(l, p) => `Día ${diaCorto(l)}${p[0]?.payload.pico ? ' · pico repentino' : ''}`} />}
              cursor={{ stroke: tema.muted, strokeDasharray: '3 3' }}
            />
            <Line type="linear" dataKey="mediaMovil" name="Media móvil 7 días" stroke={tema['text-2']} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} activeDot={false} />
            <Line type="linear" dataKey="total" name="Anomalías" stroke={tema['series-1']} strokeWidth={2} dot={PuntoPico} isAnimationActive={false} activeDot={{ r: 5, stroke: tema.surface, strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="nota-grafica">
        {tendencia && <>Tendencia <b>{tendencia}</b>: media de {fmtNum(ultimo.mediaMovil)} anomalías/día en los últimos 7 días (antes {fmtNum(hace7.mediaMovil)}). </>}
        {picos.length
          ? <>Picos repentinos: {picos.slice(-5).map((p) => `${diaCorto(p.dia)} (${p.total})`).join(', ')}{picos.length > 5 ? ` y ${picos.length - 5} más` : ''}.</>
          : 'Sin picos repentinos.'}
        <span className="muted"> Pico = 3 o más anomalías y al menos el doble del promedio de los 7 días anteriores.</span>
      </p>
      <Tabla
        columnas={[
          { k: 'dia', t: 'Día' }, { k: 'total', t: 'Anomalías', num: true },
          { k: 'mediaMovil', t: 'Media 7 días', num: true, f: fmtNum }, { k: 'pico', t: 'Pico', f: (v) => (v ? 'Sí' : '') },
        ]}
        filas={datos}
      />
    </>
  );
}

function franjasPorHora(franjas) {
  const deHora = (h) => {
    const s = h * 3600 + 1800;
    return franjas.find((f) => {
      const d = horaASegundos(f.desde);
      const ha = horaASegundos(f.hasta);
      return d <= ha ? s >= d && s <= ha : s >= d || s <= ha;
    });
  };
  const tramos = [];
  for (let h = 0; h < 24; h += 1) {
    const f = deHora(h);
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.franja === f) ultimo.hasta = h;
    else tramos.push({ franja: f, desde: h, hasta: h });
  }
  return { deHora, tramos };
}

export function GraficaPorHora({ datos, franjas, tema }) {
  const { deHora, tramos } = franjasPorHora(franjas);
  const filas = datos.map((d) => {
    const f = deHora(d.hora);
    return { ...d, franja: f ? nombreFranja(f.nombre) : '—', pct: d.transacciones ? (100 * d.anomalias) / d.transacciones : 0 };
  });
  const topAnomalias = [...filas].filter((d) => d.anomalias > 0).sort((a, b) => b.anomalias - a.anomalias || a.hora - b.hora).slice(0, 3);
  const topSet = new Set(topAnomalias.map((d) => d.hora));
  filas.forEach((d) => { d.etiquetaTop = topSet.has(d.hora) ? d.anomalias : null; });
  const pico = [...filas].sort((a, b) => b.transacciones - a.transacciones)[0];
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  const eje = { stroke: tema.border, tick: { fill: tema['text-2'], fontSize: 11 }, tickLine: false };
  const corto = (f) => `${nombreFranja(f.nombre).split('-')[0]} · ${f.segundosVentana} s`;

  const fondo = (conNombres) => tramos.flatMap((t, i) => [
    <ReferenceArea
      key={`a-${t.desde}`}
      x1={t.desde - 0.5}
      x2={t.hasta + 0.5}
      fill={tema['surface-2']}
      fillOpacity={t.franja && horaASegundos(t.franja.desde) > horaASegundos(t.franja.hasta) ? 1 : 0}
      stroke="none"
      ifOverflow="hidden"
      label={conNombres && t.franja ? { value: corto(t.franja), position: 'insideTop', fill: tema['text-2'], fontSize: 10 } : undefined}
    />,
    i > 0 && <ReferenceLine key={`l-${t.desde}`} x={t.desde - 0.5} stroke={tema.muted} strokeDasharray="3 3" ifOverflow="hidden" />,
  ]).filter(Boolean);
  const grafica = (clave, nombre, color, etiquetas, alto) => (
    <div style={{ width: '100%', height: alto }} role="img" aria-label={`${nombre} por hora del día`}>
      <ResponsiveContainer>
        <BarChart data={filas} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
          {fondo(etiquetas)}
          <CartesianGrid stroke={tema.border} strokeOpacity={0.6} vertical={false} />
          <XAxis type="number" dataKey="hora" domain={[-0.5, 23.5]} ticks={[0, 3, 6, 9, 12, 15, 18, 21]} tickFormatter={(h) => `${h}h`} {...eje} />
          <YAxis allowDecimals={false} domain={[0, (max) => Math.max(1, Math.ceil(max * (etiquetas ? 1.45 : 1.1)))]} {...eje} axisLine={false} width={44} />
          <Tooltip content={<TooltipSimple titulo={(l, p) => `${hh(l)}–${String(l).padStart(2, '0')}:59 · ${p[0]?.payload.franja}`} />} cursor={{ fill: tema['surface-2'], fillOpacity: 0.6 }} />
          <Bar dataKey={clave} name={nombre} fill={color} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false}>
            {etiquetas && <LabelList dataKey="etiquetaTop" position="top" fill={tema.text} fontSize={11} />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <>
      <h3 className="titulo-mini"><i style={{ background: tema['series-1'] }} />Anomalías por hora</h3>
      {grafica('anomalias', 'Anomalías', tema['series-1'], true, 150)}
      <h3 className="titulo-mini"><i style={{ background: tema['series-2'] }} />Transacciones por hora (actividad)</h3>
      {grafica('transacciones', 'Transacciones', tema['series-2'], false, 130)}
      <p className="nota-grafica">
        {topAnomalias.length
          ? <>Horas con más anomalías: {topAnomalias.map((d) => `${hh(d.hora)} (${d.anomalias})`).join(', ')}. </>
          : 'Sin anomalías registradas. '}
        {pico && pico.transacciones > 0 && <>Mayor actividad: {hh(pico.hora)} con {fmtNum(pico.transacciones)} transacciones. </>}
        <span className="muted">Fondo gris: {franjas.filter((f) => horaASegundos(f.desde) > horaASegundos(f.hasta)).map((f) => `${nombreFranja(f.nombre)} (${f.desde.slice(0, 5)}–${f.hasta.slice(0, 5)})`).join(', ') || '—'}.</span>
      </p>
      <Tabla
        columnas={[
          { k: 'hora', t: 'Hora', f: hh }, { k: 'franja', t: 'Franja' },
          { k: 'transacciones', t: 'Transacciones', num: true }, { k: 'anomalias', t: 'Anomalías', num: true },
          { k: 'pct', t: 'Anomalías / transacciones', num: true, f: (v) => `${fmtNum(Math.round(v * 10) / 10)} %` },
        ]}
        filas={filas}
      />
    </>
  );
}

export function MapaCalor({ datos, tema }) {
  const [hover, setHover] = useState(null);
  const valor = new Map(datos.map((d) => [`${d.diaSemana}-${d.hora}`, d.cantidad]));
  const max = Math.max(0, ...datos.map((d) => d.cantidad));
  const pasos = [tema['seq-1'], tema['seq-2'], tema['seq-3'], tema['seq-4'], tema['seq-5'], tema['seq-6'], tema['seq-7']];
  const color = (n) => (n === 0 ? tema['seq-0'] : pasos[Math.min(pasos.length - 1, Math.floor(((n - 1) / Math.max(1, max)) * pasos.length))]);

  return (
    <div style={{ position: 'relative' }}>
      <div className="calor" role="grid" aria-label="Anomalías por día de la semana y hora">
        <div />
        {Array.from({ length: 24 }, (_, h) => <div key={h} className="hora">{h % 3 === 0 ? h : ''}</div>)}
        {DIAS.map((dia, i) => (
          <div key={dia} style={{ display: 'contents' }} role="row">
            <div className="eje">{dia}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const n = valor.get(`${i + 1}-${h}`) || 0;
              return (
                <div
                  key={h}
                  role="gridcell"
                  className="celda"
                  style={{ background: color(n) }}
                  aria-label={`${dia} ${h}:00 — ${n} anomalía(s)`}
                  onMouseEnter={() => setHover({ dia, h, n })}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="escala">
        <span>0</span>
        <span className="tramo" style={{ background: tema['seq-0'], border: `1px solid ${tema.border}` }} />
        {pasos.map((c) => <span key={c} className="tramo" style={{ background: c }} />)}
        <span>{fmtNum(max)} anomalías</span>
        {hover && <span style={{ marginLeft: 'auto', color: tema.text }}><b>{hover.dia} {String(hover.h).padStart(2, '0')}:00–{String(hover.h).padStart(2, '0')}:59</b> · {hover.n} anomalía(s)</span>}
      </div>
      <Tabla
        columnas={[{ k: 'diaSemana', t: 'Día', f: (v) => DIAS[v - 1] }, { k: 'hora', t: 'Hora', f: (v) => `${v}:00` }, { k: 'cantidad', t: 'Anomalías', num: true }]}
        filas={datos}
      />
    </div>
  );
}

function BarrasHorizontales({ datos, clave, etiqueta, colorDe, tema, alto, nombreSerie, formatear = fmtNum }) {
  if (!datos.length) return <p className="vacio">Sin datos.</p>;
  const eje = { tick: { fill: tema['text-2'], fontSize: 12 }, tickLine: false, axisLine: false };
  return (
    <div style={{ width: '100%', height: alto || Math.max(120, datos.length * 44 + 20) }}>
      <ResponsiveContainer>
        <BarChart data={datos} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={10}>
          <CartesianGrid stroke={tema.border} strokeOpacity={0.6} horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...eje} hide />
          <YAxis type="category" dataKey={etiqueta} width={150} {...eje} />
          <Tooltip content={<TooltipSimple formatear={formatear} />} cursor={{ fill: tema['surface-2'] }} />
          <Bar dataKey={clave} name={nombreSerie} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            {datos.map((d, i) => <Cell key={i} fill={colorDe(d)} stroke={tema.surface} strokeWidth={1} />)}
            <LabelList dataKey={clave} position="right" fill={tema.text} fontSize={12} formatter={formatear} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarrasNivel({ datos, tema }) {
  const orden = ['BAJO', 'MEDIO', 'ALTO'];
  const filas = orden.map((nivel) => ({ nivel, cantidad: (datos.find((d) => d.nivel === nivel) || {}).cantidad || 0 }));
  const col = { BAJO: tema['nivel-bajo'], MEDIO: tema['nivel-medio'], ALTO: tema['nivel-alto'] };
  return (
    <>
      <BarrasHorizontales datos={filas} clave="cantidad" etiqueta="nivel" nombreSerie="Anomalías" colorDe={(d) => col[d.nivel]} tema={tema} />
      <Tabla columnas={[{ k: 'nivel', t: 'Nivel' }, { k: 'cantidad', t: 'Anomalías', num: true }]} filas={filas} />
    </>
  );
}

export function BarrasCantidad({ datos, rafagaMayor, tema }) {
  const filas = datos.porCantidad.map((c) => ({ ...c, etiqueta: `${c.cantidad}${c.masDe ? ' o más' : ''} transacciones` }));
  const r = rafagaMayor;
  return (
    <>
      <BarrasHorizontales datos={filas} clave="anomalias" etiqueta="etiqueta" nombreSerie="Anomalías" colorDe={() => tema['series-1']} tema={tema} />
      {r && (
        <p className="nota-grafica">
          Ráfaga más grande: <b>{r.cantidad} transacciones en {r.ventanaSegundos} s</b> de {r.usuario} el {fmtFecha(r.fecha, { ms: false })}.{' '}
          <Link to={`/anomalias/${r.anomaliaId}`}>Ver su línea de tiempo y la ventana →</Link>
        </p>
      )}
      <Tabla
        columnas={[{ k: 'etiqueta', t: 'En la ventana' }, { k: 'anomalias', t: 'Anomalías', num: true }, { k: 'usuarios', t: 'Usuarios', num: true }]}
        filas={filas}
      />
    </>
  );
}

export function BarrasMetodo({ datos, tema }) {
  return (
    <>
      <BarrasHorizontales datos={datos} clave="anomalias" etiqueta="metodoPago" nombreSerie="Anomalías" colorDe={() => tema['series-1']} tema={tema} />
      <Tabla
        columnas={[
          { k: 'metodoPago', t: 'Método' }, { k: 'transacciones', t: 'Transacciones', num: true },
          { k: 'transaccionesAnomalas', t: 'Anómalas', num: true }, { k: 'anomalias', t: 'Anomalías', num: true },
          { k: 'valorSospechoso', t: 'Valor sospechoso', num: true, f: fmtPesos },
        ]}
        filas={datos}
      />
    </>
  );
}
