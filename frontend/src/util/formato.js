/** Utilidades de formato (es-CO). */
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });
const numero = new Intl.NumberFormat('es-CO');
const ZONA = 'America/Bogota';

export const fmtPesos = (v) => (v === null || v === undefined ? '—' : pesos.format(v));
export const fmtNum = (v) => (v === null || v === undefined ? '—' : numero.format(v));
export const fmtPct = (v) => `${numero.format(Number(v || 0))} %`;

/** "2026-09-23T10:00:01.000-05:00" → "23/09/2026 10:00:01.000" (hora de Bogotá) */
export function fmtFecha(iso, { ms = true } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  const base = `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}:${partes.second}`;
  return ms ? `${base}.${String(d.getUTCMilliseconds()).padStart(3, '0')}` : base;
}

/** Fecha/hora actual en Bogotá con el formato que espera la API: 2026-09-23T10:30:01.120 */
export function ahoraIsoLocal(desplazamientoMs = 0) {
  const d = new Date(Date.now() + desplazamientoMs);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export const NOMBRE_TIPO = { POSIBLE_FRAUDE: 'Posible fraude', EXCESO_FRANJA_HORARIA: 'Exceso en franja horaria' };
export const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
