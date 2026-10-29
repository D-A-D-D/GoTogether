// Checks a deployed GoTogether against the first-deploy checklist (docs/DEPLOYMENT.md,
// section 9), so it doesn't have to be done by hand with curl. No dependencies.
//
//   node scripts/smoke.mjs --api https://api.example.com --web https://app.example.com
//   node scripts/smoke.mjs --api https://api.example.com --web https://app.example.com --write --email you+smoke@example.com
//
//   --api         the API's address (required)
//   --web         the web app's address: also checks its headers, its pages, and that it was built pointing at the API
//   --web-origin  just the web app's origin, for the CORS check, when the web app itself isn't being checked
//   --write       also signs up a throwaway account, exercises sign-in, the session cookie, refresh and a password
//                 reset request, then deletes the account. Needs --email: the verification email goes there, so
//                 use a mailbox you control (an address like you+smoke@your-domain works). Leaves one anonymous
//                 "Deleted user" row behind.
//
// Read-only without --write. Exits non-zero if anything is wrong.
//
// It can't prove the one thing that most often goes wrong - that the browser keeps the session across a
// reload on your real domains - because that depends on the browser's same-site rules. Do that by hand
// (docs/DEPLOYMENT.md, section 9).

import { randomBytes } from 'node:crypto';
import {
  checkApiHeaders,
  checkCors,
  checkSessionCookie,
  checkWebHeaders,
  checkWebPointsAtApi,
  scriptUrls,
} from './smoke-checks.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);
const origin = (url) => new URL(url).origin;

const apiArg = arg('api');
if (!apiArg) {
  console.error('Usage: node scripts/smoke.mjs --api <url> [--web <url>] [--write --email <mailbox>]');
  process.exit(2);
}
const API = origin(apiArg);
const WEB = arg('web') ? origin(arg('web')) : undefined;
const WEB_ORIGIN = arg('web-origin') ? origin(arg('web-origin')) : WEB;
const WRITE = flag('write');
const EMAIL = arg('email');
if (WRITE && !EMAIL) {
  console.error('--write needs --email <a mailbox you control>');
  process.exit(2);
}

let failures = 0;
async function step(name, fn) {
  try {
    const problems = (await fn()) ?? [];
    if (problems.length === 0) {
      console.log(`ok    ${name}`);
    } else {
      failures += problems.length;
      console.log(`FAIL  ${name}`);
      for (const problem of problems) console.log(`        - ${problem}`);
    }
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}`);
    console.log(`        - ${error instanceof Error ? error.message : error}`);
  }
}

const expectStatus = (res, wanted, what) => (res.status === wanted ? [] : [`${what}: expected ${wanted}, got ${res.status}`]);
const json = (method, path, body, extra = {}) =>
  fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });

console.log(`API: ${API}${WEB ? `   web: ${WEB}` : ''}${WRITE ? '   (will create and delete a test account)' : ''}\n`);

// ---------------------------------------------------------------- the API
await step('API: /health answers', async () => {
  const res = await json('GET', '/health');
  const problems = expectStatus(res, 200, '/health');
  if (res.ok && (await res.json()).status !== 'ok') problems.push('/health did not say status ok');
  return problems;
});

await step('API: /health/ready - it can reach the database', async () => {
  const res = await json('GET', '/health/ready');
  return res.status === 200 ? [] : [`/health/ready returned ${res.status}${res.status === 503 ? ' - the database cannot be reached (check DATABASE_URL, and whether it has suspended)' : ''}`];
});

await step('API: security headers, request id, no X-Powered-By', async () => checkApiHeaders((await json('GET', '/health')).headers));

if (WEB_ORIGIN) {
  await step('API: CORS allows the web origin (with credentials), and nobody else', async () => {
    const preflight = (from) =>
      json('OPTIONS', '/auth/login', undefined, { origin: from, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' });
    const stranger = 'https://not-the-web-app.example';
    const ok = await preflight(WEB_ORIGIN);
    const other = await preflight(stranger);
    return checkCors({
      webOrigin: WEB_ORIGIN,
      allowedForWeb: ok.headers.get('access-control-allow-origin') ?? undefined,
      credentialsForWeb: ok.headers.get('access-control-allow-credentials') ?? undefined,
      allowedForStranger: other.headers.get('access-control-allow-origin') ?? undefined,
      stranger,
    });
  });
}

await step('API: a protected route refuses a caller with no session', async () => expectStatus(await json('GET', '/users/me'), 401, 'GET /users/me'));

// ------------------------------------------------------------- the web app
if (WEB) {
  await step('Web: the home page and sign-in page load', async () => {
    const problems = [];
    for (const path of ['/', '/login', '/forgot-password']) {
      const res = await fetch(WEB + path, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      problems.push(...expectStatus(res, 200, `GET ${path}`));
    }
    return problems;
  });

  await step('Web: security headers on a page', async () => {
    const res = await fetch(WEB + '/login', { signal: AbortSignal.timeout(30_000) });
    return checkWebHeaders(res.headers);
  });

  await step('Web: installable app files are served (manifest, service worker)', async () => {
    const problems = [];
    const manifest = await fetch(WEB + '/manifest.webmanifest', { signal: AbortSignal.timeout(30_000) });
    problems.push(...expectStatus(manifest, 200, '/manifest.webmanifest'));
    const worker = await fetch(WEB + '/sw.js', { signal: AbortSignal.timeout(30_000) });
    problems.push(...expectStatus(worker, 200, '/sw.js'));
    if (worker.ok && !/javascript/.test(worker.headers.get('content-type') ?? '')) problems.push('/sw.js is not served as JavaScript');
    return problems;
  });

  await step('Web: it was built pointing at this API (NEXT_PUBLIC_API_URL)', async () => {
    const page = await fetch(WEB + '/login', { signal: AbortSignal.timeout(30_000) });
    const urls = scriptUrls(await page.text(), WEB + '/login').filter((u) => u.startsWith(WEB));
    if (urls.length === 0) return ['found no scripts on the sign-in page'];
    const texts = await Promise.all(urls.slice(0, 40).map((u) => fetch(u, { signal: AbortSignal.timeout(30_000) }).then((r) => r.text())));
    return checkWebPointsAtApi(texts, API);
  });
}

// ------------------------------------------------- an account's whole lifecycle
if (WRITE) {
  const password = randomBytes(18).toString('base64url');
  let accessToken;
  let refreshCookie;
  let registered = false;

  await step('Account: sign up', async () => {
    const res = await json('POST', '/auth/register', { email: EMAIL, password, name: 'Smoke Test' });
    if (res.status === 201) registered = true;
    return expectStatus(res, 201, 'POST /auth/register');
  });

  if (registered) {
    await step('Account: sign in, with a session cookie that is HttpOnly, Secure, SameSite=Lax', async () => {
      const res = await json('POST', '/auth/login', { email: EMAIL, password });
      const problems = expectStatus(res, 200, 'POST /auth/login');
      if (!res.ok) return problems;
      accessToken = (await res.json()).accessToken;
      const cookies = res.headers.getSetCookie();
      problems.push(...checkSessionCookie(cookies));
      const session = cookies.find((c) => c.startsWith('gt_refresh='));
      if (session) refreshCookie = session.split(';')[0];
      if (!accessToken) problems.push('no access token was returned');
      return problems;
    });

    await step('Account: a wrong password is refused', async () => {
      const res = await json('POST', '/auth/login', { email: EMAIL, password: `${password}-not` });
      return expectStatus(res, 401, 'POST /auth/login with a wrong password');
    });

    await step('Account: the profile is readable, and never includes the password hash', async () => {
      const res = await json('GET', '/users/me', undefined, { authorization: `Bearer ${accessToken}` });
      const problems = expectStatus(res, 200, 'GET /users/me');
      if (!res.ok) return problems;
      const me = await res.json();
      if (me.email !== EMAIL) problems.push('the profile is for a different email');
      if (me.hasPassword !== true) problems.push('hasPassword is not true');
      if ('passwordHash' in me) problems.push('the response includes passwordHash');
      return problems;
    });

    await step('Account: the session can be renewed from its cookie', async () => {
      if (!refreshCookie) return ['no cookie to renew with'];
      const res = await json('POST', '/auth/refresh', undefined, { cookie: refreshCookie });
      return expectStatus(res, 200, 'POST /auth/refresh');
    });

    await step('Account: asking for a password reset gives the neutral answer', async () => {
      const res = await json('POST', '/auth/forgot-password', { email: EMAIL });
      const problems = expectStatus(res, 200, 'POST /auth/forgot-password');
      if (res.ok && (await res.json()).ok !== true) problems.push('the reply was not { ok: true }');
      return problems;
    });

    await step('Account: delete it again (leaves one anonymous "Deleted user" row)', async () => {
      const res = await json('DELETE', '/users/me', { password }, { authorization: `Bearer ${accessToken}` });
      const problems = expectStatus(res, 200, 'DELETE /users/me');
      if (res.ok) {
        const after = await json('POST', '/auth/login', { email: EMAIL, password });
        if (after.status !== 401) problems.push(`signing in to the deleted account returned ${after.status}, expected 401`);
      }
      return problems;
    });
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} problem${failures === 1 ? '' : 's'} found.`);
console.log('Still to do by hand: the browser keeps you signed in across a reload on the real domain, email arrives (not in spam), chat works live, push reaches a phone (docs/DEPLOYMENT.md section 9).');
process.exit(failures === 0 ? 0 : 1);
