// Refuses to start in production with a configuration that would be unsafe or
// quietly broken. A wrong value discovered at boot is a failed deploy; the same
// mistake discovered later is a security hole or a login page that silently
// stops working. Nothing here is checked outside production, so local
// development, CI and tests are unaffected. Values are never printed.

type Env = Record<string, unknown>;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function weakSecret(secret: string): string | null {
  if (secret.length < 32) return 'is shorter than 32 characters';
  if (new Set(secret).size < 12) return 'has too little variety to be random';
  if (/change.?me|replace.?me|your.?secret|example|placeholder/i.test(secret)) return 'looks like a placeholder';
  return null;
}

/** Every problem with a production environment, as readable sentences. Empty when it is fine. */
export function productionEnvProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  for (const name of ['DATABASE_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) {
    if (!text(env[name])) problems.push(`${name} is not set`);
  }

  const access = text(env.JWT_ACCESS_SECRET);
  const refresh = text(env.JWT_REFRESH_SECRET);
  for (const [name, value] of [['JWT_ACCESS_SECRET', access], ['JWT_REFRESH_SECRET', refresh]] as const) {
    if (!value) problems.push(`${name} is not set`);
    else {
      const weak = weakSecret(value);
      if (weak) problems.push(`${name} ${weak}`);
    }
  }
  if (access && access === refresh) problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');

  // The origin allowed to call the API with credentials, and where Google sign-in redirects back to.
  const origin = text(env.WEB_ORIGIN);
  if (!origin) problems.push('WEB_ORIGIN is not set');
  else {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:') problems.push('WEB_ORIGIN must be an https:// address');
      if (/^(localhost|127\.|\[?::1)/i.test(url.hostname)) problems.push('WEB_ORIGIN must not point at localhost');
    } catch {
      problems.push('WEB_ORIGIN is not a valid URL');
    }
  }

  // Without this every visitor appears to come from the proxy's address, so one
  // person's rate limit would be shared by everyone. Too high a number lets a
  // caller forge their own address, so it must be chosen deliberately.
  const hops = text(env.TRUST_PROXY);
  if (!hops) problems.push('TRUST_PROXY is not set (the number of reverse proxies in front of the API, e.g. 1; 0 if none)');
  else if (!/^\d+$/.test(hops)) problems.push('TRUST_PROXY must be a whole number');

  // Password reset and email verification are emails. The development "log" provider prints
  // working links to the server log, so it must never be what production runs.
  if (text(env.EMAIL_PROVIDER) !== 'resend') problems.push('EMAIL_PROVIDER must be "resend" (the "log" provider prints reset links into the logs)');
  for (const name of ['RESEND_API_KEY', 'EMAIL_FROM']) {
    if (!text(env[name])) problems.push(`${name} is not set`);
  }

  const subject = text(env.VAPID_SUBJECT);
  if (!/^(mailto:|https:\/\/)/.test(subject)) problems.push('VAPID_SUBJECT must be a mailto: or https:// address');

  return problems;
}

/** For ConfigModule: throws, listing everything wrong, so a bad production deploy fails at boot. */
export function validateEnv(env: Env): Env {
  const problems = productionEnvProblems(env);
  if (problems.length > 0) {
    throw new Error(`The production environment is not safe to start with:\n - ${problems.join('\n - ')}`);
  }
  return env;
}

/** How many reverse proxies to trust for the client address; 0 (trust none) when unset or invalid. */
export function trustProxyHops(env: Env): number {
  const hops = text(env.TRUST_PROXY);
  return /^\d+$/.test(hops) ? Number(hops) : 0;
}
