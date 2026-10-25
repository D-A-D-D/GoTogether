import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // As in main.ts, so a bad body is a 400 rather than reaching the database.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect(({ body }) => {
      if (body.status !== 'ok') throw new Error('expected status ok');
    });
  });

  it('answers 429 once one address has used up the sign-in allowance, with when to retry', async () => {
    const attempt = () => request(app.getHttpServer()).post('/auth/login').send({ email: 'not-an-email', password: 'x' });
    // The limit is on requests, so these are counted even though each is a 400.
    for (let i = 0; i < 10; i++) await attempt().expect(400);
    const limited = await attempt().expect(429);
    if (!limited.headers['retry-after']) throw new Error('expected a Retry-After header');
    // The message a person reads on the login page, not an exception class name.
    if (limited.body.message !== 'Too many requests - please slow down and try again in a moment.') {
      throw new Error(`unexpected message: ${limited.body.message}`);
    }
  });

  it('never rate limits the health checks the hosting platform polls', async () => {
    // More than the default allowance, so this fails if the exemption is ever lost.
    for (let i = 0; i < 320; i++) await request(app.getHttpServer()).get('/health').expect(200);
  });

  afterEach(async () => {
    await app.close();
  });
});
