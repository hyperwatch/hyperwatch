const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  build,
  parseAwsService,
  parseData,
  parseKeys,
  parseLines,
  parsePrefixes,
  parseResults,
  parseRoutes,
  parseTableRow,
  refresh,
  removeNested,
  sources,
} = require('../../scripts/lib/published-ips');

const dataDir = path.join(__dirname, '..', '..', 'src', 'data');

// Lists copied by hand: no source to fetch them from
const handCopied = [
  '360spider-ips',
  'amazon-quick-ips',
  'amazon-searchbot-ips',
  'amazon-user-ips',
  'amazonbot-ips',
  'daumbot-ips',
];

// A fetch answering from a map of URL to text, or failing
const fakeFetch = (responses) => async (url) => {
  if (!(url in responses)) {
    throw new Error(`${url}: 404 Not Found`);
  }
  return responses[url];
};

describe('published IP lists', () => {
  describe('parsers', () => {
    it('reads the Googlebot format and its variants', () => {
      const text = JSON.stringify({
        creationTime: '2026-10-15T00:00:00',
        prefixes: [
          { ipv4Prefix: '192.0.2.0/24' },
          { ipv6Prefix: '2001:db8::/32' },
          { ip_prefix: '198.51.100.7/32', service: 'checker' },
          { ipv6_prefix: '2001:db8::1/128' },
          { comment: 'no prefix' },
          '203.0.113.9',
        ],
      });
      assert.deepStrictEqual(parsePrefixes(text), [
        '192.0.2.0/24',
        '2001:db8::/32',
        '198.51.100.7/32',
        '2001:db8::1/128',
        '203.0.113.9',
      ]);
      assert.deepStrictEqual(parsePrefixes('["192.0.2.1"]'), ['192.0.2.1']);
      assert.throws(() => parsePrefixes('{"ranges": []}'), /no prefixes/);
      assert.throws(() => parsePrefixes('<html>'), SyntaxError);
    });

    it('reads every prefix of an entry', () => {
      const text = JSON.stringify({
        prefixes: [{ ipv4Prefix: '192.0.2.0/24', ipv6Prefix: '2001:db8::/44' }],
      });
      assert.deepStrictEqual(parsePrefixes(text), [
        '192.0.2.0/24',
        '2001:db8::/44',
      ]);
    });

    it("reads one service's ranges from a results array", () => {
      const text = JSON.stringify({
        results: [
          { cidr: '192.0.2.0/24', service: 'WEB_SCRAPING' },
          { cidr: '198.51.100.0/24', service: 'EMAIL' },
        ],
      });
      assert.deepStrictEqual(parseResults('WEB_SCRAPING')(text), [
        '192.0.2.0/24',
      ]);
      assert.throws(() => parseResults('WEB_SCRAPING')('{}'), /no results/);
    });

    it('reads the addresses of one table row', () => {
      const html = [
        '<table><tr><td>Crawler name</td><td>examplebot 1.2.3</td></tr>',
        '<tr><td>Official IP addresses</td><td>',
        '<span>192.0.2.1</span><span>192.0.2.2 </span></td></tr>',
        '<tr><td>Other</td><td>198.51.100.1</td></tr></table>',
      ].join('');
      assert.deepStrictEqual(parseTableRow('Official IP addresses')(html), [
        '192.0.2.1',
        '192.0.2.2',
      ]);
      assert.throws(
        () => parseTableRow('Official IP addresses')('<table></table>'),
        /no "Official IP addresses" row/
      );
    });

    it('reads a data array', () => {
      assert.deepStrictEqual(parseData('{"data": ["192.0.2.1"]}'), [
        '192.0.2.1',
      ]);
      assert.throws(() => parseData('{"items": []}'), /no data array/);
    });

    it('reads one entry per line', () => {
      assert.deepStrictEqual(parseLines('192.0.2.1\n  2001:db8::1 \n\n'), [
        '192.0.2.1',
        '2001:db8::1',
      ]);
    });

    it('reads the arrays of the given keys only', () => {
      const parse = parseKeys(['web', 'api']);
      const text = JSON.stringify({
        web: ['192.0.2.0/24'],
        api: ['198.51.100.0/24', { not: 'a range' }],
        actions: ['203.0.113.0/24'],
      });
      assert.deepStrictEqual(parse(text), ['192.0.2.0/24', '198.51.100.0/24']);
      assert.throws(() => parse('{"web": []}'), /no "api" array/);
    });

    it("reads one service's ranges from AWS's list", () => {
      const text = JSON.stringify({
        prefixes: [
          { ip_prefix: '192.0.2.0/24', service: 'CLOUDFRONT' },
          { ip_prefix: '198.51.100.0/24', service: 'EC2' },
        ],
        ipv6_prefixes: [
          { ipv6_prefix: '2001:db8::/32', service: 'CLOUDFRONT' },
        ],
      });
      assert.deepStrictEqual(parseAwsService('CLOUDFRONT')(text), [
        '192.0.2.0/24',
        '2001:db8::/32',
      ]);
      assert.throws(() => parseAwsService('CLOUDFRONT')('{}'), /no prefixes/);
    });

    it('reads the routes of a whois response', () => {
      const text = [
        'route:          192.0.2.0/24',
        'origin:         AS64496',
        'route6:         2001:db8::/32',
        'descr:          route: not this one',
      ].join('\n');
      assert.deepStrictEqual(parseRoutes(text), [
        '192.0.2.0/24',
        '2001:db8::/32',
      ]);
    });

    it('leaves out ranges inside another one, and duplicates', () => {
      assert.deepStrictEqual(
        removeNested([
          '192.0.2.128/25',
          '192.0.2.0/24',
          '192.0.2.0/24',
          '2001:db8::/32',
          '198.51.100.0/24',
        ]),
        ['192.0.2.0/24', '2001:db8::/32', '198.51.100.0/24']
      );
    });
  });

  describe('build', () => {
    const source = {
      name: 'test-ips',
      urls: ['https://example.com/a', 'https://example.com/b'],
      parse: parseLines,
    };

    it('joins the URLs, as ranges, without duplicates', async () => {
      const cidrs = await build(source, {
        fetch: fakeFetch({
          'https://example.com/a': '192.0.2.1\n192.0.2.0/24',
          'https://example.com/b': '2001:db8::1\n192.0.2.1',
        }),
      });
      assert.deepStrictEqual(cidrs, [
        '192.0.2.1/32',
        '192.0.2.0/24',
        '2001:db8::1/128',
      ]);
    });

    it('fails when a URL fails', async () => {
      await assert.rejects(
        build(source, {
          fetch: fakeFetch({ 'https://example.com/a': '192.0.2.1' }),
        }),
        /404/
      );
    });

    it('fails on an empty list', async () => {
      await assert.rejects(
        build(source, {
          fetch: fakeFetch({
            'https://example.com/a': '',
            'https://example.com/b': '\n',
          }),
        }),
        /empty list/
      );
    });

    it('fails on an entry that is not an address or a range', async () => {
      await assert.rejects(
        build(source, {
          fetch: fakeFetch({
            'https://example.com/a': '192.0.2.1',
            'https://example.com/b': '<html>',
          }),
        }),
        /invalid CIDR/
      );
    });

    it('fails when a list needing both families has only one', async () => {
      const both = { ...source, bothFamilies: true };
      await assert.rejects(
        build(both, {
          fetch: fakeFetch({
            'https://example.com/a': '192.0.2.0/24',
            'https://example.com/b': '198.51.100.0/24',
          }),
        }),
        /IPv4 or IPv6/
      );
      const cidrs = await build(both, {
        fetch: fakeFetch({
          'https://example.com/a': '192.0.2.0/24',
          'https://example.com/b': '2001:db8::/32',
        }),
      });
      assert.strictEqual(cidrs.length, 2);
    });
  });

  describe('refresh', () => {
    it('writes the lists that worked and reports the others', async () => {
      const written = {};
      const failed = await refresh(
        [
          {
            name: 'good-ips',
            urls: ['https://example.com/good'],
            parse: parseLines,
          },
          {
            name: 'bad-ips',
            urls: ['https://example.com/bad'],
            parse: parseLines,
          },
          {
            name: 'after-ips',
            urls: ['https://example.com/after'],
            parse: parseLines,
          },
        ],
        {
          fetch: fakeFetch({
            'https://example.com/good': '192.0.2.1',
            'https://example.com/after': '198.51.100.1',
          }),
          write: (name, cidrs) => (written[name] = cidrs),
          log: () => {},
        }
      );
      assert.deepStrictEqual(failed, ['bad-ips']);
      assert.deepStrictEqual(written, {
        'good-ips': ['192.0.2.1/32'],
        'after-ips': ['198.51.100.1/32'],
      });
    });
  });

  describe('sources', () => {
    it('have unique names, URLs and a parser', () => {
      const names = sources.map((source) => source.name);
      assert.strictEqual(new Set(names).size, names.length);
      for (const source of sources) {
        assert.match(source.name, /^[a-z0-9-]+-ips$/);
        assert.ok(source.urls.length > 0, source.name);
        for (const url of source.urls) {
          assert.match(url, /^(https|whois):\/\//, source.name);
        }
        assert.strictEqual(typeof source.parse, 'function', source.name);
      }
    });

    it('cover every list in src/data, except those copied by hand', () => {
      const lists = fs
        .readdirSync(dataDir)
        .filter((file) => file.endsWith('-ips.json'))
        .map((file) => file.replace(/\.json$/, ''))
        .filter((name) => !handCopied.includes(name))
        .sort();
      assert.deepStrictEqual(
        sources.map((source) => source.name).sort(),
        lists
      );
    });

    it('have a valid, non-empty file in src/data', () => {
      for (const { name, bothFamilies } of sources) {
        const cidrs = JSON.parse(
          fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8')
        );
        assert.ok(cidrs.length > 0, name);
        if (bothFamilies) {
          assert.ok(
            cidrs.some((cidr) => cidr.includes(':')),
            name
          );
          assert.ok(
            cidrs.some((cidr) => !cidr.includes(':')),
            name
          );
        }
      }
    });
  });
});
