// Guards on src/app/globals.css: the dark theme is written out twice (device preference, and a manual
// choice in Settings) and the two must match; and every text/background pair in both themes must meet
// WCAG AA. Reads the real stylesheet, so a careless colour change fails CI instead of reaching people.
// Run with `npm run test --workspace apps/web`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector line contains `selector`, as { name: value }. */
function declarationsAfter(selector) {
  const start = css.indexOf(selector);
  assert.ok(start !== -1, `no rule for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const out = {};
  for (const m of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = declarationsAfter(':root {');
const darkDevice = declarationsAfter(':root:not([data-theme="light"])');
const darkManual = declarationsAfter(':root[data-theme="dark"]');

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('the two copies of the dark theme', () => {
  it('are identical, so a manual choice looks exactly like the device preference', () => {
    const device = { ...darkDevice };
    const manual = { ...darkManual };
    delete device['color-scheme'];
    delete manual['color-scheme'];
    assert.deepEqual(device, manual);
    assert.ok(Object.keys(device).length > 15, 'expected a full set of tokens');
  });

  it('both declare the dark colour-scheme, so form controls and scrollbars go dark too', () => {
    assert.equal(darkDevice['color-scheme'], 'dark');
    assert.equal(darkManual['color-scheme'], 'dark');
    assert.equal(light['color-scheme'], 'light');
  });

  it('define every colour the light theme does', () => {
    for (const name of Object.keys(light)) {
      if (name === 'color-scheme') continue;
      assert.ok(name in darkManual, `${name} is missing from the dark theme`);
    }
  });
});

// [foreground, background, minimum ratio, what it is]
const PAIRS = [
  ['--foreground', '--background', 4.5, 'body text on the page'],
  ['--foreground', '--surface', 4.5, 'body text on a card'],
  ['--foreground', '--surface-2', 4.5, 'body text on a chip'],
  ['--muted', '--background', 4.5, 'secondary text on the page'],
  ['--muted', '--surface', 4.5, 'secondary text on a card'],
  ['--muted', '--surface-2', 4.5, 'secondary text on a chip'],
  ['--on-accent', '--accent', 4.5, 'a button label'],
  ['--accent-ink', '--background', 4.5, 'link text on the page'],
  ['--accent-ink', '--surface', 4.5, 'link text on a card'],
  ['--accent-ink', '--surface-2', 4.5, 'accent text on a chip'],
  ['--accent-2', '--background', 4.5, 'teal text on the page'],
  ['--accent-2', '--surface', 4.5, 'teal text on a card'],
  ['--danger', '--background', 4.5, 'an error on the page'],
  ['--danger', '--surface', 4.5, 'an error on a card'],
  ['--on-gold', '--gold', 4.5, 'text on a gold chip'],
  ['--on-forest', '--forest', 4.5, 'text on the dark green card'],
  ['--field', '--surface', 3, 'the border of an input (non-text contrast)'],
  ['--field', '--background', 3, 'the border of a control on the page'],
];

for (const [themeName, theme] of [['light', light], ['dark', darkManual]]) {
  describe(`${themeName} theme contrast (WCAG AA)`, () => {
    for (const [fg, bg, need, what] of PAIRS) {
      it(`${what}: ${fg} on ${bg} is at least ${need}:1`, () => {
        // A tint like rgba() cannot be measured on its own; every pair here is a solid hex colour.
        assert.match(theme[fg], /^#[0-9a-f]{6}$/i, `${fg} is not a hex colour`);
        assert.match(theme[bg], /^#[0-9a-f]{6}$/i, `${bg} is not a hex colour`);
        const r = ratio(theme[fg], theme[bg]);
        assert.ok(r >= need, `${r.toFixed(2)}:1 (${theme[fg]} on ${theme[bg]})`);
      });
    }
  });
}
