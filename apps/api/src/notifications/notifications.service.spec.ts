import { NotificationsService } from './notifications.service.js';

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

const { default: webpush } = await import('web-push');
const sendNotification = vi.mocked(webpush.sendNotification);

const payload = { title: 'Hi', body: 'There', url: '/trips/t1' };
const sub = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: 'k', auth: 'a' });

function harness(subs = [sub('s1'), sub('s2')]) {
  const findMany = vi.fn().mockResolvedValue(subs);
  const del = vi.fn().mockResolvedValue(undefined);
  const prisma = { pushSubscription: { findMany, delete: del } };
  const service = new NotificationsService(prisma as never, {} as never);
  return { service, findMany, del };
}

describe('NotificationsService.notifyUser', () => {
  beforeEach(() => {
    // Braces matter: a function returned from beforeEach is run as a teardown hook.
    sendNotification.mockReset().mockResolvedValue({} as never);
  });

  it('only looks up subscriptions belonging to an account in good standing - a suspended person gets nothing', async () => {
    const { service, findMany } = harness();
    await service.notifyUser('user-1', payload);
    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'user-1', user: { accountStatus: 'ACTIVE' } } });
  });

  it('sends nothing when there are no subscriptions to send to', async () => {
    const { service } = harness([]);
    await service.notifyUser('user-1', payload);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends to every subscription it was given, with the payload as JSON', async () => {
    const { service } = harness();
    await service.notifyUser('user-1', payload);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification.mock.calls[0][1]).toBe(JSON.stringify(payload));
  });

  it('drops a subscription the push service says is gone', async () => {
    const { service, del } = harness([sub('gone')]);
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    await service.notifyUser('user-1', payload);
    expect(del).toHaveBeenCalledWith({ where: { id: 'gone' } });
  });

  it('keeps a subscription after a failure that is not "gone", and never throws', async () => {
    const { service, del } = harness([sub('flaky')]);
    sendNotification.mockRejectedValue(Object.assign(new Error('timeout'), { statusCode: 500 }));
    await expect(service.notifyUser('user-1', payload)).resolves.toBeUndefined();
    expect(del).not.toHaveBeenCalled();
  });

  it('notifyUsers goes through the same filter for every person', async () => {
    const { service, findMany } = harness();
    await service.notifyUsers(['a', 'b'], payload);
    expect(findMany.mock.calls.map((c) => c[0].where)).toEqual([
      { userId: 'a', user: { accountStatus: 'ACTIVE' } },
      { userId: 'b', user: { accountStatus: 'ACTIVE' } },
    ]);
  });
});
