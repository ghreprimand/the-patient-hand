import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { type Level, loadLevel, validateLevel } from './level';

const goodLevel: Level = {
  id: '001',
  chapter: 1,
  name: 'First Lesson',
  capacity: 4,
  tubes: [
    ['a', 'b', 'a', 'b'],
    ['b', 'a', 'b', 'a'],
    [],
    [],
  ],
  optimalMoves: 4,
  author: 'house',
};

describe('validateLevel', () => {
  it('accepts a well-formed level', () => {
    assert.doesNotThrow(() => validateLevel(goodLevel));
  });

  it('rejects capacity < 2', () => {
    assert.throws(() => validateLevel({ ...goodLevel, capacity: 1 }), /capacity/);
  });

  it('rejects fewer than 2 tubes', () => {
    assert.throws(
      () => validateLevel({ ...goodLevel, tubes: [['a', 'b', 'a', 'b']] }),
      /at least 2 tubes/,
    );
  });

  it('rejects a tube larger than capacity', () => {
    assert.throws(
      () =>
        validateLevel({
          ...goodLevel,
          tubes: [['a', 'a', 'a', 'a', 'a'], ['b', 'b', 'b', 'b'], []],
        }),
      /capacity is 4/,
    );
  });

  it('rejects a color count != capacity', () => {
    assert.throws(
      () =>
        validateLevel({
          ...goodLevel,
          tubes: [
            ['a', 'b', 'a'],     // 2 'a's, 1 'b'
            ['b', 'a', 'b', 'a'], // 2 'a's, 2 'b's
            [],
            [],
          ],
        }),
      /appears \d+ times/,
    );
  });

  it('rejects an all-full layout (no room to pour)', () => {
    assert.throws(
      () =>
        validateLevel({
          ...goodLevel,
          tubes: [
            ['a', 'a', 'a', 'a'],
            ['b', 'b', 'b', 'b'],
          ],
        }),
      /no room/,
    );
  });
});

describe('loadLevel', () => {
  it('returns a GameState that mirrors the level layout', () => {
    const s = loadLevel(goodLevel);
    assert.equal(s.capacity, 4);
    assert.equal(s.tubes.length, 4);
    assert.deepEqual([...s.tubes[0]!.tokens], ['a', 'b', 'a', 'b']);
    assert.deepEqual([...s.tubes[2]!.tokens], []);
    assert.equal(s.history.length, 0);
  });
});
