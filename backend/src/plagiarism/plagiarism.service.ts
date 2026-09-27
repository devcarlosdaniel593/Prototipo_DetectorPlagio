import { Injectable, Logger } from '@nestjs/common';
import {
  AnalysisService,
  AnalysisResponse,
} from '../analysis/analysis.service';

/**
 * PlagiarismService actúa como fachada pública del módulo de plagio.
 *
 * Toda la lógica pesada (comparación léxica, semántica, fuentes web)
 * vive en AnalysisService. Este servicio expone una API limpia para
 * que PlagiarismController no dependa directamente de AnalysisService.
 *
 * Si en el futuro se añaden reglas de negocio propias del módulo de plagio
 * (umbrales por tipo de usuario, límites de análisis por plan, auditoría, etc.)
 * se añaden aquí sin tocar AnalysisService.
 */
@Injectable()
export class PlagiarismService {
  private readonly logger = new Logger(PlagiarismService.name);

  constructor(private readonly analysisService: AnalysisService) {}

  /**
   * Analiza un documento y retorna el reporte completo de similitud.
   * @param documentId ID del documento a analizar (debe existir en BD)
   */
  async analyzeDocument(documentId: number): Promise<AnalysisResponse> {
    this.logger.log(
      `PlagiarismService: iniciando análisis para documento ${documentId}`,
    );
    const result = await this.analysisService.analyzeDocument(documentId);
    this.logger.log(
      `PlagiarismService: análisis completado — similitud global: ${result.overallSimilarity}%, ` +
        `fuentes encontradas: ${result.summary.length}`,
    );
    return result;
  }

  /**
   * Retorna solo el porcentaje global de similitud sin el detalle completo.
   * Útil para endpoints de resumen o listados.
   */
  async getOverallSimilarity(documentId: number): Promise<number> {
    const result = await this.analyzeDocument(documentId);
    return result.overallSimilarity;
  }
}
