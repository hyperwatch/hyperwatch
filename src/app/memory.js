const v8 = require('v8');

const { Aggregator } = require('../lib/aggregator');
const LogBuffer = require('../lib/log-buffer');
const defaultPersistence = require('../lib/persistence');

/**
 * What holds memory, to decide what to cap: the process and V8 heap, and
 * every document the persistence saves (the aggregators and the history
 * buffers), with its entries and its bytes at the latest load and dump.
 *
 * `measure` serializes every document as the persistence does, to give its
 * size now: it blocks the event loop and allocates about as much as the
 * documents weigh, so it's opt-in (?measure=1).
 * @param {object} [options]
 * @param {boolean} [options.measure]
 * @param {typeof defaultPersistence} [options.persistence]
 */
function memoryReport({
  measure = false,
  persistence = defaultPersistence,
} = {}) {
  const heap = v8.getHeapStatistics();

  const documents = Object.entries(persistence.documents).map(
    ([name, document]) => {
      /** @type {DocumentReport} */
      const report = { name, type: 'other' };
      if (document instanceof Aggregator) {
        const sorters = Object.keys(document.sorters).length;
        Object.assign(report, {
          type: 'aggregator',
          entries: document.entries.size,
          gcSize: document.gcSize,
          sorters,
          // gc() keeps the top gcSize of each sorter: at most this many
          // entries right after it, more until the next one
          ceiling: document.gcSize * sorters,
        });
      } else if (document instanceof LogBuffer) {
        Object.assign(report, {
          type: 'history',
          entries: document.size,
          capacity: document.capacity,
        });
      }
      const sizes = persistence.sizes[name] || {};
      report.loadedBytes = sizes.load === undefined ? null : sizes.load;
      report.dumpedBytes = sizes.dump === undefined ? null : sizes.dump;
      if (measure) {
        report.bytes = Buffer.byteLength(JSON.stringify(document.dump()));
      }
      return report;
    }
  );

  // Heaviest first: measured now, else at the latest dump, else load
  const weight = (/** @type {DocumentReport} */ d) => {
    for (const bytes of [d.bytes, d.dumpedBytes, d.loadedBytes]) {
      if (typeof bytes === 'number') {
        return bytes;
      }
    }
    return -1;
  };
  documents.sort((a, b) => weight(b) - weight(a));

  return {
    at: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    // Bytes: rss, heapTotal, heapUsed, external, arrayBuffers
    process: process.memoryUsage(),
    heap: {
      limit: heap.heap_size_limit,
      total: heap.total_heap_size,
      used: heap.used_heap_size,
      malloced: heap.malloced_memory,
      peakMalloced: heap.peak_malloced_memory,
      external: heap.external_memory,
    },
    heapSpaces: v8.getHeapSpaceStatistics().map((space) => ({
      name: space.space_name,
      size: space.space_size,
      used: space.space_used_size,
      available: space.space_available_size,
    })),
    documents,
  };
}

/**
 * GET /memory.json
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function handler(req, res) {
  const measure = ['1', 'true'].includes(String(req.query.measure));
  res.json(memoryReport({ measure }));
}

/**
 * @typedef {object} DocumentReport
 * @property {string} name The persistence document (aggregator name, or
 *   `history-<node>`)
 * @property {'aggregator' | 'history' | 'other'} type
 * @property {number} [entries]
 * @property {number} [gcSize] Aggregators: entries kept per sorter by gc()
 * @property {number} [sorters] Aggregators: number of sorters
 * @property {number} [ceiling] Aggregators: gcSize × sorters
 * @property {number} [capacity] History: logs kept
 * @property {number | null} [loadedBytes] JSON bytes at the latest load
 * @property {number | null} [dumpedBytes] JSON bytes at the latest dump
 * @property {number} [bytes] JSON bytes now (?measure=1)
 */

module.exports = { memoryReport, handler };
