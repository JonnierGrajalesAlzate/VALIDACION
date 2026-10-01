/**
 * Carga y valida las variables de entorno UNA sola vez.
 *
 * ¿Por qué validar el .env? Porque un PGPORT vacío o un HMAC_SECRET
 * faltante producen errores muy confusos más adelante ("hash inválido" en
 * TODAS las transacciones, o "connect ECONNREFUSED" sin más). Es mejor
 * detener el arranque aquí diciendo exactamente qué variable falta.
 */
const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');
const { IANAZone } = require('luxon');

// La ruta es relativa a este archivo, no al directorio desde donde se
// ejecute node; así funciona igual con `npm start` o desde otra carpeta.
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const esquemaEnv = z.object({
  PGHOST: z.string().min(1, 'PGHOST es obligatorio (ej. localhost)'),
  PGPORT: z.string().regex(/^\d+$/, 'PGPORT debe ser un número de puerto (ej. 5432)'),
  PGUSER: z.string().min(1, 'PGUSER es obligatorio (ej. postgres)'),
  PGPASSWORD: z.string({ error: 'PGPASSWORD es obligatorio' }),
  PGDATABASE: z.string().min(1, 'PGDATABASE es obligatorio (ej. ACTIVIDAD_PA)'),
  PGDATABASE_TEST: z.string().regex(/^[a-z0-9_]+$/, 'PGDATABASE_TEST solo admite minúsculas, números y _').default('actividad_pa_test'),
  HMAC_SECRET: z.string().min(1, 'HMAC_SECRET es obligatorio: es la llave con la que se firman las transacciones'),
  PORT: z.string().regex(/^\d+$/, 'PORT debe ser numérico').default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TZ_NEGOCIO: z
    .string()
    .default('America/Bogota')
    .refine((tz) => IANAZone.isValidZone(tz), 'TZ_NEGOCIO no es una zona horaria IANA válida (ej. America/Bogota)'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  REGLAS_PATH: z.string().optional(),
});

function cargarEnv() {
  const resultado = esquemaEnv.safeParse(process.env);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Se lanza un Error normal: server.js lo atrapa y detiene el arranque.
    throw new Error(
      `Configuración inválida en backend/.env (copie .env.example y complételo):\n${detalle}`,
    );
  }
  const env = resultado.data;

  // En pruebas se usa SIEMPRE la base de datos de pruebas. Esta guarda
  // evita que Jest borre por accidente los datos reales.
  if (env.NODE_ENV === 'test') {
    env.PGDATABASE = env.PGDATABASE_TEST;
  }
  env.PORT = Number(env.PORT);
  env.PGPORT = Number(env.PGPORT);
  return env;
}

module.exports = cargarEnv();
