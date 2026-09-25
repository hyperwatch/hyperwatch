const assert = require('assert');

const { fromJS } = require('immutable');

const { address, executionTime } = require('../../src/lib/formatter');
const { logMatches } = require('../../src/lib/util');

describe('address format', () => {
  const log = (hostname, verified) =>
    fromJS({
      request: { address: '66.249.66.1' },
      address: { value: '66.249.66.1', hostname },
      hostname: { verified },
    });

  it('marks verified hostnames with + in text', () => {
    assert.strictEqual(
      address(log('crawl.googlebot.com', true), 'text'),
      'crawl.googlebot.com+'
    );
  });

  it('marks verified hostnames with a class in HTML', () => {
    const html = address(log('crawl.googlebot.com', true), 'html');
    assert.match(
      html,
      /^<span class="verified" [^>]*>crawl\.googlebot\.com<\/span>$/
    );
    assert.doesNotMatch(html, /\+|✓/);
  });

  it('leaves unverified hostnames unmarked', () => {
    assert.strictEqual(
      address(log('host.example', false), 'html'),
      'host.example'
    );
  });

  it('escapes hostnames in HTML', () => {
    assert.strictEqual(
      address(log('<b>x</b>', false), 'html'),
      '&lt;b&gt;x&lt;/b&gt;'
    );
  });
});

describe('executionTime format', () => {
  const log = (ms) => fromJS({ executionTime: ms });

  it('separates thousands in HTML', () => {
    assert.strictEqual(
      executionTime(log(1016), 'html'),
      '<span class="red">1,016ms</span>'
    );
    assert.strictEqual(
      executionTime(log(42), 'html'),
      '<span class="green">42ms</span>'
    );
  });

  it('keeps the raw number in text', () => {
    assert.strictEqual(executionTime(log(1016), 'text'), '1016ms');
  });
});

describe('log filters', () => {
  it('matches the request address without the address module', () => {
    const log = fromJS({ request: { address: '10.0.0.1' } });
    assert.ok(logMatches(log, { address: '10.0.0.1' }));
    assert.ok(!logMatches(log, { address: '10.0.0.12' }));
  });
});
