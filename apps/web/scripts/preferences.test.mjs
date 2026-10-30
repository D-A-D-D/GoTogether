// Tests for src/lib/preferences.ts. Run with `npm run test --workspace apps/web`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOOT_SCRIPT,
  DEFAULT_PREFERENCES,
  STORAGE_KEYS,
  applyPreferences,
  htmlAttributes,
  normalizeTextSize,
  normalizeTheme,
  readPreferences,
  writePreferences,
} from '../src/lib/preferences.ts';

const memoryStore = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = String(v)),
    removeItem: (k) => void delete data[k],
  };
};

describe('normalising', () => {
  it('accepts only the known themes and text sizes, falling back to the defaults', () => {
    assert.equal(normalizeTheme('dark'), 'dark');
    assert.equal(normalizeTheme('light'), 'light');
    for (const bad of ['system', 'DARK', '', null, undefined, 5, {}]) assert.equal(normalizeTheme(bad), 'system');
    assert.equal(normalizeTextSize('large'), 'large');
    assert.equal(normalizeTextSize('xlarge'), 'xlarge');
    for (const bad of ['standard', 'huge', '', null, undefined]) assert.equal(normalizeTextSize(bad), 'standard');
  });
});

describe('htmlAttributes', () => {
  it('has no attributes at all for the defaults', () => {
    assert.deepEqual(htmlAttributes(DEFAULT_PREFERENCES), {});
  });

  it('sets only what was changed', () => {
    assert.deepEqual(htmlAttributes({ ...DEFAULT_PREFERENCES, theme: 'dark' }), { 'data-theme': 'dark' });
    assert.deepEqual(htmlAttributes({ ...DEFAULT_PREFERENCES, textSize: 'large' }), { 'data-text': 'large' });
    assert.deepEqual(htmlAttributes({ ...DEFAULT_PREFERENCES, reduceMotion: true }), { 'data-motion': 'reduce' });
    assert.deepEqual(htmlAttributes({ theme: 'light', textSize: 'xlarge', reduceMotion: true }), {
      'data-theme': 'light',
      'data-text': 'xlarge',
      'data-motion': 'reduce',
    });
  });
});

describe('reading and writing', () => {
  it('round-trips every choice', () => {
    const store = memoryStore();
    const chosen = { theme: 'dark', textSize: 'xlarge', reduceMotion: true };
    writePreferences(store, chosen);
    assert.deepEqual(readPreferences(store), chosen);
  });

  it('stores a default as nothing, so resetting leaves no trace', () => {
    const store = memoryStore();
    writePreferences(store, { theme: 'dark', textSize: 'large', reduceMotion: true });
    writePreferences(store, DEFAULT_PREFERENCES);
    assert.deepEqual(store.data, {});
  });

  it('ignores garbage left in storage', () => {
    const store = memoryStore({ [STORAGE_KEYS.theme]: 'neon', [STORAGE_KEYS.text]: '9000', [STORAGE_KEYS.motion]: 'yes' });
    assert.deepEqual(readPreferences(store), DEFAULT_PREFERENCES);
  });

  it('does not throw when storage is missing, blocked or full', () => {
    assert.deepEqual(readPreferences(null), DEFAULT_PREFERENCES);
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    assert.deepEqual(readPreferences(blocked), DEFAULT_PREFERENCES);
    assert.doesNotThrow(() => writePreferences(blocked, { theme: 'dark', textSize: 'large', reduceMotion: true }));
    assert.doesNotThrow(() => writePreferences(null, DEFAULT_PREFERENCES));
  });
});

describe('applyPreferences', () => {
  const fakeRoot = () => {
    const attributes = {};
    return {
      attributes,
      setAttribute: (k, v) => void (attributes[k] = v),
      removeAttribute: (k) => void delete attributes[k],
    };
  };

  it('puts the chosen attributes on the page', () => {
    const root = fakeRoot();
    applyPreferences({ theme: 'dark', textSize: 'large', reduceMotion: true }, root);
    assert.deepEqual(root.attributes, { 'data-theme': 'dark', 'data-text': 'large', 'data-motion': 'reduce' });
  });

  it('takes away what an earlier choice left, so going back to the defaults leaves nothing behind', () => {
    const root = fakeRoot();
    applyPreferences({ theme: 'dark', textSize: 'xlarge', reduceMotion: true }, root);
    applyPreferences(DEFAULT_PREFERENCES, root);
    assert.deepEqual(root.attributes, {});
  });

  it('replaces one choice without keeping the others from before', () => {
    const root = fakeRoot();
    applyPreferences({ theme: 'dark', textSize: 'large', reduceMotion: false }, root);
    applyPreferences({ theme: 'light', textSize: 'standard', reduceMotion: false }, root);
    assert.deepEqual(root.attributes, { 'data-theme': 'light' });
  });
});

describe('the script that runs before the page paints', () => {
  function run(stored) {
    const attributes = {};
    const doc = { documentElement: { setAttribute: (k, v) => void (attributes[k] = v) } };
    new Function('document', 'localStorage', BOOT_SCRIPT)(doc, memoryStore(stored));
    return attributes;
  }

  it('sets the same attributes the app would set from the same storage', () => {
    for (const prefs of [
      DEFAULT_PREFERENCES,
      { theme: 'dark', textSize: 'standard', reduceMotion: false },
      { theme: 'light', textSize: 'large', reduceMotion: true },
      { theme: 'system', textSize: 'xlarge', reduceMotion: false },
    ]) {
      const store = memoryStore();
      writePreferences(store, prefs);
      assert.deepEqual(run(store.data), htmlAttributes(prefs), JSON.stringify(prefs));
    }
  });

  it('survives unreadable storage and unknown values', () => {
    assert.deepEqual(run({ [STORAGE_KEYS.theme]: 'neon' }), {});
    const throwing = { getItem: () => { throw new Error('no'); } };
    const doc = { documentElement: { setAttribute: () => {} } };
    assert.doesNotThrow(() => new Function('document', 'localStorage', BOOT_SCRIPT)(doc, throwing));
  });

  it('contains nothing that could end an HTML script block early', () => {
    assert.ok(!/<\/script/i.test(BOOT_SCRIPT));
    assert.ok(!BOOT_SCRIPT.includes('<!--'));
  });
});
