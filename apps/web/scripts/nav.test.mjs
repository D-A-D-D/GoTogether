// Tests for src/lib/nav.ts. Run with `npm run test --workspace apps/web`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activeTab, createVisitStack, routeMeta } from '../src/lib/nav.ts';

describe('routeMeta', () => {
  it('treats the four main screens as tabs, with no Back', () => {
    for (const path of ['/', '/trips/discover', '/trips/mine', '/profile']) {
      const meta = routeMeta(path);
      assert.equal(meta.tab, true, path);
      assert.equal(meta.back, null, path);
    }
  });

  it('gives every other screen a Back target, so nobody is stranded', () => {
    for (const path of ['/trips/new', '/login', '/register', '/terms', '/trips/abc', '/trips/abc/chat', '/something/unknown']) {
      const meta = routeMeta(path);
      assert.equal(meta.tab, false, path);
      assert.ok(meta.back, `${path} has no back target`);
    }
  });

  it('sends a trip screen back to discovery, and its sections back to the trip', () => {
    assert.equal(routeMeta('/trips/abc').back, '/trips/discover');
    for (const section of ['chat', 'expenses', 'reviews', 'edit']) {
      assert.equal(routeMeta(`/trips/abc/${section}`).back, '/trips/abc', section);
    }
  });

  it('is not fooled by the fixed trip routes looking like trip ids', () => {
    assert.equal(routeMeta('/trips/discover').title, 'Discover');
    assert.equal(routeMeta('/trips/mine').title, 'My trips');
    assert.equal(routeMeta('/trips/new').title, 'Host a trip');
  });

  it('makes only the chat immersive', () => {
    assert.equal(routeMeta('/trips/abc/chat').immersive, true);
    for (const path of ['/trips/abc', '/trips/abc/expenses', '/trips/discover', '/profile']) {
      assert.equal(routeMeta(path).immersive, false, path);
    }
  });

  it('ignores a trailing slash', () => {
    assert.deepEqual(routeMeta('/trips/abc/chat/'), routeMeta('/trips/abc/chat'));
    assert.deepEqual(routeMeta('/profile/'), routeMeta('/profile'));
  });
});

describe('activeTab', () => {
  it('lights up the matching tab, and nothing for a trip page', () => {
    assert.equal(activeTab('/trips/discover'), 'discover');
    assert.equal(activeTab('/trips/mine'), 'mine');
    assert.equal(activeTab('/trips/new'), 'new');
    assert.equal(activeTab('/profile'), 'profile');
    assert.equal(activeTab('/trips/abc'), null);
  });
});

describe('createVisitStack', () => {
  it('cannot go back from the first screen, and can after a second', () => {
    const stack = createVisitStack();
    stack.visit('/trips/discover');
    assert.equal(stack.canGoBack(), false);
    stack.visit('/trips/abc');
    assert.equal(stack.canGoBack(), true);
  });

  it('does not count the same screen twice in a row', () => {
    const stack = createVisitStack();
    stack.visit('/a');
    stack.visit('/a');
    assert.equal(stack.depth(), 1);
  });

  it('unwinds when the browser goes back, so the next Back still makes sense', () => {
    const stack = createVisitStack();
    stack.visit('/a');
    stack.visit('/b');
    stack.visit('/c');
    stack.markPop();
    stack.visit('/b');
    assert.equal(stack.depth(), 2);
    stack.markPop();
    stack.visit('/a');
    assert.equal(stack.canGoBack(), false);
  });

  it('treats a pop to an unknown screen as a fresh visit', () => {
    const stack = createVisitStack();
    stack.visit('/a');
    stack.markPop();
    stack.visit('/zzz');
    assert.equal(stack.depth(), 2);
  });

  it('keeps going forward as normal after a pop', () => {
    const stack = createVisitStack();
    stack.visit('/a');
    stack.visit('/b');
    stack.markPop();
    stack.visit('/a');
    stack.visit('/c');
    assert.equal(stack.depth(), 2);
    assert.equal(stack.canGoBack(), true);
  });
});
