/**
 * Reglas de negocio configurables (config/reglas.json):
 *  - ventana deslizante (segundos y umbral),
 *  - límites por franja horaria,
 *  - regla de niveles BAJO/MEDIO/ALTO,
 *  - métodos de pago permitidos,
 *  - modo del hash (hmac | sha256),
 *  - tamaño máximo de lote.
 *
 * Se leen de un archivo JSON (y no de constantes en el código) para poder
 * ajustarlas sin tocar el código, y se pueden cambiar en caliente con
 * PUT /api/config. Cada cambio se valida con Zod antes de aplicarse.
 */
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const env = require('./env');

const RUTA_POR_DEFECTO = path.join(__dirname, '..', '..', 'config', 'reglas.json');
const RUTA = env.REGLAS_PATH ? path.resolve(path.join(__dirname, '..', '..'), env.REGLAS_PATH) : RUTA_POR_DEFECTO;

const SEGUNDOS_DIA = 24 * 60 * 60;
const reHora = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

/** "05:00:01" → 18001 (segundos desde la medianoche). */
function horaASegundos(hhmmss) {
  const [h, m, s] = hhmmss.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

const esquemaFranja = z.strictObject({
  nombre: z.string().regex(/^[A-Z][A-Z0-9_]{0,29}$/, 'nombre en MAYÚSCULAS sin espacios (ej. MANANA)'),
  desde: z.string().regex(reHora, 'formato HH:mm:ss (ej. 05:00:01)'),
  hasta: z.string().regex(reHora, 'formato HH:mm:ss (ej. 12:00:00)'),
  limite: z.int().positive('el límite debe ser un entero > 0'),
});

const esquemaReglas = z.strictObject({
  ventanaDeslizante: z.strictObject({
    // Entero porque la columna anomalias.ventana_segundos es INTEGER.
    segundos: z.int().min(1, 'mínimo 1 segundo').max(86400, 'máximo 86400 segundos (1 día)'),
    umbral: z.int().min(2, 'el umbral debe ser al menos 2 (con 1, toda transacción sería anómala)'),
  }),
  franjasHorarias: z
    .strictObject({
      activo: z.boolean(),
      // OCURRENCIA: se cuenta por cada aparición de la franja (p. ej. "la mañana del 23/09").
      // MOVIL: se cuentan las transacciones de los últimos `segundosVentanaMovil` segundos.
      modo: z.enum(['OCURRENCIA', 'MOVIL']),
      segundosVentanaMovil: z.int().min(1).max(86400),
      franjas: z.array(esquemaFranja).min(1),
    })
    .superRefine((cfg, ctx) => {
      // Las franjas deben cubrir las 24 horas SIN huecos ni solapamientos;
      // si no, habría transacciones sin límite o con dos límites a la vez.
      const cobertura = new Uint8Array(SEGUNDOS_DIA);
      const nombres = new Set();
      for (const f of cfg.franjas) {
        if (nombres.has(f.nombre)) ctx.addIssue({ code: 'custom', message: `franja repetida: ${f.nombre}`, path: ['franjas'] });
        nombres.add(f.nombre);
        if (!reHora.test(f.desde) || !reHora.test(f.hasta)) continue;
        for (const s of segundosDeFranja(f)) cobertura[s] += 1;
      }
      const huecos = [];
      const solapes = [];
      for (let s = 0; s < SEGUNDOS_DIA; s += 1) {
        if (cobertura[s] === 0 && huecos.length < 3) huecos.push(segundosAHora(s));
        if (cobertura[s] > 1 && solapes.length < 3) solapes.push(segundosAHora(s));
      }
      if (huecos.length) ctx.addIssue({ code: 'custom', path: ['franjas'], message: `las franjas dejan horas sin cubrir, por ejemplo: ${huecos.join(', ')}` });
      if (solapes.length) ctx.addIssue({ code: 'custom', path: ['franjas'], message: `las franjas se solapan, por ejemplo en: ${solapes.join(', ')}` });
    }),
  niveles: z
    .strictObject({
      medioDesdeExcedente: z.int().min(1),
      altoDesdeExcedente: z.int().min(1),
    })
    .refine((n) => n.altoDesdeExcedente > n.medioDesdeExcedente, {
      message: 'altoDesdeExcedente debe ser mayor que medioDesdeExcedente',
    }),
  metodosPago: z.array(z.string().trim().min(1).max(30, 'máximo 30 caracteres (columna metodo_pago VARCHAR(30))')).min(1),
  hash: z.strictObject({
    modo: z.enum(['hmac', 'sha256']),
  }),
  lote: z.strictObject({
    maxTransacciones: z.int().min(1).max(10000),
  }),
});

/** Genera los segundos del día que cubre una franja (maneja el cruce de medianoche). */
function* segundosDeFranja(f) {
  const desde = horaASegundos(f.desde);
  const hasta = horaASegundos(f.hasta);
  if (desde <= hasta) {
    for (let s = desde; s <= hasta; s += 1) yield s;
  } else {
    // Cruza la medianoche: desde → 23:59:59 y 00:00:00 → hasta.
    for (let s = desde; s < SEGUNDOS_DIA; s += 1) yield s;
    for (let s = 0; s <= hasta; s += 1) yield s;
  }
}

function segundosAHora(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
}

let actuales = null;

/** Convierte los issues de Zod en líneas legibles "ruta: mensaje". */
function describirIssues(error) {
  return error.issues.map((i) => ({ campo: i.path.join('.') || '(raíz)', mensaje: i.message }));
}

function validar(datos) {
  const r = esquemaReglas.safeParse(datos);
  if (!r.success) {
    const err = new Error(
      `Reglas inválidas: ${describirIssues(r.error).map((d) => `${d.campo}: ${d.mensaje}`).join('; ')}`,
    );
    err.detalles = describirIssues(r.error);
    throw err;
  }
  return r.data;
}

/** Lee y valida el archivo de reglas. Lanza un Error claro si algo falla. */
function cargar() {
  let texto;
  try {
    texto = fs.readFileSync(RUTA, 'utf8');
  } catch (err) {
    throw new Error(`No se pudo leer el archivo de reglas ${RUTA}: ${err.message}`);
  }
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (err) {
    throw new Error(`El archivo de reglas ${RUTA} no es JSON válido: ${err.message}`);
  }
  actuales = validar(datos);
  return actuales;
}

/** Devuelve las reglas vigentes (las carga la primera vez). */
function obtener() {
  if (!actuales) cargar();
  return actuales;
}

/**
 * Valida y guarda nuevas reglas. Se escribe primero a un archivo temporal
 * y luego se renombra: si el proceso muere a mitad de la escritura, el
 * archivo original no queda corrupto.
 */
function actualizar(nuevas) {
  const validas = validar(nuevas);
  const temporal = `${RUTA}.tmp`;
  fs.writeFileSync(temporal, `${JSON.stringify(validas, null, 2)}\n`, 'utf8');
  fs.renameSync(temporal, RUTA);
  actuales = validas;
  return actuales;
}

module.exports = { cargar, obtener, actualizar, validar, horaASegundos, segundosAHora, RUTA, esquemaReglas };
