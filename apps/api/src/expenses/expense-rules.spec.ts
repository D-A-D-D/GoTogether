import { changeVerdict, involvedUserIds } from './expense-rules.js';

const expense = (over: Partial<Parameters<typeof changeVerdict>[0]> = {}) => ({
  paidById: 'payer',
  createdById: 'logger',
  splits: [
    { userId: 'payer', settled: false },
    { userId: 'other', settled: false },
  ],
  ...over,
});

describe('changeVerdict — who may change an expense', () => {
  it('lets the person who logged it change it', () => {
    expect(changeVerdict(expense(), 'logger')).toBe('ok');
  });

  it('lets the person who paid change it, even if someone else logged it', () => {
    expect(changeVerdict(expense(), 'payer')).toBe('ok');
  });

  it('lets someone who both logged and paid change it', () => {
    expect(changeVerdict(expense({ createdById: 'payer' }), 'payer')).toBe('ok');
  });

  it('refuses anyone else on the trip, even someone with a share', () => {
    expect(changeVerdict(expense(), 'other')).toBe('not-yours');
    expect(changeVerdict(expense(), 'stranger')).toBe('not-yours');
  });

  it('only the payer can change an expense logged before the logger was recorded', () => {
    const legacy = expense({ createdById: null });
    expect(changeVerdict(legacy, 'payer')).toBe('ok');
    expect(changeVerdict(legacy, 'logger')).toBe('not-yours');
    expect(changeVerdict(legacy, 'other')).toBe('not-yours');
  });
});

describe('changeVerdict — once money has changed hands', () => {
  const partlySettled = expense({
    splits: [
      { userId: 'payer', settled: false },
      { userId: 'other', settled: true },
      { userId: 'third', settled: false },
    ],
  });

  it('locks it as soon as any share is marked paid', () => {
    expect(changeVerdict(partlySettled, 'logger')).toBe('settled');
    expect(changeVerdict(partlySettled, 'payer')).toBe('settled');
  });

  it('does not tell someone who may not change it that it is settled — "not yours" comes first', () => {
    expect(changeVerdict(partlySettled, 'stranger')).toBe('not-yours');
  });

  it('is still changeable while every share is unsettled', () => {
    expect(changeVerdict(expense(), 'logger')).toBe('ok');
  });
});

describe('involvedUserIds', () => {
  it('is the payer plus everyone with a share, once each', () => {
    const ids = involvedUserIds({
      paidById: 'payer',
      splits: [
        { userId: 'payer', settled: false },
        { userId: 'a', settled: false },
        { userId: 'b', settled: false },
      ],
    });
    expect(ids.sort()).toEqual(['a', 'b', 'payer']);
  });

  it('includes a payer who has no share of their own', () => {
    const ids = involvedUserIds({ paidById: 'payer', splits: [{ userId: 'a', settled: false }] });
    expect(ids.sort()).toEqual(['a', 'payer']);
  });
});
