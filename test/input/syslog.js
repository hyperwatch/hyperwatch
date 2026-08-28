const assert = require('assert');

const { fromJS } = require('immutable');

const format = require('../../src/format');
const socket = require('../../src/input/socket');
const syslog = require('../../src/input/syslog');

// Starts a syslog input with the network servers stubbed out and returns the
// line handler that the UDP/TCP servers would feed, plus what it emitted.
function startInput(options = {}) {
  const originalUdp = socket.createUdpServer;
  const originalTcp = socket.createTcpServer;
  const servers = [];
  let handler;
  socket.createUdpServer = (args) => {
    servers.push('udp');
    handler = args.handler;
  };
  socket.createTcpServer = (args) => {
    servers.push('tcp');
    handler = args.handler;
  };

  const successes = [];
  const rejections = [];
  try {
    syslog.create(options).start({
      success: (log) => successes.push(log),
      reject: (err) => rejections.push(err),
      status: () => {},
      log: () => {},
    });
  } finally {
    socket.createUdpServer = originalUdp;
    socket.createTcpServer = originalTcp;
  }

  return { handler, servers, successes, rejections };
}

const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// What the Hyperwatch express middleware ships over syslog: an access log
// already in the Hyperwatch JSON schema, handled by the default parse().
const jsonAccessLog = {
  request: {
    time: '2026-08-28T12:00:00.000Z',
    address: '203.0.113.42',
    method: 'GET',
    url: '/api/collectives?limit=20',
    protocol: 'HTTP/1.1',
    headers: { host: 'api.example.com', 'user-agent': userAgent },
  },
  response: { status: 200 },
};

// Apache piped logs in the hyperwatch_combined format (see docs/tutorials).
const apacheAccessLog =
  '203.0.113.42 - - [28/Aug/2026:12:00:00 +0000] "GET /api/collectives?limit=20 HTTP/1.1" 200 3480 "https://example.com/" ' +
  `"${userAgent}" "application/json" "-" "gzip, deflate, br" "en-US,en;q=0.9" "keep-alive" "1" "-" "api.example.com"`;

// Nginx `access_log syslog:server=...,tag=nginx` with the combined format.
const nginxAccessLog =
  '198.51.100.7 - - [28/Aug/2026:12:00:01 +0000] "POST /webhooks/stripe HTTP/2.0" 204 0 "-" "Stripe/1.0 (+https://stripe.com/docs/webhooks)"';

// Wraps an access log in the RFC 3164 envelope produced by a syslog daemon.
const envelope = (tag, body) => `<134>Aug 28 12:00:00 web01 ${tag}: ${body}`;

describe('syslog input', () => {
  it('parses a JSON access log from the Hyperwatch middleware', () => {
    const { handler, successes, rejections } = startInput();
    handler(envelope('hyperwatch[1234]', JSON.stringify(jsonAccessLog)));
    assert.strictEqual(rejections.length, 0);
    assert.strictEqual(successes.length, 1);
    assert.ok(successes[0].equals(fromJS(jsonAccessLog)));
  });

  it('parses an Apache access log with the apache format parser', () => {
    const { handler, successes, rejections } = startInput({
      parse: format.apache.parser({
        format: format.apache.formats.hyperwatch_combined,
      }),
    });
    handler(envelope('httpd[4321]', apacheAccessLog));
    assert.strictEqual(rejections.length, 0);
    assert.strictEqual(successes.length, 1);
    const log = successes[0];
    assert.strictEqual(log.getIn(['request', 'address']), '203.0.113.42');
    assert.strictEqual(log.getIn(['request', 'method']), 'GET');
    assert.strictEqual(
      log.getIn(['request', 'url']),
      '/api/collectives?limit=20'
    );
    assert.strictEqual(
      log.getIn(['request', 'time']),
      '2026-08-28T12:00:00.000Z'
    );
    assert.strictEqual(
      log.getIn(['request', 'headers', 'host']),
      'api.example.com'
    );
    assert.strictEqual(
      log.getIn(['request', 'headers', 'user-agent']),
      userAgent
    );
    assert.strictEqual(log.getIn(['response', 'status']), 200);
  });

  it('parses an Nginx access log with the nginx format parser', () => {
    const { handler, successes, rejections } = startInput({
      parse: format.nginx.parser(),
    });
    handler(envelope('nginx', nginxAccessLog));
    assert.strictEqual(rejections.length, 0);
    assert.strictEqual(successes.length, 1);
    const log = successes[0];
    assert.strictEqual(log.getIn(['request', 'address']), '198.51.100.7');
    assert.strictEqual(log.getIn(['request', 'method']), 'POST');
    assert.strictEqual(log.getIn(['request', 'url']), '/webhooks/stripe');
    assert.strictEqual(log.getIn(['response', 'status']), 204);
  });

  it('rejects an access log that arrives without a syslog envelope', () => {
    const { handler, successes, rejections } = startInput({
      parse: format.nginx.parser(),
    });
    handler(nginxAccessLog);
    assert.strictEqual(successes.length, 0);
    assert.strictEqual(rejections.length, 1);
    assert.match(rejections[0].message, /Unparseable syslog message/);
  });

  it('rejects an access log in a format the configured parse() cannot handle', () => {
    // Default parse() expects JSON but Apache is sending its combined format.
    const { handler, successes, rejections } = startInput();
    handler(envelope('httpd[4321]', apacheAccessLog));
    assert.strictEqual(successes.length, 0);
    assert.strictEqual(rejections.length, 1);
    assert.ok(rejections[0] instanceof SyntaxError);
  });

  it('listens on both protocols by default, or only the one requested', () => {
    assert.deepStrictEqual(startInput().servers, ['udp', 'tcp']);
    assert.deepStrictEqual(startInput({ protocol: 'udp' }).servers, ['udp']);
    assert.deepStrictEqual(startInput({ protocol: 'tcp' }).servers, ['tcp']);
  });
});
