const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const { createClient } = require('../lib/cloudflare/client');
const expression = require('../lib/cloudflare/expression');
const lists = require('../lib/firewall/lists');
const { migrate } = require('../lib/firewall/migrate');
const sync = require('../lib/firewall/sync');

const USAGE = `Usage: hyperwatch firewall <command> [options]

Commands:
  sync up    Apply firewall.json changes to the linked Cloudflare rules
  sync down  Apply Cloudflare rule changes to firewall.json
             (run "sync down" then "sync up" for a full sync)
  check      Validate firewall.json and each linked list's expression length
  migrate    Convert a legacy rule-based firewall.json into lists

Options:
  --file <path>        firewall.json to use (default: ./firewall.json)
  --state <path>       sync state file (default: next to --file, .sync.json)
  --dry-run            sync: show the plan, change nothing
  --list <id>          sync: only this list
  --out <path>         migrate: output file (default: ./firewall.json)
  --force              migrate: overwrite existing output files

sync reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID from the environment.`;

const PARSE_OPTIONS = {
  file: { type: 'string', default: 'firewall.json' },
  state: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  list: { type: 'string' },
  out: { type: 'string', default: 'firewall.json' },
  force: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

const COMMANDS = ['sync', 'check', 'migrate'];

// Set by run() for the command being executed
let options;
let args;

const statePath = (file) => options.state || sync.defaultStatePath(file);

const short = (id) => (id ? id.slice(0, 8) : '');

function printPlan(items) {
  for (const item of items) {
    const version = item.ruleVersion ? `, v${item.ruleVersion}` : '';
    console.log(`${item.listId} (rule ${short(item.ruleId)}${version})`);
    const line = (label, { add, remove }) => {
      if (add.length || remove.length) {
        const changes = [
          ...add.map((v) => `+${v}`),
          ...remove.map((v) => `-${v}`),
        ];
        console.log(`  ${label}: ${changes.join('  ')}`);
      }
    };
    const down = item.direction === 'down';
    if (down) {
      line('to firewall.json', item.toLocal);
    } else {
      line('to Cloudflare', item.toRemote);
    }
    for (const c of item.conflicts) {
      const [from, to] = down ? [c.local, c.remote] : [c.remote, c.local];
      console.log(
        `  ${c.field}: ${JSON.stringify(from)} -> ${JSON.stringify(to)} ${down ? 'in firewall.json' : 'in Cloudflare'}`
      );
    }
    for (const warning of item.warnings) {
      console.log(`  warning: ${warning}`);
    }
    for (const error of item.errors) {
      console.log(`  error: ${error}`);
    }
    if (!item.errors.length && !sync.hasChanges(item)) {
      console.log('  in sync');
    }
  }
}

async function runSync() {
  const [direction] = args;
  if (!sync.DIRECTIONS.includes(direction)) {
    throw new Error(
      'sync needs a direction: "sync up" (firewall.json to Cloudflare) or "sync down" (Cloudflare to firewall.json)'
    );
  }
  const file = options.file;
  const data = lists.load(file);
  const state = sync.loadState(statePath(file));
  const client = createClient();
  const ruleset = await client.getEntrypoint();

  const items = sync.plan({
    data,
    state,
    ruleset,
    direction,
    only: options.list,
  });
  printPlan(items);
  const failed = items.some((item) => item.errors.length);

  if (options['dry-run']) {
    console.log('\nDry run: nothing changed.');
    return failed ? 1 : 0;
  }

  const result = await sync.apply(items, {
    client,
    originalData: data,
    readData: () => lists.load(file),
    writeData: (next) => lists.save(file, next),
    state,
  });
  console.log('');
  for (const item of result.items) {
    if (item.skipped) {
      console.log(`${item.listId}: skipped (${item.skipped})`);
    } else if (item.patch) {
      console.log(
        `${item.listId}: Cloudflare rule updated to v${item.newVersion}`
      );
    }
  }
  if (result.items.some((item) => item.applied)) {
    sync.saveState(statePath(file), result.state);
    const updated = result.localWritten ? `${file} and ` : '';
    console.log(`${updated}${statePath(file)} updated.`);
  }
  return failed || result.items.some((item) => item.skipped) ? 1 : 0;
}

function runCheck() {
  const data = lists.load(options.file);
  let failed = false;
  for (const list of data.lists) {
    let detail = `${list.entries.length} entries`;
    if (list.cloudflare) {
      try {
        const length = expression.build(list).length;
        detail += `, expression ${length}/${expression.MAX_LENGTH} characters`;
      } catch (err) {
        detail += `, error: ${err.message}`;
        failed = true;
      }
    } else {
      detail += ', local only';
    }
    console.log(`${list.id} (${list.type}, ${list.action}): ${detail}`);
  }
  return failed ? 1 : 0;
}

function runMigrate() {
  const [input] = args;
  if (!input) {
    throw new Error('migrate needs the legacy firewall.json path');
  }
  const out = options.out;
  const legacyOut = path.join(path.dirname(out), 'firewall.legacy.json');
  for (const target of [out, legacyOut]) {
    if (fs.existsSync(target) && !options.force) {
      throw new Error(`${target} exists; pass --force to overwrite`);
    }
  }
  const old = JSON.parse(fs.readFileSync(input, 'utf8'));
  const { firewall, legacy, report } = migrate(old);
  lists.save(out, firewall);
  fs.writeFileSync(legacyOut, `${JSON.stringify(legacy, null, 2)}\n`);

  console.log(`Lists written to ${out}:`);
  for (const [id, count] of Object.entries(report.lists)) {
    console.log(`  ${id}: ${count} entries`);
  }
  console.log(`Backed up to ${legacyOut}:`);
  for (const [reason, count] of Object.entries(report.legacy)) {
    console.log(`  ${count} × ${reason}`);
  }
  return 0;
}

/**
 * Run `hyperwatch firewall <command>` with the arguments after "firewall".
 * Resolves to the process exit code.
 */
async function run(argv) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: PARSE_OPTIONS,
  });
  options = parsed.values;
  const [command, ...rest] = parsed.positionals;
  args = rest;

  if (options.help || !command) {
    console.log(USAGE);
    return command || options.help ? 0 : 1;
  }
  switch (command) {
    case 'sync':
      return runSync();
    case 'check':
      return runCheck();
    case 'migrate':
      return runMigrate();
    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

// Whether `hyperwatch <argv>` is a firewall command rather than a config
// path: "firewall" followed by a known command, an option, or nothing.
function isFirewallCommand(argv) {
  if (argv[0] !== 'firewall') {
    return false;
  }
  const next = argv[1];
  return next === undefined || next.startsWith('-') || COMMANDS.includes(next);
}

module.exports = { run, isFirewallCommand };
