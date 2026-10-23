// Tests for public/sw.js's push handlers. Run with `npm run test --workspace apps/web`.
//
// The real worker file is loaded into a sandbox with a fake service-worker
// environment, and its `push` / `notificationclick` handlers are driven
// directly. Uses Node's built-in test runner — no dependency to add, because
// apps/web has no test framework. The part worth protecting is the URL
// handling: a push payload arrives over the wire, and must only ever be able
// to open a page in this app.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://app.test';
const source = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');

function makeWorker({ windows = [], navigateRejects = false } = {}) {
  const handlers = {};
  const shown = [];
  const opened = [];
  const focused = [];
  const navigated = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    registration: {
      showNotification: async (title, options) => {
        shown.push({ title, options });
      },
    },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () =>
        windows.map((url) => ({
          url,
          focus: async () => {
            focused.push(url);
          },
          navigate: async (target) => {
            if (navigateRejects) throw new Error('cannot navigate');
            navigated.push(target);
          },
        })),
      openWindow: async (target) => {
        opened.push(target);
      },
    },
  };
  vm.runInNewContext(source, { self, URL, caches: {}, fetch: async () => {}, console });
  return { handlers, shown, opened, focused, navigated };
}

async function push(worker, data) {
  const waits = [];
  worker.handlers.push({ data, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
}

async function click(worker, notificationData) {
  const waits = [];
  let closed = false;
  worker.handlers.notificationclick({
    notification: {
      data: notificationData,
      close: () => {
        closed = true;
      },
    },
    waitUntil: (p) => waits.push(p),
  });
  await Promise.all(waits);
  return closed;
}

const json = (obj) => ({ json: () => obj, text: () => JSON.stringify(obj) });

describe('push handler', () => {
  it('shows the title, body, icon, and a same-origin destination', async () => {
    const w = makeWorker();
    await push(w, json({ title: 'Priya', body: 'See you at the base camp', url: '/trips/abc/chat' }));
    assert.equal(w.shown.length, 1);
    assert.equal(w.shown[0].title, 'Priya');
    assert.equal(w.shown[0].options.body, 'See you at the base camp');
    assert.equal(w.shown[0].options.icon, '/icons/icon-192.png');
    assert.equal(w.shown[0].options.data.url, `${ORIGIN}/trips/abc/chat`);
  });

  it('tags by destination and renotifies, so a chat replaces rather than stacks', async () => {
    const w = makeWorker();
    await push(w, json({ title: 'x', body: 'y', url: '/trips/abc/chat' }));
    assert.equal(w.shown[0].options.tag, `${ORIGIN}/trips/abc/chat`);
    assert.equal(w.shown[0].options.renotify, true);
  });

  it('sends a cross-origin url home', async () => {
    const w = makeWorker();
    await push(w, json({ title: 'x', body: 'y', url: 'https://evil.example/phish' }));
    assert.equal(w.shown[0].options.data.url, `${ORIGIN}/`);
  });

  it('sends a protocol-relative url (//evil.example) home', async () => {
    const w = makeWorker();
    await push(w, json({ title: 'x', body: 'y', url: '//evil.example/phish' }));
    assert.equal(w.shown[0].options.data.url, `${ORIGIN}/`);
  });

  it('sends a javascript: url home', async () => {
    const w = makeWorker();
    await push(w, json({ title: 'x', body: 'y', url: 'javascript:alert(1)' }));
    assert.equal(w.shown[0].options.data.url, `${ORIGIN}/`);
  });

  it('sends a missing or non-string url home', async () => {
    const w = makeWorker();
    await push(w, json({ title: 'x', body: 'y' }));
    await push(w, json({ title: 'x', body: 'y', url: 42 }));
    assert.equal(w.shown[0].options.data.url, `${ORIGIN}/`);
    assert.equal(w.shown[1].options.data.url, `${ORIGIN}/`);
  });

  it('turns a non-JSON payload into the body under a default title', async () => {
    const w = makeWorker();
    await push(w, {
      json: () => {
        throw new SyntaxError('not json');
      },
      text: () => 'plain text',
    });
    assert.equal(w.shown[0].title, 'GoTogether');
    assert.equal(w.shown[0].options.body, 'plain text');
  });

  it('still shows something for an empty push, rather than failing silently', async () => {
    const w = makeWorker();
    await push(w, null);
    assert.equal(w.shown.length, 1);
    assert.equal(w.shown[0].title, 'GoTogether');
    assert.equal(w.shown[0].options.body, '');
  });

  it('ignores a non-string title or body instead of rendering it', async () => {
    const w = makeWorker();
    await push(w, json({ title: { evil: true }, body: ['x'], url: '/' }));
    assert.equal(w.shown[0].title, 'GoTogether');
    assert.equal(w.shown[0].options.body, '');
  });
});

describe('notificationclick handler', () => {
  it('closes the notification and focuses + navigates an open window', async () => {
    const w = makeWorker({ windows: [`${ORIGIN}/trips/mine`] });
    const closed = await click(w, { url: `${ORIGIN}/trips/abc/chat` });
    assert.equal(closed, true);
    assert.deepEqual(w.focused, [`${ORIGIN}/trips/mine`]);
    assert.deepEqual(w.navigated, [`${ORIGIN}/trips/abc/chat`]);
    assert.deepEqual(w.opened, []);
  });

  it('opens a new window when none is open', async () => {
    const w = makeWorker({ windows: [] });
    await click(w, { url: `${ORIGIN}/trips/abc` });
    assert.deepEqual(w.opened, [`${ORIGIN}/trips/abc`]);
  });

  it("ignores another origin's windows", async () => {
    const w = makeWorker({ windows: ['https://other.example/page'] });
    await click(w, { url: `${ORIGIN}/trips/abc` });
    assert.deepEqual(w.focused, []);
    assert.deepEqual(w.opened, [`${ORIGIN}/trips/abc`]);
  });

  it('falls back to a new window when navigate() rejects', async () => {
    const w = makeWorker({ windows: [`${ORIGIN}/`], navigateRejects: true });
    await click(w, { url: `${ORIGIN}/trips/abc` });
    assert.deepEqual(w.opened, [`${ORIGIN}/trips/abc`]);
  });

  it('re-sanitises a tampered destination in the notification data', async () => {
    const w = makeWorker({ windows: [] });
    await click(w, { url: 'https://evil.example/x' });
    assert.deepEqual(w.opened, [`${ORIGIN}/`]);
  });

  it('goes home when the notification carries no data', async () => {
    const w = makeWorker({ windows: [] });
    await click(w, undefined);
    assert.deepEqual(w.opened, [`${ORIGIN}/`]);
  });
});
