/**
 * S3 storage: one object per document, `<prefix><namespace>/<name>.json`, in
 * one bucket. Plain JSON, not compressed.
 *
 * `@aws-sdk/client-s3` is an optional peer dependency, only required when
 * this backend is selected. Credentials come from the AWS SDK's default
 * chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, roles…), never from the
 * Hyperwatch configuration.
 */
const SDK = '@aws-sdk/client-s3';

// Establishing a connection; requests are bounded by persistence deadlines
const CONNECTION_TIMEOUT = 10000;

function sdk() {
  try {
    return require(SDK);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `The s3 persistence backend needs ${SDK}: npm install ${SDK}`,
        { cause: err }
      );
    }
    throw err;
  }
}

function key({ s3 = {}, namespace }, name) {
  const prefix = s3.prefix || '';
  return `${prefix}${namespace ? `${namespace}/` : ''}${name}.json`;
}

// Errors carry the key and the S3 error name only, never a body
function describe(operation, objectKey, err) {
  if (err.name === 'AbortError') {
    return err;
  }
  // The HTTP status, or a network error code such as ECONNREFUSED
  const code =
    (err.$metadata && err.$metadata.httpStatusCode) || err.code || '';
  const error = new Error(
    `S3 ${operation} ${objectKey}: ${err.name || 'Error'}${code ? ` (${code})` : ''}`
  );
  error.name = err.name;
  // Without s3:ListBucket, S3 answers 403 instead of 404 for a missing object
  if (operation === 'GetObject' && code === 403) {
    error.message +=
      ', or missing (grant s3:ListBucket so S3 reports missing objects)';
  }
  return error;
}

// The abort signal only bounds send(), which resolves with the headers:
// destroy the body when it aborts, so a slow download doesn't carry on in
// the background
async function readBody(body, signal) {
  if (!signal) {
    return body.transformToString('utf-8');
  }
  const abort = () => {
    if (typeof body.destroy === 'function') {
      body.destroy(signal.reason);
    }
  };
  if (signal.aborted) {
    abort();
    signal.throwIfAborted();
  }
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await body.transformToString('utf-8');
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

// Whether the SDK went as far as sending the request: a request that failed
// earlier, e.g. resolving credentials or signing, can't have reached S3.
// The last middleware before the HTTP handler marks it sent. Clients that
// don't run the middleware stack count as possibly sent.
function trackSending(command) {
  let started = false;
  let sent = false;
  if (command.middlewareStack) {
    command.middlewareStack.add(
      (next) => (args) => {
        started = true;
        return next(args);
      },
      { step: 'initialize', priority: 'high', name: 'hyperwatchRequestStarted' }
    );
    command.middlewareStack.add(
      (next) => (args) => {
        sent = true;
        return next(args);
      },
      { step: 'deserialize', priority: 'low', name: 'hyperwatchRequestSent' }
    );
  }
  return { failedBeforeSending: () => started && !sent };
}

function createS3Storage(config = {}, { client } = {}) {
  const s3 = config.s3 || {};
  const { GetObjectCommand, PutObjectCommand, S3Client } = sdk();
  // A failed request may still commit remotely. Never send a newer snapshot
  // to that key while the outcome of the older upload is unknown.
  const uncertainWrites = new Set();

  client =
    client ||
    new S3Client({
      // Any region works: requests follow the redirect to the bucket's
      region: s3.region || process.env.AWS_REGION || 'us-east-1',
      followRegionRedirects: true,
      endpoint: s3.endpoint || undefined,
      forcePathStyle: s3.forcePathStyle || undefined,
      // Retrying an upload after losing its response could leave an older
      // attempt running after the retry succeeds and the next dump starts.
      maxAttempts: 1,
      requestHandler: { connectionTimeout: CONNECTION_TIMEOUT },
    });

  return {
    name: 's3',
    client,

    async read(name, { signal } = {}) {
      const objectKey = key(config, name);
      if (signal) {
        signal.throwIfAborted();
      }
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: s3.bucket, Key: objectKey }),
          { abortSignal: signal }
        );
        return await readBody(response.Body, signal);
      } catch (err) {
        if (err.name === 'NoSuchKey') {
          return null;
        }
        throw describe('GetObject', objectKey, err);
      }
    },

    async write(name, body, { signal } = {}) {
      const objectKey = key(config, name);
      // Aborted before sending: nothing lands. Aborted while sending: the
      // request is cancelled, and S3 stores an object whole or not at all.
      // Only a request S3 has fully received can still complete
      if (signal) {
        signal.throwIfAborted();
      }
      if (uncertainWrites.has(objectKey)) {
        throw new Error(
          `S3 PutObject ${objectKey}: an earlier upload has an unknown outcome; further writes are disabled for this document`
        );
      }
      const command = new PutObjectCommand({
        Bucket: s3.bucket,
        Key: objectKey,
        Body: body,
        ContentType: 'application/json',
      });
      const request = trackSending(command);
      try {
        await client.send(command, { abortSignal: signal });
      } catch (err) {
        const status = err.$metadata && err.$metadata.httpStatusCode;
        // Explicit client errors (e.g. AccessDenied) are definitive failures,
        // and so is a failure before the request was sent (e.g. credentials).
        // Aborts, transport errors, timeouts and server errors are ambiguous.
        const definitive =
          (status >= 400 && status < 500 && status !== 408) ||
          request.failedBeforeSending();
        if (!definitive) {
          uncertainWrites.add(objectKey);
        }
        throw describe('PutObject', objectKey, err);
      }
    },

    async close() {
      client.destroy();
    },
  };
}

// Checked at init, so a misconfiguration fails before anything starts
createS3Storage.validate = (config) => {
  const s3 = config.s3 || {};
  if (!s3.bucket) {
    throw new Error('persistence.s3.bucket is required with the s3 backend');
  }
  sdk();
};

module.exports = { createS3Storage, key };
