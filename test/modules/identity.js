const assert = require('assert');

const { fromJS } = require('immutable');

const claudeBotIps = require('../../src/data/claude-bot-ips.json');
const identity = require('../../src/modules/identity.js');

const claudeFamilies = {
  ClaudeBot: 'Claude',
  'Claude-User': 'Claude User',
  'Claude-SearchBot': 'Claude SearchBot',
  'Claude-Web': 'Claude Web',
  'anthropic-ai': 'Anthropic',
};

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
      for (const family of Object.keys(claudeFamilies)) {
        const result = identity.augment(log({ family, address: '8.8.8.8' }));
        assert.strictEqual(result.get('identity'), undefined);
      }
    });

    // Skipped until `node scripts/fetch-anthropic-ips.js` has been run
    (claudeBotIps.length > 0 ? it : it.skip)(
      'should identify every Claude family from a published range',
      () => {
        const address = claudeBotIps[0].split('/')[0];
        for (const [family, expected] of Object.entries(claudeFamilies)) {
          const result = identity.augment(log({ family, address }));
          assert.strictEqual(result.get('identity'), expected);
        }
      }
    );
  });
});
