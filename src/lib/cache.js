const { LRUCache } = require('lru-cache');

const lruProvider = (options) => {
  const lruInstance = new LRUCache(options);
  return {
    clear: async () => lruInstance.reset(),
    delete: async (key) => lruInstance.delete(key),
    get: async (key) => lruInstance.get(key),
    has: async (key) => lruInstance.has(key),
    set: async (key, value, ttlInSeconds) =>
      lruInstance.set(key, value, ttlInSeconds ? ttlInSeconds * 1000 : null),
  };
};

let cacheProvider = lruProvider({ max: 1000 });

function setProvider(provider) {
  cacheProvider = provider;
}

async function has(key) {
  return cacheProvider.has(key);
}

async function get(key) {
  return cacheProvider.get(key);
}

async function set(key, value, ttlInSeconds) {
  return cacheProvider.set(key, value, ttlInSeconds);
}

module.exports = { has, get, set, setProvider };
