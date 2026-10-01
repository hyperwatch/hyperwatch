const assert = require('assert');

const { parseNumber } = require('../../src/lib/util');

describe('parseNumber', () => {
  it('reads numbers and decimal strings', () => {
    assert.strictEqual(parseNumber(20), 20);
    assert.strictEqual(parseNumber('20'), 20);
    assert.strictEqual(parseNumber(' 20 '), 20);
    assert.strictEqual(parseNumber('0.05'), 0.05);
    assert.strictEqual(parseNumber('.5'), 0.5);
    assert.strictEqual(parseNumber('-3'), -3);
    assert.strictEqual(parseNumber(0), 0);
  });

  it("doesn't read what Number() would turn into a number", () => {
    for (const value of [
      false,
      true,
      null,
      undefined,
      '',
      ' ',
      [],
      [0],
      [20],
      {},
      '0x10',
      '1e2',
      'Infinity',
      Infinity,
      NaN,
    ]) {
      assert.strictEqual(parseNumber(value), null, String(value));
    }
  });

  it('checks integer, min and max', () => {
    assert.strictEqual(parseNumber(1.5, { integer: true }), null);
    assert.strictEqual(parseNumber('20.0', { integer: true }), 20);
    assert.strictEqual(parseNumber(-1, { min: 0 }), null);
    assert.strictEqual(parseNumber(0, { min: 0 }), 0);
    assert.strictEqual(parseNumber(11, { max: 10 }), null);
    assert.strictEqual(parseNumber('10', { max: 10 }), 10);
  });
});
