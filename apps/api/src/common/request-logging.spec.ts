import { EventEmitter } from 'node:events';
import { REQUEST_ID_HEADER, SLOW_REQUEST_MS, pathOf, requestIdFrom, requestLogging } from './request-logging.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('requestIdFrom', () => {
  it('keeps an id a proxy sent, so a request can be followed across hops', () => {
    expect(requestIdFrom('abc12345-def6')).toBe('abc12345-def6');
  });

  it('keeps the first of several', () => {
    expect(requestIdFrom(['first-id-0001', 'second-id-0002'])).toBe('first-id-0001');
  });

  it('makes a new id when there is none', () => {
    expect(requestIdFrom(undefined)).toMatch(UUID);
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['with a space', 'has a space 1234'],
    ['a newline, which could forge a log line', 'abcdefgh\nlevel=error'],
    ['quotes and braces', '{"level":"error"}'],
    ['empty', ''],
  ])('does not trust an id that is %s', (_label, value) => {
    expect(requestIdFrom(value)).toMatch(UUID);
  });

  it('makes a different id each time', () => {
    expect(requestIdFrom(undefined)).not.toBe(requestIdFrom(undefined));
  });

  it('ignores a header that is not text', () => {
    expect(requestIdFrom(12345678)).toMatch(UUID);
  });
});

describe('pathOf', () => {
  it('drops the query string', () => {
    expect(pathOf('/trips/discover?destination=Spiti&token=secret')).toBe('/trips/discover');
  });
  it('leaves a path with no query alone', () => {
    expect(pathOf('/trips/mine')).toBe('/trips/mine');
  });
});

function run(options: { url?: string; status?: number; durationMs?: number; headers?: Record<string, string>; method?: string } = {}) {
  let clock = 1000;
  const lines: Array<{ level: string; line: any }> = [];
  const logger = {
    log: (line: unknown) => lines.push({ level: 'log', line }),
    warn: (line: unknown) => lines.push({ level: 'warn', line }),
    error: (line: unknown) => lines.push({ level: 'error', line }),
  };
  const middleware = requestLogging({ logger, now: () => clock });
  const req: any = { headers: options.headers ?? {}, method: options.method ?? 'GET', originalUrl: options.url ?? '/trips/mine', ip: '203.0.113.9' };
  const res: any = Object.assign(new EventEmitter(), { statusCode: options.status ?? 200, setHeader: vi.fn() });
  const next = vi.fn();
  middleware(req, res, next);
  clock += options.durationMs ?? 12;
  res.emit('finish');
  return { req, res, next, lines };
}

describe('requestLogging', () => {
  it('lets the request carry on', () => {
    expect(run().next).toHaveBeenCalledTimes(1);
  });

  it('gives the request an id, available to later code and sent back in a response header', () => {
    const { req, res } = run();
    expect(req.requestId).toMatch(UUID);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  it('uses the id a proxy sent', () => {
    const { req, res } = run({ headers: { [REQUEST_ID_HEADER]: 'from-the-proxy-1' } });
    expect(req.requestId).toBe('from-the-proxy-1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'from-the-proxy-1');
  });

  it('writes one line when the response finishes, with what is needed to understand it', () => {
    const { lines, req } = run({ method: 'POST', url: '/auth/login', status: 401, durationMs: 37 });
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('log');
    expect(lines[0].line).toEqual({
      message: 'request',
      requestId: req.requestId,
      method: 'POST',
      path: '/auth/login',
      status: 401,
      durationMs: 37,
      ip: '203.0.113.9',
    });
  });

  it('never logs the query string, which can carry tokens or personal data', () => {
    const { lines } = run({ url: '/trips/discover?destination=Spiti&token=SECRET123' });
    expect(JSON.stringify(lines)).not.toContain('SECRET123');
    expect(lines[0].line.path).toBe('/trips/discover');
  });

  it('never logs headers, cookies or a body - only the fixed fields', () => {
    const { lines } = run({ headers: { cookie: 'gt_refresh=SECRETCOOKIE', authorization: 'Bearer SECRETTOKEN' } });
    expect(JSON.stringify(lines)).not.toMatch(/SECRETCOOKIE|SECRETTOKEN/);
    expect(Object.keys(lines[0].line).sort()).toEqual(['durationMs', 'ip', 'message', 'method', 'path', 'requestId', 'status']);
  });

  it('logs a server error at error level', () => {
    const { lines } = run({ status: 500 });
    expect(lines[0].level).toBe('error');
  });

  it('logs a client error (a 4xx) as an ordinary line - those are the caller\'s mistakes, not ours', () => {
    expect(run({ status: 404 }).lines[0].level).toBe('log');
    expect(run({ status: 429 }).lines[0].level).toBe('log');
  });

  it('flags a slow request as a warning', () => {
    const { lines } = run({ durationMs: SLOW_REQUEST_MS });
    expect(lines[0].level).toBe('warn');
    expect(lines[0].line.message).toBe('slow request');
  });

  it('does not flag one just under the threshold', () => {
    expect(run({ durationMs: SLOW_REQUEST_MS - 1 }).lines[0].level).toBe('log');
  });

  it('rounds the duration to whole milliseconds', () => {
    expect(run({ durationMs: 12.6 }).lines[0].line.durationMs).toBe(13);
  });

  it.each(['/health', '/health/ready'])('stays quiet about a healthy %s: the platform polls it constantly', (url) => {
    expect(run({ url }).lines).toHaveLength(0);
  });

  it.each(['/health', '/health/ready'])('but does log a failing %s', (url) => {
    const { lines } = run({ url, status: 503 });
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('error');
  });

  it('does not treat a path that merely starts with /health as a health check', () => {
    expect(run({ url: '/healthy-trips' }).lines).toHaveLength(1);
  });
});
