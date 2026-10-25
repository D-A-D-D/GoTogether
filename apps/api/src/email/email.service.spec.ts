import { EmailService } from './email.service.js';

const message = { to: 'una@example.com', subject: 'Hello', text: 'plain body', html: '<p>html body</p>' };

function service(config: Record<string, string | undefined>) {
  const get = vi.fn((key: string, fallback?: string) => config[key] ?? fallback);
  const getOrThrow = vi.fn((key: string) => {
    const value = config[key];
    if (value === undefined) throw new Error(`Configuration key "${key}" does not exist`);
    return value;
  });
  return new EmailService({ get, getOrThrow } as never);
}

afterEach(() => vi.unstubAllGlobals());

describe('EmailService — the development log provider', () => {
  it('is the default when nothing is configured, and sends nothing over the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await service({}).send(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is used for any provider name that is not "resend"', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await service({ EMAIL_PROVIDER: 'log' }).send(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('EmailService — Resend', () => {
  const config = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_secret_key', EMAIL_FROM: 'GoTogether <no-reply@gotogether.example>' };

  it('posts to the Resend API with the key as a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await service(config).send(message);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_secret_key');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends the sender, the recipient, and both the text and HTML bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await service(config).send(message);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      from: 'GoTogether <no-reply@gotogether.example>',
      to: ['una@example.com'],
      subject: 'Hello',
      text: 'plain body',
      html: '<p>html body</p>',
    });
  });

  it('gives up on a slow provider rather than holding things open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await service(config).send(message);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('throws when Resend refuses, with the status and a short reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '{"message":"domain not verified"}' }));
    await expect(service(config).send(message)).rejects.toThrow('Resend rejected the email (403): {"message":"domain not verified"}');
  });

  it('keeps an enormous error body from filling the log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'x'.repeat(5000) }));
    const error = await service(config).send(message).catch((e: Error) => e);
    expect((error as Error).message.length).toBeLessThan(300);
  });

  it('never puts the API key in an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorised' }));
    const error = await service(config).send(message).catch((e: Error) => e);
    expect((error as Error).message).not.toContain('re_secret_key');
  });

  it('refuses to send without a key or a sender, rather than sending something broken', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(service({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'x@y.example' }).send(message)).rejects.toThrow(/RESEND_API_KEY/);
    await expect(service({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }).send(message)).rejects.toThrow(/EMAIL_FROM/);
  });
});

describe('EmailService.webOrigin', () => {
  it('is the configured web address, which links in emails are built from', () => {
    expect(service({ WEB_ORIGIN: 'https://app.gotogether.example' }).webOrigin).toBe('https://app.gotogether.example');
  });

  it('falls back to the local web app in development', () => {
    expect(service({}).webOrigin).toBe('http://localhost:3000');
  });
});
