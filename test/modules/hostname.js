const assert = require('assert');
const dns = require('dns').promises;

const hostname = require('../../src/modules/hostname.js');

const stubs = ['reverse', 'resolve4', 'resolve6'];

describe('hostname', () => {
  const originals = {};

  beforeEach(() => {
    for (const name of stubs) {
      originals[name] = dns[name];
    }
  });

  afterEach(() => {
    for (const name of stubs) {
      dns[name] = originals[name];
    }
  });

  function stubDns({ reverse, resolve4 = [], resolve6 = [] }) {
    dns.reverse = async () => [reverse];
    dns.resolve4 = async () => resolve4;
    dns.resolve6 = async () => resolve6;
  }

  it('should verify an IPv4 address among several forward results', async () => {
    stubDns({
      reverse: 'crawler.example.com',
      resolve4: ['192.0.2.1', '192.0.2.10'],
    });
    const entry = await hostname.lookup('192.0.2.10');
    assert.strictEqual(entry.value, 'crawler.example.com');
    assert.strictEqual(entry.verified, true);
  });

  it('should verify an IPv6 address written differently', async () => {
    stubDns({
      reverse: 'crawler.example.com',
      resolve6: ['2001:DB8:0:0::1'],
    });
    const entry = await hostname.lookup('2001:db8::1');
    assert.strictEqual(entry.value, 'crawler.example.com');
    assert.strictEqual(entry.verified, true);
  });

  it('should not verify a hostname resolving elsewhere', async () => {
    stubDns({
      reverse: 'crawler.example.com',
      resolve4: ['192.0.2.99'],
      resolve6: ['2001:db8::99'],
    });
    const entry = await hostname.lookup('192.0.2.20');
    assert.strictEqual(entry.value, 'crawler.example.com');
    assert.strictEqual(entry.verified, undefined);
  });
});
