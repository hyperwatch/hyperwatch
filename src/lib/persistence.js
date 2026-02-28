const debug = require('debug')('hyperwatch:persistence');

const fs = require('fs');
const path = require('path');

const aggregators = {};

function register(name, aggregator) {
  aggregators[name] = aggregator;
}

function dump(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const [name, aggregator] of Object.entries(aggregators)) {
    const data = aggregator.dump();
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data));
  }
  debug(`Dumped ${Object.keys(aggregators).length} aggregator(s) to ${dir}`);
}

function load(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let loaded = 0;
  for (const file of files) {
    const name = path.basename(file, '.json');
    if (aggregators[name]) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      aggregators[name].load(data);
      loaded += data.length;
    }
  }
  if (loaded) {
    debug(`Loaded ${loaded} entries from ${dir}`);
  }
}

module.exports = { register, dump, load };
