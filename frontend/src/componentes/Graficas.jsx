/**
 * Gráficas del dashboard (Recharts + un mapa de calor en grilla CSS).
 *
 * Reglas de diseño aplicadas:
 *  - Color por función: categórico (tipo de anomalía: azul / naranja, orden
 *    fijo), secuencial de un solo tono (mapa de calor), ordinal (niveles).
 *  - Leyenda siempre visible con 2+ series; los textos usan colores de texto,
 *    no el color de la serie.
 *  - Líneas de 2 px, barras delgadas con extremos redondeados, cuadrícula tenue.
 *  - Tooltip al pasar el mouse y, debajo, "Ver datos en tabla" (accesibilidad).
 */
import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { DIAS, NOMBRE_TIPO, fmtNum, fmtPesos } from '../util/formato';

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

/** Rellena con ceros los días sin anomalías para que la línea no "salte". */
function completarDias(datos) {
  if (!datos.length) return [];
  const porDia = new Map(datos.map((d) => [d.dia, d]));
  const salida = [];
  const fin = new Date(`${datos[datos.length - 1].dia}T00:00:00Z`);
  for (let d = new Date(`${datos[0].dia}T00:00:00Z`); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    const clave = d.toISOString().slice(0, 10);
    salida.push(porDia.get(clave) || { dia: clave, posibleFraude: 0, excesoFranja: 0, total: 0 });
  }
  return salida;
}

const diaCorto = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function GraficaEvolucion({ datos, tema }) {
  const serie = completarDias(datos);
  if (!serie.length) return <p className="vacio">Aún no hay anomalías registradas.</p>;
  const eje = { stroke: tema.border, tick: { fill: tema['text-2'], fontSize: 12 }, tickLine: false };
  return (
    <>
      <div className="leyenda" aria-hidden="true">
        <span><i style={{ background: tema['series-1'] }} />{NOMBRE_TIPO.POSIBLE_FRAUDE}</span>
        <span><i style={{ background: tema['series-2'] }} />{NOMBRE_TIPO.EXCESO_FRANJA_HORARIA}</span>
      </div>
      <div style={{ width: '100%', height: 260 }} role="img" aria-label="Evolución diaria de anomalías por tipo">
        <ResponsiveContainer>
          <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={tema.border} strokeOpacity={0.6} vertical={false} />
            <XAxis dataKey="dia" tickFormatter={diaCorto} {...eje} minTickGap={18} />
            <YAxis allowDecimals={false} {...eje} axisLine={false} width={44} />
            <Tooltip content={<TooltipSimple titulo={(l) => `Día ${diaCorto(l)}`} />} cursor={{ stroke: tema.muted, strokeDasharray: '3 3' }} />
            <Line type="linear" dataKey="posibleFraude" name={NOMBRE_TIPO.POSIBLE_FRAUDE} stroke={tema['series-1']} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 5, stroke: tema.surface, strokeWidth: 2 }} />
            <Line type="linear" dataKey="excesoFranja" name={NOMBRE_TIPO.EXCESO_FRANJA_HORARIA} stroke={tema['series-2']} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 5, stroke: tema.surface, strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Tabla columnas={[{ k: 'dia', t: 'Día' }, { k: 'posibleFraude', t: 'Posible fraude', num: true }, { k: 'excesoFranja', t: 'Exceso franja', num: true }, { k: 'total', t: 'Total', num: true }]} filas={serie} />
    </>
  );
}

/** Mapa de calor día de la semana × hora: intensidad = cantidad de anomalías. */
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

/** Barras horizontales con etiqueta de valor al final (una sola medida). */
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

export function BarrasTipo({ datos, tema }) {
  const filas = ['POSIBLE_FRAUDE', 'EXCESO_FRANJA_HORARIA'].map((tipo) => ({
    tipo, nombre: NOMBRE_TIPO[tipo], cantidad: (datos.find((d) => d.tipo === tipo) || {}).cantidad || 0,
  }));
  const col = { POSIBLE_FRAUDE: tema['series-1'], EXCESO_FRANJA_HORARIA: tema['series-2'] };
  return (
    <>
      <BarrasHorizontales datos={filas} clave="cantidad" etiqueta="nombre" nombreSerie="Anomalías" colorDe={(d) => col[d.tipo]} tema={tema} />
      <Tabla columnas={[{ k: 'nombre', t: 'Tipo' }, { k: 'cantidad', t: 'Anomalías', num: true }]} filas={filas} />
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
