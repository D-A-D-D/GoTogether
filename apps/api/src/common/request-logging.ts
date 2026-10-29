import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** The shape of id we are willing to keep from a caller: short, with nothing that could forge a log line. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Requests slower than this are logged as warnings, so they stand out. */
export const SLOW_REQUEST_MS = 2000;

/** Health checks are polled constantly by the platform; they are only worth a line when they fail. */
const QUIET_PATHS = new Set(['/health', '/health/ready']);

/**
 * A request id: the caller's (a proxy or load balancer often sets one, and keeping
 * it lets a request be followed across them) when it is a sane shape, else a new one.
 */
export function requestIdFrom(header: unknown): string {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && SAFE_ID.test(value) ? value : randomUUID();
}

/** The path without its query string: a query can carry things that do not belong in logs. */
export function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

interface LogSink {
  log(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
}

/**
 * Gives every request an id (sent back as X-Request-Id, so someone reporting a
 * problem can quote it) and writes one structured line when it finishes: method,
 * path, status, how long it took and the client address. Deliberately not logged:
 * the query string, headers, cookies and bodies - they can hold passwords, tokens
 * and personal data.
 */
export function requestLogging(
  options: { logger?: LogSink; now?: () => number } = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const logger = options.logger ?? new Logger('HTTP');
  const now = options.now ?? (() => performance.now());

  return (req, res, next) => {
    const requestId = requestIdFrom(req.headers[REQUEST_ID_HEADER]);
    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = now();

    res.on('finish', () => {
      const path = pathOf(req.originalUrl ?? req.url ?? '');
      const status = res.statusCode;
      if (QUIET_PATHS.has(path) && status < 400) return;
      const durationMs = Math.round(now() - started);
      const line = { message: 'request', requestId, method: req.method, path, status, durationMs, ip: req.ip };
      if (status >= 500) logger.error(line);
      else if (durationMs >= SLOW_REQUEST_MS) logger.warn({ ...line, message: 'slow request' });
      else logger.log(line);
    });
    next();
  };
}
