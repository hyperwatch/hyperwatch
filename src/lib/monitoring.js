const { Map } = require('immutable');

const { Speed } = require('./speed');
const { now } = require('./util');

/**
 * @param {MonitoringOptions} options
 * @returns {MonitoringItem}
 */
const createMonitoringItem = ({
  speeds,
  name,
  type,
  status = 'Not started',
}) => ({
  speeds: speeds.reduce(
    (/** @type {Record<string, MonitoringSpeeds>} */ acc, speedId) =>
      Object.assign(
        {
          [speedId]: {
            per_minute: new Speed(60, 15),
            per_hour: new Speed(3600, 24),
          },
        },
        acc
      ),
    {}
  ),
  name,
  type,
  hit(speedName = speeds[0], value = now()) {
    Object.values(this.speeds[speedName]).forEach((speed) => {
      speed.hit(value);
    });
  },
  status,
  getComputed() {
    let computed = /** @type {import('immutable').Map<string, any>} */ (
      Map(this)
    );
    Object.keys(this.speeds).forEach((speedName) => {
      Object.keys(this.speeds[speedName]).forEach((speedId) => {
        computed = computed.updateIn(
          ['speeds', speedName, speedId],
          (/** @type {any} */ s) => s.compute()
        );
      });
    });
    return computed;
  },
});

class Monitoring {
  constructor() {
    /** @type {MonitoringItem[]} */
    this.items = [];
  }

  /**
   * Adds an item to the status page
   * @param {MonitoringOptions} monitoringData
   * @returns {MonitoringItem}
   */
  register(monitoringData) {
    const monitor = createMonitoringItem(monitoringData);
    this.items.push(monitor);
    return monitor;
  }

  /** @returns {import('immutable').Map<string, any>[]} */
  getAllComputed() {
    return this.items.map((item) => item.getComputed());
  }
}

/**
 * @typedef {object} MonitoringOptions
 * @property {string[]} speeds Names of the speeds, the first one is hit()'s
 *   default
 * @property {string} name
 * @property {string} type `input`, `node`, `output`…
 * @property {string} [status]
 */

/**
 * The speeds of a monitoring item, per window size
 * @typedef {{ per_minute: Speed, per_hour: Speed }} MonitoringSpeeds
 */

/**
 * An item of the status page. Its owner may update `status`, and may attach
 * data of its own (as `persistence` or `firewallSync`), shown in the raw
 * status.
 * @typedef {{
 *   speeds: Record<string, MonitoringSpeeds>,
 *   name: string,
 *   type: string,
 *   status: string,
 *   hit: (speedName?: string, value?: number) => void,
 *   getComputed: () => import('immutable').Map<string, any>,
 *   [extra: string]: unknown,
 * }} MonitoringItem
 */

module.exports = new Monitoring();
