function calcularNivel(excedente, niveles) {
  if (excedente >= niveles.altoDesdeExcedente) return 'ALTO';
  if (excedente >= niveles.medioDesdeExcedente) return 'MEDIO';
  return 'BAJO';
}

module.exports = { calcularNivel };
