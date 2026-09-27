import { Module } from '@nestjs/common';
import { PlagiarismController } from './plagiarism.controller';
import { PlagiarismService } from './plagiarism.service';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [AnalysisModule],
  controllers: [PlagiarismController],
  providers: [PlagiarismService],
})
export class PlagiarismModule {}
