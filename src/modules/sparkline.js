const aggregator = require('../lib/aggregator');

const sparkline = (entry, key) => {
  const identifier =
    entry.getIn(['identity']) ||
    entry.getIn(['address', 'value']) ||
    entry.getIn(['request', 'address']);

  const points = entry
    .getIn(['speed', key])
    .compute()
    .toList()
    .shift()
    .reverse()
    .toJS();

  if (points.length <= 1) {
    return;
  }

  return `<canvas id="${identifier}" width="100" height="12"></canvas>
<script>
sparkline ('${identifier}', ${JSON.stringify(points)}, '#797979', 14, 5);
</script>`;
};

function register() {
  aggregator.defaultFormatter.insertFormat('activity', (entry) =>
    sparkline(entry, 'per_minute')
  );
}

module.exports = {
  register,
};
