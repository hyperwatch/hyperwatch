const Table = require('easy-table');
const { Map } = require('immutable');

const api = require('../app/api');
const pipeline = require('../lib/pipeline');
const { Speed } = require('../lib/speed');
const { aggregateSpeed } = require('../lib/util');

let addresses = new Map();

let mapper = (entry) => ({
  address:
    entry.getIn(['address', 'hostname']) ||
    entry.getIn(['address', 'value']) ||
    entry.getIn(['request', 'address']),
  '15m': aggregateSpeed(entry, 'per_minute'),
  '24h': aggregateSpeed(entry, 'per_hour'),
});

function setMapper(fn) {
  mapper = fn;
}

let enricher = (entry, log) => {
  for (const field of ['address', 'hostname', 'cloudflare', 'geoip', 'dnsbl']) {
    if (!entry.get(field) && log.has(field)) {
      entry = entry.set(field, log.get(field));
    }
  }
  return entry;
};

function setEnricher(fn) {
  enricher = fn;
}

function load() {
  pipeline.getNode('main').map((log) => {
    const address =
      log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

    if (!addresses.has(address)) {
      addresses = addresses
        .setIn([address, 'speed', 'per_minute'], new Speed(60, 15).hit())
        .setIn([address, 'speed', 'per_hour'], new Speed(3600, 24).hit());
    } else {
      addresses = addresses
        .updateIn([address, 'speed', 'per_minute'], (speed) => speed.hit())
        .updateIn([address, 'speed', 'per_hour'], (speed) => speed.hit());
    }

    addresses = addresses.updateIn([address], (address) =>
      enricher(address, log)
    );
  });

  api.get('/addresses(.:format(txt|json))?', (req, res) => {
    const counts = addresses
      .map((address) => aggregateSpeed(address, 'per_minute'))
      .sort()
      .reverse()
      .slice(0, 100);

    const data = Object.keys(counts.toJS()).map((address) =>
      mapper(addresses.get(address), req.params.format)
    );

    if (req.params.format === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.send(Table.print(data));
    } else {
      res.send(data);
    }
  });
}

module.exports = { load, setMapper, setEnricher };
