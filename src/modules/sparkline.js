const aggregator = require('../lib/aggregator');

const sparkline = (entry, key) => {
  const id = entry.get('id');

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

  return `<canvas id="${id}" width="100" height="12"></canvas>
<script>
sparkline ('${id}', ${JSON.stringify(points)}, '#797979', 14, 5);
</script>`;
};

function init() {
  aggregator.defaultFormatter.insertFormat('activity', (entry) =>
    sparkline(entry, 'per_minute')
  );
}

module.exports = {
  init,
};
