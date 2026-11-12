/**
 * Logs of a pipeline node written to disk, one NDJSON file per hour:
 * <dir>/<YYYY-MM-DDTHH>.ndjson (UTC hour of arrival), oldest line first.
 *
 * The writer never blocks or throws in the pipeline: when the disk is slow
 * or failing, logs are dropped and counted. The reader goes through the
 * files backwards, newest log first, within bounds, and gives a cursor to
 * resume from.
 */
const fs = require('fs');
const path = require('path');

const { fromJS } = require('immutable');

const { logMatches } = require('./util');

/** @typedef {import('../types').Log} Log */

/**
 * A file being written: its name, the bytes written to it for sure, and the
 * lines sent and not written yet (oldest first)
 * @typedef {{ file: string, written: number, pending: string[] }} FileState
 */

/**
 * What the files hold at a time, per file name: the bytes written for sure
 * and the lines still pending (LogWriter#snapshot())
 * @typedef {Map<string, { size: number, pending: string[] }>} Snapshot
 */

/**
 * @typedef {object} LogWriterOptions
 * @property {() => Date} [now]
 * @property {number} [highWaterMark] Bytes a stream buffers before logs are
 *   dropped
 * @property {((log: Log) => Log | null) | null} [transform] What to write of
 *   a log: a log, or null to skip it
 */

const NEWLINE = 0x0a;
const FILE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}\.ndjson$/;

// The longest line written, and read: a longer one is dropped by the writer
// and skipped by the reader, so a read always gets past a line
const MAX_LINE = 1024 * 1024;

// Bytes a stream buffers before the writer drops logs: logs of a few KB
// come in bursts, and the default (64 KB) dropped some on a busy site
const HIGH_WATER_MARK = 4 * 1024 * 1024;

const DEFAULT_BOUNDS = {
  // Bytes read from disk per request
  scan: 200 * 1024 * 1024,
  // Milliseconds per request, checked between chunks
  time: 10 * 1000,
  // Bytes of matching logs per response
  response: 10 * 1024 * 1024,
  // Bytes read at once
  chunk: 1024 * 1024,
};

const hourOf = (/** @type {Date} */ date) => date.toISOString().slice(0, 13);

const fileFor = (/** @type {string} */ hour) => `${hour}.ndjson`;

// The size of a file (0 when missing), and whether it ends mid-line (a line
// cut by a crash)
/**
 * @param {string} file
 * @returns {{ size: number, midLine: boolean }}
 */
function fileState(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { size: 0, midLine: false };
    }
    throw err;
  }
  try {
    const { size } = fs.fstatSync(fd);
    if (size === 0) {
      return { size, midLine: false };
    }
    const byte = Buffer.alloc(1);
    fs.readSync(fd, byte, 0, 1, size - 1);
    return { size, midLine: byte[0] !== NEWLINE };
  } finally {
    fs.closeSync(fd);
  }
}

class LogWriter {
  /**
   * @param {string} dir
   * @param {LogWriterOptions} [options]
   */
  constructor(
    dir,
    {
      now = () => new Date(),
      highWaterMark = HIGH_WATER_MARK,
      transform = null,
    } = {}
  ) {
    this.dir = dir;
    this.now = now;
    this.highWaterMark = highWaterMark;
    // What to write of a log: a log, or null to skip it
    this.transform = transform;
    // The stream of the current hour, null when not open (failed, stopped,
    // or waiting for older streams to close)
    /** @type {fs.WriteStream | null} */
    this.stream = null;
    /** @type {string | null} */
    this.hour = null;
    // write() returned false: drop until that stream drains
    this.blocked = false;
    // Hour whose file failed: drop until the next hour
    /** @type {string | null} */
    this.failedHour = null;
    // Streams ended and not closed yet: at most 2, never queued
    /** @type {Set<fs.WriteStream>} */
    this.closing = new Set();
    // Per open stream: its file, the bytes written to it for sure, and the
    // lines sent and not written yet (oldest first), see snapshot()
    /** @type {Map<fs.WriteStream, FileState>} */
    this.files = new Map();
    this.stopped = false;
    this.counts = { written: 0, dropped: 0, lost: 0, skipped: 0 };
    /** @type {string | null} */
    this.lastError = null;
    /** @type {string | null} */
    this.lastWriteAt = null;
  }

  /** @param {Log} log */
  push(log) {
    if (this.stopped) {
      this.counts.dropped++;
      return;
    }
    const hour = hourOf(this.now());
    if (hour !== this.hour) {
      this.rotate(hour);
    }
    if (!this.stream && this.closing.size <= 1 && this.failedHour !== hour) {
      this.open(hour);
    }
    if (!this.stream || this.blocked) {
      this.counts.dropped++;
      return;
    }
    if (this.transform) {
      try {
        // null skips it, checked below
        log = /** @type {Log} */ (this.transform(log));
      } catch (err) {
        this.lastError = `transform: ${/** @type {Error} */ (err).message}`;
        this.counts.dropped++;
        return;
      }
      if (!log) {
        this.counts.skipped++;
        return;
      }
    }
    const line = `${JSON.stringify(log.toJS())}\n`;
    if (Buffer.byteLength(line) > MAX_LINE) {
      this.counts.dropped++;
      return;
    }
    const stream = this.stream;
    const accepted = this.write(stream, line, (err) => {
      if (err) {
        this.counts.lost++;
      } else {
        this.counts.written++;
        this.lastWriteAt = new Date().toISOString();
      }
    });
    if (!accepted) {
      this.blocked = true;
      stream.once('drain', () => {
        // A late drain from an older stream changes nothing
        if (this.stream === stream) {
          this.blocked = false;
        }
      });
    }
  }

  // Writes a line, tracked until written. A stream calls back in order, so
  // the oldest pending line is the one written.
  /**
   * @param {fs.WriteStream} stream
   * @param {string} line
   * @param {(err?: Error | null) => void} callback
   * @returns {boolean} false when the stream buffers too much
   */
  write(stream, line, callback) {
    const state = /** @type {FileState} */ (this.files.get(stream));
    state.pending.push(line);
    return stream.write(line, (err) => {
      state.pending.shift();
      if (!err) {
        state.written += Buffer.byteLength(line);
      }
      callback(err);
    });
  }

  /**
   * What the files hold right now, logs not written yet included: per file
   * name, the bytes written for sure and the lines still pending. Taken
   * synchronously, so a reader starting from it and a live stream starting
   * at the same time neither miss nor repeat a log.
   * @returns {Snapshot}
   */
  snapshot() {
    /** @type {Snapshot} */
    const files = new Map();
    for (const state of this.files.values()) {
      files.set(state.file, {
        size: state.written,
        pending: [...state.pending],
      });
    }
    // No stream on the current hour yet (none written this hour, a failure,
    // a restart): its file as it is now, so logs written while the reader
    // starts stay out of it
    const current = fileFor(hourOf(this.now()));
    if (!files.has(current)) {
      let size = 0;
      try {
        size = fs.statSync(path.join(this.dir, current)).size;
      } catch (err) {
        // Not created yet
      }
      files.set(current, { size, pending: [] });
    }
    return files;
  }

  /** @param {string} hour */
  rotate(hour) {
    this.hour = hour;
    this.failedHour = null;
    if (this.stream) {
      this.end(this.stream);
      this.stream = null;
    }
  }

  /** @param {string} hour */
  open(hour) {
    const file = path.join(this.dir, fileFor(hour));
    let state;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      state = fileState(file);
    } catch (err) {
      this.fail(/** @type {Error} */ (err));
      return;
    }
    const stream = fs.createWriteStream(file, {
      flags: 'a',
      highWaterMark: this.highWaterMark,
    });
    stream.on('error', (err) => {
      if (this.stream === stream) {
        this.fail(err);
      } else {
        this.lastError = err.message;
      }
    });
    this.files.set(stream, {
      file: fileFor(hour),
      written: state.size,
      pending: [],
    });
    this.stream = stream;
    this.blocked = false;
    // Ends the line cut by a crash, so the next log starts its own line
    if (state.midLine) {
      this.write(stream, '\n', () => {});
    }
  }

  /** @param {Error} err */
  fail(err) {
    this.lastError = err.message;
    this.failedHour = this.hour;
    if (this.stream) {
      const stream = this.stream;
      this.stream = null;
      this.end(stream);
    }
  }

  // Ends a stream and forgets it once closed, failed or not
  /** @param {fs.WriteStream} stream */
  end(stream) {
    this.closing.add(stream);
    const settle = () => {
      this.closing.delete(stream);
      this.files.delete(stream);
    };
    stream.once('close', settle);
    stream.once('error', settle);
    if (stream.destroyed || stream.closed) {
      settle();
    } else if (!stream.writableEnded) {
      stream.end();
    }
  }

  // Ends every stream; those still open when the signal fires are destroyed.
  // Logs pushed afterwards are dropped.
  /** @param {AbortSignal} [signal] */
  async flush(signal) {
    this.stopped = true;
    if (this.stream) {
      this.end(this.stream);
      this.stream = null;
    }
    const pending = [...this.closing].map(
      (stream) =>
        // Resolved with the error, if any: ignored
        /** @type {Promise<Error | void>} */ (
          new Promise((resolve) => {
            if (!this.closing.has(stream)) {
              resolve();
              return;
            }
            stream.once('close', resolve);
            stream.once('error', resolve);
          })
        )
    );
    if (!pending.length) {
      return;
    }
    if (!signal) {
      await Promise.all(pending);
      return;
    }
    await /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        const onAbort = () => {
          for (const stream of this.closing) {
            stream.destroy();
            this.files.delete(stream);
          }
          this.closing.clear();
          resolve();
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.all(pending).then(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
      })
    );
  }

  async stats() {
    const files = await listFiles(this.dir);
    let bytes = 0;
    for (const file of files) {
      try {
        bytes += (await fs.promises.stat(path.join(this.dir, file))).size;
      } catch (err) {
        // Deleted meanwhile
      }
    }
    const hour = (/** @type {string | undefined} */ file) =>
      file ? file.slice(0, 13) : null;
    return {
      files: files.length,
      bytes,
      newest: hour(files[0]),
      oldest: hour(files[files.length - 1]),
      ...this.counts,
      lastError: this.lastError,
      lastWriteAt: this.lastWriteAt,
    };
  }
}

// Log files of a directory, newest first
/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFiles(dir) {
  try {
    const names = await fs.promises.readdir(dir);
    return names
      .filter((name) => FILE_PATTERN.test(name))
      .sort()
      .reverse();
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

class CursorError extends Error {}

// "<file>:<offset>", the offset being where the next read ends: 0 or right
// after a newline
/**
 * @param {string} dir
 * @param {string[]} files
 * @param {string} cursor
 * @returns {Promise<{ file: string, offset: number }>}
 */
async function parseCursor(dir, files, cursor) {
  const match = /^(.+):(\d+)$/.exec(String(cursor));
  if (!match || !FILE_PATTERN.test(match[1]) || !files.includes(match[1])) {
    throw new CursorError(`Invalid cursor: ${cursor}`);
  }
  const [, file, digits] = match;
  const offset = Number(digits);
  const handle = await fs.promises.open(path.join(dir, file), 'r');
  try {
    const { size } = await handle.stat();
    if (!Number.isSafeInteger(offset) || offset > size) {
      throw new CursorError(`Invalid cursor: ${cursor}`);
    }
    if (offset > 0) {
      const byte = Buffer.alloc(1);
      await handle.read(byte, 0, 1, offset - 1);
      if (byte[0] !== NEWLINE) {
        throw new CursorError(`Invalid cursor: ${cursor}`);
      }
    }
  } finally {
    await handle.close();
  }
  return { file, offset };
}

/**
 * What a line matching `filters` contains for sure, searched in the bytes
 * read like grep: a filter value as the JSON string the writer wrote (the
 * longest, usually the rarest), or null without filters. Searching bytes is
 * much cheaper than parsing every log.
 * @param {ReadOptions['filters']} [filters]
 * @returns {Buffer | null}
 */
const searchFor = (filters = {}) =>
  /** @type {('identity' | 'address' | 'signature')[]} */ ([
    'identity',
    'address',
    'signature',
  ])
    .map((key) => filters[key])
    .filter((value) => typeof value === 'string' && value)
    .map((value) => Buffer.from(JSON.stringify(value)))
    .reduce(
      (longest, value) =>
        !longest || value.length > longest.length ? value : longest,
      /** @type {Buffer | null} */ (null)
    );

// The parsed log of a line, or null when it isn't one
/**
 * @param {Buffer} line
 * @returns {Record<string, any> | null}
 */
function parseLine(line) {
  let data;
  try {
    data = JSON.parse(line.toString('utf8'));
  } catch (err) {
    return null;
  }
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    !data.request ||
    typeof data.request !== 'object'
  ) {
    return null;
  }
  return data;
}

/**
 * The logs of `dir` matching `filters` (see logMatches), newest first.
 *
 * Reads from `cursor` (from an earlier read) or from the end of the newest
 * file. Stops at `limit` logs, at the end of the files, or when a bound is
 * hit (`truncated`). `cursor` is where to resume, null after the oldest log.
 *
 * With a `snapshot` (LogWriter.snapshot()), reads what the files held when it
 * was taken, logs not written yet included, and nothing newer: in one call,
 * without a cursor.
 */
/**
 * @typedef {object} ReadOptions
 * @property {number} [limit] Logs at most (default 100)
 * @property {string} [cursor] Where to resume, from an earlier read
 * @property {{ identity?: string, address?: string, signature?: string }} [filters]
 * @property {AbortSignal} [signal]
 * @property {Partial<typeof DEFAULT_BOUNDS>} [bounds] Bytes and time per read
 * @property {Snapshot} [snapshot] From LogWriter#snapshot()
 */

/**
 * @typedef {object} ReadResult
 * @property {Record<string, any>[]} logs Newest first
 * @property {string | null} cursor Where to resume, null after the oldest log
 * @property {boolean} truncated Whether a bound was hit
 * @property {number} scannedBytes
 * @property {number} skipped Lines that aren't logs, or too long
 * @property {string | null} oldest The oldest hour on disk
 */

/**
 * @param {string} dir
 * @param {ReadOptions} [options]
 * @returns {Promise<ReadResult>}
 */
async function read(
  dir,
  { limit = 100, cursor, filters = {}, signal, bounds = {}, snapshot } = {}
) {
  const { scan, time, response, chunk } = { ...DEFAULT_BOUNDS, ...bounds };
  const started = Date.now();
  let files = await listFiles(dir);
  /** @type {ReadResult} */
  const result = {
    logs: [],
    cursor: null,
    truncated: false,
    scannedBytes: 0,
    skipped: 0,
    oldest: files.length ? files[files.length - 1].slice(0, 13) : null,
  };

  let index = 0;
  /** @type {number | null} */
  let end = null;
  if (snapshot) {
    // Files created since the snapshot are newer than it. Its files may not
    // exist yet (a stream opens its file asynchronously)
    const newest = [...snapshot.keys()].sort().pop();
    if (newest) {
      files = [...new Set([...files, ...snapshot.keys()])]
        .filter((file) => file <= newest)
        .sort()
        .reverse();
    }
  } else if (cursor) {
    const parsed = await parseCursor(dir, files, cursor);
    index = files.indexOf(parsed.file);
    end = parsed.offset;
  }

  const search = searchFor(filters);
  let responseBytes = 0;
  let progressed = false;
  const overBudget = () =>
    progressed && (result.scannedBytes >= scan || Date.now() - started >= time);

  // Takes a line (without its newline) if it's a log matching the filters.
  // 'full' when it doesn't fit in the response, 'done' at the limit
  /** @returns {'full' | 'done' | null} */
  const take = (/** @type {Buffer} */ line) => {
    if (line.length > MAX_LINE) {
      result.skipped++;
      return null;
    }
    if (!line.length) {
      return null;
    }
    const data = parseLine(line);
    if (!data) {
      result.skipped++;
      return null;
    }
    if (!logMatches(fromJS(data), filters)) {
      return null;
    }
    if (result.logs.length && responseBytes + line.length > response) {
      return 'full';
    }
    responseBytes += line.length;
    result.logs.push(data);
    return result.logs.length >= limit ? 'done' : null;
  };

  for (; index < files.length; index++) {
    const file = files[index];
    const state = snapshot && snapshot.get(file);

    // Lines not written yet when the snapshot was taken: the newest of the
    // file
    if (state) {
      for (const line of [...state.pending].reverse()) {
        const taken = take(Buffer.from(line.replace(/\n$/, '')));
        progressed = true;
        if (taken === 'full') {
          result.truncated = true;
          return result;
        }
        if (taken === 'done') {
          return result;
        }
      }
    }

    let handle;
    try {
      handle = await fs.promises.open(path.join(dir, file), 'r');
    } catch (err) {
      // Not created yet: only its pending lines
      if (
        /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT' &&
        state
      ) {
        continue;
      }
      throw err;
    }
    try {
      // From a cursor: where it points. From a snapshot: what was written.
      // Otherwise the end of the file. Without a cursor, the bytes after the
      // last newline are left out (a write in progress, or a line cut by a
      // crash)
      let upto = end;
      if (upto === null) {
        const { size } = await handle.stat();
        upto = state ? Math.min(state.size, size) : size;
      }
      let trimmed = end !== null;
      end = null;
      // Bytes [pos, upto) read and not consumed yet. Once trimmed, upto is a
      // line boundary, so pending ends with a newline or is empty.
      let pos = upto;
      let pending = Buffer.alloc(0);
      // The line at the start of pending is longer than MAX_LINE: drop bytes
      // until its start
      let skipping = false;

      while (pos > 0 || pending.length) {
        // The client left: nothing to resume
        if (signal && signal.aborted) {
          return { ...result, cursor: null };
        }
        if (overBudget()) {
          result.truncated = true;
          if (!snapshot) {
            // Before the end of this file is trimmed, upto may be mid-line:
            // resume from the start of the previous file, done (there is
            // one: only progress allows stopping on the budget, and nothing
            // of this file was consumed yet)
            result.cursor = trimmed
              ? `${file}:${upto}`
              : `${files[index - 1]}:0`;
          }
          return result;
        }

        if (pos > 0) {
          const size = Math.min(chunk, pos);
          const buffer = Buffer.alloc(size);
          await handle.read(buffer, 0, size, pos - size);
          pos -= size;
          result.scannedBytes += size;

          if (!trimmed) {
            const last = buffer.lastIndexOf(NEWLINE);
            if (last === -1) {
              upto = pos;
              if (pos === 0) {
                break;
              }
              continue;
            }
            upto = pos + last + 1;
            pending = buffer.subarray(0, last + 1);
            trimmed = true;
          } else if (skipping) {
            const last = buffer.lastIndexOf(NEWLINE);
            if (last === -1) {
              if (pos === 0) {
                // The long line starts the file
                result.skipped++;
                skipping = false;
                upto = 0;
                pending = Buffer.alloc(0);
                progressed = true;
              }
              continue;
            }
            result.skipped++;
            skipping = false;
            upto = pos + last + 1;
            pending = buffer.subarray(0, last + 1);
            progressed = true;
          } else {
            pending = pending.length
              ? Buffer.concat([buffer, pending])
              : buffer;
          }
        }

        // Complete lines, from the end of pending
        while (pending.length) {
          // With filters, like grep: the lines after the last one holding
          // the search value can't match, passed over at once. The first
          // line may start before pending: kept, to be searched whole
          if (search) {
            const hit = pending.lastIndexOf(search);
            const cut =
              hit !== -1
                ? pending.indexOf(NEWLINE, hit) + 1
                : pos > 0
                  ? pending.indexOf(NEWLINE) + 1
                  : 0;
            if (cut < pending.length) {
              pending = pending.subarray(0, cut);
              upto = pos + cut;
              progressed = true;
              if (!pending.length) {
                break;
              }
            }
          }
          // (a negative offset would count from the end)
          const previous =
            pending.length > 1
              ? pending.lastIndexOf(NEWLINE, pending.length - 2)
              : -1;
          if (previous === -1 && pos > 0) {
            // The line may start before pending: read more, unless it's
            // already too long
            if (pending.length > MAX_LINE) {
              skipping = true;
              pending = Buffer.alloc(0);
            }
            break;
          }
          const start = previous + 1;
          const lineEnd = upto;
          const lineStart = pos + start;
          const line = pending.subarray(start, pending.length - 1);
          pending = pending.subarray(0, start);

          const taken = take(line);
          if (taken === 'full') {
            // Not included: resume with this line
            result.truncated = true;
            if (!snapshot) {
              result.cursor = `${file}:${lineEnd}`;
            }
            return result;
          }
          upto = lineStart;
          progressed = true;
          if (taken === 'done') {
            if (!snapshot) {
              result.cursor = `${file}:${upto}`;
            }
            return result;
          }
        }
      }
    } finally {
      await handle.close();
    }
  }
  return result;
}

module.exports.CursorError = CursorError;
module.exports.DEFAULT_BOUNDS = DEFAULT_BOUNDS;
module.exports.FILE_PATTERN = FILE_PATTERN;
module.exports.LogWriter = LogWriter;
module.exports.MAX_LINE = MAX_LINE;
module.exports.hourOf = hourOf;
module.exports.listFiles = listFiles;
module.exports.read = read;
