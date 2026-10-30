import { raw } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// The upload routes take the file itself as the request body (not a multipart form), so the one thing
// needed to read it is express.raw - no upload library, and so none of the multipart parser's
// vulnerabilities, which is why this app has none of those in its attack surface.
//
// It is limited to these exact routes, and each has its own size cap, so no other route ever has its body
// read as a blob, and a large body is refused as it arrives rather than after it has been buffered.

/** Slightly above each route's own limit (MEDIA_LIMITS), which is what the service enforces with a clear message. */
export const RAW_MEDIA_ROUTES: ReadonlyArray<{ method: 'PUT' | 'POST'; pattern: RegExp; limit: string }> = [
  { method: 'PUT', pattern: /^\/users\/me\/avatar\/?$/, limit: '1700kb' },
  { method: 'POST', pattern: /^\/trips\/[^/]+\/media\/?$/, limit: '4300kb' },
];

export function rawMedia(): RequestHandler {
  const parsers = RAW_MEDIA_ROUTES.map((route) => ({ ...route, parse: raw({ type: () => true, limit: route.limit }) }));
  return (req: Request, res: Response, next: NextFunction) => {
    const route = parsers.find((p) => p.method === req.method && p.pattern.test(req.path));
    if (!route) return next();
    return route.parse(req, res, next);
  };
}

/** The uploaded bytes, or null if the request carried none. */
export function uploadedBytes(req: { body?: unknown }): Buffer | null {
  return Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;
}
