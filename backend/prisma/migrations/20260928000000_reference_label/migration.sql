-- Etiqueta de referencia para calcular precisión, recall y F1 con datos reales
ALTER TABLE "DocumentAnalysis" ADD COLUMN "referenceLabel" TEXT;
