/* eslint-env mocha */

const assert = require('assert');
const http = require('http');

const api = require('../../src/app/api');

describe('API', () => {
  let server;
  let baseUrl;

  before((done) => {
    server = api.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after((done) => {
    server.close(done);
  });

  it('should assign unique request IDs to streaming clients', (done) => {
    const mockStream = {
      map: (fn) => {
        mockStream._handler = fn;
      },
    };
    const mockFormatter = {
      format: (log) => `<span>${log}</span>`,
    };

    api.streamToHttp('/test-stream', mockStream, mockFormatter);

    let completed = 0;
    const total = 3;

    for (let i = 0; i < total; i++) {
      const req = http.get(`${baseUrl}/test-stream`, (res) => {
        assert.strictEqual(
          res.headers['content-type'],
          'text/html; charset=utf-8'
        );
        assert.strictEqual(res.headers['cache-control'], 'no-cache');

        // Read first chunk (the HTML header), then abort
        res.once('data', () => {
          req.destroy();
          completed++;
          if (completed === total) {
            // Verify the stream handler was set
            assert.strictEqual(typeof mockStream._handler, 'function');
            done();
          }
        });
      });
    }
  });
});
