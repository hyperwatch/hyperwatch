const { LRUCache } = require('lru-cache');

/**
 * @param {LRUCache.Options<string, any, unknown>} options
 * @returns {CacheProvider}
 */
const lruProvider = (options) => {
  /** @type {LRUCache<string, any>} */
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

/**
 * Replaces the cache (an LRU of 1,000 entries by default)
 * @param {CacheProvider} provider
 */
function setProvider(provider) {
  cacheProvider = provider;
}

/**
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function has(key) {
  return cacheProvider.has(key);
}

/**
 * @param {string} key
 * @returns {Promise<any>}
 */
async function get(key) {
  return cacheProvider.get(key);
}

/**
 * Without `ttlInSeconds` (or with 0), the entry stays until evicted: the
 * modules cache parsed user agents, hostnames and XBL results this way.
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlInSeconds]
 */
async function set(key, value, ttlInSeconds) {
  return cacheProvider.set(key, value, ttlInSeconds);
}

/** @param {string} key */
async function del(key) {
  return cacheProvider.del(key);
}

async function clear() {
  return cacheProvider.clear();
}

/**
 * A cache backend. Values are whatever the modules store (hostnames, parsed
 * user agents…).
 * @typedef {object} CacheProvider
 * @property {() => Promise<unknown>} clear
 * @property {(key: string) => Promise<unknown>} del
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string) => Promise<boolean>} has
 * @property {(key: string, value: any, ttlInSeconds?: number) => Promise<unknown>} set
 */

module.exports = { has, get, set, del, clear, setProvider };
