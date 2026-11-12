const assert = require('assert');

const { LRUCache } = require('lru-cache');

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

  describe('ttl', () => {
    const originalSet = LRUCache.prototype.set;
    /** @type {any[]} */
    let options;

    beforeEach(() => {
      options = [];
      LRUCache.prototype.set = function (key, value, setOptions) {
        options.push(setOptions);
        return originalSet.call(this, key, value, setOptions);
      };
    });

    afterEach(async () => {
      LRUCache.prototype.set = originalSet;
      await cache.clear();
    });

    it('passes no ttl without ttlInSeconds, or with 0', async () => {
      await cache.set('no-ttl', 'value');
      await cache.set('zero-ttl', 'value', 0);
      assert.deepStrictEqual(options, [undefined, undefined]);
      assert.strictEqual(await cache.get('no-ttl'), 'value');
    });

    it('expires an entry after ttlInSeconds', async () => {
      await cache.set('short', 'value', 0.02);
      assert.strictEqual(options.length, 1);
      assert.strictEqual(options[0].ttl, 20);
      assert.strictEqual(await cache.get('short'), 'value');
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.strictEqual(await cache.get('short'), undefined);
    });
  });
});
