const IPCIDR = require('ip-cidr');

const api = require('../app/api');
const { Aggregator } = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');

function augment(log) {
  const family = log.getIn(['agent', 'family']);
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
    case 'Google':
    case 'Google Docs':
    case 'Google Favicon':
    case 'Google Image Proxy':
      return hostname && hostname.endsWith('.google.com')
        ? log.set('identity', 'Google')
        : log;
    case 'Baidu':
      return hostname && hostname.endsWith('.baidu.com')
        ? log.set('identity', family)
        : log;
    case 'Bing':
      // 40.74.0.0 - 40.125.127.255
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
    case 'Archive-It':
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
    case 'Uptime Robot':
      return hostname && hostname.endsWith('.uptimerobot.com')
        ? log.set('identity', family)
        : log;
    case 'Yisou':
      return hostname && hostname.endsWith('.crawl.sm.cn')
        ? log.set('identity', family)
        : log;
    case 'Coc Coc':
      return hostname && hostname.endsWith('.coccoc.com')
        ? log.set('identity', family)
        : log;
    case 'DuckDuckGo':
      return hostname && hostname.endsWith('.duckduckgo.com')
        ? log.set('identity', family)
        : log;
    case 'Majestic':
      return hostname && hostname.endsWith('.mj12bot.com')
        ? log.set('identity', family)
        : log;
    case 'Yahoo':
      return hostname && hostname.endsWith('.crawl.yahoo.net')
        ? log.set('identity', family)
        : log;
    case 'Sirportly':
      return hostname && hostname.endsWith('.labs.k.io')
        ? log.set('identity', family)
        : log;
    case 'Bytespider':
      return hostname && hostname.endsWith('.crawl.bytedance.com')
        ? log.set('identity', family)
        : log;

    // Per hostname + CIDR
    case 'Twitter':
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
    case 'Moz':
      return address && new IPCIDR('216.244.64.0/19').contains(address)
        ? log.set('identity', family)
        : log;

    // EC2
    case 'Raven':
    case 'Monitor Backlinks':
    case 'Shields.io':
    case 'Slack':
    case 'Happy Apps':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', family)
        : log;

    case 'Riddler':
      return hostname && hostname.endsWith('.eu-west-1.compute.amazonaws.com')
        ? log.set('identity', family)
        : log;
  }

  // Hostname only
  if (hostname && !log.has('identity')) {
    if (hostname.endsWith('.crawl.sogou.com')) {
      log.set('identity', 'Sogou');
    }
  }

  return log;
}

const identifier = (log) =>
  log.getIn(['identity']) ||
  log.getIn(['address', 'value']) ||
  log.getIn(['request', 'address']);

function registerPipeline() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

function register() {
  registerPipeline();
}

function load() {
  const aggregator = new Aggregator();

  aggregator.setIdentifier(identifier);

  pipeline.getNode('main').map((log) => aggregator.processLog(log));

  api.registerAggregator('identities', aggregator);
}

module.exports = {
  augment,
  register,
  load,
};
