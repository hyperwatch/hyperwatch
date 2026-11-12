/**
 * Where persistence keeps its documents. A storage is an object with:
 *
 * - read(name, { signal }) → the document (a string), or null when missing
 * - write(name, body, { signal }) → resolves once the document is stored.
 *   After `signal` aborts, the write must not overwrite a newer snapshot:
 *   prevent it from committing, or reject further writes to that document
 *   when a remote commit cannot be ruled out
 * - close() → releases connections, if any
 *
 * Names match /^[A-Za-z0-9._-]+$/. Documents are plain JSON, not compressed,
 * the same for every backend.
 */
/**
 * @typedef {object} Storage
 * @property {string} name The backend: `file`, `s3`
 * @property {(name: string, options?: Abortable) => Promise<string | null>} read
 * @property {(name: string, body: string, options?: Abortable) => Promise<void>} write
 * @property {() => any} [close]
 */

/**
 * The persistence configuration a backend reads (see docs/configuration.md)
 * @typedef {object} StorageConfig
 * @property {string} [backend] `file` (default) or `s3`
 * @property {string} [namespace] A directory or key prefix per instance
 * @property {string} [path] The file backend's directory
 * @property {{ bucket?: string, prefix?: string, region?: string, endpoint?: string, forcePathStyle?: boolean }} [s3]
 */

/** @typedef {import('../../types').Abortable} Abortable */

const { createFileStorage } = require('./file');
const { createS3Storage } = require('./s3');

// No prototype: only registered names are backends, not "constructor" or
// "toString"
const backends = Object.assign(Object.create(null), {
  file: createFileStorage,
  s3: createS3Storage,
});

/**
 * @param {StorageConfig} [config]
 * @returns {Storage}
 */
function create(config = {}) {
  const backend = backends[config.backend || 'file'];
  if (!backend) {
    throw new Error(`Unknown persistence backend "${config.backend}"`);
  }
  return backend(config);
}

module.exports = { backends, create };
