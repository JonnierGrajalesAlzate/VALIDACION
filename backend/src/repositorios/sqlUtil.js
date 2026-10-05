function crearFiltros(paramsIniciales = []) {
  const params = [...paramsIniciales];
  const condiciones = [];
  return {
    params,
    param(valor) {
      params.push(valor);
      return `$${params.length}`;
    },
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
