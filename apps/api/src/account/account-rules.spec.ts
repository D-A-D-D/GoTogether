import {
  DELETED_NAME,
  RELEASABLE_TRIP_STATUSES,
  UNFINISHED_TRIP_STATUSES,
  anonymisedEmail,
  anonymisedProfile,
  unfinishedTripsMessage,
} from './account-rules.js';

describe('anonymisedProfile — what is left of a deleted account', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const profile = anonymisedProfile('user-1', now);

  it('clears everything that identifies the person', () => {
    expect(profile).toMatchObject({
      name: DELETED_NAME,
      bio: null,
      homeCity: null,
      homeRegion: null,
      homeLat: null,
      homeLng: null,
    });
  });

  it('clears the way to sign in', () => {
    expect(profile.passwordHash).toBeNull();
    expect(profile.emailVerifiedAt).toBeNull();
    expect(profile.email).toBe('deleted-user-1@deleted.invalid');
  });

  it('marks it deleted, with when, so every existing check treats it as gone', () => {
    expect(profile.accountStatus).toBe('DELETED');
    expect(profile.deletedAt).toBe(now);
  });

  it('strips any privilege — a deleted admin is a plain user', () => {
    expect(profile.role).toBe('USER');
  });

  it('keeps nothing from the original that could identify them', () => {
    const everything = JSON.stringify(profile);
    expect(everything).not.toMatch(/@example\.com/);
  });
});

describe('anonymisedEmail', () => {
  it('is unique per account, so the unique constraint on email still holds', () => {
    expect(anonymisedEmail('a')).not.toBe(anonymisedEmail('b'));
  });

  it('is in the reserved .invalid domain, so it can never be a real address and the real one is free to register again', () => {
    expect(anonymisedEmail('x')).toMatch(/@deleted\.invalid$/);
  });
});

describe('which trips matter', () => {
  it('a host cannot delete while a trip is unfinished — anything not completed or cancelled', () => {
    expect([...UNFINISHED_TRIP_STATUSES].sort()).toEqual(['DRAFT', 'FULL', 'ONGOING', 'OPEN']);
  });

  it('a member gives up their place only on a trip that is still open or under way', () => {
    expect([...RELEASABLE_TRIP_STATUSES].sort()).toEqual(['FULL', 'ONGOING', 'OPEN']);
  });

  it('never gives up a place on a finished trip — reviews and expenses depend on it', () => {
    expect(RELEASABLE_TRIP_STATUSES).not.toContain('COMPLETED');
    expect(RELEASABLE_TRIP_STATUSES).not.toContain('CANCELLED');
  });
});

describe('unfinishedTripsMessage', () => {
  it('reads correctly for one trip', () => {
    expect(unfinishedTripsMessage(1)).toBe(
      'You still host 1 trip that has not finished. Cancel or complete it first, then delete your account.',
    );
  });

  it('reads correctly for several', () => {
    expect(unfinishedTripsMessage(3)).toBe(
      'You still host 3 trips that have not finished. Cancel or complete them first, then delete your account.',
    );
  });
});
