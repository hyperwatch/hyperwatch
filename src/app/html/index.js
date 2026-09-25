// HTML views of the API: minimal pages rendered on the server, with one
// inline stylesheet and small inline scripts. A richer dashboard is a
// separate project.
const fs = require('fs');
const path = require('path');

const { omit } = require('lodash');

const { escapeHtml, formatTable } = require('../../lib/util');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

const stylesheet = read('style.css');
const followScript = read('scripts/follow.js');

// Layout

// Sections shown in the top navigation, in this order, once registered
const order = ['addresses', 'identities', 'logs', 'pipeline'];
const sections = new Set();

function registerSection(name) {
  sections.add(name);
}

function hasSection(name) {
  return sections.has(name);
}

// A link to the main logs kept by a filter (address, identity, signature),
// or the plain value when logs aren't served. The link is relative, so it
// works from any page at the root of the mount path.
function logsLink(filter, value, className) {
  const text = escapeHtml(value || '');
  const classAttribute = className ? ` class="${className}"` : '';
  if (!value || !sections.has('logs')) {
    return className ? `<span${classAttribute}>${text}</span>` : text;
  }
  // The class goes on the link, so its underline has the same color
  return `<a href="logs/main?${filter}=${encodeURIComponent(
    value
  )}"${classAttribute}>${text}</a>`;
}

function isUnder(pathname, path) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

// Links are prefixed with req.baseUrl so they follow the mount path
function nav(req) {
  const base = req.baseUrl || '';
  const home = req.path === '/' || isUnder(req.path, '/status');
  const links = [
    `<a href="${base}/"${home ? ' class="active"' : ''}>hyperwatch</a>`,
  ];
  for (const name of order.filter((name) => sections.has(name))) {
    const path = `/${name}`;
    const active = isUnder(req.path, path);
    links.push(
      `<a href="${base}${path}"${active ? ' class="active"' : ''}>${name}</a>`
    );
  }
  return `<nav>${links.join('')}</nav>`;
}

// The opening part of a page, up to and including the navigation
function head(req, { title, bodyClass } = {}) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>hyperwatch${title ? ` · ${title}` : ''}</title>
<style>${stylesheet}</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>${nav(req)}`;
}

function page(req, options, body) {
  return `${head(req, options)}${body}</body>
</html>`;
}

// Pipeline nodes

// A pipeline node name, linking to its logs when they're served
function nodeLink(req, name) {
  if (!sections.has('logs')) {
    return escapeHtml(name);
  }
  return `<a href="${req.baseUrl}/logs/${encodeURIComponent(
    name
  )}">${escapeHtml(name)}</a>`;
}

function renderTree(req, node) {
  const label = [];
  if (node.name) {
    label.push(`<strong>${nodeLink(req, node.name)}</strong>`);
  }
  if (node.op) {
    label.push(`<span class="op">[${node.op}]</span>`);
  }
  if (node.module) {
    label.push(`<span class="module">(${node.module})</span>`);
  }
  if (node.fnName) {
    label.push(`<span class="fn">${node.fnName}</span>`);
  }
  if (node.label) {
    label.push(`<span class="label">${node.label}</span>`);
  }

  let html = `<li>${label.join(' ')}`;
  if (node.children && node.children.length > 0) {
    html += '<ul>';
    for (const child of node.children) {
      html += renderTree(req, child);
    }
    html += '</ul>';
  }
  html += '</li>';
  return html;
}

function renderInputs(req, inputs) {
  if (!inputs || inputs.length === 0) {
    return '';
  }
  let html = '<ul>';
  for (const input of inputs) {
    html += `<li><strong>${input.name}</strong> <span class="op">[input]</span>`;
    if (input.status) {
      html += ` <span class="module">(${input.status})</span>`;
    }
    html += ` accepted: ${input.accepted}, rejected: ${input.rejected}`;
    if (input.tree) {
      html += `<ul>${renderTree(req, input.tree)}</ul>`;
    }
    html += '</li>';
  }
  html += '</ul>';
  return html;
}

function nodesPage(req, nodes) {
  return page(
    req,
    { title: 'nodes' },
    formatTable(nodes.map((name) => ({ name: nodeLink(req, name) })))
  );
}

function pipelinePage(req, tree) {
  return page(
    req,
    { title: 'pipeline' },
    `<div class="tree">${renderInputs(req, tree.inputs)}<ul>${renderTree(req, tree)}</ul></div>`
  );
}

// Aggregators

// Columns left out of the aggregator HTML tables to save screen space. They
// stay in the JSON and CSV formats, and counts can still be used to sort.
const hiddenColumns = [
  '2xx15m',
  '2xx24h',
  '4xx15m',
  '4xx24h',
  'city',
  'os',
  'language',
  'signatureCount15m',
  'signatureCount24h',
];

// Column sorted by a sorter of another name
const sortKeys = { lastSeen: 'latest' };

// Headings of sortable columns link to the page sorted by them, keeping the
// other query parameters. Sorting is descending, done by the aggregator.
function sortHeading(req, sorters, sort) {
  return (column) => {
    const key = sortKeys[column] || column;
    if (!sorters || !sorters[key]) {
      return column;
    }
    const query = new URLSearchParams(req.query);
    query.set('sort', key);
    return key === sort
      ? `<a href="?${escapeHtml(query)}" class="sorted">${column} ▾</a>`
      : `<a href="?${escapeHtml(query)}">${column}</a>`;
  };
}

/**
 * The HTML view of an aggregator: render(req, { rows, sorters, sort }).
 * - nav: link the page in the top navigation
 * - hide: more columns to leave out of the table
 */
function aggregatorView(name, { nav = false, hide = [] } = {}) {
  const hidden = [...hiddenColumns, ...hide];
  if (nav) {
    registerSection(name);
  }
  return (req, { rows, sorters, sort }) =>
    page(
      req,
      { title: name },
      rows.length > 0
        ? formatTable(
            rows.map((row) => omit(row, hidden)),
            { heading: sortHeading(req, sorters, sort) }
          )
        : '<p class="grey">No entries yet: they appear as logs come in.</p>'
    );
}

// Logs

// The logs index: the HTTP and WebSocket streams of each pipeline node
function logsPage(req, nodes) {
  const ws = `${req.protocol === 'https' ? 'wss' : 'ws'}://${req.get('host')}`;
  const rows = nodes.map((name) => {
    const path = `${req.baseUrl}/logs/${name}`;
    return {
      node: `<a href="${path}">${name}</a>`,
      websocket: `${ws}${path}`,
    };
  });
  return page(req, { title: 'logs' }, formatTable(rows));
}

// The opening part of a log stream page. Latest lines are at the bottom,
// like a terminal, or at the top with ?latest=top. The stream container is
// never closed: lines keep being appended to it.
function streamHead(req, { title }) {
  const latestOnTop = req.query.latest === 'top';
  return `${head(req, { title, bodyClass: 'stream-page' })}${streamFilters(
    req
  )}${latestOnTop ? '' : `<script>${followScript}</script>`}<main class="stream${
    latestOnTop ? ' latest-top' : ''
  }">`;
}

// A line saying which logs a filtered stream keeps, linking to all of them
function streamFilters(req) {
  const filters = ['identity', 'signature', 'address']
    .filter((key) => typeof req.query[key] === 'string')
    .map((key) => `${key} ${escapeHtml(req.query[key])}`);
  if (filters.length === 0) {
    return '';
  }
  return `<p class="grey">Only logs with ${filters.join(', ')} · <a href="${
    req.baseUrl
  }${req.path}">all logs</a></p>`;
}

function streamLine(line) {
  return `<div>${line}</div>`;
}

module.exports = {
  aggregatorView,
  hasSection,
  logsLink,
  head,
  logsPage,
  nav,
  nodesPage,
  pipelinePage,
  page,
  registerSection,
  streamHead,
  streamLine,
};
