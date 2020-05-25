const { Map } = require('immutable');

const { Speed } = require('./speed');
const { now } = require('./util');

const createMonitoringItem = ({
  speeds,
  name,
  type,
  status = 'Not started',
}) => ({
  speeds: speeds.reduce(
    (acc, speedId) =>
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
    let computed = Map(this);
    Object.keys(this.speeds).forEach((speedName) => {
      Object.keys(this.speeds[speedName]).forEach((speedId) => {
        computed = computed.updateIn(['speeds', speedName, speedId], (s) =>
          s.compute()
        );
      });
    });
    return computed;
  },
});

class Monitoring {
  constructor() {
    this.items = [];
  }

  register(monitoringData) {
    const monitor = createMonitoringItem(monitoringData);
    this.items.push(monitor);
    return monitor;
  }

  getAllComputed() {
    return this.items.map((item) => item.getComputed());
  }
}

module.exports = new Monitoring();
