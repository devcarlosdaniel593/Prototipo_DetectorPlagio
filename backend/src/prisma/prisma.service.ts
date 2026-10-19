import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente de Prisma inyectable. Abre la conexión a PostgreSQL (DATABASE_URL)
 * al iniciar el módulo; todos los servicios comparten esta instancia.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
