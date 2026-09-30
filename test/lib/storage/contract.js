/**
 * Contract every persistence storage follows (see src/lib/storage). Backends
 * run it with their own factory:
 *
 *   storageContract('s3', () => createS3Storage({ ... }));
 */
const assert = require('assert');

function storageContract(name, factory, { cleanup } = {}) {
  describe(`storage contract: ${name}`, () => {
    let storage;

    beforeEach(async () => {
      storage = await factory();
    });

    afterEach(async () => {
      await storage.close();
      if (cleanup) {
        await cleanup(storage);
      }
    });

    it('has a name', () => {
      assert.strictEqual(typeof storage.name, 'string');
    });

    it('reads null for a missing document', async () => {
      assert.strictEqual(await storage.read('missing'), null);
    });

    it('reads what was written', async () => {
      await storage.write('doc', '[{"a":1}]');
      assert.strictEqual(await storage.read('doc'), '[{"a":1}]');
    });

    it('keeps the body as is, including non-ASCII characters', async () => {
      const body = JSON.stringify([{ city: 'Zürich', emoji: '🦉' }]);
      await storage.write('unicode', body);
      assert.strictEqual(await storage.read('unicode'), body);
    });

    it('overwrites a document', async () => {
      await storage.write('doc', '[1]');
      await storage.write('doc', '[2]');
      assert.strictEqual(await storage.read('doc'), '[2]');
    });

    it('keeps documents separate', async () => {
      await storage.write('doc-a', '["a"]');
      await storage.write('doc.b_c', '["b"]');
      assert.strictEqual(await storage.read('doc-a'), '["a"]');
      assert.strictEqual(await storage.read('doc.b_c'), '["b"]');
    });

    it("doesn't store a write aborted before it starts", async () => {
      await storage.write('doc', '[1]');
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        storage.write('doc', '[2]', { signal: controller.signal })
      );
      assert.strictEqual(await storage.read('doc'), '[1]');
    });

    it('closes', async () => {
      await storage.close();
    });
  });
}

module.exports = { storageContract };
