// Types shared across Hyperwatch, for JSDoc (`import('./types').Log`) and the
// published type declarations. This module has no runtime content.

/**
 * A log: an Immutable Map with `request`, `response`, `executionTime` and
 * what the modules add (`address`, `agent`, `identity`, `geoip`,
 * `signature`, `webbotauth`…). See docs/log.md.
 *
 * `getIn()` returns `any`, like `get()`: Immutable's own returns `unknown`
 * for a Map of `any`, which no caller could use without a cast
 * (`log.getIn(['request', 'url']).match(…)`). It comes first, so it is the
 * overload TypeScript picks.
 * @typedef {{ getIn(searchKeyPath: Iterable<unknown>, notSetValue?: any): any }
 *   & import('immutable').Map<string, any>} Log
 */

/**
 * The configuration of a module (`modules.<name>` in the configuration):
 * `active` and `priority` for all, then options of its own.
 * @typedef {{ active?: boolean, priority?: number, [option: string]: any }} ModuleConfig
 */

/**
 * The configuration given to `init()`, merged into the defaults of
 * src/constants.js: `port` of the HTTP and WebSocket API, `modules` by name,
 * `persistence`, and the other options of docs/configuration.md.
 * @typedef {{
 *   port?: number,
 *   modules?: Record<string, ModuleConfig>,
 *   persistence?: Record<string, any>,
 *   [option: string]: any,
 * }} Config
 */

/**
 * An AbortSignal option, to stop a long operation.
 * @typedef {{ signal?: AbortSignal }} Abortable
 */

module.exports = {};
