const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fromJS } = require('immutable');

const firewall = require('../../src/modules/firewall');

describe('Firewall rules', () => {
  let directory;
  let filePath;
  let warn;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperwatch-firewall-'));
    filePath = path.join(directory, 'firewall.json');
    warn = console.warn;
    console.warn = () => {};
  });

  afterEach(() => {
    console.warn = warn;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function writeRules(rules) {
    fs.writeFileSync(filePath, JSON.stringify({ rules }));
  }

  it('matches valid CIDRs without compiling them for every request', () => {
    writeRules([
      { id: 'private', action: 'allow', match: { cidrs: ['10.0.0.0/8'] } },
    ]);

    assert.strictEqual(firewall._testing.loadRules(filePath), true);
    const log = firewall._testing.augment(
      fromJS({ request: { address: '10.1.2.3' } })
    );
    assert.strictEqual(log.getIn(['firewall', 'rule']), 'private');
  });

  it('keeps the last valid rules when a reload contains invalid JSON', () => {
    writeRules([
      { id: 'blocked', action: 'block', match: { address: '192.0.2.1' } },
    ]);
    assert.strictEqual(firewall._testing.loadRules(filePath), true);

    fs.writeFileSync(filePath, '{');
    assert.strictEqual(firewall._testing.loadRules(filePath), false);
    assert.strictEqual(firewall.getExplicitAction('192.0.2.1'), 'block');
  });

  it('rejects invalid CIDRs while keeping the last valid rules', () => {
    writeRules([
      { id: 'blocked', action: 'block', match: { address: '192.0.2.1' } },
    ]);
    assert.strictEqual(firewall._testing.loadRules(filePath), true);

    writeRules([{ id: 'invalid', action: 'block', match: { cidrs: ['bad'] } }]);
    assert.strictEqual(firewall._testing.loadRules(filePath), false);
    assert.strictEqual(firewall.getExplicitAction('192.0.2.1'), 'block');
  });

  it('safely ignores rules without match criteria in formatter lookups', () => {
    writeRules([
      { id: 'disabled', action: 'block' },
      { id: 'signature', action: 'allow', match: { signature: 'abc' } },
    ]);

    assert.strictEqual(firewall._testing.loadRules(filePath), true);
    assert.strictEqual(firewall.getExplicitAction('192.0.2.1'), null);
    assert.strictEqual(firewall.getSignatureAction('abc'), 'allow');
  });
});
