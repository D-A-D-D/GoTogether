import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { RAW_MEDIA_ROUTES, rawMedia, uploadedBytes } from './raw-media.js';

// A real HTTP server with the middleware mounted, because "does the body arrive as bytes, and only on these
// routes" is exactly what mocks cannot prove.

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(rawMedia());
  // Echoes what the route handler would see, for every method and path.
  app.use((req, res) => {
    res.json({ isBuffer: Buffer.isBuffer(req.body), length: Buffer.isBuffer(req.body) ? req.body.length : null, bodyType: typeof req.body });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const send = (method: string, path: string, body?: Uint8Array, type = 'application/octet-stream') =>
  fetch(base + path, { method, body: body as never, headers: body ? { 'content-type': type } : {} });

describe('rawMedia', () => {
  it('hands the avatar route the file itself, whatever type the client calls it', async () => {
    for (const type of ['image/jpeg', 'application/octet-stream', 'text/plain']) {
      const res = await (await send('PUT', '/users/me/avatar', new Uint8Array(1234), type)).json();
      expect(res).toEqual({ isBuffer: true, length: 1234, bodyType: 'object' });
    }
  });

  it('hands the chat media route the file itself', async () => {
    const res = await (await send('POST', '/trips/trip-1/media', new Uint8Array(500), 'audio/webm')).json();
    expect(res).toMatchObject({ isBuffer: true, length: 500 });
  });

  it('leaves every other route alone, so no other endpoint ever has its body read as a blob', async () => {
    for (const [method, path] of [['POST', '/auth/login'], ['PUT', '/users/me'], ['POST', '/trips'], ['POST', '/trips/t1/requests'], ['PUT', '/users/me/avatar/extra'], ['POST', '/users/me/avatar'], ['PUT', '/trips/t1/media'], ['GET', '/users/me/avatar']] as const) {
      const res = await (await send(method, path, method === 'GET' ? undefined : new Uint8Array(50))).json();
      expect(res.isBuffer, `${method} ${path}`).toBe(false);
    }
  });

  it('refuses an avatar over the limit as it arrives, with 413', async () => {
    const res = await send('PUT', '/users/me/avatar', new Uint8Array(1_800_000));
    expect(res.status).toBe(413);
  });

  it('refuses a chat file over its (larger) limit with 413, but takes one just under', async () => {
    expect((await send('POST', '/trips/t1/media', new Uint8Array(4_500_000))).status).toBe(413);
    expect((await send('POST', '/trips/t1/media', new Uint8Array(4_000_000))).status).toBe(200);
  });

  it('copes with a request that has no body at all: nothing to store', async () => {
    const res = await (await fetch(`${base}/users/me/avatar`, { method: 'PUT' })).json();
    expect(res.length ?? 0).toBe(0);
  });

  it('keeps its limits a little above the service limits, so the service can give the clear message', () => {
    const limit = (path: RegExp) => RAW_MEDIA_ROUTES.find((r) => r.pattern === path)!.limit;
    expect(RAW_MEDIA_ROUTES).toHaveLength(2);
    expect(limit(RAW_MEDIA_ROUTES[0].pattern)).toBe('1700kb');
    expect(limit(RAW_MEDIA_ROUTES[1].pattern)).toBe('4300kb');
  });
});

describe('uploadedBytes', () => {
  it('returns a non-empty buffer, and nothing else', () => {
    const bytes = Buffer.from([1, 2, 3]);
    expect(uploadedBytes({ body: bytes })).toBe(bytes);
    expect(uploadedBytes({ body: Buffer.alloc(0) })).toBeNull();
    expect(uploadedBytes({ body: {} })).toBeNull();
    expect(uploadedBytes({ body: 'text' })).toBeNull();
    expect(uploadedBytes({})).toBeNull();
  });
});
