/**
 * Where the firewall lists (firewall.json) and their Cloudflare sync state
 * (firewall.sync.json) are kept, chosen by `modules.firewall.backend`, else
 * `persistence.backend`:
 *
 * - file (default): `modules.firewall.path` (./firewall.json by default),
 *   the sync state next to it. Reloaded when the file changes.
 * - any other persistence backend, e.g. s3: the documents "firewall" and
 *   "firewall.sync" of the persistence storage, so
 *   <prefix><namespace>/firewall.json in the bucket. Read at start and when
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

const LISTS = 'firewall';
const STATE = 'firewall.sync';

const emptyState = () => ({ lists: {} });

function createFileStore({ file, state } = {}) {
  const listsPath = file || path.join(process.cwd(), 'firewall.json');
  const statePath = state || sync.defaultStatePath(listsPath);
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
      fs.watchFile(listsPath, { interval }, onChange).unref();
    },
    async close() {},
  };
}

// On a persistence storage (see ../storage): read(), write() and close()
function createStorageStore(storage) {
  return {
    name: storage.name,
    where: `the ${storage.name} document "${LISTS}"`,
    stateWhere: `the ${storage.name} document "${STATE}"`,
    async readLists({ signal } = {}) {
      const body = await storage.read(LISTS, { signal });
      return body === null ? null : lists.parse(body);
    },
    async writeLists(data) {
      await storage.write(LISTS, lists.serialize(lists.validate(data)));
    },
    async readState() {
      const body = await storage.read(STATE);
      if (body === null) {
        return emptyState();
      }
      const value = JSON.parse(body);
      return value && value.lists ? value : emptyState();
    },
    async writeState(value) {
      await storage.write(STATE, `${JSON.stringify(value, null, 2)}\n`);
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
