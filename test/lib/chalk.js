const assert = require('assert');

const chalk = require('chalk');
const { Map } = require('immutable');

const { colorize, executionTime } = require('../../src/lib/formatter');

describe('chalk integration', () => {
  let originalLevel;

  before(() => {
    // Save and force color support so tests produce ANSI codes even without a TTY
    originalLevel = chalk.level;
    chalk.level = 1;
  });

  after(() => {
    chalk.level = originalLevel;
  });

  describe('chalk color functions exist and return strings', () => {
    const colorsUsed = ['grey', 'magenta', 'cyan', 'green', 'red', 'yellow'];

    colorsUsed.forEach((color) => {
      it(`chalk.${color} is a function and produces output`, () => {
        assert.strictEqual(typeof chalk[color], 'function');
        const result = chalk[color]('test');
        assert.strictEqual(typeof result, 'string');
        assert.ok(result.includes('test'));
        // With forced color level, ANSI codes should be present
        assert.ok(
          result.length > 'test'.length,
          `chalk.${color} should wrap with ANSI codes`
        );
      });
    });
  });

  describe('chalk dynamic access via chalk[name](value)', () => {
    it('supports bracket-notation color access used by colorize', () => {
      const result = chalk['cyan']('hello');
      assert.strictEqual(typeof result, 'string');
      assert.ok(result.includes('hello'));
      assert.ok(result.length > 'hello'.length);
    });
  });

  describe('colorize function with console output', () => {
    it('applies chalk color and returns a string containing the value', () => {
      const result = colorize('green', '50ms', 'console');
      assert.strictEqual(typeof result, 'string');
      assert.ok(result.includes('50ms'));
      assert.ok(result.length > '50ms'.length);
    });

    it('applies each formatter color correctly', () => {
      const colors = ['grey', 'magenta', 'cyan', 'green', 'red', 'yellow'];
      colors.forEach((color) => {
        const result = colorize(color, 'value', 'console');
        assert.ok(
          result.includes('value'),
          `${color} output must contain the original value`
        );
        assert.ok(
          result.length > 'value'.length,
          `${color} output must include ANSI codes`
        );
      });
    });
  });

  describe('colorize function with html output', () => {
    it('returns an html span instead of chalk codes', () => {
      const result = colorize('green', '50ms', 'html');
      assert.strictEqual(result, '<span class="green">50ms</span>');
    });
  });

  describe('colorize function with plain output', () => {
    it('returns the raw value when output is not console or html', () => {
      const result = colorize('green', '50ms', 'plain');
      assert.strictEqual(result, '50ms');
    });
  });

  describe('executionTime formatting', () => {
    function makeLog(ms) {
      return Map({ executionTime: ms });
    }

    it('returns green for fast requests (<=100ms)', () => {
      const result = executionTime(makeLog(50), 'console');
      assert.ok(result.includes('50ms'));
      assert.ok(result.length > '50ms'.length);
    });

    it('returns yellow for medium requests (101-999ms)', () => {
      const result = executionTime(makeLog(500), 'console');
      assert.ok(result.includes('500ms'));
      assert.ok(result.length > '500ms'.length);
    });

    it('returns red for slow requests (>=1000ms)', () => {
      const result = executionTime(makeLog(2000), 'console');
      assert.ok(result.includes('2000ms'));
      assert.ok(result.length > '2000ms'.length);
    });

    it('returns undefined when executionTime is not set', () => {
      const log = Map({});
      const result = executionTime(log, 'console');
      assert.strictEqual(result, undefined);
    });

    it('colors differ between fast, medium, and slow thresholds', () => {
      const fast = executionTime(makeLog(50), 'console');
      const medium = executionTime(makeLog(500), 'console');
      const slow = executionTime(makeLog(2000), 'console');
      // Strip the value text to isolate the ANSI escape sequences
      const fastAnsi = fast.replace('50ms', '');
      const mediumAnsi = medium.replace('500ms', '');
      const slowAnsi = slow.replace('2000ms', '');
      // Each threshold uses a distinct color (green, yellow, red)
      assert.notStrictEqual(fastAnsi, mediumAnsi);
      assert.notStrictEqual(mediumAnsi, slowAnsi);
      assert.notStrictEqual(fastAnsi, slowAnsi);
    });
  });
});
