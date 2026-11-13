const crypto = require('crypto');
const env = require('./config/env');
const reglas = require('./config/reglas');
const { fuenteNumero, esLiteralDecimal } = require('./validacion/jsonCrudo');

function reprFloatPython(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';

  const negativo = x < 0;
  const [mantisa, expTexto] = Math.abs(x).toExponential().split('e');
  const exp = Number(expTexto);
  const digitos = mantisa.replace('.', '');

  let texto;
  if (exp < -4 || exp >= 16) {
    const m = digitos.length > 1 ? `${digitos[0]}.${digitos.slice(1)}` : digitos;
    const e = String(Math.abs(exp)).padStart(2, '0');
    texto = `${m}e${exp < 0 ? '-' : '+'}${e}`;
  } else if (exp >= 0) {
    const enteros = exp + 1;
    texto = digitos.length <= enteros
      ? `${digitos}${'0'.repeat(enteros - digitos.length)}.0`
      : `${digitos.slice(0, enteros)}.${digitos.slice(enteros)}`;
  } else {
    texto = `0.${'0'.repeat(-exp - 1)}${digitos}`;
  }
  return negativo ? `-${texto}` : texto;
}

function numeroComoPython(valor, fuente) {
  if (typeof fuente === 'string') {
    if (!esLiteralDecimal(fuente)) {
      return BigInt(fuente).toString();
    }
    return reprFloatPython(Number(fuente));
  }
  if (Number.isSafeInteger(valor)) return String(valor);
  return reprFloatPython(valor);
}

const ESCAPES = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

function textoComoPython(texto) {
  let salida = '"';
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i];
    const codigo = texto.charCodeAt(i);
    if (ESCAPES[ch]) salida += ESCAPES[ch];
    else if (codigo >= 0x20 && codigo <= 0x7e) salida += ch;
    else salida += `\\u${codigo.toString(16).padStart(4, '0')}`;
  }
  return `${salida}"`;
}

function compararComoPython(a, b) {
  const pa = Array.from(a);
  const pb = Array.from(b);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const d = pa[i].codePointAt(0) - pb[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return pa.length - pb.length;
}

// Separadores de json.dumps: compactos (la guía: separators=(",", ":")) o los de Python por defecto (", ", ": ").
const COMPACTO = { item: ',', clave: ':' };
const PYTHON_DEFECTO = { item: ', ', clave: ': ' };

function serializarCanonico(valor, contenedor, clave, opc = { sep: COMPACTO, ordenar: true }) {
  if (valor === null) return 'null';
  if (valor === true) return 'true';
  if (valor === false) return 'false';
  if (typeof valor === 'number') return numeroComoPython(valor, fuenteNumero(contenedor, clave));
  if (typeof valor === 'string') return textoComoPython(valor);
  if (Array.isArray(valor)) {
    return `[${valor.map((v, i) => serializarCanonico(v, valor, String(i), opc)).join(opc.sep.item)}]`;
  }
  if (typeof valor === 'object') {
    const claves = opc.ordenar ? Object.keys(valor).sort(compararComoPython) : Object.keys(valor);
    return `{${claves.map((k) => `${textoComoPython(k)}${opc.sep.clave}${serializarCanonico(valor[k], valor, k, opc)}`).join(opc.sep.item)}}`;
  }
  throw new TypeError(`No se puede serializar un valor de tipo ${typeof valor}`);
}

function sinHash(transaccion) {
  const copia = {};
  for (const k of Object.keys(transaccion)) if (k !== 'hash') copia[k] = transaccion[k];
  return copia;
}

// Mensaje firmado según la guía: json.dumps(datos, sort_keys=True, separators=(",", ":")) de Python.
function mensajeAFirmar(transaccion, opc = { sep: COMPACTO, ordenar: true }) {
  const datos = sinHash(transaccion);
  const claves = opc.ordenar ? Object.keys(datos).sort(compararComoPython) : Object.keys(datos);
  return `{${claves.map((k) => `${textoComoPython(k)}${opc.sep.clave}${serializarCanonico(datos[k], transaccion, k, opc)}`).join(opc.sep.item)}}`;
}

function ordenarClaves(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarClaves);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort(compararComoPython).map((k) => [k, ordenarClaves(valor[k])]));
  }
  return valor;
}

// ─── Verificación compatible ────────────────────────────────────────────────
// El cliente (el bot del profesor) puede armar el mensaje y firmarlo de varias formas razonables.
// Se prueban todas las combinaciones MENSAJE × ALGORITMO permitidas por hash.modo. La primera
// combinación es la de la guía. Un hash inventado o un campo cambiado después de firmar no coincide
// con ninguna, así que se sigue rechazando.

const CAMPOS_GUIA = ['idTxn', 'user', 'date', 'value', 'paymentMethod'];

function textoCampo(t, k) {
  if (typeof t[k] === 'number') return fuenteNumero(t, k) ?? String(t[k]);
  return String(t[k]);
}

// Concatenación de los 5 campos en el orden de la guía, p. ej. f"{idTxn}|{user}|{date}|{value}|{paymentMethod}"
const concatenar = (sep) => (t) => (CAMPOS_GUIA.every((k) => t[k] !== undefined && t[k] !== null)
  ? CAMPOS_GUIA.map((k) => textoCampo(t, k)).join(sep)
  : null);

const MENSAJES = [
  { nombre: 'json.dumps(sort_keys=True, separators=(",", ":"))', mensaje: (t) => mensajeAFirmar(t) },
  { nombre: 'json.dumps(sort_keys=True)', mensaje: (t) => mensajeAFirmar(t, { sep: PYTHON_DEFECTO, ordenar: true }) },
  { nombre: 'json.dumps(separators=(",", ":"))', mensaje: (t) => mensajeAFirmar(t, { sep: COMPACTO, ordenar: false }) },
  { nombre: 'json.dumps()', mensaje: (t) => mensajeAFirmar(t, { sep: PYTHON_DEFECTO, ordenar: false }) },
  { nombre: 'JSON.stringify()', mensaje: (t) => JSON.stringify(sinHash(t)) },
  { nombre: 'JSON.stringify() con claves ordenadas', mensaje: (t) => JSON.stringify(ordenarClaves(sinHash(t))) },
  ...['', '|', ',', ';', ':', ' ', '-', '_'].map((sep) => ({
    nombre: `campos concatenados con "${sep}" (idTxn${sep}user${sep}date${sep}value${sep}paymentMethod)`,
    mensaje: concatenar(sep),
  })),
];

const ALGORITMOS = {
  hmac: { nombre: 'HMAC-SHA256 con la llave', conLlave: true, firmar: (m, k) => crypto.createHmac('sha256', k).update(m, 'utf8').digest('hex') },
  sha256: { nombre: 'SHA-256 sin llave', conLlave: false, firmar: (m) => crypto.createHash('sha256').update(m, 'utf8').digest('hex') },
  sha256MensajeLlave: { nombre: 'SHA-256(mensaje + llave)', conLlave: true, firmar: (m, k) => crypto.createHash('sha256').update(m + k, 'utf8').digest('hex') },
  sha256LlaveMensaje: { nombre: 'SHA-256(llave + mensaje)', conLlave: true, firmar: (m, k) => crypto.createHash('sha256').update(k + m, 'utf8').digest('hex') },
};

// hmac   → solo algoritmos con llave (la guía: HMAC-SHA256).
// sha256 → solo SHA-256 sin llave.
// auto   → cualquiera de los anteriores (máxima compatibilidad con el cliente). Es el valor por defecto.
const ALGORITMOS_POR_MODO = {
  hmac: ['hmac', 'sha256MensajeLlave', 'sha256LlaveMensaje'],
  sha256: ['sha256'],
  auto: ['hmac', 'sha256', 'sha256MensajeLlave', 'sha256LlaveMensaje'],
};

function firmar(cadena, modo, secreto) {
  return modo === 'sha256' ? ALGORITMOS.sha256.firmar(cadena) : ALGORITMOS.hmac.firmar(cadena, secreto);
}

function calcularHash(transaccion, opciones = {}) {
  const modo = opciones.modo || reglas.obtener().hash.modo;
  const secreto = opciones.secreto ?? env.HMAC_SECRET;
  const cadena = mensajeAFirmar(transaccion);
  return { hash: firmar(cadena, modo, secreto), cadena, modo: modo === 'auto' ? 'hmac' : modo };
}

function iguales(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function verificarHash(transaccion, opciones = {}) {
  const modo = opciones.modo || reglas.obtener().hash.modo;
  const secreto = opciones.secreto ?? env.HMAC_SECRET;
  const recibido = String(transaccion.hash || '').toLowerCase();
  const algoritmos = ALGORITMOS_POR_MODO[modo] || ALGORITMOS_POR_MODO.hmac;
  const vistas = new Set();
  let primera = null;
  for (const m of MENSAJES) {
    const cadena = m.mensaje(transaccion);
    if (cadena === null || vistas.has(cadena)) continue;
    vistas.add(cadena);
    for (const clave of algoritmos) {
      const a = ALGORITMOS[clave];
      const esperado = a.firmar(cadena, secreto);
      if (!primera) primera = { esperado, cadena };
      if (iguales(recibido, esperado)) {
        const esCanonica = m === MENSAJES[0] && clave === algoritmos[0];
        return { valido: true, recibido, esperado, cadena, modo, variante: `${a.nombre} sobre ${m.nombre}`, esCanonica };
      }
    }
  }
  return { valido: false, recibido, esperado: primera.esperado, cadena: primera.cadena, modo, variante: null, pista: diagnosticar(recibido, vistas, modo, secreto) };
}

// Solo para explicar el rechazo (nunca para aceptar).
function diagnosticar(recibido, cadenas, modo, secreto) {
  const fuera = Object.keys(ALGORITMOS).filter((k) => !(ALGORITMOS_POR_MODO[modo] || []).includes(k));
  for (const cadena of cadenas) {
    for (const clave of fuera) {
      if (iguales(recibido, ALGORITMOS[clave].firmar(cadena, secreto))) {
        return `el hash corresponde a ${ALGORITMOS[clave].nombre}, que el modo "${modo}" no admite (cambie hash.modo a "auto" en Configuración)`;
      }
    }
  }
  return 'no coincide con ninguna forma usual de firmar la transacción con la llave HMAC_SECRET configurada: algún campo se modificó después de firmar, el hash está corrupto o el cliente usa otra llave';
}

module.exports = {
  MENSAJES,
  ALGORITMOS_POR_MODO,
  calcularHash,
  verificarHash,
  mensajeAFirmar,
  serializarCanonico,
  reprFloatPython,
  textoComoPython,
};
