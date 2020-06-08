const acceptLanguageParser = require('accept-language-parser');
const { fromJS } = require('immutable');

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

module.exports = {
  augment,
};
