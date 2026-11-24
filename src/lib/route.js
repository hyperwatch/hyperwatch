// The route of a request: the pattern it matched, in one format whatever
// sets it, so that values from different applications compare (docs/log.md,
// "Route"):
//
// - `:name` for a parameter, as Express and path-to-regexp write it
// - a parameter that can only take a few fixed words keeps its value
//   (`/v1/…`, `.json`), any other one shows its name
// - literal segments lowercased, no trailing slash, no query string
// - `*` for a wildcard

// A parameter name, as path-to-regexp reads it
const NAME = /^[$_\p{ID_Start}][$‌‍\p{ID_Continue}]*/u;

// A group that can only match a few fixed words: `v1`, `json|csv`
const FIXED_WORDS = /^[\w-]+(?:\|[\w-]+)*$/;

// Escapes that stand for one literal character (`\/`, `\.`), not a class
// (`\d`, `\w`) or a back-reference (`\1`)
const LITERAL_ESCAPE = /^[^\p{L}\p{N}]$/u;

/**
 * Normalizes a route: no query string or fragment, no trailing slash,
 * literal parts lowercased (`:names` keep their case).
 * @param {string} route
 * @returns {string}
 */
function normalize(route) {
  let value = route.replace(/[?#].*$/s, '');
  value = value.replace(
    /(:[$_\p{ID_Start}][$‌‍\p{ID_Continue}]*)|[^:]+|:/gu,
    (part, name) => (name ? name : part.toLowerCase())
  );
  if (!value.startsWith('/')) {
    value = `/${value}`;
  }
  if (value.length > 1) {
    value = value.replace(/\/+$/, '') || '/';
  }
  return value;
}

/**
 * The route of a string pattern, as Express takes them: path-to-regexp 8
 * (Express 5: `:name`, `*name`, optional `{…}`) and the older syntax of
 * Express 4 (`:name?`, `:name(json|csv)`, `*`). `params` are the values the
 * request matched (`req.params`): an optional part is kept when one of its
 * parameters has a value, a parameter limited to fixed words (`(json|csv)`)
 * keeps its value.
 * @param {string} pattern
 * @param {Record<string, any>} [params]
 * @returns {string}
 */
function fromPattern(pattern, params = {}) {
  /**
   * @param {string} source
   * @returns {{ text: string, names: string[] }}
   */
  const convert = (source) => {
    let text = '';
    /** @type {string[]} */
    const names = [];
    let i = 0;
    while (i < source.length) {
      const char = source[i];
      if (char === '\\' && i + 1 < source.length) {
        text += source[i + 1];
        i += 2;
      } else if (
        char === ':' ||
        (char === '*' && NAME.test(source.slice(i + 1)))
      ) {
        const quoted = source[i + 1] === '"' && source.indexOf('"', i + 2);
        const name =
          quoted && quoted > 0
            ? source.slice(i + 2, quoted)
            : (NAME.exec(source.slice(i + 1)) || [''])[0];
        if (!name) {
          text += char;
          i += 1;
          continue;
        }
        i += 1 + (quoted && quoted > 0 ? name.length + 2 : name.length);
        names.push(name);
        if (char === '*') {
          text += '*';
          continue;
        }
        // Express 4: a constraint (`:format(json|csv)`) and a modifier
        let constraint;
        if (source[i] === '(') {
          const end = closing(source, i, '(', ')');
          constraint = source.slice(i + 1, end);
          i = end + 1;
        }
        const next = source[i] || '';
        const modifier = next && '?*+'.includes(next) ? next : '';
        i += modifier.length;
        const value = params[name];
        if (modifier === '?' && value === undefined) {
          // The optional parameter takes its prefix with it
          if (text.endsWith('/') || text.endsWith('.')) {
            text = text.slice(0, -1);
          }
        } else if (
          constraint &&
          FIXED_WORDS.test(constraint) &&
          typeof value === 'string'
        ) {
          text += value;
        } else {
          text += `:${name}`;
        }
      } else if (char === '{') {
        const end = closing(source, i, '{', '}');
        const inner = convert(source.slice(i + 1, end));
        names.push(...inner.names);
        if (!inner.names.length) {
          // Nothing tells whether it matched: keep it as written
          text += source.slice(i, end + 1);
        } else if (inner.names.some((n) => params[n] !== undefined)) {
          text += inner.text;
        }
        i = end + 1;
      } else if (char === '*') {
        // Express 4 wildcard, or a repeat after a constraint
        text += '*';
        i += 1;
      } else if (char === '(') {
        // Express 4: an unnamed group
        i = closing(source, i, '(', ')') + 1;
        text += '*';
      } else {
        text += char;
        i += 1;
      }
    }
    return { text, names };
  };
  return normalize(convert(pattern).text);
}

/**
 * The index of the character closing the bracket opened at `start`
 * (the end of `source` when it isn't closed)
 * @param {string} source
 * @param {number} start
 * @param {string} open
 * @param {string} close
 * @returns {number}
 */
function closing(source, start, open, close) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
    } else if (source[i] === open) {
      depth++;
    } else if (source[i] === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return source.length;
}

/**
 * A capturing group of a regular expression
 * @typedef {object} Capture
 * @property {number} index Its number in the match (1 for the first group)
 * @property {string} name Its name, else its number among the unnamed
 *   groups from 0, as Express names the parameters
 * @property {string} body The pattern inside the parentheses
 * @property {boolean} outer Not inside another capturing group
 */

/**
 * The capturing groups of a regular expression's source, or `undefined` when
 * the parts outside them can match more than a fixed text (`.*`, `[^/]+`,
 * `\d`…): their value would make the route as varied as the URLs.
 * @param {string} source
 * @returns {Capture[] | undefined}
 */
function parseCaptures(source) {
  /** @type {Capture[]} */
  const captures = [];
  // Open groups: the capture they start (or null), and whether they skip
  // the literal check (inside a capture, a lookaround)
  /** @type {{ capture: Capture | null, start: number, free: boolean }[]} */
  const stack = [];
  let unnamed = 0;
  let index = 0;
  const free = () => stack.some((group) => group.free);
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      if (!free() && !LITERAL_ESCAPE.test(source[i + 1] || '')) {
        return undefined;
      }
      i++;
    } else if (char === '[') {
      if (!free()) {
        return undefined;
      }
      // Skip the class: a `]` or `(` in it is a character
      i++;
      while (i < source.length && source[i] !== ']') {
        i += source[i] === '\\' ? 2 : 1;
      }
    } else if (char === '(') {
      const rest = source.slice(i + 1);
      const named = /^\?<([^>=!]+)>/.exec(rest);
      if (named || rest[0] !== '?') {
        index++;
        const prefix = named ? named[0].length : 0;
        /** @type {Capture} */
        const capture = {
          index,
          name: named ? named[1] : String(unnamed++),
          body: '',
          outer: !stack.some((group) => group.capture),
        };
        captures.push(capture);
        stack.push({ capture, start: i + 1 + prefix, free: true });
        i += prefix;
      } else {
        const lookaround = /^\?(?:[=!]|<[=!])/.exec(rest);
        stack.push({
          capture: null,
          start: i,
          free: !!lookaround,
        });
        i += lookaround ? lookaround[0].length : 2; // `(?:`
      }
    } else if (char === ')') {
      const group = stack.pop();
      if (group && group.capture) {
        group.capture.body = source.slice(group.start, i);
      }
    } else if (!free() && '.*+{'.includes(char)) {
      return undefined;
    }
  }
  return captures;
}

/**
 * The route of a path matched by a regular expression (a route declared as
 * one, e.g. `/^(?:\/(?<version>v1))?\/(?<slug>[^/]+?)\.json\/?$/i` matching
 * `/v1/babel.json` gives `/v1/:slug.json`): a named group becomes `:name`
 * (an unnamed one its number from 0, as Express names it), a group limited
 * to fixed words (`(?<version>v1)`, `(json|csv)`) keeps its value.
 * `undefined` when the expression doesn't match `path`, or when it can match
 * more than fixed text outside its groups (`/^\/files\/.*$/`).
 * @param {RegExp} regexp
 * @param {string} path
 * @returns {string | undefined}
 */
function fromRegExp(regexp, path) {
  const captures = parseCaptures(regexp.source);
  if (!captures) {
    return undefined;
  }
  const flags = `${regexp.flags.replace(/[gyd]/g, '')}d`;
  const match = new RegExp(regexp.source, flags).exec(path);
  if (!match || !match.indices) {
    return undefined;
  }
  const start = match.index;
  let text = match[0];
  // From the last group, so the offsets of the others stay valid
  for (const capture of captures.filter((c) => c.outer).reverse()) {
    const span = match.indices[capture.index];
    if (!span || FIXED_WORDS.test(capture.body)) {
      continue;
    }
    text = `${text.slice(0, span[0] - start)}:${capture.name}${text.slice(
      span[1] - start
    )}`;
  }
  return normalize(text);
}

/**
 * The route an Express request matched, from `req.route` (set by Express
 * when a route handled it) and `req.baseUrl` (the path of the router it is
 * mounted on). `undefined` when no route matched (a 404, a static file), and
 * when the route can't be written in the route format.
 * @param {{ route?: { path?: unknown }, baseUrl?: string, originalUrl?: string, url?: string, params?: Record<string, any> }} req
 * @returns {string | undefined}
 */
function fromExpressRequest(req) {
  const path = req.route && req.route.path;
  if (path === undefined || path === null) {
    return undefined;
  }
  const baseUrl = req.baseUrl || '';
  const params = req.params || {};
  /**
   * @param {unknown} candidate
   * @returns {string | undefined}
   */
  const convert = (candidate) => {
    if (candidate instanceof RegExp) {
      // Matched against the path under the router's
      const url = String(req.originalUrl || req.url || '/').replace(
        /[?#].*$/s,
        ''
      );
      const relative =
        baseUrl && url.toLowerCase().startsWith(baseUrl.toLowerCase())
          ? url.slice(baseUrl.length) || '/'
          : url;
      return fromRegExp(candidate, relative);
    }
    if (typeof candidate === 'string') {
      return fromPattern(candidate, params);
    }
    return undefined;
  };
  let route;
  if (Array.isArray(path)) {
    // The expressions say which one matched, the strings don't: a single
    // string is the one when no expression matched
    const regexps = path.filter((p) => p instanceof RegExp);
    const strings = path.filter((p) => typeof p === 'string');
    route = regexps.map(convert).find(Boolean);
    if (!route && strings.length === 1) {
      route = convert(strings[0]);
    }
  } else {
    route = convert(path);
  }
  if (route === undefined) {
    return undefined;
  }
  return normalize(`${baseUrl}${route}`);
}

module.exports = {
  fromExpressRequest,
  fromPattern,
  fromRegExp,
  normalize,
};
