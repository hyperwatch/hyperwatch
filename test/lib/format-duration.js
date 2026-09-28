const assert = require('assert');

const { formatDuration } = require('../../src/lib/util');

describe('util formatDuration', () => {
  it('shows tenths of a second under a minute', () => {
    assert.strictEqual(formatDuration(0), '0.0s');
    assert.strictEqual(formatDuration(12345), '12.3s');
    assert.strictEqual(formatDuration(59400), '59.4s');
    assert.strictEqual(formatDuration(59600), '59.6s');
    assert.strictEqual(formatDuration(59940), '59.9s');
  });

  it('shows minutes and seconds under an hour', () => {
    assert.strictEqual(formatDuration(60000), '1m');
    assert.strictEqual(formatDuration(566000), '9m26s');
    // Rounding never gives 60.0s nor 60s
    assert.strictEqual(formatDuration(59960), '1m');
    assert.strictEqual(formatDuration(119600), '2m');
  });

  it('shows hours from an hour', () => {
    assert.strictEqual(formatDuration(555 * 60000 + 26000), '9h15m26s');
    assert.strictEqual(formatDuration(2 * 3600000), '2h');
    assert.strictEqual(formatDuration(2 * 3600000 + 5000), '2h5s');
    assert.strictEqual(formatDuration(30 * 3600000 + 60000), '30h1m');
  });
});
