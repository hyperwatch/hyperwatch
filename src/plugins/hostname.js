const dns = require('dns').promises;
// const { Map } = require('immutable');

async function lookup(log) {
  const ip = log.getIn(['address', 'value']);
  const reverses = await dns.reverse(ip);
  if (reverses) {
    const reverse = reverses[0];
    log = log.setIn(['hostname', 'value'], reverse);
    try {
      const reverseIps = await dns.resolve(reverse);
      const reverseIp = reverseIps[0];
      console.log(reverseIp, ip);
      if (reverseIp === ip) {
        log = log.setIn(['hostname', 'verified'], true);
      }
    } catch (error) {
      console.log(error);
      // Ignore error
    }
  }
  return log;
}

module.exports = {
  lookup: lookup,
};
