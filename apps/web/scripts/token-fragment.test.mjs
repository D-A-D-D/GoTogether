// Tests for src/lib/token-fragment.ts. Run with `npm run test --workspace apps/web`.
// Imports the TypeScript source directly - Node strips the type annotations.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tokenFromFragment } from '../src/lib/token-fragment.ts';

describe('tokenFromFragment', () => {
  it('reads the token from a fragment', () => {
    assert.equal(tokenFromFragment('#token=abc_DEF-123'), 'abc_DEF-123');
  });

  it('refuses anything that is not a fragment, including a bare token=...', () => {
    assert.equal(tokenFromFragment('token=abc'), null);
  });

  it('decodes percent-encoding, as the link builder encodes it', () => {
    assert.equal(tokenFromFragment('#token=a%20b%26c'), 'a b&c');
  });

  it('finds the token among other parameters', () => {
    assert.equal(tokenFromFragment('#x=1&token=abc&y=2'), 'abc');
  });

  it('is null when there is no fragment, or no token in it', () => {
    assert.equal(tokenFromFragment(''), null);
    assert.equal(tokenFromFragment('#'), null);
    assert.equal(tokenFromFragment('#other=1'), null);
  });

  it('is null for an empty or blank token', () => {
    assert.equal(tokenFromFragment('#token='), null);
    assert.equal(tokenFromFragment('#token=%20%20'), null);
  });

  it('does not read a token from the query string - only the fragment is a safe place for one', () => {
    assert.equal(tokenFromFragment('?token=abc'), null);
  });
});
