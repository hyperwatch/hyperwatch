// Open responses of the live log streams (streamToHttp()): they never end on
// their own, so stop() ends them

/** @type {Set<import('express').Response>} */
const open = new Set();

/**
 * Ends the open live log responses, so the server serving them
 * (Hyperwatch's or the host's) can close
 */
function endAll() {
  for (const res of open) {
    open.delete(res);
    res.end();
  }
}

module.exports = { open, endAll };
