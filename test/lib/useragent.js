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

  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) VSCode@FB/1.45.1591656041 Chrome/78.0.3904.130 Electron/7.3.0 Safari/537.36',
    {
      family: 'VSCode@FB',
      major: '1',
      minor: '45',
      patch: '1591656041',
      patch_minor: undefined,
      os: {
        family: 'Mac OS X',
        major: '10',
        minor: '15',
        patch: '5',
        patch_minor: undefined,
      },
      device: {
        brand: 'Apple',
        family: 'Mac',
        model: 'Mac',
      },
    },
    'VSCode@FB 1.45.1591656041 / Mac OS X 10.15.5',
  ],

  [
    'Mozilla/5.0 (compatible)',
    {
      family: 'Mozilla',
      major: '5',
      minor: '0',
      patch: undefined,
      patch_minor: undefined,
    },
    'Mozilla 5.0',
  ],

  [
    'Mozilla/5.0 (compatible;)',
    {
      family: 'Mozilla',
      major: '5',
      minor: '0',
      patch: undefined,
      patch_minor: undefined,
    },
    'Mozilla 5.0',
  ],

  [
    'Mozilla/5.0 (compatible; +http://tweetedtimes.com)',
    {
      family: 'The Tweeted Times',
      major: undefined,
      minor: undefined,
      patch: undefined,
      patch_minor: undefined,
      type: 'robot',
    },
    'The Tweeted Times',
  ],

  [
    'http.rb/4.0.0',
    {
      family: 'http.rb',
      major: '4',
      minor: '0',
      patch: '0',
      patch_minor: undefined,
      type: 'robot',
    },
    'http.rb 4.0.0',
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
