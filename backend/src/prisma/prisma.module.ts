import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Expone PrismaService a los módulos que lo importan. */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
