/**
 * Obtiene el porcentaje de similitud global desde un resultado de análisis.
 */
export function getSimilarityFromAnalysisResult(result) {
  if (!result) return 0;
  if (typeof result.overallSimilarity === 'number') return result.overallSimilarity;
  const summary = result.summary || [];
  if (!summary.length) return 0;
  return summary.reduce((acc, doc) => acc + doc.similarity, 0) / summary.length;
}

/**
 * Similitud de una entrada del envío por lote (batch).
 */
export function getSimilarityFromBatchEntry(entry) {
  if (entry?.status !== 'ok' || !entry.result) return null;
  return getSimilarityFromAnalysisResult(entry.result);
}
