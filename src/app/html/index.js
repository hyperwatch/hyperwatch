// HTML views of the API: minimal pages rendered on the server, with one
// inline stylesheet and a small inline script. A richer dashboard is a
// separate project.
//
// Every page sets <base> to the mount path, and its links are relative to
// it: "logs/main", "addresses?sort=count24h".
const fs = require('fs');
const path = require('path');

const { escapeHtml, formatTable } = require('../../lib/util');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

const stylesheet = read('style.css');
const followScript = read('scripts/follow.js');

// Layout

// Sections shown in the top navigation, in this order, once registered
const order = ['addresses', 'identities', 'logs', 'pipeline'];
// Section name → the page its navigation link opens
const sections = new Map();
// Aggregator sections, whose links keep the selected period
const periodSections = new Set();

function registerSection(name, href = name) {
  sections.set(name, href);
}

function hasSection(name) {
  return sections.has(name);
}

// The current page, relative to <base>
function here(req) {
  return req.path.slice(1);
}

// The address of the mount path, e.g. "https://example.org/_hyperwatch",
// for http or ws
function baseAddress(req, scheme) {
  const secure = req.protocol === 'https' ? 's' : '';
  return `${scheme}${secure}://${req.get('host')}${req.baseUrl}`;
}

function link(href, text, className) {
  return `<a href="${escapeHtml(href)}"${
    className ? ` class="${className}"` : ''
  }>${text}</a>`;
}

// Links to the main logs kept by a filter (address, identity, signature),
// or the plain value when logs aren't served. A class goes on the link, so
// its underline has the same color.
function logsLink(filter, value, className) {
  const text = escapeHtml(value || '');
  if (!value || !sections.has('logs')) {
    return className ? `<span class="${className}">${text}</span>` : text;
  }
  return link(
    `logs/main?${filter}=${encodeURIComponent(value)}`,
    text,
    className
  );
}

// A pipeline node name, linking to its logs when they're served
function nodeLink(name, query = '', className) {
  if (!sections.has('logs')) {
    return escapeHtml(name);
  }
  return link(
    `logs/${encodeURIComponent(name)}${query}`,
    escapeHtml(name),
    className
  );
}

function isUnder(pathname, path) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function nav(req) {
  const home = req.path === '/' || isUnder(req.path, '/status');
  // The home page is the status page, when the status module is active
  const links = [
    sections.has('status')
      ? link('./', 'hyperwatch', home ? 'active' : null)
      : '<span>hyperwatch</span>',
  ];
  for (const name of order.filter((name) => sections.has(name))) {
    const active = isUnder(req.path, `/${name}`);
    const period =
      periodSections.has(name) && periodOf(req) === '24h' ? '?period=24h' : '';
    links.push(
      link(`${sections.get(name)}${period}`, name, active ? 'active' : null)
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
<base href="${escapeHtml(req.baseUrl || '')}/">
<style>${stylesheet}</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>${nav(req)}`;
}

function page(req, options, body) {
  return `${head(req, options)}${body}</body>
</html>`;
}

// Pipeline

// Log streams label their step "http:/logs/main" or "ws:/logs/main": shown
// as full addresses, the HTTP one linking to the stream
function streamLabel(req, label) {
  const match = /^(http|ws):\/(.*)$/.exec(label);
  if (!match) {
    return escapeHtml(label);
  }
  const [, scheme, path] = match;
  const address = escapeHtml(`${baseAddress(req, scheme)}/${path}`);
  return scheme === 'http' ? link(path, address) : address;
}

function renderTree(req, node) {
  const label = [];
  if (node.name) {
    label.push(`<strong>${nodeLink(node.name)}</strong>`);
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
    label.push(`<span class="label">${streamLabel(req, node.label)}</span>`);
  }
  const children = (node.children || [])
    .map((child) => renderTree(req, child))
    .join('');
  return `<li>${label.join(' ')}${children ? `<ul>${children}</ul>` : ''}</li>`;
}

// statusFor(status) fills the host of input statuses, see fillHost()
function renderInputs(req, inputs, statusFor) {
  return (inputs || [])
    .map(
      (input) =>
        `<li><strong>${input.name}</strong> <span class="op">[input]</span>${
          input.status
            ? ` <span class="module">(${statusFor(input.status)})</span>`
            : ''
        } accepted: ${input.accepted}, rejected: ${input.rejected}${
          input.tree ? `<ul>${renderTree(req, input.tree)}</ul>` : ''
        }</li>`
    )
    .join('');
}

function pipelinePage(req, tree, statusFor) {
  return page(
    req,
    { title: 'pipeline' },
    `<div class="tree"><ul>${renderInputs(
      req,
      tree.inputs,
      statusFor
    )}</ul><ul>${renderTree(req, tree)}</ul></div>`
  );
}

// Aggregators

// Aggregator pages show the last 15 minutes, or 24 hours with ?period=24h
function periodOf(req) {
  return req.query.period === '24h' ? '24h' : '15m';
}

// Switching period keeps the query but the sort, which goes back to the
// count of the period
function periodSwitch(req) {
  const current = periodOf(req);
  const links = ['15m', '24h'].map((period) => {
    if (period === current) {
      return `<strong>${period}</strong>`;
    }
    const query = new URLSearchParams(req.query);
    query.delete('sort');
    query.delete('period');
    if (period === '24h') {
      query.set('period', period);
    }
    const search = query.toString();
    return link(`${here(req)}${search ? `?${search}` : ''}`, period);
  });
  return `<div class="subnav periods">${links.join(
    '<span class="grey"> · </span>'
  )}</div>`;
}

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
    const text = key === sort ? `${column} ▾` : column;
    return link(`${here(req)}?${query}`, text, key === sort ? 'sorted' : null);
  };
}

// lastSeen is "YYYY-MM-DD hh:mm:ss" (UTC) in HTML. When every row was seen
// today, only the time is shown, like in the logs.
function shortenLastSeen(rows) {
  const today = new Date().toISOString().slice(0, 10);
  const allToday = rows.every(
    (row) => !row.lastSeen || row.lastSeen.startsWith(today)
  );
  if (!allToday) {
    return rows;
  }
  return rows.map((row) =>
    row.lastSeen ? { ...row, lastSeen: row.lastSeen.slice(-8) } : row
  );
}

/**
 * The HTML view of an aggregator: render(req, { rows, sorters, sort }).
 * - nav: link the page in the top navigation
 * - columns: the columns of the table, in order. A column without a period
 *   ("count") is the one of the selected period ("count15m"), and columns
 *   the rows don't have (e.g. of an inactive module) are skipped. By
 *   default, all columns of the selected period.
 */
function aggregatorView(name, { nav = false, columns } = {}) {
  if (nav) {
    registerSection(name);
    periodSections.add(name);
  }
  return (req, { rows, sorters, sort }) => {
    if (rows.length === 0) {
      return page(
        req,
        { title: name },
        '<p class="grey">No entries yet: they appear as logs come in.</p>'
      );
    }
    const period = periodOf(req);
    const other = period === '15m' ? '24h' : '15m';
    const keys = columns
      ? columns
          .map((column) => (column in rows[0] ? column : `${column}${period}`))
          .filter((key) => key in rows[0])
      : Object.keys(rows[0]).filter((key) => !key.endsWith(other));
    const table = shortenLastSeen(rows).map((row) =>
      Object.fromEntries(keys.map((key) => [key, row[key]]))
    );
    return page(
      req,
      { title: name },
      `${periodSwitch(req)}${formatTable(table, {
        heading: sortHeading(req, sorters, sort),
      })}`
    );
  };
}

// Logs

// Where a pipeline node is in the tree: its named ancestors and the named
// nodes one level below it (unnamed steps, like maps and filters, are
// skipped). Returns null when the node isn't in the tree.
function findNode(tree, name) {
  const search = (node, ancestors) => {
    if (!node) {
      return null;
    }
    if (node.name === name) {
      return { ancestors, node };
    }
    const path = node.name ? [...ancestors, node.name] : ancestors;
    for (const child of node.children || []) {
      const found = search(child, path);
      if (found) {
        return found;
      }
    }
    return null;
  };
  const roots = [tree, ...(tree.inputs || []).map((input) => input.tree)];
  for (const root of roots) {
    const found = search(root, []);
    if (found) {
      return found;
    }
  }
  return null;
}

function namedChildren(node) {
  return (node.children || []).flatMap((child) =>
    child.name ? [child.name] : namedChildren(child)
  );
}

const separator = (text) => `<span class="grey"> ${text} </span>`;

// The navigation between log streams: the path to the current node, then
// the nodes one level below it. Below main, the nodes under main stay
// listed, the branch of the current node highlighted. Links keep the query
// (filters, grep).
function nodesNav(req, name, tree) {
  const found = findNode(tree, name);
  if (!found) {
    return '';
  }
  const query = new URLSearchParams(req.query).toString();
  const nodeWithQuery = (node, className) =>
    nodeLink(node, query ? `?${query}` : '', className);
  const current = `<strong>${escapeHtml(name)}</strong>`;
  const below = (node) => {
    const children = namedChildren(node);
    return children.length > 0
      ? `${separator('→')}${children
          .map((child) => nodeWithQuery(child))
          .join(separator('·'))}`
      : '';
  };

  const main = found.ancestors.indexOf('main');
  if (main === -1) {
    const path = [
      ...found.ancestors.map((node) => nodeWithQuery(node)),
      current,
    ];
    return `<div class="subnav">${path.join(separator('›'))}${below(
      found.node
    )}</div>`;
  }

  // Below main: its nodes, then the path from the branch to the current node
  const [branch, ...deeper] = [...found.ancestors.slice(main + 1), name];
  const branches = namedChildren(findNode(tree, 'main').node).map((node) =>
    node === name
      ? current
      : nodeWithQuery(node, node === branch ? 'active' : null)
  );
  const path = deeper.map((node) =>
    node === name ? current : nodeWithQuery(node)
  );
  return `<div class="subnav">${found.ancestors
    .slice(0, main + 1)
    .map((node) => nodeWithQuery(node))
    .join(separator('›'))}${separator('→')}${branches.join(separator('·'))}${
    path.length > 0 ? `${separator('›')}${path.join(separator('›'))}` : ''
  }${below(found.node)}</div>`;
}

// A line saying which logs a filtered stream keeps, linking to all of them
function streamFilters(req) {
  const filters = ['identity', 'signature', 'address']
    .filter((key) => typeof req.query[key] === 'string')
    .map((key) => `${key} ${escapeHtml(req.query[key])}`);
  if (filters.length === 0) {
    return '';
  }
  return `<p class="grey">Only logs with ${filters.join(', ')} · ${link(
    here(req),
    'all logs'
  )}</p>`;
}

// The opening part of a log stream page, latest lines at the bottom like a
// terminal. header: more HTML under the navigation, e.g. nodesNav(). The
// stream container is never closed: lines keep being appended to it.
function streamHead(req, { title, header = '' }) {
  return `${head(req, { title, bodyClass: 'stream-page' })}${header}${streamFilters(
    req
  )}<script>${followScript}</script><main class="stream">`;
}

function streamLine(line) {
  return `<div>${line}</div>`;
}

module.exports = {
  aggregatorView,
  baseAddress,
  hasSection,
  head,
  logsLink,
  nav,
  nodesNav,
  page,
  pipelinePage,
  registerSection,
  streamHead,
  streamLine,
};
