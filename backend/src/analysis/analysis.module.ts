import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WebSourceService } from './web-source.service';
import { SearchQueryPlannerService } from './search-query-planner.service';
import { StylometryService } from './stylometry.service';

@Module({
  imports: [PrismaModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    WebSourceService,
    SearchQueryPlannerService,
    StylometryService,
  ],
  exports: [AnalysisService],
})
export class AnalysisModule {}
