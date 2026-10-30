import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { requestLogging } from './common/request-logging.js';
import { rawMedia } from './common/raw-media.js';
import { trustProxyHops } from './config/env.js';

async function bootstrap() {
  // One JSON object per line in production, which log tools can search and filter; the
  // readable coloured output in development.
  const logger = process.env.NODE_ENV === 'production' ? new ConsoleLogger({ json: true, colors: false }) : undefined;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, logger ? { logger } : {});

  // How many reverse proxies sit in front of this process (TRUST_PROXY). Rate
  // limits are per client address, so without it everyone behind the platform's
  // proxy would share one allowance. 0 locally; required in production (config/env.ts).
  app.set('trust proxy', trustProxyHops(process.env));

  // Headers that harden a JSON API (no sniffing, no framing, HSTS over https...).
  app.use(helmet());
  // First after the security headers, so every response - even a refused one - carries an id and is logged.
  app.use(requestLogging());
  app.use(cookieParser());
  // Reads the body of the upload routes (and only those) as the file itself.
  app.use(rawMedia());
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
