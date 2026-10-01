const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fromJS } = require('immutable');

const { createFileStore } = require('../../src/lib/firewall/store');
const firewall = require('../../src/modules/firewall');

function writeLists(file, entries) {
  fs.writeFileSync(
    file,
    JSON.stringify({
      lists: [
        {
          id: 'block-ips',
          type: 'ip',
          action: 'block',
          entries: entries.map((value) => ({ value })),
        },
        {
          id: 'monitor-uas',
          type: 'user_agent',
          action: 'monitor',
          entries: [{ value: 'BadBot/1.0' }],
        },
      ],
    })
  );
}

const log = (address, ua = 'Mozilla/5.0') =>
  fromJS({
    address: { value: address },
    request: { address, headers: { 'user-agent': ua } },
  });

describe('firewall module', () => {
  let dir;
  let file;
  let store;
  let warn;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firewall-'));
    file = path.join(dir, 'firewall.json');
    store = createFileStore({ file });
    warn = console.warn;
    console.warn = () => {};
  });

  afterEach(() => {
    console.warn = warn;
    fs.rmSync(dir, { recursive: true });
  });

  it('tags matching logs with the list, action and value', async () => {
    writeLists(file, ['1.2.3.4']);
    assert.ok(await firewall.load(store));

    const blocked = firewall.augment(log('1.2.3.4'));
    assert.deepStrictEqual(blocked.get('firewall').toJS(), {
      list: 'block-ips',
      action: 'block',
      value: '1.2.3.4',
    });

    const monitored = firewall.augment(log('5.5.5.5', 'BadBot/1.0'));
    assert.strictEqual(monitored.getIn(['firewall', 'list']), 'monitor-uas');

    assert.strictEqual(firewall.augment(log('5.5.5.5')).has('firewall'), false);
  });

  it('keeps the previous lists when the file becomes invalid', async () => {
    writeLists(file, ['1.2.3.4']);
    assert.ok(await firewall.load(store));

    fs.writeFileSync(file, '{ not json');
    assert.strictEqual(await firewall.load(store), false);
    assert.ok(firewall.augment(log('1.2.3.4')).has('firewall'));

    writeLists(file, ['10.0.0.1/8']);
    assert.strictEqual(await firewall.load(store), false);
    assert.ok(firewall.augment(log('1.2.3.4')).has('firewall'));
  });

  it('picks up a valid change', async () => {
    writeLists(file, ['1.2.3.4']);
    await firewall.load(store);
    writeLists(file, ['9.9.9.9']);
    assert.ok(await firewall.load(store));
    assert.strictEqual(firewall.augment(log('1.2.3.4')).has('firewall'), false);
    assert.ok(firewall.augment(log('9.9.9.9')).has('firewall'));
  });

  it('looks up addresses and user agents', async () => {
    writeLists(file, ['10.0.0.0/8']);
    await firewall.load(store);
    assert.deepStrictEqual(
      firewall.lookup({
        addresses: ['10.1.2.3', '1.1.1.1'],
        user_agents: ['BadBot/1.0'],
      }),
      {
        addresses: {
          '10.1.2.3': {
            list: 'block-ips',
            action: 'block',
            value: '10.0.0.0/8',
          },
          '1.1.1.1': null,
        },
        user_agents: {
          'BadBot/1.0': {
            list: 'monitor-uas',
            action: 'monitor',
            value: 'BadBot/1.0',
          },
        },
      }
    );
  });

  it('adds and removes entries and reloads', async () => {
    writeLists(file, ['1.2.3.4']);
    await firewall.load(store);

    await firewall.edit(store, 'block-ips', 'add', {
      value: '9.9.9.9',
      reason: 'spam',
      source: 'dashboard',
    });
    assert.ok(firewall.augment(log('9.9.9.9')).has('firewall'));
    const entry = (await firewall.summary(store)).lists[0].entries.find(
      (e) => e.value === '9.9.9.9'
    );
    assert.strictEqual(entry.reason, 'spam');
    assert.strictEqual(entry.source, 'dashboard');

    await firewall.edit(store, 'block-ips', 'remove', { value: '9.9.9.9' });
    assert.strictEqual(firewall.augment(log('9.9.9.9')).has('firewall'), false);

    await assert.rejects(
      firewall.edit(store, 'nope', 'add', { value: '1.1.1.1' })
    );
    await assert.rejects(
      firewall.edit(store, 'block-ips', 'add', { value: 'x' })
    );
  });

  it('reports entries pending a Cloudflare sync', async () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        lists: [
          {
            id: 'block-ips',
            type: 'ip',
            action: 'block',
            cloudflare: { rule_id: 'abc' },
            entries: [{ value: '1.1.1.1' }, { value: '2.2.2.2' }],
          },
          {
            id: 'block-uas',
            type: 'user_agent',
            action: 'block',
            cloudflare: { rule_id: 'def' },
            entries: [{ value: 'BadBot/1.0' }],
          },
        ],
      })
    );
    fs.writeFileSync(
      path.join(dir, 'firewall.sync.json'),
      JSON.stringify({
        lists: {
          'block-ips': { rule_id: 'abc', values: ['1.1.1.1', '3.3.3.3'] },
        },
      })
    );
    const [ips, uas] = (await firewall.summary(store)).lists;
    assert.deepStrictEqual(ips.pending, {
      added: ['2.2.2.2'],
      removed: ['3.3.3.3'],
    });
    assert.strictEqual(uas.pending, null);
  });
});

describe('firewall lists in a persistence storage', () => {
  const { createStorageStore } = require('../../src/lib/firewall/store');
  const { createMemoryStorage } = require('../helpers/memory-storage');

  const LISTS = {
    lists: [
      {
        id: 'block-ips',
        type: 'ip',
        action: 'block',
        cloudflare: { rule_id: 'abc' },
        entries: [{ value: '1.1.1.1' }],
      },
    ],
  };

  let warn;

  beforeEach(() => {
    warn = console.warn;
    console.warn = () => {};
  });

  afterEach(() => {
    console.warn = warn;
  });

  it('loads, edits and summarizes the documents "firewall" and "firewall.sync"', async () => {
    const storage = createMemoryStorage();
    const store = createStorageStore(storage);

    // Nothing stored yet
    assert.strictEqual(await firewall.load(store), false);

    storage.documents.set('firewall', JSON.stringify(LISTS));
    assert.ok(await firewall.load(store));
    assert.ok(firewall.augment(log('1.1.1.1')).has('firewall'));

    await firewall.edit(store, 'block-ips', 'add', { value: '9.9.9.9' });
    assert.ok(firewall.augment(log('9.9.9.9')).has('firewall'));
    assert.deepStrictEqual(
      JSON.parse(storage.documents.get('firewall')).lists[0].entries.map(
        (entry) => entry.value
      ),
      ['1.1.1.1', '9.9.9.9']
    );

    storage.documents.set(
      'firewall.sync',
      JSON.stringify({
        lists: { 'block-ips': { rule_id: 'abc', values: ['1.1.1.1'] } },
      })
    );
    const [ips] = (await firewall.summary(store)).lists;
    assert.deepStrictEqual(ips.pending, { added: ['9.9.9.9'], removed: [] });
  });

  it('runs edits one after the other, so none is lost', async () => {
    const storage = createMemoryStorage();
    storage.documents.set('firewall', JSON.stringify(LISTS));
    const write = storage.write;
    storage.write = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return write(...args);
    };
    const store = createStorageStore(storage);

    await Promise.all(
      ['2.2.2.2', '3.3.3.3', '4.4.4.4'].map((value) =>
        firewall.edit(store, 'block-ips', 'add', { value })
      )
    );
    assert.strictEqual(
      JSON.parse(storage.documents.get('firewall')).lists[0].entries.length,
      4
    );
  });
});

describe('firewall store', () => {
  const { createStore } = require('../../src/lib/firewall/store');

  const config = (firewall, persistence) => ({
    modules: { firewall },
    persistence,
  });

  it('keeps the lists in a local file by default', () => {
    const store = createStore(config({ path: '/tmp/lists.json' }, {}));
    assert.strictEqual(store.name, 'file');
    assert.strictEqual(store.where, '/tmp/lists.json');
    assert.strictEqual(store.stateWhere, '/tmp/lists.sync.json');
  });

  it('follows the persistence backend, unless the firewall sets its own', async () => {
    const s3 = { backend: 's3', namespace: 'all', s3: { bucket: 'b' } };
    const store = createStore(config({}, s3));
    assert.strictEqual(store.name, 's3');
    await store.close();

    assert.strictEqual(
      createStore(config({ backend: 'file' }, s3)).name,
      'file'
    );
  });

  it('checks the backend configuration', () => {
    assert.throws(
      () => createStore(config({}, { backend: 's3', s3: {} })),
      /persistence\.s3\.bucket is required/
    );
    assert.throws(
      () => createStore(config({ backend: 'nope' }, {})),
      /Unknown firewall backend "nope"/
    );
  });
});
