const { LRUCache } = require('lru-cache');

const lruProvider = (options) => {
  const lruInstance = new LRUCache(options);
  return {
    clear: async () => lruInstance.clear(),
    del: async (key) => lruInstance.delete(key),
    get: async (key) => lruInstance.get(key),
    has: async (key) => lruInstance.has(key),
    // Without ttlInSeconds, no ttl: the entry stays until evicted (and the
    // cache doesn't track ages until an entry has a ttl)
    set: async (key, value, ttlInSeconds) =>
      lruInstance.set(
        key,
        value,
        ttlInSeconds ? { ttl: ttlInSeconds * 1000 } : undefined
      ),
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

// Without ttlInSeconds (or with 0), the entry stays until evicted: the
// modules cache parsed user agents, hostnames and XBL results this way
async function set(key, value, ttlInSeconds) {
  return cacheProvider.set(key, value, ttlInSeconds);
}

async function del(key) {
  return cacheProvider.del(key);
}

async function clear() {
  return cacheProvider.clear();
}

module.exports = { has, get, set, del, clear, setProvider };
