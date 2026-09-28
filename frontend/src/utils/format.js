/**
 * Formatea un porcentaje para mostrarlo en pantalla.
 *   formatPercent(12.3456)    → "12.35%"
 *   formatPercent(12.3456, 1) → "12.3%"
 *   formatPercent(null)       → "—"  (sin dato, p. ej. métricas sin etiquetas)
 */
export function formatPercent(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number.toFixed(decimals)}%`;
}
