const path = require('path');

const update = require('useragent/lib/update');

update.remote =
  'https://raw.githubusercontent.com/ua-parser/uap-core/master/regexes.yaml';

update.output = path.resolve(__dirname, '..', 'src', 'data', 'regexes.js');

update.update((err) => {
  if (err) {
    console.error('Update unsuccessfull due to reasons');
    console.log(err.message);
    console.log(err.stack);

    return;
  }
  console.log(
    'Successfully fetched and generated new parsers from the internets.'
  );
});
