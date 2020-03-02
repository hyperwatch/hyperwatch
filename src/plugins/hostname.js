const dns = require('dns').promises;

async function lookup(log) {
  const ip = log.getIn(['address', 'value']);
  try {
    const reverses = await dns.reverse(ip);
    if (reverses) {
      const reverse = reverses[0];
      log = log.setIn(['hostname', 'value'], reverse);
      log = log.setIn(['address', 'hostname'], reverse);
      const reverseIps = await dns.resolve(reverse);
      const reverseIp = reverseIps[0];
      if (reverseIp === ip) {
        log = log.setIn(['hostname', 'verified'], true);
      }
    }
  } catch (error) {
    // Ignore error
    // console.log(error);
  }
  return log;
}

module.exports = {
  lookup: lookup,
};
