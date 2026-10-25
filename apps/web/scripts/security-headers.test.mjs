// Tests for the security headers in next.config.ts. Run with
// `npm run test --workspace apps/web`. Imports the TypeScript source directly -
// Node strips the type annotations.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import nextConfig from '../next.config.ts';

const original = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = original;
});

async function headersFor(env) {
  process.env.NODE_ENV = env;
  const rules = await nextConfig.headers();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/:path*', 'applies to every route');
  return Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
}

describe('security headers', () => {
  it('do not advertise the framework with X-Powered-By', () => {
    assert.equal(nextConfig.poweredByHeader, false);
  });

  it('stop the browser guessing content types', async () => {
    assert.equal((await headersFor('production'))['X-Content-Type-Options'], 'nosniff');
  });

  it('forbid framing the app, both ways browsers understand', async () => {
    const h = await headersFor('production');
    assert.equal(h['X-Frame-Options'], 'DENY');
    assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  });

  it('restrict where forms post, where <base> points, and plugins', async () => {
    const csp = (await headersFor('production'))['Content-Security-Policy'];
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /object-src 'none'/);
  });

  it('do not restrict scripts or connections - that needs a nonce policy, and would break the app if guessed', async () => {
    const csp = (await headersFor('production'))['Content-Security-Policy'];
    assert.doesNotMatch(csp, /script-src|default-src|connect-src|style-src/);
  });

  it('send only the origin to other sites', async () => {
    assert.equal((await headersFor('production'))['Referrer-Policy'], 'strict-origin-when-cross-origin');
  });

  it('switch off browser features the app never uses', async () => {
    const policy = (await headersFor('production'))['Permissions-Policy'];
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) {
      assert.match(policy, new RegExp(`${feature}=\\(\\)`));
    }
  });

  it('add HSTS in production, so browsers refuse plain http for two years', async () => {
    assert.match((await headersFor('production'))['Strict-Transport-Security'], /max-age=63072000; includeSubDomains/);
  });

  it('leave HSTS out in development, where it would stick to localhost', async () => {
    assert.equal((await headersFor('development'))['Strict-Transport-Security'], undefined);
  });
});
