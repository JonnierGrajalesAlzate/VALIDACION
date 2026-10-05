const { z } = require('zod');
const { crearDetalle } = require('../errores/ErrorApp');
const { fuenteNumero, esLiteralDecimal } = require('./jsonCrudo');
const { parsearFechaIso } = require('./fechas');

const CAMPOS = ['idTxn', 'user', 'date', 'value', 'paymentMethod', 'hash'];
const VALOR_MAXIMO = 999999999999.99;

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

function contarDecimales(numero) {
  const [mantisa, exp] = String(numero).toLowerCase().split('e');
  const decimalesMantisa = (mantisa.split('.')[1] || '').length;
  return Math.max(0, decimalesMantisa - Number(exp || 0));
}

function construirEsquema(reglas) {
  return z.strictObject({
    idTxn: z.int().positive(),
    user: z.email().max(254),
    date: z.string().superRefine((texto, ctx) => {
      const r = parsearFechaIso(texto);
      if (!r.ok) ctx.addIssue({ code: 'custom', message: r.mensaje, params: { codigo: r.codigo } });
    }),
    value: z.number().positive().max(VALOR_MAXIMO),
    paymentMethod: z.string().superRefine((texto, ctx) => {
      if (texto.trim() === '') {
        ctx.addIssue({ code: 'custom', message: 'vacío', params: { codigo: 'FORMATO_INVALIDO', vacio: true } });
      } else if (!reglas.metodosPago.includes(texto)) {
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
    if (campo === 'date') mensaje = `campo 'date': ${issue.message}, se recibió ${describirValor(valor)}`;
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
      if (issue.code === 'unrecognized_keys') {
        for (const clave of issue.keys) {
          errores.push(crearDetalle({
            idTxn, posicion, campo: clave, codigo: 'CAMPO_NO_PERMITIDO',
            mensaje: `el campo '${clave}' no está permitido (solo se aceptan: ${CAMPOS.join(', ')})`,
            recibido: obj[clave], tipoRecibido: tipoDe(obj[clave]), esperado: 'campo ausente',
          }));
        }
        continue;
      }
      const campo = issue.path[0];
      if (camposConError.has(campo)) continue;
      camposConError.add(campo);
      errores.push(issueADetalle(issue, obj, idTxn, posicion, desc));
    }
  }

  if (!camposConError.has('idTxn') && esLiteralDecimal(fuenteNumero(obj, 'idTxn'))) {
    camposConError.add('idTxn');
    errores.push(crearDetalle({
      idTxn, posicion, campo: 'idTxn', codigo: 'TIPO_INVALIDO',
      mensaje: `campo 'idTxn' debe ser entero positivo sin decimales, se recibió el número ${fuenteNumero(obj, 'idTxn')}`,
      recibido: fuenteNumero(obj, 'idTxn'), tipoRecibido: 'number (decimal)', esperado: desc.idTxn.esperado,
    }));
  }
  if (!camposConError.has('value') && typeof obj.value === 'number' && contarDecimales(obj.value) > 2) {
    camposConError.add('value');
    errores.push(crearDetalle({
      idTxn, posicion, campo: 'value', codigo: 'FORMATO_INVALIDO',
      mensaje: `campo 'value' admite máximo 2 decimales (columna NUMERIC(14,2)), se recibió ${fuenteNumero(obj, 'value') || obj.value}`,
      recibido: obj.value, tipoRecibido: 'number', esperado: desc.value.esperado,
    }));
  }

  if (errores.length) return { ok: false, idTxn, errores };

  const fecha = parsearFechaIso(obj.date).fecha;
  const email = obj.user.toLowerCase();
  return {
    ok: true,
    datos: {
      idTxn: obj.idTxn,
      email,
      nombre: email.split('@')[0],
      fechaMs: fecha.toMillis(),
      fechaTexto: obj.date,
      valor: obj.value,
      metodoPago: obj.paymentMethod,
      hash: obj.hash.toLowerCase(),
      original: obj,
      posicion,
    },
  };
}

module.exports = { validarTransaccion, describirValor, tipoDe, CAMPOS };
