const assert = require('assert');
const http = require('http');

const express = require('express');
const { List, fromJS } = require('immutable');

const api = require('../../src/app/api');
const html = require('../../src/app/html');
const monitoring = require('../../src/lib/monitoring');
const { logMatches } = require('../../src/lib/util');
const status = require('../../src/modules/status');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const aggregator = {
  dump: () => [],
  getData: () => List(),
  load() {},
  reset() {},
};

describe('API format routes', () => {
  let server;
  let baseUrl;

  before(async () => {
    api.registerAggregator('format-test', aggregator);
    status.start();

    server = http.createServer(api);
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await close(server);
  });

  for (const path of ['/nodes.xml', '/format-test.xml', '/status.csv']) {
    it(`rejects the unsupported format in ${path}`, async () => {
      const response = await fetch(`${baseUrl}${path}`);
      assert.strictEqual(response.status, 404);
    });
  }

  for (const path of [
    '/nodes',
    '/nodes.json',
    '/nodes.csv',
    '/format-test',
    '/format-test.json',
    '/format-test.csv',
    '/status',
    '/status.txt',
    '/status.json',
  ]) {
    it(`accepts the supported format in ${path}`, async () => {
      const response = await fetch(`${baseUrl}${path}`);
      assert.strictEqual(response.status, 200);
    });
  }
});

describe('API navigation', () => {
  let server;
  let baseUrl;

  before(async () => {
    api.registerAggregator('identities', aggregator, { nav: true });
    status.start();

    const app = express();
    app.use(api);
    app.use('/_hyperwatch', api);
    server = http.createServer(app);
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await close(server);
  });

  it('serves the status page at the root, with the navigation', async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.strictEqual(response.status, 200);
    const body = await response.text();
    assert.match(body, /<nav><a href="\/" class="active">hyperwatch<\/a>/);
    assert.match(body, /<a href="\/identities">identities<\/a>/);
  });

  it('says when an aggregator has no entries yet', async () => {
    const body = await (await fetch(`${baseUrl}/identities`)).text();
    assert.match(body, /No entries yet/);
  });

  it('greys status entries without recent traffic', async () => {
    monitoring.register({ name: 'idle-test', speeds: ['processed'] });
    const busy = monitoring.register({
      name: 'busy-test',
      speeds: ['processed'],
    });
    busy.hit();

    const body = await (await fetch(`${baseUrl}/`)).text();
    assert.match(body, /<tr class="grey"><td>idle-test<\/td>/);
    assert.match(body, /<tr><td>busy-test<\/td>/);
  });

  it('resolves relative links from the mount path', async () => {
    const body = await (
      await fetch(`${baseUrl}/_hyperwatch/identities/`)
    ).text();
    assert.match(body, /<base href="\/_hyperwatch\/">/);
    const root = await (await fetch(`${baseUrl}/identities`)).text();
    assert.match(root, /<base href="\/">/);
  });

  it('shows the path to a node and the nodes below it', () => {
    const tree = {
      name: 'raw',
      children: [
        {
          name: 'main',
          children: [
            {
              op: 'filter',
              children: [{ name: 'a#<b>', children: [] }],
            },
            { name: 'slow', children: [{ name: 'extra-slow', children: [] }] },
          ],
        },
      ],
      inputs: [],
    };
    const req = { baseUrl: '/hw', path: '/logs/main', query: { grep: 'x' } };
    const body = html.nodesNav(req, 'main', tree);
    assert.match(
      body,
      /<a href="\/hw\/logs\/raw\?grep=x">raw<\/a><span class="grey"> › <\/span><strong>main<\/strong>/
    );
    // Named nodes one level below, through unnamed steps, links encoded
    assert.match(
      body,
      /<a href="\/hw\/logs\/a%23%3Cb%3E\?grep=x">a#&lt;b&gt;<\/a>/
    );
    assert.match(body, /<a href="\/hw\/logs\/slow\?grep=x">slow<\/a>/);
    assert.doesNotMatch(body, /extra-slow/);
    assert.strictEqual(html.nodesNav(req, 'unknown', tree), '');
  });

  it('fills the host of input statuses on the status page', async () => {
    monitoring.register({
      name: 'host-test',
      speeds: ['accepted'],
      status: 'Listening on http://__HOST__/input/log',
    });
    const body = await (await fetch(`${baseUrl}/_hyperwatch/`)).text();
    const host = new URL(baseUrl).host;
    assert.ok(
      body.includes(`Listening on http://${host}/_hyperwatch/input/log`)
    );
    const json = await (await fetch(`${baseUrl}/status.json`)).json();
    const entry = json.find((row) => row.name === 'host-test');
    assert.strictEqual(entry.status, `Listening on http://${host}/input/log`);
  });

  it('only links the registered sections', async () => {
    const body = await (await fetch(`${baseUrl}/`)).text();
    assert.doesNotMatch(body, /href="\/format-test"/);
  });

  it('marks the current section as active', async () => {
    const body = await (await fetch(`${baseUrl}/identities`)).text();
    assert.match(body, /<a href="\/identities" class="active">identities/);
    assert.match(body, /<a href="\/">hyperwatch/);
  });

  it('serves the pipeline tree, linked from the navigation', async () => {
    const response = await fetch(`${baseUrl}/pipeline`);
    assert.strictEqual(response.status, 200);
    const body = await response.text();
    assert.match(body, /<a href="\/pipeline" class="active">pipeline<\/a>/);
    assert.match(body, /<div class="tree">/);
  });

  it('links pipeline nodes to their logs, once logs are served', async () => {
    html.registerSection('logs');
    const body = await (await fetch(`${baseUrl}/_hyperwatch/pipeline`)).text();
    assert.match(
      body,
      /<strong><a href="\/_hyperwatch\/logs\/raw">raw<\/a><\/strong>/
    );
  });

  it('prefixes the links with the mount path', async () => {
    const body = await (
      await fetch(`${baseUrl}/_hyperwatch/identities`)
    ).text();
    assert.match(body, /<a href="\/_hyperwatch\/">hyperwatch/);
    assert.match(
      body,
      /<a href="\/_hyperwatch\/identities" class="active">identities/
    );
  });
});

describe('API aggregator columns', () => {
  let server;
  let baseUrl;
  // Replaces the default rows in a test
  let rows;

  afterEach(() => {
    rows = undefined;
  });

  before(async () => {
    api.registerAggregator('columns-test', {
      ...aggregator,
      sorters: { count15m: () => 0, count24h: () => 0, latest: () => 0 },
      getData: () =>
        fromJS(
          rows || [
            {
              name: 'bot',
              count15m: 5,
              count24h: 8,
              '2xx15m': 3,
              os: 'Linux',
              lastSeen: '',
            },
          ]
        ),
    });

    server = http.createServer(api);
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await close(server);
  });

  it('leaves the hidden columns out of the HTML table', async () => {
    const body = await (await fetch(`${baseUrl}/columns-test`)).text();
    assert.match(body, /count15m/);
    assert.doesNotMatch(body, /2xx15m/);
    assert.doesNotMatch(body, /<th>os<\/th>/);
  });

  it('links sortable headings, marking the current sort', async () => {
    const body = await (
      await fetch(`${baseUrl}/columns-test?limit=5&sort=latest`)
    ).text();
    assert.match(body, /<th>name<\/th>/);
    assert.match(
      body,
      /<th><a href="\/columns-test\?limit=5&amp;sort=count15m">count15m<\/a><\/th>/
    );
    assert.match(
      body,
      /<th><a href="\/columns-test\?limit=5&amp;sort=latest" class="sorted">lastSeen ▾<\/a><\/th>/
    );
  });

  it('shows the columns of the last 15 minutes by default', async () => {
    const body = await (await fetch(`${baseUrl}/columns-test`)).text();
    assert.match(body, /<strong>15m<\/strong>/);
    assert.match(body, /<a href="\/columns-test\?period=24h">24h<\/a>/);
    assert.match(body, /count15m/);
    assert.doesNotMatch(body, /count24h/);
  });

  it('shows the columns of the last 24 hours with ?period=24h', async () => {
    const body = await (
      await fetch(`${baseUrl}/columns-test?period=24h`)
    ).text();
    assert.match(body, /<strong>24h<\/strong>/);
    assert.match(body, /<a href="\/columns-test">15m<\/a>/);
    // Sorted by the count of the period by default
    assert.match(body, /class="sorted">count24h ▾/);
    assert.doesNotMatch(body, /count15m/);
  });

  it('moves the sort to the other period when switching', async () => {
    const body = await (
      await fetch(`${baseUrl}/columns-test?sort=count15m&limit=5`)
    ).text();
    assert.match(
      body,
      /<a href="\/columns-test\?sort=count24h&amp;limit=5&amp;period=24h">24h<\/a>/
    );
  });

  it('marks count15m as sorted when the sort is unknown', async () => {
    const body = await (
      await fetch(`${baseUrl}/columns-test?sort=nope`)
    ).text();
    assert.match(body, /sort=count15m" class="sorted">count15m ▾/);
  });

  it('separates thousands in HTML, not in JSON', async () => {
    rows = [{ name: 'big', count15m: 1234567, count24h: 0 }];
    const body = await (await fetch(`${baseUrl}/columns-test`)).text();
    assert.match(body, /<td>1,234,567<\/td>/);
    const json = await (await fetch(`${baseUrl}/columns-test.json`)).json();
    assert.strictEqual(json[0].count15m, 1234567);
  });

  it('keeps the hidden columns in JSON', async () => {
    const rows = await (await fetch(`${baseUrl}/columns-test.json`)).json();
    assert.strictEqual(rows[0]['2xx15m'], 3);
    assert.strictEqual(rows[0].os, 'Linux');
  });
});

describe('API log streams', () => {
  let server;
  let baseUrl;
  let emit;

  before(async () => {
    const stream = {
      map(fn) {
        emit = fn;
      },
    };
    const formatter = { format: (log) => log.get('line') };
    const logs = ['c', 'b', 'a'].map((line, i) =>
      fromJS({ line, address: { value: `10.0.0.${3 - i}` } })
    );
    api.streamToHttp('/stream-test', stream, formatter, {
      // Newest first, like history.latest()
      history: (limit, filters) =>
        logs.filter((log) => logMatches(log, filters)).slice(0, limit),
    });

    server = http.createServer(api);
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await close(server);
  });

  // Reads the stream until it includes `until`, then closes it
  async function read(path, until) {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '';
    while (!body.includes(until)) {
      const { value } = await reader.read();
      body += decoder.decode(value);
      if (body.includes('<main class="stream">')) {
        emit(fromJS({ line: 'live', address: { value: '10.0.0.2' } }));
      }
    }
    controller.abort();
    return body.slice(body.indexOf('</nav>'));
  }

  it('starts with the latest history, oldest first', async () => {
    const body = await read('/stream-test', '<div>live</div>');
    assert.match(body, /<div>a<\/div><div>b<\/div><div>c<\/div>.*live/);
  });

  it('limits the history with ?history=', async () => {
    const body = await read('/stream-test?history=1', '<div>live</div>');
    assert.doesNotMatch(body, /<div>b<\/div>/);
    assert.match(body, /<div>c<\/div>/);
  });

  it('keeps the logs of one address with ?address=', async () => {
    const body = await read('/stream-test?address=10.0.0.2', '<div>live</div>');
    assert.match(body, /Only logs with address 10\.0\.0\.2/);
    assert.match(body, /<div>b<\/div>/);
    assert.doesNotMatch(body, /<div>[ac]<\/div>/);
  });

  it('skips the history with ?history=0', async () => {
    const body = await read('/stream-test?history=0', '<div>live</div>');
    assert.doesNotMatch(body, /<div>[abc]<\/div>/);
  });
});

describe('API lastSeen', () => {
  let server;
  let baseUrl;
  let rows;

  const today = new Date().toISOString().slice(0, 10);

  before(async () => {
    api.registerAggregator('dates-test', {
      ...aggregator,
      getData: () => fromJS(rows),
    });

    server = http.createServer(api);
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await close(server);
  });

  it('only shows the time when every row is from today', async () => {
    rows = [
      { name: 'a', lastSeen: `${today}&nbsp;12:51:07` },
      { name: 'b', lastSeen: '' },
    ];
    const body = await (await fetch(`${baseUrl}/dates-test`)).text();
    assert.match(body, /<td>12:51:07<\/td>/);
  });

  it('shows dates when a row is from another day', async () => {
    rows = [
      { name: 'a', lastSeen: `${today}&nbsp;12:51:07` },
      { name: 'b', lastSeen: '2020-01-01&nbsp;08:00:00' },
    ];
    const body = await (await fetch(`${baseUrl}/dates-test`)).text();
    assert.match(body, new RegExp(`<td>${today}&nbsp;12:51:07</td>`));
    assert.match(body, /<td>2020-01-01&nbsp;08:00:00<\/td>/);
  });
});
