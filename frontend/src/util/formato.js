const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });
const numero = new Intl.NumberFormat('es-CO');
const ZONA = 'America/Bogota';

export const fmtPesos = (v) => (v === null || v === undefined ? '—' : pesos.format(v));
export const fmtNum = (v) => (v === null || v === undefined ? '—' : numero.format(v));
export const fmtPct = (v) => `${numero.format(Number(v || 0))} %`;

export function fmtFecha(iso, { ms = true } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  const base = `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}:${partes.second}`;
  return ms ? `${base}.${String(d.getUTCMilliseconds()).padStart(3, '0')}` : base;
}

export function ahoraIsoLocal(desplazamientoMs = 0) {
  const d = new Date(Date.now() + desplazamientoMs);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export const NOMBRE_TIPO = { POSIBLE_FRAUDE: 'Posible fraude' };

export const ESTADO_REVISION = {
  NUEVA: { texto: 'Nueva', plural: 'Nuevas', clase: 'alerta', ayuda: 'nadie la ha revisado' },
  ABIERTA: { texto: 'Abierta', plural: 'Abiertas', clase: 'abierta', ayuda: 'en revisión' },
  REVISADA: { texto: 'Revisada', plural: 'Revisadas', clase: 'ok', ayuda: 'fraude confirmado / gestionado' },
  DESCARTADA: { texto: 'Descartada', plural: 'Descartadas', clase: 'descartada', ayuda: 'falso positivo' },
};

export function fmtVariacion(t, contra) {
  if (t.variacion === null) return t.actual ? `sin datos ${contra}` : `igual que ${contra}`;
  if (t.variacion === 0) return `= igual que ${contra}`;
  return `${t.variacion > 0 ? '▲' : '▼'} ${numero.format(Math.abs(t.variacion))} % vs. ${contra}`;
}

export const horaASegundos = (hhmmss) => hhmmss.split(':').map(Number).reduce((s, n, i) => s + n * [3600, 60, 1][i], 0);

export const nombreFranja = (n) => ({ MANANA: 'Mañana', TARDE_NOCHE: 'Tarde-noche', NOCHE_MADRUGADA: 'Noche-madrugada' })[n]
  || n.charAt(0) + n.slice(1).toLowerCase().replace(/_/g, ' ');
export const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
