import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { trustProxyHops } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // How many reverse proxies sit in front of this process (TRUST_PROXY). Rate
  // limits are per client address, so without it everyone behind the platform's
  // proxy would share one allowance. 0 locally; required in production (config/env.ts).
  app.set('trust proxy', trustProxyHops(process.env));

  // Headers that harden a JSON API (no sniffing, no framing, HSTS over https...).
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // On SIGTERM (every deploy) finish in-flight work and close the database
  // connections instead of dropping them.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
