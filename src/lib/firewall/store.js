/**
 * Where the firewall lists (firewall.json) and their Cloudflare sync state
 * (firewall.sync.json) are kept, chosen by `modules.firewall.backend`, else
 * `persistence.backend`:
 *
 * - file (default): `modules.firewall.path` (./firewall.json by default),
 *   the sync state next to it. Reloaded when the file changes.
 * - any other persistence backend, e.g. s3: the documents "firewall-lists"
 *   and "firewall-lists.sync" of the persistence storage, so
 *   <prefix><namespace>/firewall-lists.json in the bucket. Not "firewall":
 *   persistence saves the firewall aggregator under that name. Read at start and when
 *   the instance edits or syncs them, never polled: nothing else is expected
 *   to change them.
 *
 * readLists() resolves to null when nothing is stored yet.
 */
const fs = require('fs');
const path = require('path');

const storages = require('../storage');

const lists = require('./lists');
const sync = require('./sync');

// Milliseconds before a storage operation is abandoned, so a stalled one
// can't hold the firewall's edits and syncs, which run one at a time
const OPERATION_TIMEOUT = 60000;

const LISTS = 'firewall-lists';
const STATE = 'firewall-lists.sync';

const emptyState = () => ({ lists: {} });

function createFileStore({ file, state } = {}) {
  const listsPath = file || path.join(process.cwd(), 'firewall.json');
  const statePath = state || sync.defaultStatePath(listsPath);
  let listener = null;
  return {
    name: 'file',
    where: listsPath,
    stateWhere: statePath,
    async readLists() {
      try {
        return lists.load(listsPath);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
    },
    async writeLists(data) {
      lists.save(listsPath, data);
    },
    async readState() {
      return sync.loadState(statePath);
    },
    async writeState(value) {
      sync.saveState(statePath, value);
    },
    watch(onChange, interval) {
      listener = onChange;
      fs.watchFile(listsPath, { interval }, listener).unref();
    },
    async close() {
      if (listener) {
        fs.unwatchFile(listsPath, listener);
        listener = null;
      }
    },
  };
}

// Settles with `promise`, or rejects when `signal` aborts, whichever comes
// first: some stalls ignore the abort (e.g. an S3 client stuck resolving its
// credentials). A write abandoned this way can't land later over a newer
// one: the S3 backend refuses further writes to that document
function settle(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => {});
      reject(signal.reason);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

// On a persistence storage (see ../storage): read(), write() and close()
function createStorageStore(storage, { timeout = OPERATION_TIMEOUT } = {}) {
  const bounded = (signal) =>
    signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
  return {
    name: storage.name,
    where: `the ${storage.name} document "${LISTS}"`,
    stateWhere: `the ${storage.name} document "${STATE}"`,
    async readLists({ signal } = {}) {
      const bound = bounded(signal);
      const body = await settle(storage.read(LISTS, { signal: bound }), bound);
      return body === null ? null : lists.parse(body);
    },
    async writeLists(data, { signal } = {}) {
      const bound = bounded(signal);
      const body = lists.serialize(lists.validate(data));
      await settle(storage.write(LISTS, body, { signal: bound }), bound);
    },
    async readState() {
      const bound = bounded();
      const body = await settle(storage.read(STATE, { signal: bound }), bound);
      if (body === null) {
        return emptyState();
      }
      const value = JSON.parse(body);
      return value && value.lists ? value : emptyState();
    },
    async writeState(value, { signal } = {}) {
      const bound = bounded(signal);
      const body = `${JSON.stringify(value, null, 2)}\n`;
      await settle(storage.write(STATE, body, { signal: bound }), bound);
    },
    watch() {},
    close: () => storage.close(),
  };
}

// The store `constants` select (see above)
function createStore(constants) {
  const firewall = constants.modules.firewall || {};
  const persistence = constants.persistence || {};
  const backend = firewall.backend || persistence.backend || 'file';
  if (backend === 'file') {
    return createFileStore({ file: firewall.path });
  }
  if (!storages.backends[backend]) {
    throw new Error(`Unknown firewall backend "${backend}"`);
  }
  const config = { ...persistence, backend };
  if (storages.backends[backend].validate) {
    storages.backends[backend].validate(config);
  }
  return createStorageStore(storages.create(config));
}

module.exports = { createFileStore, createStorageStore, createStore };
