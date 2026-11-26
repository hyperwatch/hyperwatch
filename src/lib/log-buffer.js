/**
 * Keep the latest `capacity` logs of a pipeline node, newest first.
 * dump() / load() let the persistence module save it across restarts.
 */
const { fromJS } = require('immutable');

const { sharedFields } = require('./shared');

class LogBuffer {
  /** @param {number} [capacity] */
  constructor(capacity = 1000) {
    this.capacity = capacity;
    /** @type {Log[]} */
    this.buffer = new Array(capacity);
    this.pointer = 0;
    this.size = 0;
  }

  /** @param {Log} item */
  push(item) {
    this.buffer[this.pointer] = item;
    this.pointer = (this.pointer + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /** @returns {Log[]} */
  toArray() {
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size).reverse();
    }
    return [
      ...this.buffer.slice(this.pointer),
      ...this.buffer.slice(0, this.pointer),
    ].reverse();
  }

  // Oldest first, never more than capacity
  /** @returns {Record<string, any>[]} */
  dump() {
    return this.toArray()
      .reverse()
      .map((log) => log.toJS());
  }

  /** @param {Record<string, any>[]} data Logs as dump() gives them */
  load(data) {
    data
      .slice(-this.capacity)
      // Shared values (agent, language…) as live logs have them
      .forEach((item) =>
        this.push(/** @type {Log} */ (fromJS(sharedFields(item))))
      );
  }
}

/** @typedef {import('../types').Log} Log */

module.exports = LogBuffer;
