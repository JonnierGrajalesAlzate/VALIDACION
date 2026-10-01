/**
 * Nivel de una anomalía según cuánto SUPERA el umbral.
 *
 * excedente = cantidad − (primer valor que ya es anómalo)
 *   - POSIBLE_FRAUDE:        primer valor anómalo = umbral      (3 txn → excedente 0)
 *   - EXCESO_FRANJA_HORARIA: primer valor anómalo = límite + 1  (límite 3: 4 txn → excedente 0)
 *
 * Con la configuración por defecto (medioDesdeExcedente=1, altoDesdeExcedente=3):
 *   excedente 0     → BAJO   (p. ej. 3 transacciones en 3 s)
 *   excedente 1 a 2 → MEDIO  (4 o 5 en 3 s)
 *   excedente ≥ 3   → ALTO   (6 o más en 3 s)
 */
function calcularNivel(excedente, niveles) {
  if (excedente >= niveles.altoDesdeExcedente) return 'ALTO';
  if (excedente >= niveles.medioDesdeExcedente) return 'MEDIO';
  return 'BAJO';
}

module.exports = { calcularNivel };
