import { ASK_AGAIN_AFTER_DECLINE_MS, MAX_DIRECT_LENGTH, canAskAgain, needsAttention, pairOf, sendProblem, textProblem, viewOf } from './direct-rules.js';

const NOW = new Date('2027-03-10T12:00:00Z');
const thread = (status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CLOSED', extra = {}) => ({ status, requesterId: 'asker', respondedAt: null as Date | null, ...extra });

describe('pairOf', () => {
  it('puts the two ids in a fixed order, whoever asked', () => {
    expect(pairOf('b', 'a')).toEqual({ low: 'a', high: 'b' });
    expect(pairOf('a', 'b')).toEqual({ low: 'a', high: 'b' });
  });
});

describe('viewOf', () => {
  it('shows an accepted chat to both, and a closed one to both', () => {
    expect(viewOf(thread('ACCEPTED'), 'asker')).toBe('ACCEPTED');
    expect(viewOf(thread('ACCEPTED'), 'other')).toBe('ACCEPTED');
    expect(viewOf(thread('CLOSED'), 'other')).toBe('CLOSED');
  });

  it('shows a waiting request as an outgoing one to the asker and an incoming one to the other person', () => {
    expect(viewOf(thread('PENDING'), 'asker')).toBe('REQUEST_OUT');
    expect(viewOf(thread('PENDING'), 'other')).toBe('REQUEST_IN');
  });

  it('never tells the asker they were declined, and no longer shows it to the person who declined', () => {
    expect(viewOf(thread('DECLINED'), 'asker')).toBe('REQUEST_OUT');
    expect(viewOf(thread('DECLINED'), 'other')).toBe('HIDDEN');
  });
});

describe('sendProblem', () => {
  it('lets both people talk once it is accepted', () => {
    expect(sendProblem(thread('ACCEPTED'), 'asker', 40)).toBeNull();
    expect(sendProblem(thread('ACCEPTED'), 'other', 0)).toBeNull();
  });

  it('allows exactly one message from the asker while the request waits', () => {
    expect(sendProblem(thread('PENDING'), 'asker', 0)).toBeNull();
    expect(sendProblem(thread('PENDING'), 'asker', 1)).toMatch(/once they accept/);
  });

  it('does not let the other person reply until they accept', () => {
    expect(sendProblem(thread('PENDING'), 'other', 0)).toMatch(/Accept their request/);
  });

  it('allows nothing after a decline, and says nothing that reveals it to the asker', () => {
    expect(sendProblem(thread('DECLINED'), 'asker', 1)).toBe('You can send more once they accept your request');
    expect(sendProblem(thread('DECLINED'), 'other', 0)).toMatch(/not open/);
  });

  it('allows nothing in a closed chat', () => {
    expect(sendProblem(thread('CLOSED'), 'asker', 0)).toMatch(/closed/);
    expect(sendProblem(thread('CLOSED'), 'other', 0)).toMatch(/closed/);
  });
});

describe('canAskAgain', () => {
  it('is always allowed after a chat was closed by a removal', () => {
    expect(canAskAgain(thread('CLOSED'), 'asker', NOW)).toBe(true);
    expect(canAskAgain(thread('CLOSED'), 'other', NOW)).toBe(true);
  });

  it('makes the declined person wait a month, but lets the person who declined change their mind', () => {
    const declined = (ago: number) => thread('DECLINED', { respondedAt: new Date(NOW.getTime() - ago) });
    expect(canAskAgain(declined(ASK_AGAIN_AFTER_DECLINE_MS - 1000), 'asker', NOW)).toBe(false);
    expect(canAskAgain(declined(ASK_AGAIN_AFTER_DECLINE_MS), 'asker', NOW)).toBe(true);
    expect(canAskAgain(declined(1000), 'other', NOW)).toBe(true);
  });

  it('never replaces an accepted chat or a request that is still waiting', () => {
    expect(canAskAgain(thread('ACCEPTED'), 'asker', NOW)).toBe(false);
    expect(canAskAgain(thread('PENDING'), 'other', NOW)).toBe(false);
  });
});

describe('textProblem', () => {
  it('refuses blank text and text over the limit, and accepts what is in between', () => {
    expect(textProblem('   ')).toMatch(/empty/);
    expect(textProblem('x'.repeat(MAX_DIRECT_LENGTH + 1))).toMatch(/at most/);
    expect(textProblem('x'.repeat(MAX_DIRECT_LENGTH))).toBeNull();
    expect(textProblem('hello')).toBeNull();
  });
});

describe('needsAttention', () => {
  const t = (status: 'PENDING' | 'ACCEPTED', lowReadAt: Date | null, highReadAt: Date | null) => ({ status, requesterId: 'a', userLowId: 'a', lowReadAt, highReadAt });
  const at = (m: number) => new Date(NOW.getTime() + m * 60_000);

  it('is true for a request waiting for you, whatever has been read', () => {
    expect(needsAttention(t('PENDING', null, at(5)), 'b', { senderId: 'a', createdAt: at(1) })).toBe(true);
  });

  it("is true when the other person's message is newer than when you last looked, using your own side's time", () => {
    // 'a' is the low side, 'b' the high side.
    expect(needsAttention(t('ACCEPTED', at(10), at(0)), 'b', { senderId: 'a', createdAt: at(5) })).toBe(true);
    expect(needsAttention(t('ACCEPTED', at(0), at(10)), 'b', { senderId: 'a', createdAt: at(5) })).toBe(false);
    expect(needsAttention(t('ACCEPTED', null, null), 'b', { senderId: 'a', createdAt: at(5) })).toBe(true);
  });

  it('is false for your own last message, and for an empty chat', () => {
    expect(needsAttention(t('ACCEPTED', null, null), 'b', { senderId: 'b', createdAt: at(5) })).toBe(false);
    expect(needsAttention(t('ACCEPTED', null, null), 'b', null)).toBe(false);
  });
});
