/**
 * Interpreta el flag de persistencia enviado desde el frontend (FormData).
 * Por defecto true para mantener el comportamiento histórico del prototipo.
 */
export function parsePersistToRepository(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return true;
}
