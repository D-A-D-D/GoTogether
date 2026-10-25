import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  const controller = (queryRaw: () => Promise<unknown>) => new AppController({ $queryRaw: queryRaw } as never);

  describe('health (liveness)', () => {
    it('reports ok status', () => {
      expect(controller(vi.fn()).health().status).toBe('ok');
    });

    it('never touches the database, so an outage cannot get the process restarted', () => {
      const queryRaw = vi.fn();
      controller(queryRaw).health();
      expect(queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('health/ready (readiness)', () => {
    it('is ok when the database answers', async () => {
      const queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
      await expect(controller(queryRaw).ready()).resolves.toMatchObject({ status: 'ok' });
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('is a 503 when the database cannot be reached, so a load balancer stops sending traffic', async () => {
      const queryRaw = vi.fn().mockRejectedValue(new Error("Can't reach database server"));
      await expect(controller(queryRaw).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('does not leak why it is unavailable', async () => {
      const queryRaw = vi.fn().mockRejectedValue(new Error('password authentication failed for user "secret_user"'));
      const error = await controller(queryRaw).ready().catch((e: ServiceUnavailableException) => e);
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toMatch(/secret_user|password/);
    });
  });
});
