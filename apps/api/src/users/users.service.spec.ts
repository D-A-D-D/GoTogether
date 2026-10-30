import { UsersService } from './users.service.js';

const service = new UsersService({} as never);
const user = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'una@example.com',
  name: 'Una',
  passwordHash: '$2a$12$abcdefghijklmnopqrstuv',
  homeCity: 'Pune',
  homeLat: 18.52,
  homeLng: 73.85,
  ...overrides,
});

describe('UsersService.toPublicProfile', () => {
  it('never lets the password hash or the precise geocode out', () => {
    const profile = service.toPublicProfile(user());
    expect(profile).not.toHaveProperty('passwordHash');
    expect(profile).not.toHaveProperty('homeLat');
    expect(profile).not.toHaveProperty('homeLng');
    expect(JSON.stringify(profile)).not.toContain('$2a$');
  });

  it('keeps the internal media id inside, and the picture version and read-receipts choice out for the app', () => {
    const profile = service.toPublicProfile(user({ avatarMediaId: 'media-9', avatarUpdatedAt: '2027-01-01T00:00:00.000Z', readReceipts: false }));
    expect(profile).not.toHaveProperty('avatarMediaId');
    expect(profile).toMatchObject({ avatarUpdatedAt: '2027-01-01T00:00:00.000Z', readReceipts: false });
  });

  it('keeps the city, which is what is allowed out', () => {
    expect(service.toPublicProfile(user())).toMatchObject({ id: 'u1', name: 'Una', homeCity: 'Pune' });
  });

  it('says whether there is a password, without revealing it', () => {
    expect(service.toPublicProfile(user()).hasPassword).toBe(true);
  });

  it('says there is none for an account that signed up with Google', () => {
    expect(service.toPublicProfile(user({ passwordHash: null })).hasPassword).toBe(false);
    expect(service.toPublicProfile(user({ passwordHash: undefined })).hasPassword).toBe(false);
  });
});
