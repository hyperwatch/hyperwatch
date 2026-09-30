const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createFileStorage,
  directory,
} = require('../../../src/lib/storage/file');

const { storageContract } = require('./contract');

const tmpDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'hyperwatch-storage-'));

storageContract('file', () => createFileStorage({ path: tmpDir() }), {
  cleanup: (storage) =>
    fs.rmSync(storage.dir, { recursive: true, force: true }),
});

describe('file storage', () => {
  let base;

  beforeEach(() => {
    base = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('writes <path>/<namespace>/<name>.json, as before', async () => {
    const storage = createFileStorage({ path: base, namespace: 'api' });
    await storage.write('addresses', '[]');
    assert.strictEqual(
      fs.readFileSync(path.join(base, 'api', 'addresses.json'), 'utf8'),
      '[]'
    );
    assert.ok(!fs.existsSync(path.join(base, 'api', 'addresses.json.tmp')));
  });

  it('defaults to .hyperwatch-data in the current directory', () => {
    assert.strictEqual(
      directory({}),
      path.join(process.cwd(), '.hyperwatch-data')
    );
  });

  it("doesn't rename a write aborted while it was written", async () => {
    const storage = createFileStorage({ path: base });
    await storage.write('doc', '[1]');
    const controller = new AbortController();
    const write = storage.write('doc', '[2]', { signal: controller.signal });
    controller.abort();
    await assert.rejects(write);
    assert.strictEqual(await storage.read('doc'), '[1]');
  });
});
