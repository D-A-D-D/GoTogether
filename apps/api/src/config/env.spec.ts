import { productionEnvProblems, trustProxyHops, validateEnv } from './env.js';

const GOOD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pw@host/db',
  JWT_ACCESS_SECRET: 'q7Hk2mXz9PvL4nRtB8cYw3JdA6eGfS1u',
  JWT_REFRESH_SECRET: 'W5bN0xKq8TzV2mHc7RjY4pLd9AaEs3Fg',
  WEB_ORIGIN: 'https://app.gotogether.example',
  TRUST_PROXY: '1',
  VAPID_PUBLIC_KEY: 'BPublicKeyValue',
  VAPID_PRIVATE_KEY: 'PrivateKeyValue',
  VAPID_SUBJECT: 'mailto:team@gotogether.example',
};

const without = (name: string) => {
  const { [name]: _removed, ...rest } = GOOD as Record<string, string>;
  return rest;
};

describe('productionEnvProblems', () => {
  it('accepts a sound production environment', () => {
    expect(productionEnvProblems(GOOD)).toEqual([]);
  });

  it.each(['development', 'test', undefined])('checks nothing outside production (NODE_ENV=%s)', (nodeEnv) => {
    expect(productionEnvProblems({ NODE_ENV: nodeEnv })).toEqual([]);
  });

  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'WEB_ORIGIN', 'TRUST_PROXY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'])(
    'reports a missing %s',
    (name) => {
      expect(productionEnvProblems(without(name)).join(' ')).toContain(`${name} is not set`);
    },
  );

  it('treats a blank value like a missing one', () => {
    expect(productionEnvProblems({ ...GOOD, JWT_ACCESS_SECRET: '   ' }).join(' ')).toContain('JWT_ACCESS_SECRET is not set');
  });
});

describe('productionEnvProblems — secrets', () => {
  it('rejects a short secret', () => {
    expect(productionEnvProblems({ ...GOOD, JWT_ACCESS_SECRET: 'short' }).join(' ')).toMatch(/JWT_ACCESS_SECRET is shorter than 32/);
  });

  it('rejects a long but repetitive secret', () => {
    expect(productionEnvProblems({ ...GOOD, JWT_REFRESH_SECRET: 'a'.repeat(40) }).join(' ')).toMatch(/JWT_REFRESH_SECRET has too little variety/);
  });

  it.each(['please-change-me-please-change-me-1234', 'your-secret-goes-here-your-secret-xyz', 'replace_me_with_a_real_secret_value_9'])(
    'rejects a placeholder: %s',
    (secret) => {
      expect(productionEnvProblems({ ...GOOD, JWT_ACCESS_SECRET: secret }).join(' ')).toMatch(/JWT_ACCESS_SECRET looks like a placeholder/);
    },
  );

  it('rejects using one secret for both tokens', () => {
    expect(productionEnvProblems({ ...GOOD, JWT_REFRESH_SECRET: GOOD.JWT_ACCESS_SECRET }).join(' ')).toMatch(/must be different/);
  });

  it('never puts a secret in the message', () => {
    const messages = productionEnvProblems({ ...GOOD, JWT_ACCESS_SECRET: 'tooShortSecret!' }).join(' ');
    expect(messages).not.toContain('tooShortSecret');
  });
});

describe('productionEnvProblems — origin and proxy', () => {
  it.each(['http://app.gotogether.example', 'https://localhost:3000', 'https://127.0.0.1', 'not a url'])(
    'rejects WEB_ORIGIN %s',
    (origin) => {
      expect(productionEnvProblems({ ...GOOD, WEB_ORIGIN: origin }).join(' ')).toMatch(/WEB_ORIGIN/);
    },
  );

  it('accepts an https origin on a subdomain', () => {
    expect(productionEnvProblems({ ...GOOD, WEB_ORIGIN: 'https://app.example.org' })).toEqual([]);
  });

  it.each(['1', '2', '0'])('accepts TRUST_PROXY=%s, including 0 for "no proxy"', (hops) => {
    expect(productionEnvProblems({ ...GOOD, TRUST_PROXY: hops })).toEqual([]);
  });

  it.each(['yes', '-1', '1.5', 'true'])('rejects TRUST_PROXY=%s — a wrong value either merges everyone or lets callers forge an address', (hops) => {
    expect(productionEnvProblems({ ...GOOD, TRUST_PROXY: hops }).join(' ')).toMatch(/TRUST_PROXY must be a whole number/);
  });

  it.each(['team@gotogether.example', 'http://insecure.example'])('rejects VAPID_SUBJECT %s', (subject) => {
    expect(productionEnvProblems({ ...GOOD, VAPID_SUBJECT: subject }).join(' ')).toMatch(/VAPID_SUBJECT/);
  });

  it('reports every problem at once, not just the first', () => {
    const problems = productionEnvProblems({ NODE_ENV: 'production' });
    expect(problems.length).toBeGreaterThanOrEqual(7);
  });
});

describe('validateEnv', () => {
  it('returns a good environment unchanged', () => {
    expect(validateEnv(GOOD)).toBe(GOOD);
  });

  it('throws, listing the problems, so a bad production deploy fails at boot', () => {
    const bad = { ...GOOD, TRUST_PROXY: undefined, WEB_ORIGIN: 'http://x' };
    expect(() => validateEnv(bad)).toThrow(/not safe to start/);
    expect(() => validateEnv(bad)).toThrow(/TRUST_PROXY is not set/);
    expect(() => validateEnv(bad)).toThrow(/WEB_ORIGIN must be an https/);
  });

  it('lets development and tests start with an empty environment', () => {
    expect(() => validateEnv({})).not.toThrow();
  });
});

describe('trustProxyHops', () => {
  it.each([['1', 1], ['2', 2], ['0', 0], [undefined, 0], ['', 0], ['abc', 0], ['-1', 0], ['1.5', 0]])('%j -> %j', (value, expected) => {
    expect(trustProxyHops({ TRUST_PROXY: value })).toBe(expected);
  });
});
