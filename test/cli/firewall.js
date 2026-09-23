const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const firewall = require('../../src/cli/firewall');

describe('hyperwatch firewall', () => {
  describe('isFirewallCommand', () => {
    it('routes firewall commands, options and bare "firewall"', () => {
      for (const argv of [
        ['firewall'],
        ['firewall', 'sync', '--dry-run'],
        ['firewall', 'check'],
        ['firewall', 'migrate', 'old.json'],
        ['firewall', '--help'],
      ]) {
        assert.ok(firewall.isFirewallCommand(argv), argv.join(' '));
      }
    });

    it('leaves config paths to start.js', () => {
      for (const argv of [
        [],
        ['api'],
        ['./config/custom.js'],
        ['firewall', 'extra'],
      ]) {
        assert.ok(!firewall.isFirewallCommand(argv), argv.join(' '));
      }
    });
  });

  describe('run', () => {
    let dir;
    let log;
    let error;
    let output;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firewall-cli-'));
      output = [];
      log = console.log;
      error = console.error;
      console.log = (...a) => output.push(a.join(' '));
      console.error = (...a) => output.push(a.join(' '));
    });

    afterEach(() => {
      console.log = log;
      console.error = error;
      fs.rmSync(dir, { recursive: true });
    });

    it('prints usage', async () => {
      assert.strictEqual(await firewall.run(['--help']), 0);
      assert.match(output.join('\n'), /Usage: hyperwatch firewall <command>/);
      assert.strictEqual(await firewall.run([]), 1);
      assert.strictEqual(await firewall.run(['nope']), 1);
    });

    it('migrates a legacy file, then checks it', async () => {
      const legacy = path.join(dir, 'legacy.json');
      const out = path.join(dir, 'firewall.json');
      fs.writeFileSync(
        legacy,
        JSON.stringify({
          rules: [
            {
              id: 'cf-ips',
              action: 'block',
              match: { addresses: ['1.2.3.4'] },
              cloudflare: { id: 'rule-1' },
            },
            { id: 'sig', action: 'block', match: { signature: 'x' } },
          ],
        })
      );

      assert.strictEqual(
        await firewall.run(['migrate', legacy, '--out', out]),
        0
      );
      assert.ok(fs.existsSync(out));
      assert.ok(fs.existsSync(path.join(dir, 'firewall.legacy.json')));

      // Refuses to overwrite without --force
      await assert.rejects(
        firewall.run(['migrate', legacy, '--out', out]),
        /exists; pass --force/
      );

      output = [];
      assert.strictEqual(await firewall.run(['check', '--file', out]), 0);
      assert.match(
        output.join('\n'),
        /block-ips \(ip, block\): 1 entries, expression 21\/4096/
      );
    });
  });
});
