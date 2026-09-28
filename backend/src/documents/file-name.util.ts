/**
 * Multer entrega el nombre del archivo interpretado como latin1, así que
 * "Evaluación.pdf" llega como "EvaluaciÃ³n.pdf". Esta función lo corrige.
 *
 * Solo se reinterpreta si el resultado es UTF-8 válido; si el nombre ya venía
 * bien (o contiene caracteres fuera de latin1) se deja como está.
 */
export function fixUploadFileName(name: string): string {
  if (!name || !/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) {
    return name;
  }
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

export function fixUploadFileNames(files: Express.Multer.File[] | undefined): void {
  (files || []).forEach((file) => {
    file.originalname = fixUploadFileName(file.originalname);
  });
}
