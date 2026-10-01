/**
 * Ayuda para armar cláusulas WHERE dinámicas SIN concatenar valores.
 *
 * Solo se concatenan fragmentos de SQL escritos por nosotros; los valores
 * del usuario siempre van como parámetros $1, $2...
 *
 *   const f = crearFiltros();
 *   f.agregar('u.email = ?', 'aa@aa.com');   // → "u.email = $1"
 *   f.where()   → "WHERE u.email = $1"
 *   f.params    → ['aa@aa.com']
 */
function crearFiltros(paramsIniciales = []) {
  const params = [...paramsIniciales];
  const condiciones = [];
  return {
    params,
    /** Registra un valor y devuelve su marcador ($n). */
    param(valor) {
      params.push(valor);
      return `$${params.length}`;
    },
    /** Agrega una condición; cada "?" se reemplaza por el marcador del valor. */
    agregar(fragmento, valor) {
      params.push(valor);
      condiciones.push(fragmento.replace(/\?/g, `$${params.length}`));
    },
    where() {
      return condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    },
  };
}

module.exports = { crearFiltros };
