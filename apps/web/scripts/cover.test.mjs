// Tests for src/lib/cover.ts. Run with `npm run test --workspace apps/web`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COVER_GRADIENTS, coverFor, hashString } from '../src/lib/cover.ts';

describe('coverFor', () => {
  it('gives the same trip the same cover every time', () => {
    assert.deepEqual(coverFor('Spiti Valley'), coverFor('Spiti Valley'));
  });

  it('ignores case and surrounding spaces, so a retyped name keeps its look', () => {
    assert.deepEqual(coverFor('  spiti valley '), coverFor('Spiti Valley'));
  });

  it('uses only the palette gradients', () => {
    for (const name of ['Goa', 'Hampi', 'Ladakh', 'Kerala', 'Kedarnath', 'x', '']) {
      assert.ok(COVER_GRADIENTS.includes(coverFor(name).background), name);
    }
  });

  it('spreads different names across the gradients rather than giving them all one', () => {
    const used = new Set(
      ['Goa', 'Hampi', 'Ladakh', 'Kerala', 'Kedarnath', 'Spiti', 'Jaipur', 'Varanasi', 'Munnar', 'Coorg', 'Pondicherry', 'Gokarna']
        .map((name) => coverFor(name).background),
    );
    assert.ok(used.size >= 4, `only ${used.size} gradients used`);
  });

  it('draws seven closed contour lines with finite coordinates', () => {
    const { contours } = coverFor('Goa');
    assert.equal(contours.length, 7);
    for (const d of contours) {
      assert.match(d, /^M[\d. -]+( L[\d. -]+)*Z$|^M.*Z$/);
      assert.ok(d.endsWith('Z'));
      assert.ok(!/NaN|Infinity/.test(d));
    }
  });

  it('draws different lines for different names', () => {
    assert.notDeepEqual(coverFor('Goa').contours, coverFor('Hampi').contours);
  });
});

describe('hashString', () => {
  it('is stable and unsigned', () => {
    assert.equal(hashString('abc'), hashString('abc'));
    assert.ok(hashString('abc') >= 0);
    assert.notEqual(hashString('abc'), hashString('abd'));
  });
});
