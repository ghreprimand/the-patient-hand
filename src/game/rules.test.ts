import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { makeState, makeTube } from './state';
import {
  applyPour,
  canPour,
  isStuck,
  isWin,
  pourAmount,
  undo,
} from './rules';

describe('canPour', () => {
  it('rejects same-tube pours', () => {
    const s = makeState(4, [makeTube(['a'])]);
    assert.equal(canPour(s, 0, 0), false);
  });

  it('rejects pours from an empty source', () => {
    const s = makeState(4, [makeTube([]), makeTube(['a'])]);
    assert.equal(canPour(s, 0, 1), false);
  });

  it('rejects pours into a full destination', () => {
    const s = makeState(4, [makeTube(['a']), makeTube(['a', 'a', 'a', 'a'])]);
    assert.equal(canPour(s, 0, 1), false);
  });

  it('rejects pours when top colors differ', () => {
    const s = makeState(4, [makeTube(['a', 'a']), makeTube(['b'])]);
    assert.equal(canPour(s, 0, 1), false);
  });

  it('accepts pour into empty', () => {
    const s = makeState(4, [makeTube(['a']), makeTube([])]);
    assert.equal(canPour(s, 0, 1), true);
  });

  it('accepts pour onto matching color', () => {
    const s = makeState(4, [makeTube(['a', 'a']), makeTube(['a'])]);
    assert.equal(canPour(s, 0, 1), true);
  });
});

describe('applyPour', () => {
  it('moves min(runLen, slack) tokens — full run when fits', () => {
    const before = makeState(4, [
      makeTube(['b', 'a', 'a', 'a']),
      makeTube([]),
    ]);
    const after = applyPour(before, 0, 1);
    assert.deepEqual([...after.tubes[0]!.tokens], ['b']);
    assert.deepEqual([...after.tubes[1]!.tokens], ['a', 'a', 'a']);
    assert.equal(after.history.length, 1);
    assert.deepEqual(after.history[0], { src: 0, dst: 1, amount: 3, liquid: 'a' });
  });

  it('clamps to destination slack', () => {
    const before = makeState(4, [
      makeTube(['a', 'a', 'a', 'a']),  // 4 of 'a'
      makeTube(['b', 'a']),            // 2 slack
    ]);
    const after = applyPour(before, 0, 1);
    // Only 2 'a's transfer (not all 4); src now has 2 left.
    assert.deepEqual([...after.tubes[0]!.tokens], ['a', 'a']);
    assert.deepEqual([...after.tubes[1]!.tokens], ['b', 'a', 'a', 'a']);
  });

  it('throws on illegal pour', () => {
    const s = makeState(4, [makeTube(['a']), makeTube(['b'])]);
    assert.throws(() => applyPour(s, 0, 1), /Illegal pour/);
  });

  it('pourAmount returns 0 for illegal pours, correct count otherwise', () => {
    const s1 = makeState(4, [makeTube(['a']), makeTube(['b'])]);
    assert.equal(pourAmount(s1, 0, 1), 0);
    const s2 = makeState(4, [
      makeTube(['b', 'a', 'a', 'a']),
      makeTube(['a']),
    ]);
    assert.equal(pourAmount(s2, 0, 1), 3);
  });
});

describe('undo', () => {
  it('returns null when history is empty', () => {
    const s = makeState(4, [makeTube(['a']), makeTube([])]);
    assert.equal(undo(s), null);
  });

  it('reverses the last pour exactly', () => {
    const before = makeState(4, [
      makeTube(['b', 'a', 'a']),
      makeTube(['a']),
    ]);
    const after = applyPour(before, 0, 1);
    const reverted = undo(after)!;
    assert.deepEqual([...reverted.tubes[0]!.tokens], [...before.tubes[0]!.tokens]);
    assert.deepEqual([...reverted.tubes[1]!.tokens], [...before.tubes[1]!.tokens]);
    assert.equal(reverted.history.length, 0);
  });
});

describe('win + stuck', () => {
  it('isWin true when every tube is solved', () => {
    const won = makeState(4, [
      makeTube([]),
      makeTube(['a', 'a', 'a', 'a']),
      makeTube(['b', 'b', 'b', 'b']),
    ]);
    assert.equal(isWin(won), true);
  });

  it('isWin false when any tube is partial-mixed', () => {
    const partial = makeState(4, [
      makeTube(['a', 'b']),
      makeTube(['a', 'a', 'a']),
    ]);
    assert.equal(isWin(partial), false);
  });

  it('isStuck true when no legal pour exists and not won', () => {
    // 2 tubes, both full of mixed colors, no slack to pour anywhere.
    const stuck = makeState(2, [
      makeTube(['a', 'b']),
      makeTube(['b', 'a']),
    ]);
    assert.equal(isWin(stuck), false);
    assert.equal(isStuck(stuck), true);
  });
});
