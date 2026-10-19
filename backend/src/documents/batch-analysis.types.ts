import type { AnalysisResponse } from '../analysis/analysis.service';

/**
 * Resultado de un archivo dentro de un envío por lote. `index` es su posición
 * en el envío original; si status = 'error', `error` trae el mensaje y no hay `result`.
 */
export type BatchAnalysisResult = {
  index: number;
  fileName: string;
  title: string;
  status: 'ok' | 'error';
  result?: AnalysisResponse;
  error?: string;
};
