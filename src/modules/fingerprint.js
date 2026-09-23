const { is } = require('immutable');

const api = require('../app/api');
const { Aggregator } = require('../lib/aggregator');
const { Formatter, colorize } = require('../lib/formatter');
const logger = require('../lib/logger');
const pipeline = require('../lib/pipeline');
const { aggregateCount, aggregateSum, formatDuration } = require('../lib/util');

const { agentFormat } = require('./agent');

// Engine family classification

const chromiumFamilies = new Set([
  'Chrome',
  'Chrome Mobile',
  'Chrome Mobile WebView',
  'Chrome Mobile iOS',
  'Chromium',
  'Chrome WebView',
  'Samsung Internet',
  'Brave',
  'Vivaldi',
  'Yandex Browser',
  'Opera Mobile',
  'Opera',
  'UC Browser',
]);

const firefoxFamilies = new Set(['Firefox', 'Firefox Mobile', 'Firefox iOS']);

const webkitFamilies = new Set([
  'Safari',
  'Mobile Safari',
  'Mobile Safari UI/WKWebView',
]);

function getEngine(family, major) {
  if (chromiumFamilies.has(family)) {
    return 'chromium';
  }
  // Edge 79+ is Chromium-based
  if (family === 'Edge' && major >= 79) {
    return 'chromium';
  }
  // Opera 15+ is Chromium-based
  if (family === 'Opera' && major >= 15) {
    return 'chromium';
  }
  if (firefoxFamilies.has(family)) {
    return 'firefox';
  }
  if (webkitFamilies.has(family)) {
    return 'webkit';
  }
  return null;
}

// Version freshness: estimate age in months from anchor versions

function estimateAge(engine, major) {
  if (!major || major <= 0) {
    return null;
  }

  switch (engine) {
    case 'chromium':
      // Chrome 145 ≈ Feb 2026, ~4 weeks per major
      return Math.max(0, ((145 - major) * 4) / 4.3);
    case 'firefox':
      // Firefox 148 ≈ Feb 2026, ~4 weeks per major
      return Math.max(0, ((148 - major) * 4) / 4.3);
    case 'webkit':
      // Safari 26 ≈ Sep 2025, ~12 months per major
      return Math.max(0, (26 - major) * 12);
    default:
      return null;
  }
}

// Check accept-language q-value pattern

function getQValues(acceptLanguage) {
  const parts = acceptLanguage.split(',').map((s) => s.trim());
  const qValues = [];
  for (const part of parts) {
    const match = part.match(/;q=([\d.]+)/);
    if (match) {
      qValues.push(parseFloat(match[1]));
    }
  }
  return qValues;
}

function hasChromeQPattern(qValues) {
  // Chrome decrements by 0.1: q=0.9, q=0.8, q=0.7, ...
  if (qValues.length === 0) {
    return false;
  }
  for (let i = 0; i < qValues.length; i++) {
    const expected = Math.round((0.9 - i * 0.1) * 10) / 10;
    if (expected <= 0) {
      break;
    }
    if (Math.abs(qValues[i] - expected) > 0.01) {
      return false;
    }
  }
  return true;
}

function hasFirefoxQPattern(qValues) {
  // Firefox typically uses larger jumps, e.g. q=0.5 for base fallback
  if (qValues.length === 0) {
    return false;
  }
  // Common Firefox pattern: single q=0.5 or q=0.7 or similar non-0.1-step
  if (qValues.length === 1 && qValues[0] <= 0.7) {
    return true;
  }
  // Check for non-Chrome-like gaps
  for (let i = 0; i < qValues.length - 1; i++) {
    const gap = Math.round((qValues[i] - qValues[i + 1]) * 10) / 10;
    if (gap > 0.15) {
      return true;
    }
  }
  return false;
}

// Main augment function

function augment(log) {
  const family = log.getIn(['agent', 'family']);
  const major = parseInt(log.getIn(['agent', 'major']), 10) || 0;

  const engine = family ? getEngine(family, major) : null;

  // Not a browser engine — skip (bots declaring themselves as bots get score 0)
  if (!engine) {
    return log;
  }

  const flags = [];

  const headers = log.getIn(['request', 'headers']);
  const accept = headers.get('accept');
  const acceptLanguage = headers.get('accept-language');
  const cookie = headers.get('cookie');

  // Accept header checks — skip subrequests (JS, CSS, images, fonts)
  const url = log.getIn(['request', 'url']) || '';
  const isSubrequest =
    /\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?)(\?|$)/i.test(url);

  if (!isSubrequest) {
    if (!accept) {
      flags.push('missing-accept');
    } else if (accept === '*/*') {
      flags.push('accept-star');
    } else if (!accept.includes('text/html') && !accept.includes('image/')) {
      flags.push('accept-mismatch');
    }

    // Engine-specific Accept validation
    // Firefox page Accept: text/html,...,*/*;q=0.8 (never image/apng or image/webp)
    // Chrome page Accept: text/html,...,image/avif,image/webp,image/apng,*/*;q=0.8
    // No browser sends text/plain in Accept for page navigation
    if (accept) {
      if (
        engine === 'firefox' &&
        (accept.includes('image/apng') || accept.includes('image/webp'))
      ) {
        flags.push('accept-engine-mismatch');
      }
      if (
        engine === 'webkit' &&
        (accept.includes('image/apng') || accept.includes('image/webp'))
      ) {
        flags.push('accept-engine-mismatch');
      }
      if (accept.includes('text/plain')) {
        flags.push('accept-nonstandard');
      }
      // Chrome version-specific Accept validation
      // image/apng: added in Chrome 60
      // image/avif: added in Chrome 85
      if (engine === 'chromium') {
        if (major < 60 && accept.includes('image/apng')) {
          flags.push('accept-version-mismatch');
        }
        if (major < 85 && accept.includes('image/avif')) {
          flags.push('accept-version-mismatch');
        }
      }
    }
  }

  // Accept-language checks
  if (!acceptLanguage) {
    flags.push('missing-accept-language');
  } else if (
    acceptLanguage === '*' ||
    /^[a-z]{2}(-[A-Z]{2})?$/i.test(acceptLanguage.trim())
  ) {
    // Just '*' or a single bare tag like 'en' or 'en-US' with no q-values
    if (acceptLanguage === '*' || !acceptLanguage.includes(',')) {
      // Safari often sends just a single locale, so only flag for non-webkit
      if (engine !== 'webkit') {
        flags.push('bare-accept-language');
      }
    }
  } else {
    // Wildcard '*' as a language tag is never sent by real browsers
    if (/(?:^|,)\s*\*\s*(?:;|,|$)/.test(acceptLanguage)) {
      flags.push('language-wildcard');
    }
    // Check q-value pattern consistency with claimed browser
    const qValues = getQValues(acceptLanguage);
    if (qValues.length > 0) {
      if (
        engine === 'chromium' &&
        !hasChromeQPattern(qValues) &&
        hasFirefoxQPattern(qValues)
      ) {
        flags.push('language-mismatch');
      }
    }
  }

  // Version freshness
  const age = estimateAge(engine, major);
  if (age !== null) {
    if (age >= 24) {
      flags.push('ancient-version');
    } else if (age >= 12) {
      flags.push('old-version');
    } else if (age >= 6) {
      flags.push('aging-version');
    }
  }

  // Headless combo: broken accept + missing language is a dead giveaway
  if (
    (flags.includes('accept-star') || flags.includes('missing-accept')) &&
    flags.includes('missing-accept-language')
  ) {
    flags.push('headless-combo');
  }

  let score = Math.min(flags.length * 0.2, 1.0);

  // Positive signals: hard to fake, reduce score

  // sec-ch-ua: Chromium 89+ browsers send Client Hints
  if (engine === 'chromium' && major >= 89) {
    if (headers.get('sec-ch-ua')) {
      score = Math.max(0, score - 0.2);
      flags.push('has-client-hints');
    }
  }

  // sec-fetch-dest/mode: real browser navigation sends these (Chromium 76+, Firefox 90+)
  if (
    headers.get('sec-fetch-dest') === 'document' &&
    headers.get('sec-fetch-mode') === 'navigate'
  ) {
    score = Math.max(0, score - 0.2);
    flags.push('has-sec-fetch');
  }

  // upgrade-insecure-requests: real browsers send "1" on page navigation
  if (!isSubrequest && headers.get('upgrade-insecure-requests') === '1') {
    score = Math.max(0, score - 0.2);
    flags.push('has-upgrade-insecure');
  }

  // Logged-in OC user
  if (
    cookie &&
    (cookie.includes('accessTokenPayload') ||
      cookie.includes('rootRedirectDashboard'))
  ) {
    score = Math.max(0, score - 0.2);
    flags.push('has-session');
  }

  log = log.set('fingerprint', {
    score,
    flags,
    age: age !== null ? Math.round(age * 10) / 10 : null,
  });

  return log;
}

const fingerprintFormat = (log, output) => {
  const fp = log.get('fingerprint');
  if (!fp) {
    return;
  }

  const { score, flags } = fp;

  const positiveFlags = new Set([
    'has-client-hints',
    'has-sec-fetch',
    'has-upgrade-insecure',
    'has-session',
  ]);
  const hasPositive = flags.some((f) => positiveFlags.has(f));
  const hasNegative = flags.some((f) => !positiveFlags.has(f));

  if (score === 0 && !hasPositive) {
    return;
  }

  let label, color;
  if (score === 0 && hasPositive && !hasNegative) {
    label = 'legit';
    color = 'green';
  } else if (score >= 0.6) {
    label = 'suspect';
    color = 'red';
  } else if (score >= 0.4) {
    label = 'unusual';
    color = 'yellow';
  } else {
    label = 'weak';
    color = 'grey';
  }

  const text = score === 0 ? `[${label}]` : `[${label} ${score.toFixed(1)}]`;
  return colorize(color, text, output);
};

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');

  logger.defaultFormatter.insertFormat('fingerprint', fingerprintFormat, {
    after: 'executionTime',
  });
}

function start() {
  const aggregator = new Aggregator();

  aggregator.setIdentifier((log) => log.getIn(['signature', 'id']));

  const fingerprintFormatter = new Formatter();

  fingerprintFormatter.setFormats([
    ['signature', (entry) => entry.getIn(['signature', 'id'])],
    ['identity', (entry) => entry.get('identity')],
    [
      'score',
      (entry) => {
        const fp = entry.get('fingerprint');
        if (!fp) {
          return '0.0';
        }
        const score =
          typeof fp.score === 'number' ? fp.score : fp.get && fp.get('score');
        return score != null ? score.toFixed(1) : '0.0';
      },
    ],
    [
      'flags',
      (entry) => {
        const fp = entry.get('fingerprint');
        if (!fp) {
          return '';
        }
        const flags = fp.flags || (fp.get && fp.get('flags'));
        return flags
          ? (Array.isArray(flags) ? flags : flags.toJS()).join(', ')
          : '';
      },
    ],
    ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
    ['count24h', (entry) => aggregateCount(entry, 'per_hour')],
    [
      'execTime15m',
      (entry) => formatDuration(aggregateSum(entry, 'per_minute')),
    ],
    ['execTime24h', (entry) => formatDuration(aggregateSum(entry, 'per_hour'))],
  ]);

  fingerprintFormatter.insertFormat('agent', agentFormat, {
    before: 'count15m',
    color: 'grey',
  });

  aggregator.setFormatter(fingerprintFormatter);

  aggregator.sorters.score = (entry) => {
    const fp = entry.get('fingerprint');
    if (!fp) {
      return 0;
    }
    if (typeof fp.score === 'number') {
      return fp.score;
    }
    return (fp.get && fp.get('score')) || 0;
  };

  const enricher = (entry, log) => {
    for (const field of [
      'fingerprint',
      'signature',
      'identity',
      'agent',
      'address',
    ]) {
      if (log.has(field) && !is(log.get(field), entry.get(field))) {
        entry = entry.set(field, log.get(field));
      }
    }
    return entry;
  };

  aggregator.setEnricher(enricher);

  pipeline
    .getNode('main')
    .map((log) => aggregator.processLog(log), 'aggregator');

  api.registerAggregator('fingerprint', aggregator);
}

module.exports = {
  augment,
  init,
  start,
};
