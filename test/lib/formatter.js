const assert = require('assert');

const { fromJS } = require('immutable');

const { address } = require('../../src/lib/formatter');

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
