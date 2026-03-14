const debug = require('debug')('hyperwatch:persistence');

const fs = require('fs');
const path = require('path');

const aggregators = Object.create(null);

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function register(name, aggregator) {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`Invalid aggregator name for persistence: "${name}"`);
  }
  aggregators[name] = aggregator;
}

function dump(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const [name, aggregator] of Object.entries(aggregators)) {
    const data = aggregator.dump();
    const target = path.join(dir, `${name}.json`);
    const tmp = path.join(dir, `${name}.json.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, target);
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
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!Array.isArray(data)) {
          debug(`Skipping ${file}: expected array, got ${typeof data}`);
          continue;
        }
        aggregators[name].load(data);
        loaded += data.length;
      } catch (err) {
        debug(`Skipping ${file}: ${err.message}`);
      }
    }
  }
  if (loaded) {
    debug(`Loaded ${loaded} entries from ${dir}`);
  }
}

module.exports = { register, dump, load };
