/**
 * Keep the latest `capacity` logs of a pipeline node, newest first.
 * dump() / load() let the persistence module save it across restarts.
 */
const { fromJS } = require('immutable');

class LogBuffer {
  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.pointer = 0;
    this.size = 0;
  }

  push(item) {
    this.buffer[this.pointer] = item;
    this.pointer = (this.pointer + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

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
  dump() {
    return this.toArray()
      .reverse()
      .map((log) => log.toJS());
  }

  load(data) {
    data.slice(-this.capacity).forEach((item) => this.push(fromJS(item)));
  }
}

module.exports = LogBuffer;
