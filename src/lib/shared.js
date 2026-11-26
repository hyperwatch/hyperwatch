const { fromJS } = require('immutable');

/**
 * One value per field and key, shared by every log and aggregator entry that
 * has it: the agent of a User-Agent string, the language of an
 * Accept-Language header, the geoip of a country… Without it each log gets
 * its own copy (fromJS per log), and so does each entry that keeps it.
 *
 * Immutable values never change, so sharing them changes nothing but memory.
 * Values are held weakly: one is dropped once no log or entry uses it, so
 * nothing needs a size limit.
 */

/** @type {Map<string, Map<string, WeakRef<any>>>} */
const fields = new Map();

/** @type {FinalizationRegistry<[string, string, WeakRef<any>]>} */
const registry = new FinalizationRegistry(([field, key, ref]) => {
  const values = fields.get(field);
  // A newer value may have replaced the collected one under this key
  if (values && values.get(key) === ref) {
    values.delete(key);
  }
});

/**
 * The shared value of `field` for `key`, built with `build()` the first time
 * (and again after nothing used it any more)
 * @template T
 * @param {string} field
 * @param {string} key
 * @param {() => T} build An Immutable value, or any other that never changes
 * @returns {T}
 */
function shared(field, key, build) {
  let values = fields.get(field);
  if (!values) {
    values = new Map();
    fields.set(field, values);
  }
  const ref = values.get(key);
  const existing = ref && ref.deref();
  if (existing !== undefined) {
    return existing;
  }
  const value = build();
  if (value === null || typeof value !== 'object') {
    // Primitives need no sharing, and can't be held weakly
    return value;
  }
  const newRef = new WeakRef(value);
  values.set(key, newRef);
  registry.register(value, [field, key, newRef]);
  return value;
}

/**
 * The shared value of `field` for a value in its JSON form (as persistence
 * documents have it), keyed by its content
 * @param {string} field
 * @param {unknown} plain
 */
function sharedFromJS(field, plain) {
  if (plain === null || typeof plain !== 'object') {
    return plain;
  }
  return shared(field, `json:${JSON.stringify(plain)}`, () => fromJS(plain));
}

// Fields of logs and aggregator entries restored shared (see sharedFields)
const SHARED_FIELDS = ['agent', 'language', 'geoip', 'asn', 'cloudflare'];

/**
 * A log or entry in its JSON form with its shared fields replaced by their
 * shared values, before fromJS (which keeps Immutable values as they are)
 * @param {Record<string, any>} plain
 * @returns {Record<string, any>}
 */
function sharedFields(plain) {
  const copy = { ...plain };
  for (const field of SHARED_FIELDS) {
    if (copy[field] !== undefined) {
      copy[field] = sharedFromJS(field, copy[field]);
    }
  }
  // A signature with only its id (the signatures aggregator's entries also
  // have their headers, kept as a plain object)
  if (
    copy.signature &&
    typeof copy.signature === 'object' &&
    Object.keys(copy.signature).length === 1 &&
    typeof copy.signature.id === 'string'
  ) {
    copy.signature = sharedFromJS('signature', copy.signature);
  }
  return copy;
}

/**
 * How many values each field shares now (for /memory.json and tests)
 * @returns {Record<string, number>}
 */
function sizes() {
  /** @type {Record<string, number>} */
  const result = {};
  for (const [field, values] of fields) {
    result[field] = values.size;
  }
  return result;
}

module.exports = { shared, sharedFromJS, sharedFields, sizes };
