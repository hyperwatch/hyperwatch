const assert = require('assert');

const { fromJS } = require('immutable');

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

const payload = { request: { address: '1.2.3.4', url: '/' } };
const line = `<134>Aug 28 12:00:00 web01 nginx[42]: ${JSON.stringify(payload)}`;

describe('syslog input', () => {
  it('parses the syslog envelope and hands the message to parse()', () => {
    const { handler, successes, rejections } = startInput();
    handler(line);
    assert.strictEqual(rejections.length, 0);
    assert.strictEqual(successes.length, 1);
    assert.ok(successes[0].equals(fromJS(payload)));
  });

  it('rejects a message that is not syslog', () => {
    const { handler, successes, rejections } = startInput();
    handler('this is not a syslog line');
    assert.strictEqual(successes.length, 0);
    assert.strictEqual(rejections.length, 1);
    assert.match(rejections[0].message, /Unparseable syslog message/);
  });

  it('rejects a syslog message whose body parse() cannot handle', () => {
    const { handler, successes, rejections } = startInput();
    handler('<134>Aug 28 12:00:00 web01 nginx[42]: not json');
    assert.strictEqual(successes.length, 0);
    assert.strictEqual(rejections.length, 1);
    assert.ok(rejections[0] instanceof SyntaxError);
  });

  it('uses a custom parse()', () => {
    const { handler, successes } = startInput({
      parse: (message) => message.toUpperCase(),
    });
    handler('<134>Aug 28 12:00:00 web01 nginx[42]: hello');
    assert.deepStrictEqual(successes, ['HELLO']);
  });

  it('listens on both protocols by default, or only the one requested', () => {
    assert.deepStrictEqual(startInput().servers, ['udp', 'tcp']);
    assert.deepStrictEqual(startInput({ protocol: 'udp' }).servers, ['udp']);
    assert.deepStrictEqual(startInput({ protocol: 'tcp' }).servers, ['tcp']);
  });
});
