// Checks the published type declarations the way a TypeScript user gets
// them: packs Hyperwatch (prepack generates types/), installs the tarball in
// a temporary project with its dependencies only (and @types/express, an
// optional peer dependency), then type-checks
// test/types/consumer.ts and every published declaration file, strict and
// without skipLibCheck.
//
//   npm run types:test
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
      .toString()
      .trim();
  } catch (err) {
    // What the command printed (tsc reports errors on stdout), then which
    // step failed
    if (err.stdout && err.stdout.length) {
      process.stderr.write(err.stdout);
    }
    console.error(`\`${command} ${args.join(' ')}\` failed`);
    throw err;
  }
}

// The versions Hyperwatch is developed with
function version(name) {
  return JSON.parse(
    fs.readFileSync(
      path.join(root, 'node_modules', name, 'package.json'),
      'utf8'
    )
  ).version;
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperwatch-types-'));
  try {
    const tarball = run(
      'npm',
      ['pack', '--silent', '--pack-destination', tmp],
      root
    )
      .split('\n')
      .pop();
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      `${JSON.stringify({ name: 'consumer', private: true }, null, 2)}\n`
    );
    run(
      'npm',
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--ignore-scripts',
        `./${tarball}`,
        `typescript@${version('typescript')}`,
        `@types/node@${version('@types/node')}`,
        // An optional peer dependency: TypeScript users of Express have it
        `@types/express@${version('@types/express')}`,
      ],
      tmp
    );
    fs.copyFileSync(
      path.join(root, 'test', 'types', 'consumer.ts'),
      path.join(tmp, 'consumer.ts')
    );
    fs.writeFileSync(
      path.join(tmp, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            noEmit: true,
            strict: true,
            module: 'nodenext',
            moduleResolution: 'nodenext',
            target: 'es2023',
            lib: ['es2023'],
            types: ['node'],
            skipLibCheck: false,
          },
          include: [
            'consumer.ts',
            'node_modules/@hyperwatch/hyperwatch/types/**/*.d.ts',
          ],
        },
        null,
        2
      )}\n`
    );
    run(
      path.join(tmp, 'node_modules', '.bin', 'tsc'),
      ['-p', '.', '--pretty', 'false'],
      tmp
    );
    console.log('The published declarations type-check.');
  } catch (err) {
    process.exitCode = 1;
    if (err.status === undefined) {
      console.error(err);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
