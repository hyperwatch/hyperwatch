const fs = require('fs');
const path = require('path');

// One JSON file per document: <path>/<namespace>/<name>.json, <path> being
// .hyperwatch-data in the current directory by default
function directory({ path: base, namespace } = {}) {
  const dir = base || path.join(process.cwd(), '.hyperwatch-data');
  return namespace ? path.join(dir, namespace) : dir;
}

function createFileStorage(config = {}) {
  const dir = directory(config);
  const file = (name) => path.join(dir, `${name}.json`);

  return {
    name: 'file',
    dir,

    async read(name, { signal } = {}) {
      try {
        return await fs.promises.readFile(file(name), {
          encoding: 'utf8',
          signal,
        });
      } catch (err) {
        if (err.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
    },

    async write(name, body, { signal } = {}) {
      await fs.promises.mkdir(dir, { recursive: true });
      const target = file(name);
      const tmp = `${target}.tmp`;
      await fs.promises.writeFile(tmp, body, { signal });
      // The rename commits the write. Checked and done in the same tick, so
      // a write aborted by a deadline never lands later
      if (signal) {
        signal.throwIfAborted();
      }
      fs.renameSync(tmp, target);
    },

    async close() {},
  };
}

module.exports = { createFileStorage, directory };
