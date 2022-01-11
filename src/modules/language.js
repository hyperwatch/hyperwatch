const acceptLanguageParser = require('accept-language-parser');
const { fromJS } = require('immutable');

const aggregator = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');

function augment(log) {
  if (log.hasIn(['request', 'headers', 'accept-language'])) {
    const language = acceptLanguageParser.parse(
      log.getIn(['request', 'headers', 'accept-language'])
    );
    if (language) {
      log = log.set('language', fromJS(language));
    }
  }

  return log;
}

const language = (log) => {
  const code = log.getIn(['language', 0, 'code']);
  if (code) {
    const region = log.getIn(['language', 0, 'region']);
    if (region) {
      return `${code.toLowerCase()} ${region.toUpperCase()}`;
    } else {
      return code.toLowerCase();
    }
  }
};

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('language', language, {
    before: '15m',
    color: 'grey',
  });
}

module.exports = {
  augment,
  init,
};
