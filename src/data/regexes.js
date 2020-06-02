const agentRegexes = require('./regexes-agent');
const deviceRegexes = require('./regexes-device');
const osRegexes = require('./regexes-os');

function compileRegex(entry) {
  entry.regex = new RegExp(entry.regex, entry.regex_flag || '');
  return entry;
}

module.exports = {
  agent: agentRegexes.map(compileRegex),
  os: osRegexes.map(compileRegex),
  device: deviceRegexes.map(compileRegex),
};
