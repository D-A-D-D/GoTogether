// The judgements the deployed-environment smoke check makes, as pure functions of
// what a server sent back - so they can be tested without a server
// (scripts/smoke-checks.test.mjs). Each returns a list of problems; empty means fine.
// The script that fetches things and runs these is scripts/smoke.mjs.

const has = (headers, name) => headers.get(name) !== null;

/** Hardening headers every API response should carry. */
export function checkApiHeaders(headers) {
  const problems = [];
  if ((headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') problems.push('X-Content-Type-Options: nosniff is missing');
  if (!has(headers, 'strict-transport-security')) problems.push('Strict-Transport-Security (HSTS) is missing');
  if (has(headers, 'x-powered-by')) problems.push('X-Powered-By is exposed');
  if (!has(headers, 'x-request-id')) problems.push('X-Request-Id is missing (request logging is not active)');
  return problems;
}

/** Hardening headers every web page should carry. */
export function checkWebHeaders(headers) {
  const problems = [];
  if ((headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') problems.push('X-Content-Type-Options: nosniff is missing');
  if ((headers.get('x-frame-options') ?? '').toUpperCase() !== 'DENY') problems.push('X-Frame-Options: DENY is missing');
  if (!/frame-ancestors\s+'none'/.test(headers.get('content-security-policy') ?? '')) problems.push("Content-Security-Policy frame-ancestors 'none' is missing");
  if (!has(headers, 'referrer-policy')) problems.push('Referrer-Policy is missing');
  if (!has(headers, 'strict-transport-security')) problems.push('Strict-Transport-Security (HSTS) is missing - is the site served over https?');
  if (has(headers, 'x-powered-by')) problems.push('X-Powered-By is exposed');
  return problems;
}

/**
 * CORS: the web origin must be allowed (with credentials, since the session is a cookie),
 * and a stranger's origin must not be echoed back.
 */
export function checkCors({ webOrigin, allowedForWeb, credentialsForWeb, allowedForStranger, stranger }) {
  const problems = [];
  if (allowedForWeb !== webOrigin) problems.push(`the API does not allow the web origin ${webOrigin} (it sent "${allowedForWeb ?? 'nothing'}") - is WEB_ORIGIN set to exactly that?`);
  if ((credentialsForWeb ?? '').toLowerCase() !== 'true') problems.push('Access-Control-Allow-Credentials is not true, so the session cookie would not be sent');
  if (allowedForStranger === stranger || allowedForStranger === '*') problems.push(`the API allows an unrelated origin (${stranger})`);
  return problems;
}

/** Parses one Set-Cookie header into its name, value and attributes. */
export function parseSetCookie(header) {
  const [pair, ...attributes] = header.split(';').map((part) => part.trim());
  const eq = pair.indexOf('=');
  const attrs = {};
  for (const attribute of attributes) {
    const i = attribute.indexOf('=');
    attrs[(i === -1 ? attribute : attribute.slice(0, i)).toLowerCase()] = i === -1 ? true : attribute.slice(i + 1);
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs };
}

/** The session cookie must be unreadable by scripts, https-only, and scoped to the auth routes. */
export function checkSessionCookie(setCookieHeaders) {
  const header = setCookieHeaders.find((h) => h.startsWith('gt_refresh='));
  if (!header) return ['no gt_refresh session cookie was set'];
  const { attrs } = parseSetCookie(header);
  const problems = [];
  if (!attrs.httponly) problems.push('the session cookie is not HttpOnly');
  if (!attrs.secure) problems.push('the session cookie is not Secure (is NODE_ENV=production?)');
  if (String(attrs.samesite ?? '').toLowerCase() !== 'lax') problems.push('the session cookie is not SameSite=Lax');
  if (attrs.path !== '/auth') problems.push('the session cookie is not scoped to /auth');
  return problems;
}

/**
 * The web build bakes in the API's address (NEXT_PUBLIC_API_URL). Given the text of the
 * page's scripts, check it points at the real API - the classic mistake is a build made
 * without it, which quietly talks to localhost.
 */
export function checkWebPointsAtApi(scriptTexts, apiOrigin) {
  const all = scriptTexts.join('\n');
  const problems = [];
  const apiIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(apiOrigin);
  if (!all.includes(apiOrigin)) problems.push(`the web app's scripts do not mention the API address ${apiOrigin} - was it built with NEXT_PUBLIC_API_URL set?`);
  if (!apiIsLocal && all.includes('localhost:3001')) problems.push('the web app still contains the development API address localhost:3001');
  return problems;
}

/**
 * With sign-in via the web app (NEXT_PUBLIC_AUTH_VIA_WEB), a wrong-password sign-in sent to the
 * web app's own address must come back from the API: a 401 with a JSON body. The usual ways it
 * goes wrong are the web build having been made without the setting (the web app answers 404 with
 * a page), or with a wrong API address (a gateway error).
 */
export function checkAuthReachesApi({ status, contentType }) {
  if (status === 401 && /json/i.test(contentType ?? '')) return [];
  if (status === 404) return ['the web app has no /auth route - was it built with NEXT_PUBLIC_AUTH_VIA_WEB=true?'];
  if (status >= 500) return [`the web app could not reach the API for /auth (it answered ${status}) - is NEXT_PUBLIC_API_URL right in the web build?`];
  return [`a wrong-password sign-in through the web app should come back 401 from the API, got ${status}${contentType ? ` (${contentType})` : ''}`];
}

/** The script URLs on a page, resolved against the page's address. */
export function scriptUrls(html, pageUrl) {
  const urls = [];
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) urls.push(new URL(match[1], pageUrl).toString());
  return urls;
}
