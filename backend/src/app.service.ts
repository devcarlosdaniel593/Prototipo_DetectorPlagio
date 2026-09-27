import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'API de plagio activa. Abre el frontend en http://localhost:3001';
  }
}
