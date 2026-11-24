const assert = require('assert');

const {
  fromExpressRequest,
  fromPattern,
  fromRegExp,
  normalize,
} = require('../../src/lib/route');

describe('route', () => {
  describe('normalize()', () => {
    it('lowercases literals, keeps parameter names', () => {
      assert.strictEqual(
        normalize('/V1/:collectiveSlug/Members'),
        '/v1/:collectiveSlug/members'
      );
    });

    it('drops the query string and the trailing slash', () => {
      assert.strictEqual(normalize('/api/?x=1'), '/api');
      assert.strictEqual(normalize('/'), '/');
      assert.strictEqual(normalize(''), '/');
      assert.strictEqual(normalize('api/users'), '/api/users');
    });
  });

  describe('fromPattern()', () => {
    it('keeps Express 5 patterns', () => {
      assert.strictEqual(
        fromPattern('/v1/:collectiveSlug.json'),
        '/v1/:collectiveSlug.json'
      );
    });

    it('writes a wildcard as *', () => {
      assert.strictEqual(fromPattern('/files/*path'), '/files/*');
      assert.strictEqual(
        fromPattern('/files{/*path}', { path: ['a'] }),
        '/files/*'
      );
      assert.strictEqual(fromPattern('*'), '/*');
    });

    it('keeps an optional part when one of its parameters matched', () => {
      const pattern = '/:slug{.:format}';
      assert.strictEqual(fromPattern(pattern, { slug: 'a' }), '/:slug');
      assert.strictEqual(
        fromPattern(pattern, { slug: 'a', format: 'json' }),
        '/:slug.:format'
      );
    });

    it('keeps an optional part without parameters as written', () => {
      assert.strictEqual(fromPattern('/about{/}'), '/about{/}');
    });

    it('reads escapes as literals', () => {
      assert.strictEqual(fromPattern('/a\\:b'), '/a:b');
    });

    it('reads Express 4 patterns', () => {
      assert.strictEqual(
        fromPattern('/:slug/members/:type(all|users|organizations)', {
          slug: 'babel',
          type: 'users',
        }),
        '/:slug/members/users'
      );
      assert.strictEqual(
        fromPattern('/:slug.:format(json|csv)?', { slug: 'babel' }),
        '/:slug'
      );
      assert.strictEqual(fromPattern('/:id(\\d+)', { id: '42' }), '/:id');
      assert.strictEqual(fromPattern('/:id?', {}), '/');
    });
  });

  describe('fromRegExp()', () => {
    const json = /^(?:\/(?<version>v1))?\/(?<collectiveSlug>[^/]+?)\.json\/?$/i;

    it('writes named groups as :name, keeps fixed words', () => {
      assert.strictEqual(
        fromRegExp(json, '/v1/babel.json'),
        '/v1/:collectiveSlug.json'
      );
      assert.strictEqual(
        fromRegExp(json, '/V1/babel.json/'),
        '/v1/:collectiveSlug.json'
      );
    });

    it('leaves out the groups that did not match', () => {
      assert.strictEqual(
        fromRegExp(json, '/babel.json'),
        '/:collectiveSlug.json'
      );
    });

    it('keeps a fixed alternation', () => {
      assert.strictEqual(
        fromRegExp(
          /^\/(?<slug>[^/]+)\/members\/(?<type>all|users|organizations)(?:\.(?<format>json|csv))?$/,
          '/babel/members/users.csv'
        ),
        '/:slug/members/users.csv'
      );
    });

    it('names unnamed groups by their number, as Express does', () => {
      assert.strictEqual(
        fromRegExp(/^\/users\/(\d+)\/posts\/(\d+)$/, '/users/1/posts/2'),
        '/users/:0/posts/:1'
      );
    });

    it('writes nested groups once, as the outer one', () => {
      assert.strictEqual(
        fromRegExp(/^\/(?<path>(?:[a-z]+\/)*([a-z]+))$/, '/a/b/c'),
        '/:path'
      );
    });

    it('gives nothing when it does not match', () => {
      assert.strictEqual(fromRegExp(json, '/babel.csv'), undefined);
    });

    it('gives nothing when text outside the groups varies', () => {
      assert.strictEqual(fromRegExp(/^\/files\/.*$/, '/files/a'), undefined);
      assert.strictEqual(fromRegExp(/^\/u\/\d+$/, '/u/1'), undefined);
      assert.strictEqual(fromRegExp(/^\/u\/[a-z]+$/, '/u/a'), undefined);
      assert.strictEqual(fromRegExp(/^\/(a)+$/, '/aa'), undefined);
    });

    it('accepts lookarounds and escaped literals', () => {
      assert.strictEqual(
        fromRegExp(/^\/(?!api)(?<page>[^/]+)\.x$/, '/home.x'),
        '/:page.x'
      );
    });

    it('ignores the global and sticky flags', () => {
      const regexp = /^\/(?<a>[^/]+)$/g;
      regexp.lastIndex = 5;
      assert.strictEqual(fromRegExp(regexp, '/x'), '/:a');
    });
  });

  describe('fromExpressRequest()', () => {
    it('gives nothing without a route', () => {
      assert.strictEqual(fromExpressRequest({}), undefined);
    });

    it('prefixes the router mount path', () => {
      assert.strictEqual(
        fromExpressRequest({
          baseUrl: '/API',
          route: { path: '/users/:id/' },
          params: { id: '1' },
        }),
        '/api/users/:id'
      );
      assert.strictEqual(
        fromExpressRequest({ baseUrl: '/api', route: { path: '/' } }),
        '/api'
      );
    });

    it('matches an expression under the mount path', () => {
      assert.strictEqual(
        fromExpressRequest({
          baseUrl: '/api',
          originalUrl: '/api/v1/babel.json?x=1',
          route: {
            path: /^(?:\/(?<version>v1))?\/(?<slug>[^/]+?)\.json$/,
          },
        }),
        '/api/v1/:slug.json'
      );
    });

    it('picks the expression of an array that matched', () => {
      assert.strictEqual(
        fromExpressRequest({
          originalUrl: '/b/1',
          route: { path: [/^\/a\/(?<id>\d+)$/, /^\/b\/(?<id>\d+)$/] },
        }),
        '/b/:id'
      );
      assert.strictEqual(
        fromExpressRequest({
          originalUrl: '/c/1',
          route: { path: [/^\/a\/(?<id>\d+)$/, '/c/:id'] },
        }),
        '/c/:id'
      );
      assert.strictEqual(
        fromExpressRequest({
          originalUrl: '/c/1',
          route: { path: ['/c/:id', '/d/:id'] },
        }),
        undefined
      );
    });
  });
});
