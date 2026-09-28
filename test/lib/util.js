const assert = require('assert');

const { timestamp } = require('../../src/lib/util');

describe('util timestamp', () => {
  it('is the date and time in UTC, to the second', () => {
    assert.strictEqual(
      timestamp(new Date('2026-09-28T10:47:03.456Z')),
      '2026-09-28 10:47:03'
    );
  });
});
