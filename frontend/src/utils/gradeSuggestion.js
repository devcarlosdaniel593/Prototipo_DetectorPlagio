/**
 * Convierte porcentaje de similitud (0–100) a nota sobre 10.
 * Menor similitud → mayor nota. 0% → 10, 10% → 9, …, 100% → 0.
 */
export function similarityToPrototypeGrade(similarityPercent) {
  const clamped = Math.max(0, Math.min(100, Number(similarityPercent) || 0));
  const grade = (100 - clamped) / 10;
  return Math.round(grade * 100) / 100;
}

/**
 * Nota sugerida = promedio simple de la nota del prototipo y la del docente,
 * redondeado a 2 decimales. Es una referencia; la calificación final la decide el docente.
 */
export function computeSuggestedGrade(prototypeGrade, teacherGrade) {
  const avg = (prototypeGrade + teacherGrade) / 2;
  return Math.round(avg * 100) / 100;
}

/**
 * Valida la nota ingresada por el docente (número entre 0 y 10).
 * @returns {{valid: boolean, value: number|null, error: string|null}}
 */
export function parseTeacherGradeInput(raw) {
  if (raw === '' || raw === null || raw === undefined) {
    return { valid: false, value: null, error: 'Ingresa una calificación entre 0 y 10.' };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { valid: false, value: null, error: 'La calificación debe ser un número válido.' };
  }
  if (value < 0 || value > 10) {
    return { valid: false, value: null, error: 'La calificación debe estar entre 0 y 10.' };
  }
  return { valid: true, value: Math.round(value * 100) / 100, error: null };
}
