import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  isEmpty,
  isFull,
  isSolvedTube,
  makeState,
  makeTube,
  topOf,
  topRunLength,
} from './state';

describe('state queries', () => {
  it('topOf returns null for empty tube and last token otherwise', () => {
    assert.equal(topOf(makeTube([])), null);
    assert.equal(topOf(makeTube(['cinnabar'])), 'cinnabar');
    assert.equal(topOf(makeTube(['lapis', 'cinnabar'])), 'cinnabar');
  });

  it('topRunLength counts only contiguous top-color tokens', () => {
    assert.equal(topRunLength(makeTube([])), 0);
    assert.equal(topRunLength(makeTube(['cinnabar'])), 1);
    assert.equal(topRunLength(makeTube(['cinnabar', 'cinnabar'])), 2);
    assert.equal(
      topRunLength(makeTube(['lapis', 'lapis', 'cinnabar', 'cinnabar', 'cinnabar'])),
      3,
    );
    assert.equal(
      topRunLength(makeTube(['cinnabar', 'lapis', 'cinnabar'])),
      1,
    );
  });

  it('isEmpty / isFull track tube length against capacity', () => {
    const s = makeState(4, [makeTube([]), makeTube(['a', 'a', 'a', 'a']), makeTube(['a'])]);
    assert.equal(isEmpty(s.tubes[0]!), true);
    assert.equal(isEmpty(s.tubes[1]!), false);
    assert.equal(isFull(s, s.tubes[0]!), false);
    assert.equal(isFull(s, s.tubes[1]!), true);
    assert.equal(isFull(s, s.tubes[2]!), false);
  });

  it('isSolvedTube: empty OR full of single color', () => {
    const s = makeState(4, [
      makeTube([]),
      makeTube(['a', 'a', 'a', 'a']),
      makeTube(['a', 'a']),                  // partial — not solved
      makeTube(['a', 'a', 'a', 'b']),        // full but mixed — not solved
    ]);
    assert.equal(isSolvedTube(s, s.tubes[0]!), true);
    assert.equal(isSolvedTube(s, s.tubes[1]!), true);
    assert.equal(isSolvedTube(s, s.tubes[2]!), false);
    assert.equal(isSolvedTube(s, s.tubes[3]!), false);
  });
});
