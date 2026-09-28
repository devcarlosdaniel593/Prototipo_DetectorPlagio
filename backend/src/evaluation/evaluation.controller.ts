import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { DocumentAnalysisService } from './document-analysis.service';
import { SetReferenceLabelDto } from './set-reference-label.dto';

@Controller('evaluation')
export class EvaluationController {
  private readonly logger = new Logger(EvaluationController.name);

  constructor(
    private readonly evaluationService: EvaluationService,
    private readonly documentAnalysisService: DocumentAnalysisService,
  ) {}

  /**
   * Reporte de evaluación a partir de las métricas guardadas.
   * GET http://localhost:3000/evaluation/report
   */
  @Get('report')
  async generateReport() {
    this.logger.log('Solicitud recibida: GET /evaluation/report');
    return this.evaluationService.generateReport();
  }

  /**
   * Asigna la etiqueta de referencia de un documento analizado.
   * PATCH http://localhost:3000/evaluation/documents/5/label
   * Body: { "label": "similar" | "original" | null }
   */
  @Patch('documents/:documentId/label')
  async setReferenceLabel(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() body: SetReferenceLabelDto,
  ) {
    return this.documentAnalysisService.setReferenceLabel(
      documentId,
      body.label ?? null,
    );
  }
}
