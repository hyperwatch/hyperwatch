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

  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) BeakerBrowser/0.8.10 Chrome/80.0.3987.141 Electron/8.1.1 Safari/537.36',
    {
      family: 'Beaker Browser',
      major: '0',
      minor: '8',
      patch: '10',
      patch_minor: undefined,
      os: {
        family: 'Windows',
        major: '10',
        minor: undefined,
        patch: undefined,
        patch_minor: undefined,
      },
    },
    'Beaker Browser 0.8.10 / Windows 10',
  ],
];

describe('useragent', () => {
  it('should parse all test cases', () => {
    for (const [ua, json, string] of tests) {
      const agent = useragent.parse(ua);
      assert.deepStrictEqual(agent.toJSON(), json);
      assert.deepStrictEqual(agent.toString(), string);
    }
  });

  it('should re-construct from JSON', () => {
    for (const [ua] of tests) {
      const agentJson = useragent.parse(ua).toJSON();
      const agent = useragent.fromJSON(agentJson);
      assert.deepStrictEqual(agent.toJSON(), agentJson);
    }
  });
});
