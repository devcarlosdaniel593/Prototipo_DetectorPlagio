import type { AnalysisResponse } from '../analysis/analysis.service';

export type BatchAnalysisResult = {
  index: number;
  fileName: string;
  title: string;
  status: 'ok' | 'error';
  result?: AnalysisResponse;
  error?: string;
};
