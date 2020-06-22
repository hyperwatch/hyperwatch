const { mapValues } = require('lodash');

const agentRegexes = require('./regexes-agent');
const coreRegexes = require('./regexes-core');
const deviceRegexes = require('./regexes-device');
const extraRegexes = require('./regexes-extra');
const osRegexes = require('./regexes-os');

function compileRegex(entry) {
  entry.regex = new RegExp(entry.regex, entry.regex_flag || '');
  return entry;
}

module.exports = {
  agent: agentRegexes.map(compileRegex),
  device: deviceRegexes.map(compileRegex),
  os: osRegexes.map(compileRegex),
  extra: extraRegexes.map(compileRegex),
  core: mapValues(coreRegexes, (regexes) => regexes.map(compileRegex)),
};
