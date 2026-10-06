const assert = require('assert');

const { fromJS } = require('immutable');

const html = require('../../src/app/html');
const ccbotIps = require('../../src/data/ccbot-ips.json');
const claudeBotIps = require('../../src/data/claude-bot-ips.json');
const { logMatches } = require('../../src/lib/util');
const identity = require('../../src/modules/identity.js');

const claudeFamilies = [
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'Claude-Web',
  'anthropic-ai',
];

function log({ family, address, hostname, verified }) {
  return fromJS({
    request: { address },
    address: { value: address, hostname },
    agent: { family },
    ...(verified !== undefined && { hostname: { value: hostname, verified } }),
  });
}

describe('identity', () => {
  describe('Claude', () => {
    it('should not trust a reverse DNS claim from shared cloud hosting', () => {
      // Any EC2 instance in us-east-2 gets this PTR suffix by default, so it
      // proves nothing about the operator.
      const result = identity.augment(
        log({
          family: 'ClaudeBot',
          address: '3.142.252.166',
          hostname: 'ec2-3-142-252-166.us-east-2.compute.amazonaws.com',
        })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should not identify an address outside the published ranges', () => {
      for (const family of claudeFamilies) {
        const result = identity.augment(log({ family, address: '8.8.8.8' }));
        assert.strictEqual(result.get('identity'), undefined);
      }
    });

    // Skipped until `node scripts/fetch-anthropic-ips.js` has been run
    (claudeBotIps.length > 0 ? it : it.skip)(
      'should identify every Claude family from a published range',
      () => {
        const address = claudeBotIps[0].split('/')[0];
        for (const family of claudeFamilies) {
          const result = identity.augment(log({ family, address }));
          assert.strictEqual(result.get('identity'), 'Claude');
        }
      }
    );
  });

  describe('Common Crawl', () => {
    // The first address of each range, so a refresh of ccbot-ips.json
    // (`node scripts/fetch-commoncrawl-ips.js`) never breaks the tests
    const published = ccbotIps.map((cidr) => cidr.split('/')[0]);

    it('should identify CCBot from every published range', () => {
      assert.ok(published.length > 0);
      for (const address of published) {
        const result = identity.augment(log({ family: 'CCBot', address }));
        assert.strictEqual(result.get('identity'), 'Common Crawl');
      }
    });

    it('should not trust an EC2 hostname outside the published ranges', () => {
      // Any EC2 instance in us-east-1 gets this PTR suffix
      const result = identity.augment(
        log({
          family: 'CCBot',
          address: '3.80.0.1',
          hostname: 'ec2-3-80-0-1.compute-1.amazonaws.com',
        })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should not identify another agent from a published range', () => {
      const result = identity.augment(
        log({ family: 'Chrome', address: published[0] })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });

  describe('Meta', () => {
    const metaFamilies = ['meta-externalagent', 'meta-webindexer', 'Hyperlink'];

    it('should identify an address in the Meta network', () => {
      for (const family of metaFamilies) {
        for (const address of ['2a03:2880:f800:1::', '57.141.2.18']) {
          const result = identity.augment(log({ family, address }));
          assert.strictEqual(result.get('identity'), 'Meta');
        }
      }
    });

    it('should not identify an address outside the Meta network', () => {
      for (const family of metaFamilies) {
        const result = identity.augment(
          log({ family, address: '203.0.113.7' })
        );
        assert.strictEqual(result.get('identity'), undefined);
      }
    });

    it('should not trust Cloudflare Workers egress', () => {
      // Shared by every Cloudflare Worker, so anyone can send a Meta UA from it
      for (const family of metaFamilies) {
        const result = identity.augment(
          log({ family, address: '2a06:98c0:3600::103' })
        );
        assert.strictEqual(result.get('identity'), undefined);
      }
    });
  });

  describe('Facebook', () => {
    it('should identify FacebookBot from the Meta network', () => {
      const result = identity.augment(
        log({ family: 'FacebookBot', address: '57.141.2.18' })
      );
      assert.strictEqual(result.get('identity'), 'Facebook');
    });

    it('should not identify FacebookBot from elsewhere', () => {
      // Seen in production from residential addresses
      const result = identity.augment(
        log({ family: 'FacebookBot', address: '87.122.0.102' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });

  describe('Reflection', () => {
    it('should identify a reflection.ai hostname', () => {
      const result = identity.augment(
        log({
          family: 'Reflectionbot',
          address: '16.216.88.112',
          hostname: 'reflectionbot-88-112.reflection.ai',
          verified: true,
        })
      );
      assert.strictEqual(result.get('identity'), 'Reflection');
    });

    it('should not identify an unconfirmed hostname', () => {
      const result = identity.augment(
        log({
          family: 'Reflectionbot',
          address: '8.8.8.8',
          hostname: 'reflectionbot-88-112.reflection.ai',
        })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should not identify without a hostname', () => {
      const result = identity.augment(
        log({ family: 'Reflectionbot', address: '8.8.8.8' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });

  describe('SEOkicks', () => {
    it('should identify a seokicks.de hostname', () => {
      const result = identity.augment(
        log({
          family: 'SEOkicks',
          address: '135.181.210.147',
          hostname: 'c10.seokicks.de',
          verified: true,
        })
      );
      assert.strictEqual(result.get('identity'), 'SEOkicks');
    });

    it('should not identify an unconfirmed hostname', () => {
      const result = identity.augment(
        log({
          family: 'SEOkicks',
          address: '8.8.8.8',
          hostname: 'c10.seokicks.de',
        })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should not identify without a hostname', () => {
      const result = identity.augment(
        log({ family: 'SEOkicks', address: '8.8.8.8' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });

  describe('Semrush', () => {
    it('should identify SiteAuditBot by its semrush.com hostname', () => {
      const result = identity.augment(
        log({
          family: 'SiteAuditBot',
          address: '85.208.98.194',
          hostname: '66.siteaudit.bot.semrush.com',
          verified: true,
        })
      );
      assert.strictEqual(result.get('identity'), 'Semrush');
    });

    it('should not identify an unconfirmed hostname', () => {
      const result = identity.augment(
        log({
          family: 'SiteAuditBot',
          address: '8.8.8.8',
          hostname: '66.siteaudit.bot.semrush.com',
        })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should not identify SiteAuditBot without a semrush.com hostname', () => {
      const result = identity.augment(
        log({ family: 'SiteAuditBot', address: '8.8.8.8' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should identify SemrushBot from the Semrush range without a hostname', () => {
      const result = identity.augment(
        log({ family: 'SemrushBot', address: '85.208.98.18' })
      );
      assert.strictEqual(result.get('identity'), 'Semrush');
    });

    it('should not identify SemrushBot outside the Semrush range', () => {
      const result = identity.augment(
        log({ family: 'SemrushBot', address: '85.208.99.18' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should identify an unlisted crawler by its semrush.com hostname', () => {
      const result = identity.augment(
        log({
          family: 'SemrushBot-XYZ',
          address: '85.208.98.194',
          hostname: '1.bot.semrush.com',
          verified: true,
        })
      );
      assert.strictEqual(result.get('identity'), 'Semrush');
    });

    it('should not identify an unlisted crawler with an unconfirmed hostname', () => {
      const result = identity.augment(
        log({
          family: 'SemrushBot-XYZ',
          address: '8.8.8.8',
          hostname: '1.bot.semrush.com',
        })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });

  describe('Amazon Quick', () => {
    it('should identify Amazon Quick from a published range', () => {
      const result = identity.augment(
        log({ family: 'amazon-Quick-on-behalf-of', address: '52.23.63.230' })
      );
      assert.strictEqual(result.get('identity'), 'Amazon Quick');
    });

    it('should identify Amazon Quick in another region', () => {
      const result = identity.augment(
        log({ family: 'amazon-Quick-on-behalf-of', address: '52.210.255.244' })
      );
      assert.strictEqual(result.get('identity'), 'Amazon Quick');
    });

    it('should not identify Amazon Quick outside the published ranges', () => {
      // Elsewhere in AWS us-east-1
      const result = identity.augment(
        log({ family: 'amazon-Quick-on-behalf-of', address: '52.23.63.200' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should not identify another agent from an Amazon Quick range', () => {
      const result = identity.augment(
        log({ family: 'curl', address: '52.23.63.230' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });

  describe('GitHub Camo', () => {
    it('should identify github-camo from a GitHub service range', () => {
      const result = identity.augment(
        log({ family: 'github-camo', address: '140.82.115.88' })
      );
      assert.strictEqual(result.get('identity'), 'GitHub Camo');
    });

    it('should identify github-camo from 9.234.0.0/17', () => {
      const result = identity.augment(
        log({ family: 'github-camo', address: '9.234.106.63' })
      );
      assert.strictEqual(result.get('identity'), 'GitHub Camo');
    });

    it('should not identify github-camo from another Actions range', () => {
      const result = identity.augment(
        log({ family: 'github-camo', address: '4.148.0.1' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should not identify github-camo outside the published ranges', () => {
      const result = identity.augment(
        log({ family: 'github-camo', address: '203.0.113.7' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should not identify another agent from a GitHub range', () => {
      const result = identity.augment(
        log({ family: 'Chrome', address: '9.234.106.63' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });

  describe('Google', () => {
    it('should identify the Google Docs proxy by its parsed family', () => {
      const result = identity.augment(
        log({
          family: 'docs.google.com',
          address: '74.125.208.67',
          hostname: 'google-proxy-74-125-208-67.google.com',
        })
      );
      assert.strictEqual(result.get('identity'), 'Google');
    });

    it('should not identify the Google Docs proxy without a google.com hostname', () => {
      const result = identity.augment(
        log({ family: 'docs.google.com', address: '203.0.113.7' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });

  describe('Linkup', () => {
    it('should identify an address in the published list', () => {
      const result = identity.augment(
        log({ family: 'LinkupBot', address: '35.198.113.100' })
      );
      assert.strictEqual(result.get('identity'), 'Linkup');
    });

    it('should not identify an address outside the published list', () => {
      const result = identity.augment(
        log({ family: 'LinkupBot', address: '35.198.113.101' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });
  });
});

describe('identity aggregator', () => {
  before(() => identity.start());

  it('links identities to their logs in HTML', () => {
    html.registerSection('logs');
    const { aggregator } = identity;
    aggregator.processLog(
      fromJS({
        request: { address: '66.249.66.1' },
        address: { value: '66.249.66.1' },
        identity: 'Googlebot',
        executionTime: 1,
      })
    );

    const entry = aggregator.entries.first();
    const formatted = aggregator.formatter.formatObject(entry, 'html');
    assert.match(
      formatted.identity,
      /<a href="logs\/main\?identity=Googlebot">Googlebot<\/a>/
    );
    const text = aggregator.formatter.formatObject(entry, 'text');
    assert.strictEqual(text.identity, 'Googlebot');
    assert.ok(!('agent' in text));
  });

  it('colors the hostname', () => {
    assert.strictEqual(identity.aggregator.formatter.colors.hostname, 'cyan');
  });

  it('shows and links the key of unnamed identities in HTML', () => {
    const { aggregator } = identity;
    aggregator.reset();
    aggregator.processLog(
      fromJS({
        request: { address: '10.0.0.5' },
        address: { value: '10.0.0.5' },
        executionTime: 1,
      })
    );

    const entry = aggregator.entries.first();
    assert.match(
      aggregator.formatter.formatObject(entry, 'html').identity,
      /<a href="logs\/main\?identity=10\.0\.0\.5" class="grey">10\.0\.0\.5<\/a>/
    );
    assert.strictEqual(
      aggregator.formatter.formatObject(entry, 'text').identity,
      ''
    );
  });
});

describe('identity filter', () => {
  const named = fromJS({ identity: 'Bing', address: { value: '1.1.1.1' } });
  const unnamed = fromJS({ address: { value: '1.1.1.1' } });

  it('keeps the logs of a named identity', () => {
    assert.ok(logMatches(named, { identity: 'Bing' }));
    assert.ok(!logMatches(unnamed, { identity: 'Bing' }));
  });

  it('keeps the logs of an unnamed identity by its address', () => {
    assert.ok(logMatches(unnamed, { identity: '1.1.1.1' }));
    // Logs with a name belong to that identity, not to the address
    assert.ok(!logMatches(named, { identity: '1.1.1.1' }));
  });
});
