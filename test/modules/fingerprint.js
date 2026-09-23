const assert = require('assert');

const { fromJS } = require('immutable');

const { augment } = require('../../src/modules/fingerprint');

function log({ family, major, headers = {}, url = '/' }) {
  return fromJS({
    agent: { family, major: String(major) },
    request: { url, headers },
  });
}

const chromeHeaders = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,fr;q=0.8',
};

describe('fingerprint', () => {
  it('skips non-browser agents', () => {
    const result = augment(log({ family: 'curl', major: 8 }));
    assert.strictEqual(result.get('fingerprint'), undefined);
  });

  it('gives a real Chrome navigation a score of 0', () => {
    const result = augment(
      log({
        family: 'Chrome',
        major: 145,
        headers: {
          ...chromeHeaders,
          'sec-ch-ua': '"Chromium";v="145"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'upgrade-insecure-requests': '1',
        },
      })
    );
    const { score, flags } = result.get('fingerprint');
    assert.strictEqual(score, 0);
    assert.deepStrictEqual(flags, [
      'has-client-hints',
      'has-sec-fetch',
      'has-upgrade-insecure',
    ]);
  });

  it('flags a headless client claiming to be Chrome', () => {
    const result = augment(
      log({ family: 'Chrome', major: 145, headers: { accept: '*/*' } })
    );
    const { score, flags } = result.get('fingerprint');
    assert.ok(flags.includes('accept-star'));
    assert.ok(flags.includes('missing-accept-language'));
    assert.ok(flags.includes('headless-combo'));
    assert.ok(score >= 0.6);
  });

  it('flags Accept headers the claimed engine never sends', () => {
    const result = augment(
      log({
        family: 'Firefox',
        major: 148,
        headers: chromeHeaders,
      })
    );
    assert.ok(
      result.get('fingerprint').flags.includes('accept-engine-mismatch')
    );
  });

  it('flags old browser versions', () => {
    const result = augment(
      log({ family: 'Chrome', major: 100, headers: chromeHeaders })
    );
    assert.ok(result.get('fingerprint').flags.includes('ancient-version'));
  });

  it('skips Accept checks on subrequests', () => {
    const result = augment(
      log({
        family: 'Chrome',
        major: 145,
        url: '/static/app.js',
        headers: { ...chromeHeaders, accept: '*/*' },
      })
    );
    assert.ok(!result.get('fingerprint').flags.includes('accept-star'));
  });
});
