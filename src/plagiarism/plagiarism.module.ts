import { Module } from '@nestjs/common';
import { PlagiarismController } from './plagiarism.controller';
import { PlagiarismService } from './plagiarism.service';

@Module({
  controllers: [PlagiarismController],
  providers: [PlagiarismService]
})
export class PlagiarismModule {}
