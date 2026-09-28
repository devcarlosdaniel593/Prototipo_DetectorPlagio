import { Module } from '@nestjs/common';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { DocumentAnalysisService } from './document-analysis.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  // StylometryService llega desde AnalysisModule (exportado allí)
  imports: [PrismaModule, AnalysisModule],
  controllers: [EvaluationController],
  providers: [EvaluationService, DocumentAnalysisService],
  exports: [DocumentAnalysisService],
})
export class EvaluationModule {}
