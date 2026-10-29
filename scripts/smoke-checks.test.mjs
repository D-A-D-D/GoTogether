// Tests for scripts/smoke-checks.mjs. Run with `npm run test:scripts`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkApiHeaders,
  checkAuthReachesApi,
  checkCors,
  checkSessionCookie,
  checkWebHeaders,
  checkWebPointsAtApi,
  parseSetCookie,
  scriptUrls,
} from './smoke-checks.mjs';

const headers = (object) => new Headers(object);

const GOOD_API = { 'x-content-type-options': 'nosniff', 'strict-transport-security': 'max-age=31536000', 'x-request-id': 'abc' };
const GOOD_WEB = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "base-uri 'self'; frame-ancestors 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=63072000',
};

describe('checkApiHeaders', () => {
  it('accepts a hardened API', () => assert.deepEqual(checkApiHeaders(headers(GOOD_API)), []));

  for (const [name, missing] of [['nosniff', 'x-content-type-options'], ['HSTS', 'strict-transport-security'], ['a request id', 'x-request-id']]) {
    it(`flags a missing ${name}`, () => {
      const { [missing]: _removed, ...rest } = GOOD_API;
      assert.equal(checkApiHeaders(headers(rest)).length, 1);
    });
  }

  it('flags X-Powered-By', () => {
    assert.match(checkApiHeaders(headers({ ...GOOD_API, 'x-powered-by': 'Express' }))[0], /X-Powered-By/);
  });
});

describe('checkWebHeaders', () => {
  it('accepts a hardened web app', () => assert.deepEqual(checkWebHeaders(headers(GOOD_WEB)), []));

  it('flags a page that can be framed', () => {
    const { 'x-frame-options': _x, ...rest } = GOOD_WEB;
    assert.match(checkWebHeaders(headers(rest))[0], /X-Frame-Options/);
  });

  it("flags a CSP without frame-ancestors 'none'", () => {
    assert.match(checkWebHeaders(headers({ ...GOOD_WEB, 'content-security-policy': "base-uri 'self'" }))[0], /frame-ancestors/);
  });

  it('flags missing HSTS and says to check https', () => {
    const { 'strict-transport-security': _h, ...rest } = GOOD_WEB;
    assert.match(checkWebHeaders(headers(rest))[0], /https/);
  });

  it('flags X-Powered-By', () => {
    assert.ok(checkWebHeaders(headers({ ...GOOD_WEB, 'x-powered-by': 'Next.js' })).some((p) => /X-Powered-By/.test(p)));
  });
});

describe('checkCors', () => {
  const good = { webOrigin: 'https://app.example.com', allowedForWeb: 'https://app.example.com', credentialsForWeb: 'true', allowedForStranger: 'https://app.example.com', stranger: 'https://evil.example' };

  it('accepts the web origin, with credentials, and not a stranger', () => assert.deepEqual(checkCors(good), []));

  it('flags a wrong WEB_ORIGIN (including a trailing slash)', () => {
    assert.match(checkCors({ ...good, allowedForWeb: 'https://app.example.com/' })[0], /does not allow the web origin/);
    assert.match(checkCors({ ...good, allowedForWeb: undefined })[0], /sent "nothing"/);
  });

  it('flags missing credentials', () => {
    assert.match(checkCors({ ...good, credentialsForWeb: undefined })[0], /Credentials/);
  });

  it('flags an API that reflects any origin, or allows all', () => {
    assert.ok(checkCors({ ...good, allowedForStranger: 'https://evil.example' }).some((p) => /unrelated origin/.test(p)));
    assert.ok(checkCors({ ...good, allowedForStranger: '*' }).some((p) => /unrelated origin/.test(p)));
  });
});

describe('parseSetCookie', () => {
  it('splits a cookie into its name, value and attributes', () => {
    const c = parseSetCookie('gt_refresh=abc.def=ghi; Path=/auth; Expires=Tue, 24 Nov 2026 14:16:22 GMT; HttpOnly; Secure; SameSite=Lax');
    assert.equal(c.name, 'gt_refresh');
    assert.equal(c.value, 'abc.def=ghi');
    assert.equal(c.attrs.path, '/auth');
    assert.equal(c.attrs.httponly, true);
    assert.equal(c.attrs.secure, true);
    assert.equal(c.attrs.samesite, 'Lax');
  });
});

describe('checkSessionCookie', () => {
  const GOOD = 'gt_refresh=token; Path=/auth; Expires=Tue, 24 Nov 2026 14:16:22 GMT; HttpOnly; Secure; SameSite=Lax';

  it('accepts a correct session cookie', () => assert.deepEqual(checkSessionCookie([GOOD]), []));

  it('finds it among other cookies', () => assert.deepEqual(checkSessionCookie(['other=1; Path=/', GOOD]), []));

  it('flags a missing cookie', () => assert.match(checkSessionCookie(['other=1'])[0], /no gt_refresh/));

  for (const [label, bad, fragment] of [
    ['HttpOnly', GOOD.replace('HttpOnly; ', ''), /HttpOnly/],
    ['Secure', GOOD.replace('Secure; ', ''), /Secure/],
    ['SameSite=Lax', GOOD.replace('SameSite=Lax', 'SameSite=None'), /SameSite/],
    ['Path=/auth', GOOD.replace('Path=/auth', 'Path=/'), /scoped to \/auth/],
  ]) {
    it(`flags a cookie without ${label}`, () => assert.match(checkSessionCookie([bad])[0], fragment));
  }
});

describe('checkWebPointsAtApi', () => {
  it('accepts a build that mentions the real API address', () => {
    assert.deepEqual(checkWebPointsAtApi(['const A="https://api.example.com";'], 'https://api.example.com'), []);
  });

  it('flags a build that never mentions it', () => {
    assert.match(checkWebPointsAtApi(['nothing here'], 'https://api.example.com')[0], /NEXT_PUBLIC_API_URL/);
  });

  it('flags a build that still talks to the development API', () => {
    const problems = checkWebPointsAtApi(['"https://api.example.com" and "http://localhost:3001"'], 'https://api.example.com');
    assert.ok(problems.some((p) => /localhost:3001/.test(p)));
  });

  it('does not mind localhost when the API itself is local', () => {
    assert.deepEqual(checkWebPointsAtApi(['"http://localhost:3001"'], 'http://localhost:3001'), []);
  });
});

describe('scriptUrls', () => {
  it('finds scripts and resolves them against the page', () => {
    const html = '<script src="/_next/static/a.js" async></script><script>inline()</script><script src="https://cdn.example/b.js"></script>';
    assert.deepEqual(scriptUrls(html, 'https://app.example.com/login'), ['https://app.example.com/_next/static/a.js', 'https://cdn.example/b.js']);
  });
});

describe('checkAuthReachesApi', () => {
  it('accepts the 401 from the API itself, relayed as JSON', () => {
    assert.deepEqual(checkAuthReachesApi({ status: 401, contentType: 'application/json; charset=utf-8' }), []);
  });

  it('points at the build setting when the web app has no /auth route', () => {
    assert.match(checkAuthReachesApi({ status: 404, contentType: 'text/html' })[0], /NEXT_PUBLIC_AUTH_VIA_WEB/);
  });

  it('points at the API address when the relay cannot reach the API', () => {
    for (const status of [500, 502, 504]) assert.match(checkAuthReachesApi({ status, contentType: 'text/plain' })[0], /NEXT_PUBLIC_API_URL/, String(status));
  });

  it('does not accept a 401 that is not JSON (a login page, or a refusal from a gateway)', () => {
    assert.equal(checkAuthReachesApi({ status: 401, contentType: 'text/html' }).length, 1);
    assert.equal(checkAuthReachesApi({ status: 401, contentType: undefined }).length, 1);
  });

  it('does not accept a sign-in that succeeds or is rate limited as proof of a working relay', () => {
    assert.equal(checkAuthReachesApi({ status: 200, contentType: 'application/json' }).length, 1);
    assert.equal(checkAuthReachesApi({ status: 429, contentType: 'application/json' }).length, 1);
  });
});
