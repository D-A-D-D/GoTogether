import { compareDiscovered, pageOf } from './discover-paging.js';

interface Item {
  id: string;
  matchScore: number;
  startDate: Date;
}

const day = (n: number) => new Date(Date.UTC(2027, 0, 1 + n));
const item = (id: string, matchScore: number, startDay: number): Item => ({ id, matchScore, startDate: day(startDay) });

/** Small seeded PRNG (mulberry32) so the "shuffled" inputs are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const next = rng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe('compareDiscovered', () => {
  it('puts the better match first', () => {
    const sorted = [item('a', 40, 0), item('b', 90, 5), item('c', 65, 2)].sort(compareDiscovered);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a score tie in favour of the sooner trip', () => {
    const sorted = [item('later', 80, 30), item('sooner', 80, 3)].sort(compareDiscovered);
    expect(sorted.map((i) => i.id)).toEqual(['sooner', 'later']);
  });

  it('breaks a score-and-date tie by id, so the order is total', () => {
    const sorted = [item('b', 80, 3), item('a', 80, 3), item('c', 80, 3)].sort(compareDiscovered);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('gives the same order whatever order the database returned the trips in', () => {
    // Lots of ties on purpose: most trips share a score and a start date.
    const items = Array.from({ length: 40 }, (_, i) => item(`trip-${String(i).padStart(2, '0')}`, 70 + (i % 3) * 10, i % 4));
    const expected = [...items].sort(compareDiscovered).map((i) => i.id);
    for (let seed = 1; seed <= 25; seed++) {
      expect(shuffled(items, seed).sort(compareDiscovered).map((i) => i.id)).toEqual(expected);
    }
  });
});

describe('pageOf', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];

  it('takes a window starting at the offset', () => {
    expect(pageOf(list, 0, 2)).toEqual(['a', 'b']);
    expect(pageOf(list, 2, 2)).toEqual(['c', 'd']);
  });

  it('returns a short last page', () => {
    expect(pageOf(list, 4, 2)).toEqual(['e']);
  });

  it('returns nothing past the end', () => {
    expect(pageOf(list, 5, 2)).toEqual([]);
    expect(pageOf(list, 50, 2)).toEqual([]);
  });
});

describe('walking the pages', () => {
  // The guarantee that matters: simulate the real situation, where every page
  // request re-fetches the candidates and the database returns them in a
  // different order each time. Every trip must still appear exactly once.
  const items = Array.from({ length: 57 }, (_, i) => item(`trip-${String(i).padStart(2, '0')}`, 60 + (i % 4) * 10, i % 5));

  it.each([5, 10, 20])('visits every trip exactly once with a page size of %i, even as the database order changes', (limit) => {
    const seen: string[] = [];
    for (let offset = 0, request = 1; ; offset += limit, request++) {
      const page = pageOf([...shuffled(items, request * 7)].sort(compareDiscovered), offset, limit);
      if (page.length === 0) break;
      seen.push(...page.map((i) => i.id));
    }
    expect(seen).toHaveLength(items.length);
    expect(new Set(seen).size).toBe(items.length);
    expect(seen).toEqual([...items].sort(compareDiscovered).map((i) => i.id));
  });

  it('would NOT hold if ties were left to the database — which is why the tie-break exists', () => {
    // The same walk, sorting by score alone (the old behaviour), loses or repeats trips.
    const scoreOnly = (a: Item, b: Item) => b.matchScore - a.matchScore;
    const seen: string[] = [];
    for (let offset = 0, request = 1; ; offset += 10, request++) {
      const page = pageOf([...shuffled(items, request * 7)].sort(scoreOnly), offset, 10);
      if (page.length === 0) break;
      seen.push(...page.map((i) => i.id));
    }
    expect(new Set(seen).size).toBeLessThan(items.length);
  });
});
