const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fromJS } = require('immutable');

const {
  CursorError,
  LogWriter,
  MAX_LINE,
  read,
} = require('../../src/lib/log-files');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'log-files-'));

const record = (id, extra = {}) => ({
  request: { time: '2026-11-03T10:00:00Z', address: '10.0.0.1', url: `/${id}` },
  id,
  ...extra,
});

const lines = (...records) =>
  records.map((r) => `${JSON.stringify(r)}\n`).join('');

const ids = (result) => result.logs.map((log) => log.id);

// Every log of a directory, page by page, and the number of pages
async function readAll(dir, options = {}) {
  const all = [];
  let cursor;
  let pages = 0;
  do {
    const result = await read(dir, { ...options, cursor });
    all.push(...ids(result));
    pages++;
    assert.notStrictEqual(result.cursor, cursor, 'the cursor moves');
    cursor = result.cursor;
  } while (cursor && pages < 1000);
  return { all, pages };
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

describe('log files writer', () => {
  let dir;
  let now;
  let writer;

  beforeEach(() => {
    dir = tmpDir();
    now = new Date('2026-11-03T10:15:00Z');
    writer = new LogWriter(dir, { now: () => now });
  });

  afterEach(async () => {
    await writer.flush();
  });

  const file = (hour) =>
    fs.readFileSync(path.join(dir, `${hour}.ndjson`), 'utf8');

  it('writes one line per log, one file per hour', async () => {
    writer.push(fromJS(record('a')));
    writer.push(fromJS(record('b')));
    now = new Date('2026-11-03T11:01:00Z');
    writer.push(fromJS(record('c')));
    await writer.flush();

    assert.strictEqual(file('2026-11-03T10'), lines(record('a'), record('b')));
    assert.strictEqual(file('2026-11-03T11'), lines(record('c')));
    const stats = await writer.stats();
    assert.strictEqual(stats.files, 2);
    assert.strictEqual(stats.written, 3);
    assert.strictEqual(stats.dropped, 0);
    assert.strictEqual(stats.newest, '2026-11-03T11');
    assert.strictEqual(stats.oldest, '2026-11-03T10');
  });

  it('drops logs while two older streams are still closing', async () => {
    // A stream that never closes by itself
    const stuck = new EventEmitter();
    stuck.end = () => {};
    writer.end(stuck);

    writer.push(fromJS(record('a')));
    assert.ok(writer.stream, 'one stream closing: the hour opens');

    now = new Date('2026-11-03T11:00:00Z');
    writer.push(fromJS(record('b')));
    assert.strictEqual(writer.stream, null, 'two closing: nothing opens');
    assert.strictEqual(writer.counts.dropped, 1);

    stuck.emit('close');
    // The 10 o'clock stream closes too
    while (writer.closing.size) {
      await nextTick();
    }
    writer.push(fromJS(record('c')));
    await writer.flush();
    assert.strictEqual(file('2026-11-03T11'), lines(record('c')));
  });

  it('drops logs until the stream drains, ignoring older streams', async () => {
    writer = new LogWriter(dir, { now: () => now, highWaterMark: 1024 });
    // Over the stream's highWaterMark
    const big = record('big', { padding: 'x'.repeat(2 * 1024) });
    writer.push(fromJS(big));
    assert.ok(writer.blocked);
    writer.push(fromJS(record('dropped')));
    assert.strictEqual(writer.counts.dropped, 1);

    const old = writer.stream;
    now = new Date('2026-11-03T11:00:00Z');
    writer.push(fromJS(big));
    assert.notStrictEqual(writer.stream, old);
    assert.ok(writer.blocked);
    old.emit('drain');
    assert.ok(writer.blocked, 'a drain of the older stream changes nothing');

    await new Promise((resolve) => writer.stream.once('drain', resolve));
    assert.ok(!writer.blocked);
    writer.push(fromJS(record('after')));
    await writer.flush();
    assert.strictEqual(file('2026-11-03T11'), lines(big, record('after')));
  });

  it('writes what the transform returns, skips null, drops on errors', async () => {
    writer = new LogWriter(dir, {
      now: () => now,
      transform: (log) => {
        if (log.get('id') === 'skip') {
          return null;
        }
        if (log.get('id') === 'fail') {
          throw new Error('bad log');
        }
        return log.set('transformed', true);
      },
    });
    for (const id of ['a', 'skip', 'fail', 'b']) {
      writer.push(fromJS(record(id)));
    }
    await writer.flush();
    assert.strictEqual(
      file('2026-11-03T10'),
      lines(
        record('a', { transformed: true }),
        record('b', { transformed: true })
      )
    );
    assert.strictEqual(writer.counts.skipped, 1);
    assert.strictEqual(writer.counts.dropped, 1);
    assert.strictEqual(writer.lastError, 'transform: bad log');
  });

  it('drops a log longer than the longest line', async () => {
    writer.push(fromJS(record('huge', { padding: 'x'.repeat(MAX_LINE) })));
    writer.push(fromJS(record('a')));
    await writer.flush();
    assert.strictEqual(writer.counts.dropped, 1);
    assert.strictEqual(file('2026-11-03T10'), lines(record('a')));
  });

  it('counts failed writes as lost, without throwing', async () => {
    writer.push(fromJS(record('a')));
    writer.stream.destroy();
    writer.push(fromJS(record('b')));
    await nextTick();
    // b, and a, still pending when the stream was destroyed
    assert.strictEqual(writer.counts.lost, 2);
  });

  it("drops logs until the next hour when the file can't be opened", async () => {
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, '');
    writer = new LogWriter(path.join(blocker, 'logs'), { now: () => now });
    writer.push(fromJS(record('a')));
    writer.push(fromJS(record('b')));
    assert.strictEqual(writer.counts.dropped, 2);
    assert.ok(writer.lastError);
  });

  it('ends a line cut by a crash before writing again', async () => {
    const cut = `${lines(record('a'))}{"request":{"ti`;
    fs.writeFileSync(path.join(dir, '2026-11-03T10.ndjson'), cut);
    writer.push(fromJS(record('b')));
    await writer.flush();
    assert.strictEqual(file('2026-11-03T10'), `${cut}\n${lines(record('b'))}`);

    const result = await read(dir);
    assert.deepStrictEqual(ids(result), ['b', 'a']);
    assert.strictEqual(result.skipped, 1);
  });

  it('drops logs once flushed, and ends streams on the deadline', async () => {
    writer.push(fromJS(record('a')));
    const stream = writer.stream;
    const signal = AbortSignal.abort();
    await writer.flush(signal);
    assert.ok(stream.destroyed || stream.closed);
    assert.strictEqual(writer.closing.size, 0);
    writer.push(fromJS(record('b')));
    assert.strictEqual(writer.counts.dropped, 1);
  });

  it("doesn't hang flushing an errored stream", async () => {
    writer.push(fromJS(record('a')));
    const stream = writer.stream;
    stream.destroy(new Error('disk gone'));
    await writer.flush();
    // The error comes once the file is open
    if (!stream.closed) {
      await new Promise((resolve) => stream.once('close', resolve));
    }
    assert.strictEqual(writer.lastError, 'disk gone');
  });
});

describe('log files snapshot', () => {
  let dir;
  let now;
  let writer;

  beforeEach(() => {
    dir = tmpDir();
    now = new Date('2026-11-03T10:15:00Z');
    writer = new LogWriter(dir, { now: () => now });
  });

  afterEach(async () => {
    await writer.flush();
  });

  it('reads written and pending logs, and nothing newer', async () => {
    fs.writeFileSync(
      path.join(dir, '2026-11-03T09.ndjson'),
      lines(record('a'))
    );
    writer.push(fromJS(record('b')));
    await new Promise((resolve) => writer.stream.once('ready', resolve));
    await new Promise((resolve) => setImmediate(resolve));
    writer.push(fromJS(record('c')));
    const snapshot = writer.snapshot();
    assert.deepStrictEqual(
      snapshot.get('2026-11-03T10.ndjson').pending.length > 0,
      true,
      'c is pending'
    );

    // After the snapshot: neither later logs nor a later file
    writer.push(fromJS(record('d')));
    fs.writeFileSync(
      path.join(dir, '2026-11-03T11.ndjson'),
      lines(record('e'))
    );

    const result = await read(dir, { snapshot, limit: 10 });
    assert.deepStrictEqual(ids(result), ['c', 'b', 'a']);
  });

  it('has a boundary before the first write of the hour', async () => {
    fs.writeFileSync(
      path.join(dir, '2026-11-03T10.ndjson'),
      lines(record('a'))
    );
    const snapshot = writer.snapshot();
    writer.push(fromJS(record('b')));
    await writer.flush();
    const result = await read(dir, { snapshot, limit: 10 });
    assert.deepStrictEqual(ids(result), ['a']);
  });

  it('reads the pending logs of a file not created yet', async () => {
    writer.push(fromJS(record('a')));
    const snapshot = writer.snapshot();
    const result = await read(dir, { snapshot, limit: 10 });
    assert.deepStrictEqual(ids(result), ['a']);
  });

  it('applies the filters and the limit to pending logs', async () => {
    writer.push(fromJS(record('a')));
    writer.push(fromJS(record('b', { identity: 'Bot' })));
    writer.push(fromJS(record('c', { identity: 'Bot' })));
    const snapshot = writer.snapshot();
    const result = await read(dir, {
      snapshot,
      limit: 1,
      filters: { identity: 'Bot' },
    });
    assert.deepStrictEqual(ids(result), ['c']);
    assert.strictEqual(result.cursor, null);
  });
});

describe('log files reader', () => {
  let dir;

  beforeEach(() => {
    dir = tmpDir();
  });

  const write = (hour, content) =>
    fs.writeFileSync(path.join(dir, `${hour}.ndjson`), content);
  const append = (hour, content) =>
    fs.appendFileSync(path.join(dir, `${hour}.ndjson`), content);

  it('reads newest first, across files', async () => {
    write('2026-11-03T09', lines(record('a'), record('b')));
    write('2026-11-03T10', lines(record('c')));
    const result = await read(dir);
    assert.deepStrictEqual(ids(result), ['c', 'b', 'a']);
    assert.strictEqual(result.cursor, null);
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.oldest, '2026-11-03T09');
  });

  it('returns nothing without files', async () => {
    const result = await read(path.join(dir, 'missing'));
    assert.deepStrictEqual(result.logs, []);
    assert.strictEqual(result.cursor, null);
  });

  it('keeps characters split across chunks', async () => {
    const texts = ['é', '日本語', '🦊', 'ascii'];
    write(
      '2026-11-03T10',
      lines(...texts.map((text, i) => record(String(i), { text })))
    );
    for (const chunk of [1, 2, 3, 5, 7, 64]) {
      const result = await read(dir, { bounds: { chunk } });
      assert.deepStrictEqual(
        result.logs.map((log) => log.text),
        [...texts].reverse(),
        `chunk ${chunk}`
      );
    }
  });

  it('leaves out a line being written', async () => {
    write('2026-11-03T10', `${lines(record('a'))}{"request":`);
    assert.deepStrictEqual(ids(await read(dir)), ['a']);
    assert.deepStrictEqual(ids(await read(dir, { bounds: { chunk: 3 } })), [
      'a',
    ]);
  });

  it('skips lines that are not logs', async () => {
    write(
      '2026-11-03T10',
      `${lines(record('a'))}not json\nnull\n[1]\n{"request":1}\n\n${lines(record('b'))}`
    );
    const result = await read(dir);
    assert.deepStrictEqual(ids(result), ['b', 'a']);
    assert.strictEqual(result.skipped, 4);
  });

  it('skips a line longer than the longest line', async () => {
    const huge = `{"request":{},"padding":"${'x'.repeat(MAX_LINE)}"}\n`;
    write('2026-11-03T10', `${huge}${lines(record('a'))}${huge}`);
    write('2026-11-03T11', `${lines(record('b'))}${huge}${lines(record('c'))}`);
    for (const chunk of [64 * 1024, 4 * 1024 * 1024]) {
      const result = await read(dir, { bounds: { chunk } });
      assert.deepStrictEqual(ids(result), ['c', 'b', 'a'], `chunk ${chunk}`);
      assert.strictEqual(result.skipped, 3);
    }
  });

  it('filters by identity, address and signature', async () => {
    write(
      '2026-11-03T10',
      lines(
        record('a', { identity: 'Googlebot' }),
        record('b', { address: { value: '10.0.0.2' } }),
        record('c', { signature: { id: 'abc' } }),
        record('d')
      )
    );
    const by = async (filters) => ids(await read(dir, { filters }));
    assert.deepStrictEqual(await by({ identity: 'Googlebot' }), ['a']);
    // Without an identity, the identity key is the address
    assert.deepStrictEqual(await by({ identity: '10.0.0.2' }), ['b']);
    assert.deepStrictEqual(await by({ address: '10.0.0.1' }), ['d', 'c', 'a']);
    assert.deepStrictEqual(await by({ signature: 'abc' }), ['c']);
  });

  it('pages without gaps or duplicates while files grow and rotate', async () => {
    write('2026-11-03T09', lines(record('a'), record('b')));
    write('2026-11-03T10', lines(record('c'), record('d'), record('e')));

    const first = await read(dir, { limit: 2 });
    assert.deepStrictEqual(ids(first), ['e', 'd']);

    // Newer logs and a new hour don't change the next pages
    append('2026-11-03T10', lines(record('f')));
    write('2026-11-03T11', lines(record('g')));

    const second = await read(dir, { limit: 2, cursor: first.cursor });
    assert.deepStrictEqual(ids(second), ['c', 'b']);
    const third = await read(dir, { limit: 2, cursor: second.cursor });
    assert.deepStrictEqual(ids(third), ['a']);
    assert.strictEqual(third.cursor, null);

    // Logs with the same time are all there
    const { all } = await readAll(dir, { limit: 1 });
    assert.deepStrictEqual(all, ['g', 'f', 'e', 'd', 'c', 'b', 'a']);
  });

  it('stops on each bound with a cursor that moves', async () => {
    const records = 'abcdefghij'.split('').map((id) => record(id));
    write('2026-11-03T09', lines(...records.slice(0, 4)));
    write('2026-11-03T10', `${lines(...records.slice(4))}{"cut`);
    const expected = [...'abcdefghij'].reverse();

    for (const bounds of [
      { scan: 1, chunk: 16 },
      { time: 0, chunk: 16 },
      { response: 1 },
    ]) {
      const first = await read(dir, { bounds });
      assert.ok(first.truncated, JSON.stringify(bounds));
      const { all, pages } = await readAll(dir, { bounds });
      assert.deepStrictEqual(all, expected, JSON.stringify(bounds));
      assert.ok(pages > 1);
    }
  });

  it('rejects invalid cursors', async () => {
    write('2026-11-03T10', lines(record('a'), record('b')));
    const size = lines(record('a')).length;
    for (const cursor of [
      'nope',
      '../2026-11-03T10.ndjson:0',
      '2026-11-03T09.ndjson:0',
      '2026-11-03T10.ndjson:-1',
      '2026-11-03T10.ndjson:999999',
      `2026-11-03T10.ndjson:${size - 1}`,
    ]) {
      await assert.rejects(read(dir, { cursor }), CursorError, cursor);
    }
    assert.deepStrictEqual(
      ids(await read(dir, { cursor: `2026-11-03T10.ndjson:${size}` })),
      ['a']
    );
    assert.deepStrictEqual(
      ids(await read(dir, { cursor: '2026-11-03T10.ndjson:0' })),
      []
    );
  });

  it('stops when the client leaves', async () => {
    write('2026-11-03T10', lines(record('a')));
    const result = await read(dir, { signal: AbortSignal.abort() });
    assert.deepStrictEqual(result.logs, []);
    assert.strictEqual(result.cursor, null);
  });
});
