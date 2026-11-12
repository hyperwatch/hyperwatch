// Types a consumer can import (`import type { Log } from
// '@hyperwatch/hyperwatch'`), e.g. to write its own input
/** @typedef {import('./src/types').Log} Log */
/** @typedef {import('./src/types').Config} Config */
/** @typedef {import('./src/lib/pipeline').Input} Input */
/** @typedef {import('./src/lib/pipeline').InputHandlers} InputHandlers */

module.exports = require('./src/index.js');
