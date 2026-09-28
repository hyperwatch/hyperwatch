const assert = require('assert');

const { fromJS } = require('immutable');

const {
  Formatter,
  address,
  executionTime,
} = require('../../src/lib/formatter');
const {
  fillHost,
  logMatches,
  safeHtml,
  toHtml,
} = require('../../src/lib/util');

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
    const html = toHtml(address(log('crawl.googlebot.com', true), 'html'));
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
      toHtml(address(log('<b>x</b>', false), 'html')),
      '&lt;b&gt;x&lt;/b&gt;'
    );
  });
});

describe('executionTime format', () => {
  const log = (ms) => fromJS({ executionTime: ms });

  it('separates thousands in HTML', () => {
    assert.strictEqual(
      toHtml(executionTime(log(1016), 'html')),
      '<span class="red">1,016ms</span>'
    );
    assert.strictEqual(
      toHtml(executionTime(log(42), 'html')),
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

describe('fillHost', () => {
  it('fills the host placeholder of input statuses', () => {
    assert.strictEqual(
      fillHost(
        'Listening on http://__HOST__/input/log',
        (scheme) => `${scheme}://example.org/hw`
      ),
      'Listening on http://example.org/hw/input/log'
    );
    assert.strictEqual(
      fillHost(
        'Listening on ws://__HOST__/input/log',
        (scheme) => `${scheme}s://example.org`
      ),
      'Listening on wss://example.org/input/log'
    );
    assert.strictEqual(
      fillHost(null, () => 'unused'),
      null
    );
  });
});

describe('Formatter HTML escaping', () => {
  const hostile = fromJS({
    request: {
      time: '2026-09-28T10:00:00.000Z',
      method: 'GET',
      url: '/x<img src=x onerror=alert(1)>',
      address: '1.2.3.4',
      headers: { 'user-agent': 'Evil<script>alert(2)</script>' },
    },
    response: { status: 200 },
    executionTime: 5,
    identity: 'id<b>x</b>',
    address: { value: '1.2.3.4' },
  });

  it('escapes the text of log lines, keeping their own HTML', () => {
    const line = new Formatter().format(hostile, 'html');
    assert.doesNotMatch(line, /<script|<img|<b>/);
    assert.match(
      line,
      /&quot;GET \/x&lt;img src=x onerror=alert\(1\)&gt; 200&quot;/
    );
    assert.match(line, /Evil&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
    assert.match(line, /<span class="magenta">id&lt;b&gt;x&lt;\/b&gt;<\/span>/);
    assert.match(line, /<span class="green">5ms<\/span>/);
  });

  it('escapes the values of added formats, unless marked safe', () => {
    const formatter = new Formatter()
      .insertFormat('text', () => '<i>text</i>')
      .insertFormat('markup', () => safeHtml('<i>markup</i>'));
    const result = formatter.formatObject(hostile, 'html');
    assert.strictEqual(result.text, '&lt;i&gt;text&lt;/i&gt;');
    assert.strictEqual(result.markup, '<i>markup</i>');
  });

  it("doesn't escape text outputs", () => {
    const result = new Formatter().formatObject(hostile, 'text');
    assert.strictEqual(result.agent, 'Evil<script>alert(2)</script>');
    assert.strictEqual(
      result.request,
      '"GET /x<img src=x onerror=alert(1)> 200"'
    );
  });
});
