import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentUploadPipeline } from './document-upload.pipeline';
import { SessionBatchRegistryService } from './session-batch.registry';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { EvaluationModule } from '../evaluation/evaluation.module';

@Module({
  imports: [PrismaModule, AnalysisModule, EvaluationModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentUploadPipeline, SessionBatchRegistryService],
})
export class DocumentsModule {}
