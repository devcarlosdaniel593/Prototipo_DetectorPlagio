import { TfIdf } from 'natural';
import { cleanText } from './text.utils';

/**
 * Calcula similitud coseno TF-IDF entre dos textos.
 *
 * Mejora respecto a la versión anterior:
 * - Normalización de longitud: penaliza levemente cuando los textos tienen
 *   tamaños muy dispares (ej: segmento de 80 palabras vs abstract de 40 palabras).
 *   Esto evita que textos extremadamente cortos inflen o desinflén artificialmente
 *   el score coseno.
 * - Guarda la firma de los tokens para evitar recalcular TF-IDF dos veces
 *   cuando se llama desde calculateSimilarityAgainstBestChunk en lotes.
 */
export function calculateSimilarity(text1: string, text2: string): number {
  const clean1 = cleanText(text1);
  const clean2 = cleanText(text2);

  if (!clean1 || !clean2) return 0;

  const tfidf = new TfIdf();
  tfidf.addDocument(clean1);
  tfidf.addDocument(clean2);

  const terms1 = tfidf.listTerms(0);
  const terms2 = tfidf.listTerms(1);

  const map1 = new Map(terms1.map((t) => [t.term, t.tfidf]));
  const map2 = new Map(terms2.map((t) => [t.term, t.tfidf]));

  const allTerms = new Set([...map1.keys(), ...map2.keys()]);

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  allTerms.forEach((term) => {
    const v1 = map1.get(term) ?? 0;
    const v2 = map2.get(term) ?? 0;
    dotProduct += v1 * v2;
    magnitude1 += v1 * v1;
    magnitude2 += v2 * v2;
  });

  if (!magnitude1 || !magnitude2) return 0;

  const cosineSimilarity =
    dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2));

  // ── Penalización por diferencia de longitud ───────────────────────────────
  // Si un texto tiene menos de la mitad de tokens que el otro, aplicamos un
  // factor de corrección suave. Esto reduce falsos positivos cuando se compara
  // un segmento de 200 palabras contra un chunk de 15 palabras.
  const len1 = clean1.split(/\s+/).filter(Boolean).length;
  const len2 = clean2.split(/\s+/).filter(Boolean).length;
  const lengthRatio = Math.min(len1, len2) / Math.max(len1, len2);

  // El factor oscila entre 0.75 (textos muy dispares) y 1.0 (misma longitud)
  const lengthFactor = 0.75 + 0.25 * lengthRatio;

  return cosineSimilarity * lengthFactor * 100;
}
