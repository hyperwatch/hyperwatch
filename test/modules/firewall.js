const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fromJS } = require('immutable');

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
  let warn;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firewall-'));
    file = path.join(dir, 'firewall.json');
    warn = console.warn;
    console.warn = () => {};
  });

  afterEach(() => {
    console.warn = warn;
    fs.rmSync(dir, { recursive: true });
  });

  it('tags matching logs with the list, action and value', () => {
    writeLists(file, ['1.2.3.4']);
    assert.ok(firewall.load(file));

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

  it('keeps the previous lists when the file becomes invalid', () => {
    writeLists(file, ['1.2.3.4']);
    assert.ok(firewall.load(file));

    fs.writeFileSync(file, '{ not json');
    assert.strictEqual(firewall.load(file), false);
    assert.ok(firewall.augment(log('1.2.3.4')).has('firewall'));

    writeLists(file, ['10.0.0.1/8']);
    assert.strictEqual(firewall.load(file), false);
    assert.ok(firewall.augment(log('1.2.3.4')).has('firewall'));
  });

  it('picks up a valid change', () => {
    writeLists(file, ['1.2.3.4']);
    firewall.load(file);
    writeLists(file, ['9.9.9.9']);
    assert.ok(firewall.load(file));
    assert.strictEqual(firewall.augment(log('1.2.3.4')).has('firewall'), false);
    assert.ok(firewall.augment(log('9.9.9.9')).has('firewall'));
  });

  it('looks up addresses and user agents', () => {
    writeLists(file, ['10.0.0.0/8']);
    firewall.load(file);
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

  it('adds and removes entries and reloads', () => {
    writeLists(file, ['1.2.3.4']);
    firewall.load(file);

    firewall.edit(file, 'block-ips', 'add', {
      value: '9.9.9.9',
      reason: 'spam',
      source: 'dashboard',
    });
    assert.ok(firewall.augment(log('9.9.9.9')).has('firewall'));
    const entry = firewall
      .summary(file)
      .lists[0].entries.find((e) => e.value === '9.9.9.9');
    assert.strictEqual(entry.reason, 'spam');
    assert.strictEqual(entry.source, 'dashboard');

    firewall.edit(file, 'block-ips', 'remove', { value: '9.9.9.9' });
    assert.strictEqual(firewall.augment(log('9.9.9.9')).has('firewall'), false);

    assert.throws(() =>
      firewall.edit(file, 'nope', 'add', { value: '1.1.1.1' })
    );
    assert.throws(() =>
      firewall.edit(file, 'block-ips', 'add', { value: 'x' })
    );
  });

  it('reports entries pending a Cloudflare sync', () => {
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
    const [ips, uas] = firewall.summary(file).lists;
    assert.deepStrictEqual(ips.pending, {
      added: ['2.2.2.2'],
      removed: ['3.3.3.3'],
    });
    assert.strictEqual(uas.pending, null);
  });
});
