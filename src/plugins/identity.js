const IPCIDR = require('ip-cidr');

function augment(log) {
  const family = log.getIn(['useragent', 'family']);
  const hostname = log.getIn(['address', 'hostname']);
  const address =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  switch (family) {
    // Per hostname
    case 'Googlebot':
      return hostname && hostname.endsWith('.googlebot.com')
        ? log.set('identity', family)
        : log;
    case 'Baidu':
      return hostname && hostname.endsWith('.crawl.baidu.com')
        ? log.set('identity', family)
        : log;
    case 'Bing':
      return hostname && hostname.endsWith('.search.msn.com')
        ? log.set('identity', family)
        : log;
    case 'Yandex':
      return hostname && hostname.endsWith('.spider.yandex.com')
        ? log.set('identity', family)
        : log;
    case 'Semrush':
      return hostname && hostname.endsWith('.semrush.com')
        ? log.set('identity', family)
        : log;
    case 'Pingdom':
      return hostname && hostname.endsWith('.pingdom.com')
        ? log.set('identity', family)
        : log;
    case 'Archive.org':
      return hostname && hostname.endsWith('.archive.org')
        ? log.set('identity', family)
        : log;

    // Per CIDR
    case 'GitHub Camo':
      return address && new IPCIDR('140.82.112.0/20').contains(address)
        ? log.set('identity', family)
        : log;
  }

  return log;
}

module.exports = {
  augment,
};
