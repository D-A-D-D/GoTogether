import { ThrottlerGuard } from '@nestjs/throttler';
import { HttpThrottlerGuard } from './http-throttler.guard.js';

const context = (type: string) => ({ getType: () => type }) as never;

describe('HttpThrottlerGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  // Constructed without the throttler's dependencies: only the type check is under test.
  const guard = () => Object.create(HttpThrottlerGuard.prototype) as HttpThrottlerGuard;

  it.each(['ws', 'rpc'])('lets a %s context straight through — socket events have their own limit', async (type) => {
    const parent = vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(false);
    await expect(guard().canActivate(context(type))).resolves.toBe(true);
    expect(parent).not.toHaveBeenCalled();
  });

  it('defers to the throttler for HTTP, and returns what it decides', async () => {
    const parent = vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(false);
    await expect(guard().canActivate(context('http'))).resolves.toBe(false);
    expect(parent).toHaveBeenCalledTimes(1);
  });

  it('propagates a throttling error for HTTP', async () => {
    vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockRejectedValue(new Error('ThrottlerException: Too Many Requests'));
    await expect(guard().canActivate(context('http'))).rejects.toThrow('Too Many Requests');
  });
});
