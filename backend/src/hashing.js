/**
 * hashing.js — TODA la lógica del hash de una transacción vive aquí.
 *
 * Esquema (acordado con el ejemplo en Python del profesor):
 *
 *   datos   = transacción SIN el campo "hash"
 *   mensaje = json.dumps(datos, sort_keys=True, separators=(",", ":"))
 *   hash    = HMAC-SHA256(HMAC_SECRET, mensaje)  → 64 caracteres hex
 *
 * El mensaje debe ser IDÉNTICO byte por byte al que produce Python, y
 * JSON.stringify de JavaScript NO sirve porque:
 *   1. no ordena las claves;
 *   2. no escapa los caracteres no ASCII (Python, por defecto
 *      ensure_ascii=True, escribe "ñ" como "ñ");
 *   3. escribe 50000.0 como "50000" (Python conserva "50000.0" si el
 *      número venía como float) y 1e16 como "10000000000000000"
 *      (Python escribe "1e+16").
 * Por eso aquí hay una serialización canónica propia.
 *
 * Si el profesor usa otro esquema, este es el ÚNICO archivo a cambiar.
 * El modo se configura en config/reglas.json → hash.modo:
 *   - "hmac"   : HMAC-SHA256 con HMAC_SECRET (por defecto)
 *   - "sha256" : SHA-256 simple del mensaje, sin llave
 */
const crypto = require('crypto');
const env = require('./config/env');
const reglas = require('./config/reglas');
const { fuenteNumero, esLiteralDecimal } = require('./validacion/jsonCrudo');

// ─────────────────────────────────────────────────────────────────────────
// 1. Números con el mismo formato que Python
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reproduce repr(float) de Python (el formato que usa json.dumps).
 *
 * Tanto Python como JavaScript usan los MISMOS dígitos (el decimal más
 * corto que al leerse devuelve el mismo double); solo cambia cuándo usan
 * notación científica:
 *   - Python: científica si el exponente decimal es < -4 o >= 16,
 *     con exponente de al menos 2 dígitos ("1e-05", "1e+16") y
 *     siempre ".0" si el número es entero en notación fija ("50000.0").
 *   - JavaScript: científica si el exponente es < -6 o >= 21.
 */
function reprFloatPython(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';

  const negativo = x < 0;
  // toExponential() sin argumento da los dígitos MÍNIMOS: "5e+4", "1.2345e-7"
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

/**
 * Escribe un número como lo haría Python después de json.loads:
 *  - literal entero ("10001")          → int   → "10001"
 *  - literal con . o e ("50000.0")     → float → repr(float) → "50000.0"
 * `fuente` es el texto original del número en el JSON recibido (si se conoce).
 */
function numeroComoPython(valor, fuente) {
  if (typeof fuente === 'string') {
    if (!esLiteralDecimal(fuente)) {
      // BigInt respeta enteros de cualquier tamaño, igual que int de Python.
      return BigInt(fuente).toString();
    }
    return reprFloatPython(Number(fuente));
  }
  // Sin texto original (objeto armado en código): enteros como int.
  if (Number.isSafeInteger(valor)) return String(valor);
  return reprFloatPython(valor);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Textos con el mismo escape que Python (ensure_ascii=True)
// ─────────────────────────────────────────────────────────────────────────

const ESCAPES = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

/**
 * Python escapa todo lo que no esté entre el espacio (0x20) y "~" (0x7E),
 * incluido DEL (0x7F), como \uXXXX en hexadecimal MINÚSCULA. Los caracteres
 * fuera del plano básico (emojis) salen como par sustituto "😀";
 * como los strings de JS ya son UTF-16, recorrer charCodeAt da justo eso.
 */
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

/**
 * sort_keys de Python ordena por punto de código Unicode. El sort() de JS
 * compara unidades UTF-16, que difiere solo con caracteres fuera del plano
 * básico; se compara por punto de código para que sea exacto.
 */
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

// ─────────────────────────────────────────────────────────────────────────
// 3. Serialización canónica
// ─────────────────────────────────────────────────────────────────────────

/**
 * Equivale a json.dumps(valor, sort_keys=True, separators=(",", ":")).
 * @param {*} valor
 * @param {object} [contenedor] objeto que contiene a `valor` (para buscar el texto original del número)
 * @param {string} [clave] clave de `valor` dentro de `contenedor`
 */
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

/**
 * Cadena exacta que se firma: la transacción SIN "hash", en forma canónica.
 * No se copia el objeto (se perdería el texto original de los números):
 * se serializa el original saltando la clave "hash".
 */
function mensajeAFirmar(transaccion) {
  const claves = Object.keys(transaccion).filter((k) => k !== 'hash').sort(compararComoPython);
  return `{${claves.map((k) => `${textoComoPython(k)}:${serializarCanonico(transaccion[k], transaccion, k)}`).join(',')}}`;
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Cálculo y verificación
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {object} transaccion  objeto recibido (con o sin "hash")
 * @param {object} [opciones]   { modo: 'hmac'|'sha256', secreto }
 * @returns {{ hash: string, cadena: string, modo: string }}
 */
function calcularHash(transaccion, opciones = {}) {
  const modo = opciones.modo || reglas.obtener().hash.modo;
  const secreto = opciones.secreto ?? env.HMAC_SECRET;
  const cadena = mensajeAFirmar(transaccion);
  // Se firma el texto en UTF-8 (como .encode() en Python); al ser ASCII
  // puro por el escape, los bytes coinciden 1 a 1 con los caracteres.
  const hash = modo === 'sha256'
    ? crypto.createHash('sha256').update(cadena, 'utf8').digest('hex')
    : crypto.createHmac('sha256', secreto).update(cadena, 'utf8').digest('hex');
  return { hash, cadena, modo };
}

/**
 * Compara el hash recibido con el esperado usando crypto.timingSafeEqual.
 *
 * ¿Por qué no `===`? Porque === se detiene en el primer carácter distinto:
 * midiendo cuánto tarda, un atacante podría adivinar el hash carácter por
 * carácter. timingSafeEqual tarda lo mismo sin importar dónde difieran.
 *
 * @returns {{ valido: boolean, recibido: string, esperado: string, cadena: string, modo: string }}
 */
function verificarHash(transaccion, opciones = {}) {
  const { hash: esperado, cadena, modo } = calcularHash(transaccion, opciones);
  const recibido = String(transaccion.hash || '').toLowerCase();
  const bufEsperado = Buffer.from(esperado, 'hex');
  const bufRecibido = Buffer.from(recibido, 'hex');
  // timingSafeEqual exige la misma longitud (el esquema ya garantiza 64 hex).
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
