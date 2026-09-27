import { Module } from '@nestjs/common';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { DocumentAnalysisService } from './document-analysis.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StylometryService } from '../analysis/stylometry.service';

@Module({
  imports: [PrismaModule, AnalysisModule],
  controllers: [EvaluationController],
  providers: [EvaluationService, DocumentAnalysisService, StylometryService],
  exports: [DocumentAnalysisService],
})
export class EvaluationModule {}