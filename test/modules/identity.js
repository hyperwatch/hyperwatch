const assert = require('assert');

const { fromJS } = require('immutable');

const claudeBotIps = require('../../src/data/claude-bot-ips.json');
const identity = require('../../src/modules/identity.js');

const claudeFamilies = [
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'Claude-Web',
  'anthropic-ai',
];

function log({ family, address, hostname }) {
  return fromJS({
    request: { address },
    address: { value: address, hostname },
    agent: { family },
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

  describe('Meta', () => {
    const metaFamilies = ['meta-externalagent', 'meta-webindexer'];

    it('should identify an address in the Meta allocation', () => {
      for (const family of metaFamilies) {
        const result = identity.augment(
          log({ family, address: '2a03:2880:f800:1::' })
        );
        assert.strictEqual(result.get('identity'), 'Meta');
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

  describe('Reflection', () => {
    it('should identify a reflection.ai hostname', () => {
      const result = identity.augment(
        log({
          family: 'Reflectionbot',
          address: '16.216.88.112',
          hostname: 'reflectionbot-88-112.reflection.ai',
        })
      );
      assert.strictEqual(result.get('identity'), 'Reflection');
    });

    it('should not identify an unverified hostname', () => {
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
        })
      );
      assert.strictEqual(result.get('identity'), 'SEOkicks');
    });

    it('should not identify an unverified hostname', () => {
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
        })
      );
      assert.strictEqual(result.get('identity'), 'Semrush');
    });

    it('should not identify SiteAuditBot without a semrush.com hostname', () => {
      const result = identity.augment(
        log({ family: 'SiteAuditBot', address: '8.8.8.8' })
      );
      assert.strictEqual(result.get('identity'), undefined);
    });

    it('should identify an unlisted crawler by its semrush.com hostname', () => {
      const result = identity.augment(
        log({
          family: 'SemrushBot-XYZ',
          address: '85.208.98.194',
          hostname: '1.bot.semrush.com',
        })
      );
      assert.strictEqual(result.get('identity'), 'Semrush');
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
