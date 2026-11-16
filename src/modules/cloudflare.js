const pipeline = require('../lib/pipeline');

/**
 * @param {Log} log
 * @returns {string | undefined}
 */
function getConnectingIp(log) {
  return /** @type {string | undefined} */ (
    log.getIn(['request', 'headers', 'cf-connecting-ip'])
  );
}

/**
 * @param {Log} log
 * @returns {string | undefined}
 */
function getIpCountry(log) {
  return /** @type {string | undefined} */ (
    log.getIn(['request', 'headers', 'cf-ipcountry'])
  );
}

/**
 * @param {Log} log
 * @returns {string | undefined}
 */
function getDataCenter(log) {
  const cfRay = /** @type {string | undefined} */ (
    log.getIn(['request', 'headers', 'cf-ray'])
  );
  if (cfRay) {
    const [, dataCenter] = cfRay.split('-');
    return dataCenter;
  }
}

/** @param {Log} log */
function augment(log) {
  const connectingIp = getConnectingIp(log);
  if (connectingIp) {
    log = log.setIn(['address', 'value'], connectingIp);
  }

  const ipCountry = getIpCountry(log);
  if (ipCountry) {
    log = log.setIn(['address', 'country-code'], ipCountry);
  }

  const dataCenter = getDataCenter(log);
  if (dataCenter) {
    log = log.setIn(['cloudflare', 'data-center'], dataCenter);
  }

  return log;
}

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

module.exports = {
  augment,
  init,
};

/** @typedef {import('../types').Log} Log */
