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

  it('loads, edits and summarizes the documents "firewall-lists" and "firewall-lists.sync"', async () => {
    const storage = createMemoryStorage();
    const store = createStorageStore(storage);

    // Nothing stored yet
    assert.strictEqual(await firewall.load(store), false);

    storage.documents.set('firewall-lists', JSON.stringify(LISTS));
    assert.ok(await firewall.load(store));
    assert.ok(firewall.augment(log('1.1.1.1')).has('firewall'));

    await firewall.edit(store, 'block-ips', 'add', { value: '9.9.9.9' });
    assert.ok(firewall.augment(log('9.9.9.9')).has('firewall'));
    assert.deepStrictEqual(
      JSON.parse(storage.documents.get('firewall-lists')).lists[0].entries.map(
        (entry) => entry.value
      ),
      ['1.1.1.1', '9.9.9.9']
    );

    storage.documents.set(
      'firewall-lists.sync',
      JSON.stringify({
        lists: { 'block-ips': { rule_id: 'abc', values: ['1.1.1.1'] } },
      })
    );
    const [ips] = (await firewall.summary(store)).lists;
    assert.deepStrictEqual(ips.pending, { added: ['9.9.9.9'], removed: [] });
  });

  it('runs edits one after the other, so none is lost', async () => {
    const storage = createMemoryStorage();
    storage.documents.set('firewall-lists', JSON.stringify(LISTS));
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
      JSON.parse(storage.documents.get('firewall-lists')).lists[0].entries
        .length,
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

describe('firewall automatic Cloudflare sync', () => {
  const { createStorageStore } = require('../../src/lib/firewall/store');
  const { createMemoryStorage } = require('../helpers/memory-storage');

  const RULE = 'rule-ips';

  // A fake Cloudflare zone holding one IP rule
  function fakeCloudflare(values, expression) {
    const zone = {
      id: 'ruleset',
      rules: [
        {
          id: RULE,
          version: '3',
          action: 'block',
          description: 'Block IP blacklist',
          enabled: true,
          expression: expression || `(ip.src in {${values.join(' ')}})`,
        },
      ],
    };
    const patches = [];
    return {
      zone,
      patches,
      getEntrypoint: async () => JSON.parse(JSON.stringify(zone)),
      patchRule: async (rulesetId, ruleId, rule) => {
        patches.push(rule);
        const target = zone.rules.find((r) => r.id === ruleId);
        Object.assign(target, rule, {
          version: String(Number(target.version) + 1),
        });
        return JSON.parse(JSON.stringify(zone));
      },
    };
  }

  function stored(values, synced) {
    const storage = createMemoryStorage();
    storage.documents.set(
      'firewall-lists',
      JSON.stringify({
        lists: [
          {
            id: 'block-ips',
            type: 'ip',
            action: 'block',
            description: 'Block IP blacklist',
            cloudflare: { rule_id: RULE },
            entries: values.map((value) => ({ value })),
          },
        ],
      })
    );
    if (synced) {
      storage.documents.set(
        'firewall-lists.sync',
        JSON.stringify({
          lists: {
            'block-ips': { rule_id: RULE, version: '3', values: synced },
          },
        })
      );
    }
    return storage;
  }

  const storedValues = (storage) =>
    JSON.parse(storage.documents.get('firewall-lists'))
      .lists[0].entries.map((entry) => entry.value)
      .sort();

  let logs;
  let warnings;
  let original;

  beforeEach(() => {
    logs = [];
    warnings = [];
    original = { log: console.log, warn: console.warn };
    console.log = (...args) => logs.push(args.join(' '));
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  afterEach(() => {
    firewall.stopAutoSync();
    console.log = original.log;
    console.warn = original.warn;
  });

  it('reads its settings, off by default', () => {
    assert.deepStrictEqual(firewall.syncSettings({}), {
      auto: false,
      delay: 10,
      interval: 300,
    });
    assert.deepStrictEqual(
      firewall.syncSettings({
        sync: { auto: '1', delay: '2', interval: '0' },
      }),
      { auto: true, delay: 2, interval: 0 }
    );
    assert.strictEqual(
      firewall.syncSettings({ sync: { delay: 'soon' } }).delay,
      10
    );
    assert.strictEqual(warnings.length, 1);
  });

  it('pushes local changes up, and records the new base', async () => {
    const storage = stored(['1.1.1.1', '2.2.2.2'], ['1.1.1.1']);
    const cf = fakeCloudflare(['1.1.1.1']);

    await firewall.syncLists(createStorageStore(storage), cf, ['up']);

    assert.match(cf.zone.rules[0].expression, /1\.1\.1\.1 2\.2\.2\.2/);
    const state = JSON.parse(storage.documents.get('firewall-lists.sync'));
    assert.deepStrictEqual(state.lists['block-ips'].values.sort(), [
      '1.1.1.1',
      '2.2.2.2',
    ]);
    assert.match(
      logs.join('\n'),
      /sync up block-ips: \+2\.2\.2\.2 \(rule v4\)/
    );
  });

  it('brings Cloudflare changes down, and matches them right away', async () => {
    const storage = stored(['1.1.1.1'], ['1.1.1.1']);
    const cf = fakeCloudflare(['1.1.1.1', '3.3.3.3']);
    const store = createStorageStore(storage);
    await firewall.load(store);

    await firewall.syncLists(store, cf, ['down', 'up']);

    assert.deepStrictEqual(storedValues(storage), ['1.1.1.1', '3.3.3.3']);
    assert.ok(firewall.augment(log('3.3.3.3')).has('firewall'));
    assert.strictEqual(cf.patches.length, 0);
  });

  it("reports a list it won't touch, without failing", async () => {
    const storage = stored(['1.1.1.1'], ['1.1.1.1']);
    const cf = fakeCloudflare(
      [],
      '(ip.src in {1.1.1.1}) or (http.host eq "x")'
    );

    await firewall.syncLists(createStorageStore(storage), cf, ['up']);

    assert.strictEqual(cf.patches.length, 0);
    assert.match(warnings.join('\n'), /sync up block-ips skipped/);
  });

  it('syncs up shortly after an edit, a burst of edits at once', async () => {
    const storage = stored(['1.1.1.1'], ['1.1.1.1']);
    const cf = fakeCloudflare(['1.1.1.1']);
    const store = createStorageStore(storage);
    await firewall.load(store);
    firewall.startAutoSync(store, cf, { delay: 0.05, interval: 0 });
    // The full sync after start
    await new Promise((resolve) => setTimeout(resolve, 80));

    await firewall.edit(store, 'block-ips', 'add', { value: '4.4.4.4' });
    await firewall.edit(store, 'block-ips', 'add', { value: '5.5.5.5' });
    assert.strictEqual(cf.patches.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.strictEqual(cf.patches.length, 1);
    assert.match(cf.zone.rules[0].expression, /4\.4\.4\.4 5\.5\.5\.5/);
  });
});

describe('firewall lists from the configuration', () => {
  const constants = require('../../src/constants');
  const monitoring = require('../../src/lib/monitoring');
  const { createStorageStore } = require('../../src/lib/firewall/store');
  const { createMemoryStorage } = require('../helpers/memory-storage');

  const RULE = 'rule-ips';
  const DEFINITIONS = [
    {
      id: 'block-ips',
      type: 'ip',
      action: 'block',
      description: 'Block IP blacklist',
      cloudflare: { rule_id: RULE },
    },
    { id: 'monitor-ips', type: 'ip', action: 'monitor' },
  ];

  function fakeCloudflare(values) {
    const zone = {
      id: 'ruleset',
      rules: [
        {
          id: RULE,
          version: '7',
          action: 'block',
          description: 'Block IP blacklist',
          enabled: true,
          expression: `(ip.src in {${values.join(' ')}})`,
        },
      ],
    };
    return {
      zone,
      getEntrypoint: async () => JSON.parse(JSON.stringify(zone)),
      patchRule: async () => assert.fail('nothing to push'),
    };
  }

  let config;
  let original;

  beforeEach(() => {
    config = constants.modules.firewall;
    constants.modules.firewall = { ...config, lists: DEFINITIONS };
    original = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = () => {};
  });

  afterEach(() => {
    firewall.stopAutoSync();
    constants.modules.firewall = config;
    console.log = original.log;
    console.warn = original.warn;
  });

  it('starts from the configured lists, then gets the entries from Cloudflare', async () => {
    const storage = createMemoryStorage();
    const store = createStorageStore(storage);

    assert.ok(await firewall.load(store));
    assert.deepStrictEqual(
      (await firewall.summary(store)).lists.map((list) => list.id),
      ['block-ips', 'monitor-ips']
    );
    assert.strictEqual(storage.documents.has('firewall-lists'), false);

    await firewall.syncLists(store, fakeCloudflare(['1.1.1.1', '2.2.2.2']), [
      'down',
      'up',
    ]);
    const stored = JSON.parse(storage.documents.get('firewall-lists'));
    assert.deepStrictEqual(
      stored.lists[0].entries.map((entry) => entry.value),
      ['1.1.1.1', '2.2.2.2']
    );
    assert.strictEqual(stored.lists[1].id, 'monitor-ips');
    assert.ok(storage.documents.has('firewall-lists.sync'));
    assert.ok(firewall.augment(log('2.2.2.2')).has('firewall'));
  });

  it('adds configured lists the stored ones lack, and keeps the stored ones', async () => {
    const storage = createMemoryStorage();
    storage.documents.set(
      'firewall-lists',
      JSON.stringify({
        lists: [
          {
            id: 'block-ips',
            type: 'ip',
            action: 'monitor',
            entries: [{ value: '9.9.9.9' }],
          },
        ],
      })
    );
    const { lists } = await firewall.summary(createStorageStore(storage));
    assert.deepStrictEqual(
      lists.map((list) => [list.id, list.action, list.entries.length]),
      [
        ['block-ips', 'monitor', 1],
        ['monitor-ips', 'monitor', 0],
      ]
    );
  });

  it('has no lists with nothing stored and nothing configured', async () => {
    constants.modules.firewall = { ...config, lists: [] };
    assert.strictEqual(
      await firewall.load(createStorageStore(createMemoryStorage())),
      false
    );
  });

  it('rejects invalid definitions', () => {
    assert.throws(() =>
      firewall.configuredLists({ lists: [{ id: 'x', type: 'nope' }] })
    );
  });

  it('shows the latest sync on /status', async () => {
    const store = createStorageStore(createMemoryStorage());
    firewall.startAutoSync(store, fakeCloudflare(['1.1.1.1']), {
      delay: 0.01,
      interval: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const entry = monitoring.items.find(
      (item) => item.name === 'firewall sync'
    );
    assert.match(
      entry.status,
      /^down, up at \d{4}-.*: down block-ips \+1\.1\.1\.1$/
    );
    assert.deepStrictEqual(entry.firewallSync.results, [
      { direction: 'down', list: 'block-ips', change: '+1.1.1.1' },
    ]);
  });
});

describe('firewall review fixes', () => {
  const { Persistence } = require('../../src/lib/persistence');
  const { createStorageStore } = require('../../src/lib/firewall/store');
  const { createMemoryStorage } = require('../helpers/memory-storage');

  const LISTS = {
    lists: [{ id: 'block-ips', type: 'ip', action: 'block', entries: [] }],
  };

  let original;

  beforeEach(() => {
    original = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = () => {};
  });

  afterEach(() => {
    firewall.stopAutoSync();
    firewall.resume();
    console.log = original.log;
    console.warn = original.warn;
  });

  it("doesn't share a document with the persisted firewall aggregator", async () => {
    const storage = createMemoryStorage();
    const store = createStorageStore(storage);
    await store.writeLists(LISTS);

    // What persistence does with api.registerAggregator('firewall', …)
    const persistence = new Persistence();
    persistence.setStorage(storage);
    persistence.register('firewall', { dump: () => [], load() {} });
    await persistence.dump();

    assert.strictEqual((await store.readLists()).lists[0].id, 'block-ips');
  });

  it('stops syncing when Hyperwatch stops', async () => {
    let calls = 0;
    const client = {
      getEntrypoint: async () => {
        calls++;
        return { id: 'ruleset', rules: [] };
      },
      patchRule: async () => assert.fail('no sync after stop'),
    };
    const storage = createMemoryStorage();
    storage.documents.set('firewall-lists', JSON.stringify(LISTS));
    firewall.startAutoSync(createStorageStore(storage), client, {
      delay: 0.03,
      interval: 0.03,
    });
    await firewall.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(calls, 0);
  });

  it('finishes the edit in progress before stopping, and refuses new ones', async () => {
    const storage = createMemoryStorage();
    storage.documents.set('firewall-lists', JSON.stringify(LISTS));
    const events = [];
    let writing;
    const started = new Promise((resolve) => {
      writing = resolve;
    });
    const write = storage.write;
    storage.write = async (...args) => {
      writing();
      await new Promise((resolve) => setTimeout(resolve, 30));
      await write(...args);
      events.push('written');
    };
    const store = createStorageStore(storage);

    const edit = firewall.edit(store, 'block-ips', 'add', {
      value: '6.6.6.6',
    });
    await started;
    const stopping = firewall.stop();
    await assert.rejects(
      firewall.edit(store, 'block-ips', 'add', { value: '7.7.7.7' }),
      /stopping, edit refused/
    );
    await stopping;
    events.push('stopped');
    await edit;
    assert.deepStrictEqual(events, ['written', 'stopped']);
  });

  it('gives up on a stalled storage operation', async () => {
    const storage = createMemoryStorage();
    // Never answers: only an abort ends it
    storage.read = (name, { signal } = {}) =>
      new Promise((resolve, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => reject(signal.reason));
        }
      });
    const store = createStorageStore(storage, { timeout: 20 });
    await assert.rejects(store.readState());
    await assert.rejects(store.readLists());
  });

  it("doesn't pile up periodic syncs, nor run queued ones after stop", async () => {
    let calls = 0;
    const client = {
      getEntrypoint: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { id: 'ruleset', rules: [] };
      },
      patchRule: async () => assert.fail('nothing to push'),
    };
    const storage = createMemoryStorage();
    storage.documents.set('firewall-lists', JSON.stringify(LISTS));
    firewall.startAutoSync(createStorageStore(storage), client, {
      delay: 0.005,
      interval: 0.005,
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    firewall.stopAutoSync();
    const atStop = calls;
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The full sync in progress may finish (down, then up): nothing queued
    assert.ok(calls <= atStop + 2, `${calls - atStop} calls after stop`);
  });

  it('matches the lists a sync wrote, even if saving its state fails', async () => {
    const storage = createMemoryStorage();
    storage.documents.set(
      'firewall-lists',
      JSON.stringify({
        lists: [
          {
            id: 'block-ips',
            type: 'ip',
            action: 'block',
            cloudflare: { rule_id: 'rule-ips' },
            entries: [],
          },
        ],
      })
    );
    const store = createStorageStore(storage);
    store.writeState = async () => {
      throw new Error('storage down');
    };
    const client = {
      getEntrypoint: async () => ({
        id: 'ruleset',
        rules: [
          {
            id: 'rule-ips',
            version: '1',
            action: 'block',
            enabled: true,
            expression: '(ip.src in {7.7.7.7})',
          },
        ],
      }),
      patchRule: async () => assert.fail('nothing to push'),
    };
    await firewall.load(store);

    await assert.rejects(
      firewall.syncLists(store, client, ['down']),
      /storage down/
    );
    assert.ok(firewall.augment(log('7.7.7.7')).has('firewall'));
  });

  it('waits for the delay before the first periodic sync', async () => {
    let calls = 0;
    const client = {
      getEntrypoint: async () => {
        calls++;
        return { id: 'ruleset', rules: [] };
      },
      patchRule: async () => assert.fail('nothing to push'),
    };
    const storage = createMemoryStorage();
    storage.documents.set('firewall-lists', JSON.stringify(LISTS));
    firewall.startAutoSync(createStorageStore(storage), client, {
      delay: 0.1,
      interval: 0.01,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(calls, 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(calls > 0);
  });

  it('answers a lookup for a user agent named __proto__', () => {
    const result = firewall.lookup({ user_agents: ['__proto__'] });
    assert.ok(
      Object.prototype.hasOwnProperty.call(result.user_agents, '__proto__')
    );
    assert.strictEqual(
      Object.getPrototypeOf(result.user_agents),
      Object.prototype
    );
  });

  it('stops watching the file when closed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firewall-watch-'));
    const file = path.join(dir, 'firewall.json');
    fs.writeFileSync(file, JSON.stringify(LISTS));
    const store = createFileStore({ file });
    let changes = 0;
    store.watch(() => changes++, 10);
    await store.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fs.writeFileSync(file, JSON.stringify({ lists: [] }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(changes, 0);
    fs.rmSync(dir, { recursive: true });
  });

  it('gives up on a storage call that ignores its abort', async () => {
    const storage = createMemoryStorage();
    // Stalls forever, abort or not (like resolving S3 credentials)
    storage.read = () => new Promise(() => {});
    storage.write = () => new Promise(() => {});
    const store = createStorageStore(storage, { timeout: 20 });
    await assert.rejects(store.readLists());
    await assert.rejects(store.readState());
    await assert.rejects(store.writeLists(LISTS));
  });

  it('matches the lists after a sync when the first load failed', async () => {
    const storage = createMemoryStorage();
    storage.documents.set(
      'firewall-lists',
      JSON.stringify({
        lists: [
          {
            id: 'block-ips',
            type: 'ip',
            action: 'block',
            cloudflare: { rule_id: 'rule-ips' },
            entries: [{ value: '8.8.4.4' }],
          },
        ],
      })
    );
    storage.documents.set(
      'firewall-lists.sync',
      JSON.stringify({
        lists: {
          'block-ips': {
            rule_id: 'rule-ips',
            version: '1',
            values: ['8.8.4.4'],
          },
        },
      })
    );
    const read = storage.read;
    let failing = true;
    storage.read = (...args) =>
      failing ? Promise.reject(new Error('storage down')) : read(...args);
    const store = createStorageStore(storage);
    const client = {
      getEntrypoint: async () => ({
        id: 'ruleset',
        rules: [
          {
            id: 'rule-ips',
            version: '1',
            action: 'block',
            enabled: true,
            expression: '(ip.src in {8.8.4.4})',
          },
        ],
      }),
      patchRule: async () => assert.fail('in sync, nothing to push'),
    };

    assert.strictEqual(await firewall.load(store), false);
    assert.strictEqual(firewall.augment(log('8.8.4.4')).has('firewall'), false);

    failing = false;
    await firewall.syncLists(store, client, ['down', 'up']);
    assert.ok(firewall.augment(log('8.8.4.4')).has('firewall'));
  });

  it('opens again when Hyperwatch starts after a stop', async () => {
    const constants = require('../../src/constants');
    const config = constants.modules.firewall;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firewall-restart-'));
    const file = path.join(dir, 'firewall.json');
    fs.writeFileSync(file, JSON.stringify(LISTS));
    constants.modules.firewall = { ...config, path: file, backend: 'file' };
    try {
      await firewall.stop();
      await assert.rejects(
        firewall.edit(createFileStore({ file }), 'block-ips', 'add', {
          value: '3.3.3.3',
        }),
        /stopping/
      );

      firewall.start();
      await firewall.ready();
      await firewall.edit(createFileStore({ file }), 'block-ips', 'add', {
        value: '3.3.3.3',
      });
      // The module's own store is open again, on the configured file
      const { lists } = await firewall.summary();
      assert.deepStrictEqual(
        lists[0].entries.map((entry) => entry.value),
        ['3.3.3.3']
      );
    } finally {
      await firewall.stop();
      firewall.resume();
      constants.modules.firewall = config;
      fs.rmSync(dir, { recursive: true });
    }
  });
});
