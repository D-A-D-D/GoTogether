import { ACCOUNT_STATE_TTL_MS, AccountStateService } from './account-state.service.js';

function harness(rows: Record<string, { accountStatus: string; role: string } | null> = {}) {
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null);
  const service = new AccountStateService({ user: { findUnique } } as never);
  return { service, findUnique };
}

const T0 = 1_000_000;

describe('AccountStateService', () => {
  it('reads the database once, then serves repeat lookups from memory', async () => {
    const { service, findUnique } = harness({ u1: { accountStatus: 'ACTIVE', role: 'USER' } });
    expect(await service.get('u1', T0)).toEqual({ accountStatus: 'ACTIVE', role: 'USER' });
    await service.get('u1', T0 + 1000);
    await service.get('u1', T0 + ACCOUNT_STATE_TTL_MS - 1);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('only selects what it needs — status, role and the read-receipts choice', async () => {
    const { service, findUnique } = harness({ u1: { accountStatus: 'ACTIVE', role: 'USER' } });
    await service.get('u1', T0);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { accountStatus: true, role: true, readReceipts: true },
    });
  });

  it('re-reads once the entry is older than the TTL, so a change is picked up', async () => {
    const rows: Record<string, { accountStatus: string; role: string }> = { u1: { accountStatus: 'ACTIVE', role: 'USER' } };
    const { service, findUnique } = harness(rows);
    await service.get('u1', T0);
    rows.u1 = { accountStatus: 'SUSPENDED', role: 'USER' };
    expect((await service.get('u1', T0 + ACCOUNT_STATE_TTL_MS)).accountStatus).toBe('SUSPENDED');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('invalidate() makes the very next lookup read the database, whatever the age', async () => {
    const rows: Record<string, { accountStatus: string; role: string }> = { u1: { accountStatus: 'ACTIVE', role: 'USER' } };
    const { service, findUnique } = harness(rows);
    await service.get('u1', T0);
    rows.u1 = { accountStatus: 'BANNED', role: 'USER' };
    service.invalidate('u1');
    expect((await service.get('u1', T0 + 1)).accountStatus).toBe('BANNED');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('invalidating one user leaves the others cached', async () => {
    const { service, findUnique } = harness({
      a: { accountStatus: 'ACTIVE', role: 'USER' },
      b: { accountStatus: 'ACTIVE', role: 'USER' },
    });
    await service.get('a', T0);
    await service.get('b', T0);
    service.invalidate('a');
    await service.get('b', T0 + 1);
    expect(findUnique).toHaveBeenCalledTimes(2); // a once, b once — b wasn't re-read
  });

  it('returns null for an account that no longer exists, and remembers that too', async () => {
    const { service, findUnique } = harness({});
    expect(await service.get('ghost', T0)).toBeNull();
    expect(await service.get('ghost', T0 + 1)).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not grow without bound: expired entries are dropped when it fills up', async () => {
    const { service } = harness();
    for (let i = 0; i < 5000; i++) await service.get(`user-${i}`, T0);
    await service.get('one-more', T0 + ACCOUNT_STATE_TTL_MS + 1); // all earlier entries have expired by now
    expect((service as unknown as { cache: Map<string, unknown> }).cache.size).toBe(1);
  });

  it('and if nothing has expired, it starts over rather than growing past the cap', async () => {
    const { service } = harness();
    for (let i = 0; i < 5000; i++) await service.get(`user-${i}`, T0);
    await service.get('one-more', T0 + 1);
    expect((service as unknown as { cache: Map<string, unknown> }).cache.size).toBe(1);
  });
});
