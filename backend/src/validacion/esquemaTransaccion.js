const { z } = require('zod');
const { crearDetalle } = require('../errores/ErrorApp');
const { fuenteNumero } = require('./jsonCrudo');
const { parsearFechaIso } = require('./fechas');

const CAMPOS = ['idTxn', 'user', 'date', 'value', 'paymentMethod', 'hash'];
const VALOR_MAXIMO = 999999999999.99; // transacciones.valor NUMERIC(14,2)
const MAX_PARTE_LOCAL = 64;

function descripciones(reglas) {
  return {
    idTxn: { debeSer: 'entero positivo', esperado: 'integer > 0 sin comillas (ej. 10001)' },
    user: { debeSer: 'un correo electrónico válido', esperado: 'string con formato de correo (ej. aa@aa.com)' },
    date: { debeSer: 'una fecha ISO 8601', esperado: 'string YYYY-MM-DDTHH:mm:ss[.SSS][Z|±HH:mm] (ej. 2026-09-23T10:30:01.120)' },
    value: { debeSer: 'número > 0', esperado: 'number > 0, sin comillas, máximo 2 decimales' },
    paymentMethod: { debeSer: `uno de los métodos permitidos (${reglas.metodosPago.join(', ')})`, esperado: `string: ${reglas.metodosPago.join(' | ')}` },
    hash: { debeSer: 'texto hexadecimal de 64 caracteres', esperado: 'string hexadecimal de 64 caracteres (HMAC-SHA256)' },
  };
}

function tipoDe(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  return typeof valor;
}

function describirValor(valor) {
  const tipo = tipoDe(valor);
  if (tipo === 'string') return `string '${valor.length > 80 ? `${valor.slice(0, 80)}…` : valor}'`;
  if (tipo === 'null') return 'null';
  if (tipo === 'undefined') return 'nada (campo ausente)';
  const json = JSON.stringify(valor);
  return `${tipo} ${json && json.length > 80 ? `${json.slice(0, 80)}…` : json}`;
}

// Compara métodos de pago sin distinguir mayúsculas, tildes ni espacios: 'NEQUI', ' nequi ', 'Néqui' → 'Nequi'.
const claveMetodo = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function metodoCanonico(texto, metodos) {
  const clave = claveMetodo(texto);
  return metodos.find((m) => claveMetodo(m) === clave) || null;
}

// Redondea a 2 decimales (mitad hacia arriba, como NUMERIC(14,2) de PostgreSQL) usando el texto original
// del número, para no arrastrar errores binarios (1.005 → 1.01, no 1.00).
function redondearA2(valor, fuente) {
  let texto = typeof fuente === 'string' ? fuente : String(valor);
  if (/e/i.test(texto)) texto = Number(texto).toFixed(12);
  const negativo = texto.startsWith('-');
  const [entero, frac = ''] = texto.replace('-', '').split('.');
  if (frac.length <= 2) return valor;
  let centavos = BigInt(entero + frac.slice(0, 2));
  if (Number(frac[2]) >= 5) centavos += 1n;
  const abs = centavos.toString().padStart(3, '0');
  const resultado = Number(`${abs.slice(0, -2)}.${abs.slice(-2)}`);
  return negativo ? -resultado : resultado;
}

function contarDecimales(numero) {
  const [mantisa, exp] = String(numero).toLowerCase().split('e');
  const decimalesMantisa = (mantisa.split('.')[1] || '').length;
  return Math.max(0, decimalesMantisa - Number(exp || 0));
}

function construirEsquema(reglas) {
  // looseObject: los campos adicionales (p. ej. ip, estado) no se rechazan; se ignoran al guardar,
  // pero sí forman parte del mensaje firmado, porque el cliente firma el objeto completo.
  return z.looseObject({
    idTxn: z.int().positive(),
    // usuarios.email VARCHAR(254); la parte local se guarda como usuarios.nombre VARCHAR(120) → máx. 64 (RFC 5321)
    user: z.email().max(254).superRefine((texto, ctx) => {
      const local = texto.split('@')[0];
      if (local.length > MAX_PARTE_LOCAL) {
        ctx.addIssue({
          code: 'custom',
          message: `la parte antes de '@' tiene ${local.length} caracteres y el máximo es ${MAX_PARTE_LOCAL}`,
          params: { codigo: 'VALOR_FUERA_DE_RANGO', mensajePropio: true },
        });
      }
    }),
    date: z.string().superRefine((texto, ctx) => {
      const r = parsearFechaIso(texto);
      if (!r.ok) ctx.addIssue({ code: 'custom', message: r.mensaje, params: { codigo: r.codigo } });
    }),
    value: z.number().positive().max(VALOR_MAXIMO),
    paymentMethod: z.string().superRefine((texto, ctx) => {
      if (texto.trim() === '') {
        ctx.addIssue({ code: 'custom', message: 'vacío', params: { codigo: 'FORMATO_INVALIDO', vacio: true } });
      } else if (!metodoCanonico(texto, reglas.metodosPago)) {
        ctx.addIssue({ code: 'custom', message: 'no permitido', params: { codigo: 'METODO_PAGO_NO_PERMITIDO' } });
      }
    }),
    hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  });
}

function issueADetalle(issue, obj, idTxn, posicion, desc) {
  const campo = issue.path[0];
  const presente = Object.prototype.hasOwnProperty.call(obj, campo);
  const valor = obj[campo];
  const d = desc[campo];
  const base = { idTxn, posicion, campo, recibido: presente ? valor : null, tipoRecibido: presente ? tipoDe(valor) : 'ausente', esperado: d.esperado };

  if (!presente) {
    return crearDetalle({ ...base, codigo: 'CAMPO_FALTANTE', mensaje: `falta el campo obligatorio '${campo}' (debe ser ${d.debeSer})` });
  }
  if (issue.code === 'invalid_type') {
    return crearDetalle({ ...base, codigo: 'TIPO_INVALIDO', mensaje: `campo '${campo}' debe ser ${d.debeSer}, se recibió ${describirValor(valor)}` });
  }
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    let detalle = issue.code === 'too_small' ? 'debe ser mayor que 0' : 'es demasiado grande';
    if (campo === 'user') detalle = 'supera los 254 caracteres';
    if (campo === 'value' && issue.code === 'too_big') detalle = `supera el máximo permitido (${VALOR_MAXIMO})`;
    if (campo === 'idTxn' && issue.code === 'too_big') detalle = 'supera el máximo entero seguro (9007199254740991)';
    return crearDetalle({ ...base, codigo: 'VALOR_FUERA_DE_RANGO', mensaje: `campo '${campo}' ${detalle}, se recibió ${describirValor(valor)}` });
  }
  if (issue.code === 'custom' && issue.params && issue.params.codigo) {
    let mensaje;
    if (campo === 'date' || issue.params.mensajePropio) mensaje = `campo '${campo}': ${issue.message}, se recibió ${describirValor(valor)}`;
    else if (issue.params.vacio) mensaje = `campo '${campo}' no puede estar vacío`;
    else mensaje = `campo '${campo}' debe ser ${d.debeSer}, se recibió ${describirValor(valor)}`;
    return crearDetalle({ ...base, codigo: issue.params.codigo, mensaje });
  }
  if (issue.code === 'invalid_format') {
    return crearDetalle({ ...base, codigo: 'FORMATO_INVALIDO', mensaje: `campo '${campo}' debe ser ${d.debeSer}, se recibió ${describirValor(valor)}` });
  }
  return crearDetalle({ ...base, codigo: 'FORMATO_INVALIDO', mensaje: `campo '${campo}' inválido: ${issue.message}` });
}

function validarTransaccion(obj, posicion, reglas) {
  const idTxn = obj && typeof obj === 'object' && Number.isSafeInteger(obj.idTxn) ? obj.idTxn : null;

  if (tipoDe(obj) !== 'object') {
    return {
      ok: false,
      idTxn: null,
      errores: [crearDetalle({
        idTxn: null, posicion, campo: null, codigo: 'TIPO_INVALIDO',
        mensaje: `el elemento en la posición ${posicion} debe ser un objeto JSON {…} con los 6 campos de la transacción, se recibió ${describirValor(obj)}`,
        recibido: obj === undefined ? null : obj, tipoRecibido: tipoDe(obj), esperado: `objeto con los campos ${CAMPOS.join(', ')}`,
      })],
    };
  }

  const desc = descripciones(reglas);
  const resultado = construirEsquema(reglas).safeParse(obj);
  const errores = [];
  const camposConError = new Set();

  if (!resultado.success) {
    for (const issue of resultado.error.issues) {
      const campo = issue.path[0];
      if (camposConError.has(campo)) continue;
      camposConError.add(campo);
      errores.push(issueADetalle(issue, obj, idTxn, posicion, desc));
    }
  }

  // Ajustes de compatibilidad: no cambian el tipo de dato, solo normalizan. Cada uno queda como advertencia.
  const advertencias = [];
  const advertir = (campo, codigo, mensaje) => advertencias.push({ campo, codigo, mensaje });

  const extras = Object.keys(obj).filter((k) => !CAMPOS.includes(k));
  if (extras.length) {
    advertir(null, 'CAMPOS_ADICIONALES_IGNORADOS', `se recibieron campos adicionales (${extras.join(', ')}): no se guardan, pero sí se incluyen en la verificación del hash`);
  }

  const fuenteId = fuenteNumero(obj, 'idTxn');
  if (!camposConError.has('idTxn') && typeof fuenteId === 'string' && /[.eE]/.test(fuenteId)) {
    advertir('idTxn', 'ENTERO_ESCRITO_COMO_DECIMAL', `idTxn llegó como ${fuenteId}; se tomó como el entero ${obj.idTxn}`);
  }

  let valor = obj.value;
  if (!camposConError.has('value') && typeof obj.value === 'number' && contarDecimales(obj.value) > 2) {
    valor = redondearA2(obj.value, fuenteNumero(obj, 'value'));
    if (valor <= 0) {
      camposConError.add('value');
      errores.push(crearDetalle({
        idTxn, posicion, campo: 'value', codigo: 'VALOR_FUERA_DE_RANGO',
        mensaje: `campo 'value' redondeado a 2 decimales queda en ${valor.toFixed(2)}; debe ser mayor que 0, se recibió ${fuenteNumero(obj, 'value') || obj.value}`,
        recibido: obj.value, tipoRecibido: 'number', esperado: desc.value.esperado,
      }));
    } else if (valor > VALOR_MAXIMO) {
      camposConError.add('value');
      errores.push(crearDetalle({
        idTxn, posicion, campo: 'value', codigo: 'VALOR_FUERA_DE_RANGO',
        mensaje: `campo 'value' supera el máximo permitido (${VALOR_MAXIMO}), se recibió ${fuenteNumero(obj, 'value') || obj.value}`,
        recibido: obj.value, tipoRecibido: 'number', esperado: desc.value.esperado,
      }));
    } else {
      advertir('value', 'VALOR_REDONDEADO', `value ${fuenteNumero(obj, 'value') || obj.value} se redondeó a ${valor.toFixed(2)} (columna NUMERIC(14,2))`);
    }
  }

  if (errores.length) return { ok: false, idTxn, errores };

  const fecha = parsearFechaIso(obj.date).fecha;
  const email = obj.user.toLowerCase();
  const metodoPago = metodoCanonico(obj.paymentMethod, reglas.metodosPago);
  if (metodoPago !== obj.paymentMethod) {
    advertir('paymentMethod', 'METODO_PAGO_NORMALIZADO', `paymentMethod '${obj.paymentMethod}' se guardó como '${metodoPago}'`);
  }
  return {
    ok: true,
    datos: {
      idTxn: obj.idTxn,
      email,
      nombre: email.split('@')[0],
      fechaMs: fecha.toMillis(),
      fechaTexto: obj.date,
      valor,
      metodoPago,
      hash: obj.hash.toLowerCase(),
      original: obj,
      posicion,
      advertencias,
    },
  };
}

module.exports = { validarTransaccion, describirValor, tipoDe, CAMPOS };
