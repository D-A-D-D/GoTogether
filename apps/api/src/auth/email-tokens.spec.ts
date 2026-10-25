import { EMAILS_PER_HOUR, RESET_TTL_MS, VERIFICATION_TTL_MS, generateEmailToken, hashEmailToken } from './email-tokens.js';

describe('generateEmailToken', () => {
  it('gives a URL-safe token with enough randomness to be unguessable (32 bytes)', () => {
    const { raw } = generateEmailToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes as unpadded base64url
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateEmailToken().raw));
    expect(seen.size).toBe(500);
  });

  it('keeps only a hash: it matches the raw token, and is not the raw token', () => {
    const { raw, hash } = generateEmailToken();
    expect(hash).toBe(hashEmailToken(raw));
    expect(hash).not.toBe(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(raw);
  });

  it('hashes the same token the same way every time, and different tokens differently', () => {
    expect(hashEmailToken('abc')).toBe(hashEmailToken('abc'));
    expect(hashEmailToken('abc')).not.toBe(hashEmailToken('abd'));
  });
});

describe('the lifetimes and limits, pinned', () => {
  // Literals on purpose: product and security decisions, not numbers to move together with their tests.
  it('a reset link lasts one hour', () => expect(RESET_TTL_MS).toBe(60 * 60 * 1000));
  it('a verification link lasts a day', () => expect(VERIFICATION_TTL_MS).toBe(24 * 60 * 60 * 1000));
  it('at most three of each email per address per hour', () => expect(EMAILS_PER_HOUR).toBe(3));
});
