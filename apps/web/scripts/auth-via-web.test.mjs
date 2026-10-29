// Tests for sign-in through the web app's own address: src/lib/endpoint.ts (which address
// the browser calls) and the rewrite in next.config.ts (where Next passes it on to). Run with
// `npm run test --workspace apps/web`. Imports the TypeScript source directly - Node strips
// the type annotations.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { endpointUrl } from '../src/lib/endpoint.ts';
import nextConfig from '../next.config.ts';

const API = 'https://api.example.test';

describe('endpointUrl', () => {
  it('goes straight to the API when sign-in is not routed through the web app', () => {
    const config = { apiUrl: API, authViaWeb: false };
    assert.equal(endpointUrl('/auth/login', config), `${API}/auth/login`);
    assert.equal(endpointUrl('/trips', config), `${API}/trips`);
  });

  it('keeps the /auth routes on the web app\'s own address when it is', () => {
    const config = { apiUrl: API, authViaWeb: true };
    for (const path of ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/verify-email']) {
      assert.equal(endpointUrl(path, config), path, path);
    }
  });

  it('still sends everything else to the API', () => {
    const config = { apiUrl: API, authViaWeb: true };
    assert.equal(endpointUrl('/trips', config), `${API}/trips`);
    assert.equal(endpointUrl('/users/me', config), `${API}/users/me`);
    assert.equal(endpointUrl('/health', config), `${API}/health`);
  });

  it('does not mistake a path that merely starts with the letters for an /auth route', () => {
    const config = { apiUrl: API, authViaWeb: true };
    assert.equal(endpointUrl('/authors', config), `${API}/authors`);
    assert.equal(endpointUrl('/authentic/x', config), `${API}/authentic/x`);
  });

  it('treats a query string on an /auth route as part of it', () => {
    assert.equal(endpointUrl('/auth/verify-email?x=1', { apiUrl: API, authViaWeb: true }), '/auth/verify-email?x=1');
  });

  it('only relays routes under /auth - the API has none at /auth itself', () => {
    const config = { apiUrl: API, authViaWeb: true };
    assert.equal(endpointUrl('/auth', config), `${API}/auth`);
    assert.equal(endpointUrl('/auth?x=1', config), `${API}/auth?x=1`);
  });
});

const original = { via: process.env.NEXT_PUBLIC_AUTH_VIA_WEB, api: process.env.NEXT_PUBLIC_API_URL };
afterEach(() => {
  for (const [name, value] of [['NEXT_PUBLIC_AUTH_VIA_WEB', original.via], ['NEXT_PUBLIC_API_URL', original.api]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('the /auth rewrite', () => {
  it('is not there unless sign-in via the web app is switched on', async () => {
    delete process.env.NEXT_PUBLIC_AUTH_VIA_WEB;
    process.env.NEXT_PUBLIC_API_URL = API;
    assert.deepEqual(await nextConfig.rewrites(), []);
    process.env.NEXT_PUBLIC_AUTH_VIA_WEB = 'false';
    assert.deepEqual(await nextConfig.rewrites(), []);
  });

  it('passes /auth/... on to the same path on the API', async () => {
    process.env.NEXT_PUBLIC_AUTH_VIA_WEB = 'true';
    process.env.NEXT_PUBLIC_API_URL = API;
    assert.deepEqual(await nextConfig.rewrites(), [{ source: '/auth/:path*', destination: `${API}/auth/:path*` }]);
  });

  it('uses only the API\'s origin, however the address was written', async () => {
    process.env.NEXT_PUBLIC_AUTH_VIA_WEB = 'true';
    process.env.NEXT_PUBLIC_API_URL = `${API}/`;
    assert.equal((await nextConfig.rewrites())[0].destination, `${API}/auth/:path*`);
  });

  it('fails the build rather than forward sign-in nowhere', async () => {
    process.env.NEXT_PUBLIC_AUTH_VIA_WEB = 'true';
    delete process.env.NEXT_PUBLIC_API_URL;
    await assert.rejects(() => nextConfig.rewrites(), /NEXT_PUBLIC_API_URL/);
    process.env.NEXT_PUBLIC_API_URL = 'not a url';
    await assert.rejects(() => nextConfig.rewrites(), /NEXT_PUBLIC_API_URL/);
  });
});
