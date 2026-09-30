const assert = require('assert');

const { CreateBucketCommand, S3Client } = require('@aws-sdk/client-s3');

const { normalize } = require('../../../src/lib/persistence');
const { createS3Storage, key } = require('../../../src/lib/storage/s3');

const { storageContract } = require('./contract');

// Enough of S3Client for the storage: GetObject and PutObject in memory
function fakeClient() {
  const objects = new Map();
  const sent = [];
  return {
    objects,
    sent,
    async send(command, { abortSignal } = {}) {
      if (abortSignal) {
        abortSignal.throwIfAborted();
      }
      const { Bucket, Key, Body } = command.input;
      sent.push({ name: command.constructor.name, input: command.input });
      const id = `${Bucket}/${Key}`;
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(id, Body);
        return {};
      }
      if (!objects.has(id)) {
        const err = new Error('The specified key does not exist.');
        err.name = 'NoSuchKey';
        throw err;
      }
      const body = objects.get(id);
      return { Body: { transformToString: async () => body } };
    },
    destroy() {},
  };
}

storageContract('s3 (fake client)', () =>
  createS3Storage(
    { namespace: 'test', s3: { bucket: 'bucket' } },
    { client: fakeClient() }
  )
);

describe('s3 storage', () => {
  it('keys documents <prefix><namespace>/<name>.json', () => {
    assert.strictEqual(key({ s3: {} }, 'addresses'), 'addresses.json');
    assert.strictEqual(
      key({ namespace: 'all', s3: {} }, 'addresses'),
      'all/addresses.json'
    );
    assert.strictEqual(
      key({ namespace: 'all', s3: { prefix: 'watch/' } }, 'history-main'),
      'watch/all/history-main.json'
    );
  });

  it('writes plain JSON objects to the bucket', async () => {
    const client = fakeClient();
    const storage = createS3Storage(
      { namespace: 'all', s3: { bucket: 'bucket', prefix: 'p/' } },
      { client }
    );
    await storage.write('addresses', '[1]');
    assert.deepStrictEqual(client.sent[0], {
      name: 'PutObjectCommand',
      input: {
        Bucket: 'bucket',
        Key: 'p/all/addresses.json',
        Body: '[1]',
        ContentType: 'application/json',
      },
    });
  });

  it('reports errors with the key and the error name, never the body', async () => {
    const client = fakeClient();
    client.send = async () => {
      const err = new Error('Access Denied, body: [secret]');
      err.name = 'AccessDenied';
      err.$metadata = { httpStatusCode: 403 };
      throw err;
    };
    const storage = createS3Storage({ s3: { bucket: 'bucket' } }, { client });
    await assert.rejects(storage.write('doc', '["secret"]'), (err) => {
      assert.strictEqual(
        err.message,
        'S3 PutObject doc.json: AccessDenied (403)'
      );
      return true;
    });
  });

  it('hints at s3:ListBucket when a read is denied', async () => {
    const client = fakeClient();
    client.send = async () => {
      const err = new Error('Access Denied');
      err.name = 'AccessDenied';
      err.$metadata = { httpStatusCode: 403 };
      throw err;
    };
    const storage = createS3Storage({ s3: { bucket: 'bucket' } }, { client });
    await assert.rejects(storage.read('doc'), (err) => {
      assert.strictEqual(
        err.message,
        'S3 GetObject doc.json: AccessDenied (403), or missing (grant s3:ListBucket so S3 reports missing objects)'
      );
      return true;
    });
  });

  it('follows region redirects', () => {
    const storage = createS3Storage({
      s3: { bucket: 'bucket', region: 'eu-west-1' },
    });
    assert.strictEqual(storage.client.config.followRegionRedirects, true);
    storage.close();
  });
});

describe('s3 persistence configuration', () => {
  it('requires a bucket', () => {
    assert.throws(
      () => normalize({ enabled: true, backend: 's3', s3: {} }),
      /persistence\.s3\.bucket is required/
    );
    assert.strictEqual(
      normalize({ enabled: true, backend: 's3', s3: { bucket: 'b' } }).backend,
      's3'
    );
  });

  it('reads forcePathStyle from environment strings', () => {
    const config = normalize({ s3: { forcePathStyle: '1' } });
    assert.strictEqual(config.s3.forcePathStyle, true);
  });
});

// Against a real S3-compatible store, e.g. S3Mock in CI
const endpoint = process.env.HYPERWATCH_TEST_S3_ENDPOINT;
if (endpoint) {
  const bucket = process.env.HYPERWATCH_TEST_S3_BUCKET || 'hyperwatch-test';
  const s3 = { bucket, endpoint, forcePathStyle: true };

  describe(`s3 storage on ${endpoint}`, () => {
    before(async () => {
      const client = new S3Client({
        region: 'us-east-1',
        endpoint,
        forcePathStyle: true,
      });
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err) {
        if (
          !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(err.name)
        ) {
          throw err;
        }
      } finally {
        client.destroy();
      }
    });

    let run = 0;
    storageContract(`s3 (${endpoint})`, () =>
      // A namespace per test: the bucket outlives them
      createS3Storage({ namespace: `test-${Date.now()}-${run++}`, s3 })
    );
  });
}
