import { TfIdf } from 'natural';

export function calculateSimilarity(text1: string, text2: string): number {
  const tfidf = new TfIdf();

  tfidf.addDocument(text1);
  tfidf.addDocument(text2);

  const terms1 = tfidf.listTerms(0);
  const terms2 = tfidf.listTerms(1);

  const vector1 = terms1.map((t) => t.tfidf);
  const vector2 = terms2.map((t) => t.tfidf);

  const dotProduct = vector1.reduce(
    (sum, v, i) => sum + v * (vector2[i] || 0),
    0,
  );

  const magnitude1 = Math.sqrt(vector1.reduce((sum, v) => sum + v * v, 0));
  const magnitude2 = Math.sqrt(vector2.reduce((sum, v) => sum + v * v, 0));

  const similarity = dotProduct / (magnitude1 * magnitude2);

  return similarity * 100;
}
