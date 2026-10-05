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

function serializarCanonico(valor, contenedor, clave) {
  if (valor === null) return 'null';
  if (valor === true) return 'true';
  if (valor === false) return 'false';
  if (typeof valor === 'number') return numeroComoPython(valor, fuenteNumero(contenedor, clave));
  if (typeof valor === 'string') return textoComoPython(valor);
  if (Array.isArray(valor)) {
    return `[${valor.map((v, i) => serializarCanonico(v, valor, String(i))).join(',')}]`;
  }
  if (typeof valor === 'object') {
    const claves = Object.keys(valor).sort(compararComoPython);
    return `{${claves.map((k) => `${textoComoPython(k)}:${serializarCanonico(valor[k], valor, k)}`).join(',')}}`;
  }
  throw new TypeError(`No se puede serializar un valor de tipo ${typeof valor}`);
}

function mensajeAFirmar(transaccion) {
  const claves = Object.keys(transaccion).filter((k) => k !== 'hash').sort(compararComoPython);
  return `{${claves.map((k) => `${textoComoPython(k)}:${serializarCanonico(transaccion[k], transaccion, k)}`).join(',')}}`;
}

function calcularHash(transaccion, opciones = {}) {
  const modo = opciones.modo || reglas.obtener().hash.modo;
  const secreto = opciones.secreto ?? env.HMAC_SECRET;
  const cadena = mensajeAFirmar(transaccion);
  const hash = modo === 'sha256'
    ? crypto.createHash('sha256').update(cadena, 'utf8').digest('hex')
    : crypto.createHmac('sha256', secreto).update(cadena, 'utf8').digest('hex');
  return { hash, cadena, modo };
}

function verificarHash(transaccion, opciones = {}) {
  const { hash: esperado, cadena, modo } = calcularHash(transaccion, opciones);
  const recibido = String(transaccion.hash || '').toLowerCase();
  const bufEsperado = Buffer.from(esperado, 'hex');
  const bufRecibido = Buffer.from(recibido, 'hex');
  const valido = bufRecibido.length === bufEsperado.length && crypto.timingSafeEqual(bufRecibido, bufEsperado);
  return { valido, recibido, esperado, cadena, modo };
}

module.exports = {
  calcularHash,
  verificarHash,
  mensajeAFirmar,
  serializarCanonico,
  reprFloatPython,
  textoComoPython,
};
