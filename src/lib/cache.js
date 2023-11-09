const { LRUCache } = require('lru-cache');

const lruProvider = (options) => {
  const lruInstance = new LRUCache(options);
  return {
    clear: async () => lruInstance.clear(),
    del: async (key) => lruInstance.delete(key),
    get: async (key) => lruInstance.get(key),
    has: async (key) => lruInstance.has(key),
    set: async (key, value, ttlInSeconds) =>
      lruInstance.set(key, value, { ttl: ttlInSeconds * 1000 }),
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

async function del(key) {
  return cacheProvider.del(key);
}

async function clear(key) {
  return cacheProvider.clear(key);
}

module.exports = { has, get, set, del, clear, setProvider };
