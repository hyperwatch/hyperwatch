/* eslint-env mocha */

const assert = require('assert');

const { pick } = require('lodash');

const useragent = require('../../src/lib/useragent');

const tests = require('./useragent-extra.json');

const fields = ['family', 'major', 'minor', 'patch', 'patch_minor'];

describe('useragent extra', () => {
  for (const [ua, json] of tests) {
    it(`should parse ${ua}`, () => {
      const agent = useragent.parse(ua, true, true, false);
      assert.deepStrictEqual(pick(agent.toJSON(), fields), json);
    });
  }

  it('should re-construct from JSON', () => {
    for (const [ua] of tests) {
      const agentJson = useragent.parse(ua, true, true, false).toJSON();
      const agent = useragent.fromJSON(agentJson);
      assert.deepStrictEqual(
        pick(agent.toJSON(), fields),
        pick(agentJson, fields)
      );
    }
  });
});
