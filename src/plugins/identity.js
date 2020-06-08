const IPCIDR = require('ip-cidr');

function augment(log) {
  const family = log.getIn(['useragent', 'family']);
  const hostname = log.getIn(['address', 'hostname']);
  const address =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  switch (family) {
    // Per hostname
    case 'Applebot':
      return hostname && hostname.endsWith('.apple.com')
        ? log.set('identity', family)
        : log;
    case 'Googlebot':
      return hostname && hostname.endsWith('.googlebot.com')
        ? log.set('identity', family)
        : log;
    case 'GoogleImageProxy':
      return hostname && hostname.endsWith('.google.com')
        ? log.set('identity', family)
        : log;
    case 'Baidu':
      return hostname && hostname.endsWith('.baidu.com')
        ? log.set('identity', family)
        : log;
    case 'Bing':
      return hostname && hostname.endsWith('.msn.com')
        ? log.set('identity', family)
        : log;
    case 'Yandex':
      return hostname && hostname.endsWith('.yandex.com')
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
    case 'Sogou':
      return hostname && hostname.endsWith('.sogou.com')
        ? log.set('identity', family)
        : log;
    case 'Mojeek':
      return hostname && hostname.endsWith('.mojeek.com')
        ? log.set('identity', family)
        : log;
    case 'BLEXBot':
      return hostname && hostname.endsWith('.webmeup.com')
        ? log.set('identity', family)
        : log;
    case 'PetalBot':
      return hostname && hostname.endsWith('.aspiegel.com')
        ? log.set('identity', family)
        : log;
    case 'Ahrefs':
      return hostname && hostname.endsWith('.ahrefs.com')
        ? log.set('identity', family)
        : log;
    case 'Pinterest':
      return hostname && hostname.endsWith('.pinterest.com')
        ? log.set('identity', family)
        : log;
    case 'Naver':
      return hostname && hostname.endsWith('.naver.com')
        ? log.set('identity', family)
        : log;
    case 'Facebook':
      return hostname && hostname.endsWith('.fbsv.net')
        ? log.set('identity', family)
        : log;
    case 'Stripe':
      return hostname && hostname.endsWith('.stripe.com')
        ? log.set('identity', family)
        : log;

    // Per hostname + CIDR
    case 'Twitterbot':
      return (hostname && hostname.endsWith('.twttr.com')) ||
        (address && new IPCIDR('199.16.156.0/22').contains(address))
        ? log.set('identity', family)
        : log;

    // Per CIDR
    case 'GitHub Camo':
      return address && new IPCIDR('140.82.112.0/20').contains(address)
        ? log.set('identity', family)
        : log;
    case 'Seznam':
      return address && new IPCIDR('2a02:598::/32').contains(address)
        ? log.set('identity', family)
        : log;

    // EC2
    case 'Raven':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', family)
        : log;
    case 'Monitor Backlinks':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', family)
        : log;
    case 'Shields.io':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', family)
        : log;
    case 'Slackbot':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', family)
        : log;
  }

  return log;
}

module.exports = {
  augment,
};
