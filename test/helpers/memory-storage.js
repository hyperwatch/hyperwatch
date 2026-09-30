// In-memory storage, following the contract of src/lib/storage
function createMemoryStorage() {
  const documents = new Map();
  return {
    name: 'memory',
    documents,
    async read(name) {
      return documents.has(name) ? documents.get(name) : null;
    },
    async write(name, body, { signal } = {}) {
      if (signal) {
        signal.throwIfAborted();
      }
      documents.set(name, body);
    },
    async close() {},
  };
}

module.exports = { createMemoryStorage };
