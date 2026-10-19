import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentUploadPipeline } from './document-upload.pipeline';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { EvaluationModule } from '../evaluation/evaluation.module';

/**
 * Módulo de documentos: recepción de PDF, extracción de texto, registro en la
 * base de datos y orquestación del análisis. Usa AnalysisModule para el
 * análisis y EvaluationModule para guardar las métricas.
 */
@Module({
  imports: [PrismaModule, AnalysisModule, EvaluationModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentUploadPipeline],
})
export class DocumentsModule {}
