/* eslint-env mocha */

const assert = require('assert');

const cache = require('../../src/lib/cache');

describe('Cache', () => {
  it('has, get, set, del and clear', async () => {
    const sampleKey = 'sample_key';
    const sampleValue = 'barrel';

    const hasInitialValue = await cache.has(sampleKey);
    assert.equal(hasInitialValue, false);

    const initialValue = await cache.get(sampleKey);
    assert.equal(initialValue, null);

    await cache.set(sampleKey, sampleValue);

    const hasSetValue = await cache.has(sampleKey);
    assert.equal(hasSetValue, true);

    const setValue = await cache.get(sampleKey);
    assert.equal(setValue, sampleValue);

    await cache.del(sampleKey);

    const deleteValue = await cache.get(sampleKey);
    assert.equal(deleteValue, null);

    await cache.set(sampleKey, sampleValue);

    await cache.clear();

    const clearValue = await cache.get(sampleKey);
    assert.equal(clearValue, null);
  });
});
