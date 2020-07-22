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
    case 'GoogleDocs':
    case 'Google Favicon':
    case 'GoogleImageProxy':
      return hostname && hostname.endsWith('.google.com')
        ? log.set('identity', 'Google')
        : log;
    case 'Baiduspider':
    case 'Baiduspider-render':
    case 'Baiduspider-image':
      return hostname && hostname.endsWith('.baidu.com')
        ? log.set('identity', 'Baidu')
        : log;
    case 'BingBot':
    case 'BingPreview':
      return hostname && hostname.endsWith('.search.msn.com')
        ? log.set('identity', 'Bing')
        : log;
    case 'YandexBot':
    case 'YandexImages':
    case 'YandexMobileBot':
    case 'YandexAccessibilityBot':
      return hostname && hostname.endsWith('.yandex.com')
        ? log.set('identity', 'Yandex')
        : log;
    case 'SemrushBot':
      return hostname && hostname.endsWith('.semrush.com')
        ? log.set('identity', 'Semrush')
        : log;
    case 'PingdomBot':
      return hostname && hostname.endsWith('.pingdom.com')
        ? log.set('identity', 'Pingdom')
        : log;
    case 'archive.org bot':
    case 'special archiver':
      return hostname && hostname.endsWith('.archive.org')
        ? log.set('identity', 'Archive.org')
        : log;
    case 'Sogou web spider':
    case 'Sogou Pic Spider':
      return hostname && hostname.endsWith('.sogou.com')
        ? log.set('identity', 'Sogou')
        : log;
    case 'MojeekBot':
      return hostname && hostname.endsWith('.mojeek.com')
        ? log.set('identity', 'Mojeek')
        : log;
    case 'BLEXBot':
      return hostname && hostname.endsWith('.webmeup.com')
        ? log.set('identity', 'WebMeUp')
        : log;
    case 'PetalBot':
      return hostname && hostname.endsWith('.aspiegel.com')
        ? log.set('identity', family)
        : log;
    case 'AhrefsBot':
      return hostname && hostname.endsWith('.ahrefs.com')
        ? log.set('identity', 'Ahrefs')
        : log;
    case 'Pinterestbot':
      return hostname && hostname.endsWith('.pinterest.com')
        ? log.set('identity', 'Pinterest')
        : log;
    case 'Yeti':
      return hostname && hostname.endsWith('.naver.com')
        ? log.set('identity', 'Naver')
        : log;
    case 'FacebookBot':
      return hostname && hostname.endsWith('.fbsv.net')
        ? log.set('identity', 'Facebook')
        : log;
    case 'Stripe':
      return hostname && hostname.endsWith('.stripe.com')
        ? log.set('identity', family)
        : log;
    case 'UptimeRobot':
      return hostname && hostname.endsWith('.uptimerobot.com')
        ? log.set('identity', 'Uptime Robot')
        : log;
    case 'Coc Coc Bot':
    case 'Coc Coc Bot Image':
      return hostname && hostname.endsWith('.coccoc.com')
        ? log.set('identity', 'Coc Coc')
        : log;
    case 'DuckDuckGo':
    case 'DuckDuckBot-Https':
    case 'DuckDuckGo-Favicons-Bot':
      return hostname && hostname.endsWith('.duckduckgo.com')
        ? log.set('identity', 'DuckDuckGo')
        : log;
    case 'MJ12bot':
      return hostname && hostname.endsWith('.mj12bot.com')
        ? log.set('identity', 'Majestic')
        : log;
    case 'Yahoo':
      return hostname && hostname.endsWith('.crawl.yahoo.net')
        ? log.set('identity', family)
        : log;
    case 'Sirportly t.co expander':
      return hostname && hostname.endsWith('.labs.k.io')
        ? log.set('identity', 'Sirportly')
        : log;
    case 'Bytespider':
      return hostname && hostname.endsWith('.crawl.bytedance.com')
        ? log.set('identity', family)
        : log;
    case 'Mail.RU Bot':
    case 'Mail.RU Bot Img':
      return hostname && hostname.endsWith('.go.mail.ru')
        ? log.set('identity', 'Mail.RU')
        : log;
    case 'alexa site audit':
      return hostname && hostname.endsWith('.alexa.com')
        ? log.set('identity', 'Alexa')
        : log;
    case 'LinkedInBot':
      return hostname && hostname.endsWith('.linkedin.com')
        ? log.set('identity', 'LinkedIn')
        : log;
    case 'YahooMailProxy':
      return hostname && hostname.endsWith('.yahoo.net')
        ? log.set('identity', 'Yahoo')
        : log;
    case 'YisouSpider':
      return hostname && hostname.endsWith('.crawl.sm.cn')
        ? log.set('identity', 'Shenma')
        : log;

    // Per hostname + CIDR
    case 'Twitterbot':
      return (hostname && hostname.endsWith('.twttr.com')) ||
        (address && new IPCIDR('199.16.156.0/22').contains(address))
        ? log.set('identity', 'Twitter')
        : log;
    case 'SeznamBot':
      return (hostname && hostname.endsWith('.seznam.cz')) ||
        (address && new IPCIDR('2a02:598::/32').contains(address))
        ? log.set('identity', 'Seznam')
        : log;

    // Per CIDR
    case 'github-camo':
      return address && new IPCIDR('140.82.112.0/20').contains(address)
        ? log.set('identity', 'GitHub')
        : log;
    case 'DotBot':
      return address && new IPCIDR('216.244.64.0/19').contains(address)
        ? log.set('identity', 'Moz')
        : log;
    case '360Spider':
      return address && new IPCIDR('42.236.10.0/24').contains(address)
        ? log.set('identity', family)
        : log;
    case 'Daum':
      return address && new IPCIDR('203.133.160.0/19').contains(address)
        ? log.set('identity', family)
        : log;

    // EC2
    case 'Raven':
    case 'Shields.io':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', family)
        : log;
    case 'Slackbot-LinkExpanding':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', 'Slack')
        : log;
    case 'MBCrawler':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', 'Monitor Backlinks')
        : log;
    case 'HappyApps-WebCheck':
      return hostname && hostname.endsWith('.compute-1.amazonaws.com')
        ? log.set('identity', 'Happy Apps')
        : log;
    case 'Riddler':
      return hostname && hostname.endsWith('.eu-west-1.compute.amazonaws.com')
        ? log.set('identity', 'Riddler')
        : log;
    case 'Cliqzbot':
      return hostname &&
        hostname.endsWith('.eu-central-1.compute.amazonaws.com')
        ? log.set('identity', 'Cliqz')
        : log;

    // GCE
    case 'VelenPublicWebCrawler':
      return hostname && hostname.endsWith('.googleusercontent.com')
        ? log.set('identity', 'Velen')
        : log;

    // Hetzner
    case 'Ubermetrics':
      return hostname && hostname.endsWith('.your-server.de')
        ? log.set('identity', 'Ubermetrics')
        : log;
  }

  // Hostname only
  if (hostname && !log.has('identity')) {
    if (hostname.endsWith('.googlebot.com')) {
      return log.set('identity', 'Googlebot');
    }
    if (hostname.endsWith('.search.msn.com')) {
      return log.set('identity', 'Bing');
    }
    if (hostname.endsWith('.crawl.sogou.com')) {
      return log.set('identity', 'Sogou');
    }
    if (hostname.endsWith('.crawl.sm.cn')) {
      return log.set('identity', 'Shenma');
    }
  }

  return log;
}

const identifier = (log) =>
  log.getIn(['identity']) ||
  log.getIn(['address', 'value']) ||
  log.getIn(['request', 'address']);

function load() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

function beforeStart() {
  const aggregator = new Aggregator();

  aggregator.setIdentifier(identifier);

  pipeline.getNode('main').map((log) => aggregator.processLog(log));

  api.registerAggregator('identities', aggregator);
}

module.exports = {
  augment,
  load,
  beforeStart,
};