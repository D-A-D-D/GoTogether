// Tests for src/lib/image.ts, voice.ts and emoji-data.ts. Run with `npm run test --workspace apps/web`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { centredSquare, fitWithin } from '../src/lib/image.ts';
import { avatarPath } from '../src/lib/media-path.ts';
import { MAX_VOICE_MS, RECORDER_MIME_CANDIDATES, formatDuration, pickRecorderMime, waveformBars } from '../src/lib/voice.ts';
import { EMOJI_CATEGORIES, RECENT_LIMIT, insertAt, pushRecent } from '../src/lib/emoji-data.ts';

describe('fitWithin', () => {
  it('shrinks to fit the longer side, keeping the proportions', () => {
    assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
    assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
    assert.deepEqual(fitWithin(1000, 1000, 500), { width: 500, height: 500 });
  });

  it('never enlarges a picture that is already small', () => {
    assert.deepEqual(fitWithin(300, 200, 1600), { width: 300, height: 200 });
    assert.deepEqual(fitWithin(1600, 900, 1600), { width: 1600, height: 900 });
  });

  it('never rounds a thin picture down to nothing', () => {
    const { width, height } = fitWithin(10000, 3, 100);
    assert.equal(width, 100);
    assert.ok(height >= 1);
  });

  it('gives zero for nonsense sizes rather than NaN', () => {
    for (const [w, h] of [[0, 10], [10, 0], [-5, 10], [NaN, 10], [Infinity * 0, 5]]) {
      assert.deepEqual(fitWithin(w, h, 100), { width: 0, height: 0 });
    }
  });
});

describe('centredSquare', () => {
  it('takes the middle of a wide picture', () => {
    assert.deepEqual(centredSquare(1000, 600), { sx: 200, sy: 0, size: 600 });
  });

  it('takes the middle of a tall picture', () => {
    assert.deepEqual(centredSquare(600, 1000), { sx: 0, sy: 200, size: 600 });
  });

  it('is the whole picture when it is already square', () => {
    assert.deepEqual(centredSquare(500, 500), { sx: 0, sy: 0, size: 500 });
  });

  it('stays inside the picture, for odd sizes too', () => {
    for (const [w, h] of [[1001, 600], [601, 1001], [7, 3], [3, 7]]) {
      const { sx, sy, size } = centredSquare(w, h);
      assert.ok(sx >= 0 && sy >= 0 && sx + size <= w && sy + size <= h, `${w}x${h}`);
    }
  });
});

describe('voice recording formats', () => {
  it('prefers WebM with Opus, then plain WebM, then MP4 (Safari), then Ogg', () => {
    assert.equal(pickRecorderMime(() => true), 'audio/webm;codecs=opus');
    assert.equal(pickRecorderMime((m) => m === 'audio/webm'), 'audio/webm');
    assert.equal(pickRecorderMime((m) => m === 'audio/mp4'), 'audio/mp4');
    assert.equal(pickRecorderMime((m) => m.startsWith('audio/ogg')), 'audio/ogg;codecs=opus');
  });

  it('leaves the choice to the browser when none is supported, and survives a throwing check', () => {
    assert.equal(pickRecorderMime(() => false), undefined);
    assert.equal(pickRecorderMime(() => { throw new Error('no'); }), undefined);
  });

  it('only ever offers types the server accepts', () => {
    for (const mime of RECORDER_MIME_CANDIDATES) assert.match(mime, /^audio\/(webm|mp4|ogg)/);
  });

  it('stops a recording at the same length the server accepts', () => {
    assert.equal(MAX_VOICE_MS, 180_000);
  });
});

describe('formatDuration', () => {
  it('shows minutes and padded seconds, rounding down', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(999), '0:00');
    assert.equal(formatDuration(7_400), '0:07');
    assert.equal(formatDuration(65_000), '1:05');
    assert.equal(formatDuration(180_000), '3:00');
    assert.equal(formatDuration(754_000), '12:34');
  });

  it('never shows a negative or broken length', () => {
    assert.equal(formatDuration(-500), '0:00');
    assert.equal(formatDuration(NaN), '0:00');
    assert.equal(formatDuration(Infinity), '0:00');
  });
});

describe('waveformBars', () => {
  it('is the same every time for the same message, and different for another', () => {
    assert.deepEqual(waveformBars('abc'), waveformBars('abc'));
    assert.notDeepEqual(waveformBars('abc'), waveformBars('abd'));
  });

  it('gives the number asked for, each between 0.15 and 1', () => {
    for (const count of [1, 12, 28, 60]) {
      const bars = waveformBars('seed', count);
      assert.equal(bars.length, count);
      for (const b of bars) assert.ok(b >= 0.15 && b <= 1, String(b));
    }
  });

  it('has some variety, not a flat line', () => {
    assert.ok(new Set(waveformBars('x', 28)).size > 8);
  });
});

describe('emoji data', () => {
  const graphemes = (text) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)];

  it('has a useful number of emoji, in several categories', () => {
    assert.ok(EMOJI_CATEGORIES.length >= 6);
    const total = EMOJI_CATEGORIES.reduce((n, c) => n + c.emojis.length, 0);
    assert.ok(total >= 240, `only ${total}`);
  });

  it('has each emoji exactly once in its category, and every entry is a single emoji', () => {
    for (const category of EMOJI_CATEGORIES) {
      assert.equal(new Set(category.emojis).size, category.emojis.length, `${category.id} has a duplicate`);
      for (const emoji of category.emojis) {
        assert.equal(graphemes(emoji).length, 1, `${category.id}: "${emoji}" is not one emoji`);
      }
    }
  });

  it('gives every category a label, an icon that is one of its own emoji, and a unique id', () => {
    assert.equal(new Set(EMOJI_CATEGORIES.map((c) => c.id)).size, EMOJI_CATEGORIES.length);
    for (const c of EMOJI_CATEGORIES) {
      assert.ok(c.label.length > 0);
      assert.ok(c.emojis.includes(c.icon), `${c.id}'s icon is not in it`);
    }
  });
});

describe('pushRecent', () => {
  it('puts the newest first and removes a repeat', () => {
    assert.deepEqual(pushRecent(['😀', '🔥'], '🎉'), ['🎉', '😀', '🔥']);
    assert.deepEqual(pushRecent(['😀', '🔥', '🎉'], '🔥'), ['🔥', '😀', '🎉']);
  });

  it('keeps at most the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => `e${i}`);
    assert.equal(pushRecent(many, 'new').length, RECENT_LIMIT);
    assert.equal(pushRecent(many, 'new')[0], 'new');
    assert.deepEqual(pushRecent(['a', 'b', 'c'], 'd', 2), ['d', 'a']);
  });

  it('does not change the list it was given', () => {
    const list = ['a'];
    pushRecent(list, 'b');
    assert.deepEqual(list, ['a']);
  });
});

describe('insertAt', () => {
  it('inserts at the caret and says where the caret goes', () => {
    assert.deepEqual(insertAt('hello world', '😀', 5, 5), { value: 'hello😀 world', caret: 7 });
    assert.deepEqual(insertAt('', '😀', 0, 0), { value: '😀', caret: 2 });
  });

  it('replaces a selection', () => {
    assert.deepEqual(insertAt('hello world', '🎉', 6, 11), { value: 'hello 🎉', caret: 8 });
  });

  it('puts it at the end for a caret past the end, and at the start for a negative one', () => {
    assert.equal(insertAt('abc', 'X', 99, 99).value, 'abcX');
    assert.equal(insertAt('abc', 'X', -5, -5).value, 'Xabc');
  });

  it('copes with a selection given backwards', () => {
    assert.equal(insertAt('abcdef', 'X', 4, 2).value, 'abcdXef');
  });
});

describe('avatarPath', () => {
  it('is nothing for someone with no picture', () => {
    assert.equal(avatarPath({ id: 'u1' }), null);
    assert.equal(avatarPath({ id: 'u1', avatarUpdatedAt: null }), null);
  });

  it('is their picture, carrying the version so a changed picture is a new address', () => {
    const before = avatarPath({ id: 'u1', avatarUpdatedAt: '2026-10-30T10:00:00.000Z' });
    const after = avatarPath({ id: 'u1', avatarUpdatedAt: '2026-10-30T11:00:00.000Z' });
    assert.ok(before.startsWith('/users/u1/avatar?v='));
    assert.notEqual(before, after);
  });

  it('keeps the version from breaking out of the address', () => {
    assert.equal(new URL(avatarPath({ id: 'u1', avatarUpdatedAt: 'a&b=c#d' }), 'http://x').searchParams.get('v'), 'a&b=c#d');
  });
});
