import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Orígenes permitidos por CORS (qué páginas web pueden llamar a esta API).
 * - En local: el frontend de React (localhost:3000 / 3001).
 * - En producción: se define CORS_ORIGINS con la URL del frontend publicado,
 *   separadas por comas. Ej.: CORS_ORIGINS=https://detector-plagio.vercel.app
 */
function allowedOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return fromEnv.length
    ? fromEnv
    : ['http://localhost:3000', 'http://localhost:3001'];
}

/**
 * Punto de entrada de la API NestJS.
 * - ValidationPipe global: aplica los DTO con class-validator, descarta los
 *   campos no declarados y responde 400 si llegan campos extra
 *   (forbidNonWhitelisted); `transform` convierte los tipos según el DTO.
 * - CORS limitado a allowedOrigins().
 * - Puerto: variable PORT (por defecto 3000).
 * La API no implementa autenticación: los endpoints son accesibles para
 * cualquier origen permitido por CORS.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const origins = allowedOrigins();
  app.enableCors({
    origin: origins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Cierre ordenado cuando la plataforma detiene el contenedor
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  // 0.0.0.0: acepta conexiones desde fuera del contenedor
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `API escuchando en el puerto ${port} | CORS: ${origins.join(', ')}`,
  );
}
void bootstrap();
