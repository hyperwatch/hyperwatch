/* eslint-env mocha */

const assert = require('assert');

const useragent = require('../../src/lib/useragent');

const tests = [
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.61 Safari/537.36',
    {
      family: 'Chrome',
      major: '83',
      minor: '0',
      patch: '4103',
      patch_minor: '61',
      device: { family: 'Mac', brand: 'Apple', model: 'Mac' },
      os: {
        family: 'Mac OS X',
        major: '10',
        minor: '10',
        patch: '5',
        patch_minor: undefined,
      },
    },
    'Chrome 83.0.4103.61 / Mac OS X 10.10.5',
  ],
];

describe('useragent', () => {
  it('should parse all test cases', () => {
    for (const [ua, json, string] of tests) {
      const agent = useragent.parse(ua);
      assert.deepStrictEqual(json, agent.toJSON());
      assert.deepStrictEqual(string, agent.toString());
    }
  });

  it('should construct from JSON', () => {
    const agentJson = useragent.parse(tests[0][0]).toJSON();
    const agent = useragent.fromJSON(agentJson);
    assert.deepStrictEqual(agentJson, agent.toJSON());
  });
});
