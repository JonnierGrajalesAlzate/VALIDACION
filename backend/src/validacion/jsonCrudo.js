const fuentesNumericas = new WeakMap();

function parsearJsonConservandoNumeros(texto) {
  try {
    return JSON.parse(texto, function reviver(clave, valor, contexto) {
      if (typeof valor === 'number' && contexto && typeof contexto.source === 'string') {
        let mapa = fuentesNumericas.get(this);
        if (!mapa) {
          mapa = Object.create(null);
          fuentesNumericas.set(this, mapa);
        }
        mapa[clave] = contexto.source;
      }
      return valor;
    });
  } catch (err) {
    throw describirErrorJson(err, texto);
  }
}

function fuenteNumero(contenedor, clave) {
  if (!contenedor || typeof contenedor !== 'object') return null;
  const mapa = fuentesNumericas.get(contenedor);
  return mapa && Object.prototype.hasOwnProperty.call(mapa, clave) ? mapa[clave] : null;
}

function esLiteralDecimal(fuente) {
  return typeof fuente === 'string' && /[.eE]/.test(fuente);
}

const TRADUCCIONES = [
  [/Unexpected end of JSON input/i, 'el JSON termina antes de tiempo (¿falta cerrar una llave } o un corchete ]?)'],
  [/Expected property name or '}'/i, "se esperaba el nombre de un campo entre comillas dobles o '}' (¿hay una coma sobrante antes de '}'?)"],
  [/Expected double-quoted property name/i, 'se esperaba el nombre de un campo entre comillas dobles (¿coma sobrante o comillas simples?)'],
  [/Expected ',' or '}' after property value/i, "se esperaba ',' o '}' después del valor (¿falta una coma entre campos?)"],
  [/Expected ',' or ']' after array element/i, "se esperaba ',' o ']' después de un elemento del arreglo"],
  [/Expected ':' after property name/i, "se esperaba ':' después del nombre del campo"],
  [/Bad control character in string literal/i, 'hay un carácter de control (salto de línea, tabulación) sin escapar dentro de un texto'],
  [/Unterminated string/i, 'un texto no tiene comillas de cierre'],
  [/Unexpected non-whitespace character after JSON/i, 'hay contenido extra después del JSON (¿dos objetos seguidos sin encerrarlos en [ ]?)'],
  [/Bad escaped character/i, 'hay una secuencia de escape inválida (\\x) dentro de un texto'],
  [/Unexpected token/i, 'hay un carácter inesperado (¿comillas simples, comentario, NaN/Infinity o valor sin comillas?)'],
  [/is not valid JSON/i, 'el texto no es JSON válido'],
];

function describirErrorJson(err, texto) {
  const m = /position (\d+)/.exec(err.message);
  let posicion = m ? Number(m[1]) : null;
  if (posicion === null && /Unexpected end of JSON input/i.test(err.message)) posicion = texto.length;

  let linea = null;
  let columna = null;
  let fragmento = null;
  if (posicion !== null) {
    const antes = texto.slice(0, posicion);
    linea = antes.split('\n').length;
    columna = posicion - antes.lastIndexOf('\n');
    fragmento = `${texto.slice(Math.max(0, posicion - 25), posicion)}⟦aquí⟧${texto.slice(posicion, posicion + 25)}`.replace(/\s+/g, ' ');
  }

  const traduccion = (TRADUCCIONES.find(([re]) => re.test(err.message)) || [null, 'el texto no es JSON válido'])[1];
  const donde = linea !== null ? ` (línea ${linea}, columna ${columna}, posición ${posicion})` : '';

  const error = new Error(`JSON malformado${donde}: ${traduccion}`);
  error.name = 'ErrorJsonMalformado';
  error.posicion = posicion;
  error.linea = linea;
  error.columna = columna;
  error.fragmento = fragmento;
  error.mensajeOriginal = err.message;
  return error;
}

module.exports = { parsearJsonConservandoNumeros, fuenteNumero, esLiteralDecimal };
