const pipeline = require('../lib/pipeline');

function getConnectingIp(log) {
  return log.getIn(['request', 'headers', 'cf-connecting-ip']);
}

function getIpCountry(log) {
  return log.getIn(['request', 'headers', 'cf-ipcountry']);
}

function getDataCenter(log) {
  const cfRay = log.getIn(['request', 'headers', 'cf-ray']);
  if (cfRay) {
    const [, dataCenter] = cfRay.split('-');
    return dataCenter;
  }
}

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

function load() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

module.exports = {
  augment,
  load,
};
