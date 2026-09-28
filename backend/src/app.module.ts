import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { DocumentsModule } from './documents/documents.module';
import { AnalysisModule } from './analysis/analysis.module';
import { EvaluationModule } from './evaluation/evaluation.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    DocumentsModule,
    AnalysisModule,
    EvaluationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
