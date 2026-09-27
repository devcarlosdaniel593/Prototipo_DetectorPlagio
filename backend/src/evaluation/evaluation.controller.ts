import { Controller, Get, Logger } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';

@Controller('evaluation')
export class EvaluationController {
  private readonly logger = new Logger(EvaluationController.name);

  constructor(private readonly evaluationService: EvaluationService) {}

  /**
   * Estado en tiempo real del reporte (para polling desde el frontend).
   * GET http://localhost:3000/evaluation/progress
   */
  @Get('progress')
  getProgress() {
    return this.evaluationService.getProgress();
  }

  /**
   * Genera un reporte completo de evaluación del sistema.
   * Incluye precisión, recall, F1, estilometría y rendimiento.
   *
   * GET http://localhost:3000/evaluation/report
   */
  @Get('report')
  async generateReport() {
    this.logger.log('Solicitud recibida: GET /evaluation/report');
    const report = await this.evaluationService.generateReport();
    this.logger.log('Respuesta enviada: reporte de evaluación completado.');
    return report;
  }
}