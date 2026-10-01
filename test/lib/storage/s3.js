const assert = require('assert');
const { Readable } = require('stream');

const { CreateBucketCommand, S3Client } = require('@aws-sdk/client-s3');

const { Persistence, normalize } = require('../../../src/lib/persistence');
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

  it('stops downloading a body when the read is aborted', async () => {
    // Headers arrived, the body never ends
    const body = new Readable({ read() {} });
    body.push('[1,');
    body.transformToString = async () => {
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf-8');
    };
    const client = fakeClient();
    client.send = async () => ({ Body: body });
    const storage = createS3Storage({ s3: { bucket: 'bucket' } }, { client });

    const controller = new AbortController();
    const read = storage.read('doc', { signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await assert.rejects(read);
    assert.strictEqual(body.destroyed, true);
  });

  it('follows region redirects', () => {
    const storage = createS3Storage({
      s3: { bucket: 'bucket', region: 'eu-west-1' },
    });
    assert.strictEqual(storage.client.config.followRegionRedirects, true);
    storage.close();
  });

  it('disables SDK retries so an earlier upload attempt cannot outlive a successful retry', async () => {
    const storage = createS3Storage({ s3: { bucket: 'bucket' } });
    assert.strictEqual(await storage.client.config.maxAttempts(), 1);
    await storage.close();
  });

  it('does not send a final snapshot over an aborted upload that can still commit', async () => {
    const client = fakeClient();
    const send = client.send.bind(client);
    const received = Promise.withResolvers();
    let commit;
    let uploads = 0;
    client.send = (command, options = {}) => {
      if (
        command.constructor.name === 'PutObjectCommand' &&
        command.input.Key === 'doc.json' &&
        ++uploads === 1
      ) {
        // The server accepted the body, but hasn't acknowledged its commit.
        // Cancelling the client request doesn't cancel this remote operation.
        commit = () => send(command);
        return new Promise((resolve, reject) => {
          options.abortSignal.addEventListener(
            'abort',
            () => reject(options.abortSignal.reason),
            { once: true }
          );
          received.resolve();
        });
      }
      return send(command, options);
    };
    const storage = createS3Storage({ s3: { bucket: 'bucket' } }, { client });
    const persistence = new Persistence();
    persistence.setStorage(storage);
    let value = 1;
    persistence.register('doc', { dump: () => [value] });
    persistence.register('healthy', { dump: () => [value] });
    const controller = new AbortController();
    const dump = persistence.dump({ signal: controller.signal });
    await received.promise;
    controller.abort();
    assert.strictEqual((await dump).timedOut, true);

    value = 2;
    await persistence.stop();
    assert.strictEqual(uploads, 1);
    assert.strictEqual(persistence.latest.dump.failed, 1);
    assert.strictEqual(persistence.latest.dump.documents, 1);
    await commit();
    assert.strictEqual(await storage.read('doc'), '[1]');
    assert.strictEqual(await storage.read('healthy'), '[2]');
  });

  for (const status of [undefined, 408, 500, 200]) {
    it(`blocks later writes after an ambiguous upload failure (${status || 'transport'})`, async () => {
      const client = fakeClient();
      const send = client.send.bind(client);
      client.send = async () => {
        const err = new Error('Lost upload response');
        if (status) {
          err.$metadata = { httpStatusCode: status };
        }
        throw err;
      };
      const storage = createS3Storage({ s3: { bucket: 'bucket' } }, { client });
      await assert.rejects(storage.write('doc', '[1]'));
      client.send = send;
      await assert.rejects(storage.write('doc', '[2]'), /unknown outcome/);
      assert.strictEqual(client.sent.length, 0);
      await storage.write('healthy', '[2]');
      assert.strictEqual(await storage.read('healthy'), '[2]');
      await storage.close();
    });
  }

  it('allows another upload after a failure before sending (credentials)', async () => {
    let fail = true;
    const client = new S3Client({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:1',
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: async () => {
        if (fail) {
          const err = new Error('Could not load credentials');
          err.name = 'CredentialsProviderError';
          throw err;
        }
        return { accessKeyId: 'test', secretAccessKey: 'test' };
      },
    });
    const storage = createS3Storage({ s3: { bucket: 'bucket' } }, { client });
    await assert.rejects(
      storage.write('doc', '[1]'),
      /CredentialsProviderError/
    );

    // Credentials are back: the next upload is sent (and fails to connect,
    // which is ambiguous, so the one after is refused)
    fail = false;
    await assert.rejects(storage.write('doc', '[2]'), /ECONNREFUSED/);
    await assert.rejects(storage.write('doc', '[3]'), /unknown outcome/);
    await storage.close();
  });

  it('allows another upload after a definitive rejection', async () => {
    const client = fakeClient();
    const send = client.send.bind(client);
    client.send = async () => {
      const err = new Error('Access Denied');
      err.name = 'AccessDenied';
      err.$metadata = { httpStatusCode: 403 };
      throw err;
    };
    const storage = createS3Storage({ s3: { bucket: 'bucket' } }, { client });
    await assert.rejects(storage.write('doc', '[1]'), /AccessDenied/);
    client.send = send;
    await storage.write('doc', '[2]');
    assert.strictEqual(await storage.read('doc'), '[2]');
    await storage.close();
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

    it('keeps the firewall lists and their sync state', async () => {
      const { createStore } = require('../../../src/lib/firewall/store');
      const store = createStore({
        modules: { firewall: {} },
        persistence: {
          backend: 's3',
          namespace: `firewall-${Date.now()}`,
          s3,
        },
      });
      try {
        await assert.rejects(store.readLists(), /no lists in/);
        assert.deepStrictEqual(await store.readState(), { lists: {} });

        const data = {
          lists: [
            {
              id: 'block-ips',
              type: 'ip',
              action: 'block',
              entries: [{ value: '1.2.3.4' }],
            },
          ],
        };
        await store.writeLists(data);
        await store.writeState({ lists: { 'block-ips': { values: [] } } });
        assert.deepStrictEqual(
          (await store.readLists()).lists[0].entries[0].value,
          '1.2.3.4'
        );
        assert.deepStrictEqual(Object.keys((await store.readState()).lists), [
          'block-ips',
        ]);
      } finally {
        await store.close();
      }
    });
  });
}
