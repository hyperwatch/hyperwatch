const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fromJS, Map } = require('immutable');

const LogBuffer = require('../../src/lib/log-buffer');
const persistence = require('../../src/lib/persistence');

const makeLog = (i) =>
  fromJS({ id: `log-${i}`, address: { value: `10.0.0.${i}` } });

describe('LogBuffer', () => {
  it('dumps at most capacity entries, oldest first', () => {
    const buffer = new LogBuffer(3);
    [1, 2, 3, 4, 5].forEach((i) => buffer.push(makeLog(i)));

    const data = buffer.dump();
    assert.deepStrictEqual(
      data.map((log) => log.id),
      ['log-3', 'log-4', 'log-5']
    );
  });

  it('restores the same logs as Immutable Maps', () => {
    const buffer = new LogBuffer(3);
    [1, 2, 3, 4].forEach((i) => buffer.push(makeLog(i)));

    const restored = new LogBuffer(3);
    restored.load(buffer.dump());

    const logs = restored.toArray();
    assert.ok(Map.isMap(logs[0]));
    assert.deepStrictEqual(
      logs.map((log) => log.getIn(['address', 'value'])),
      ['10.0.0.4', '10.0.0.3', '10.0.0.2']
    );
  });

  it('keeps only the last capacity entries when loading more', () => {
    const buffer = new LogBuffer(2);
    buffer.load([1, 2, 3, 4].map((i) => makeLog(i).toJS()));

    assert.deepStrictEqual(
      buffer.toArray().map((log) => log.get('id')),
      ['log-4', 'log-3']
    );
  });

  it('round-trips through persistence dump / load', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperwatch-test-'));
    try {
      const buffer = new LogBuffer(5);
      [1, 2].forEach((i) => buffer.push(makeLog(i)));
      persistence.register('history-test', buffer);
      persistence.dump(tmpDir);

      const restored = new LogBuffer(5);
      persistence.register('history-test', restored);
      persistence.load(tmpDir);

      assert.deepStrictEqual(
        restored.toArray().map((log) => log.get('id')),
        ['log-2', 'log-1']
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
