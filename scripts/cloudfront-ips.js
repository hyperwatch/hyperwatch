/* eslint-disable-next-line node/no-unpublished-require */
const fetch = require('node-fetch');

async function main() {
  const response = await fetch(
    'https://ip-ranges.amazonaws.com/ip-ranges.json'
  );

  const ipRanges = await response.json();

  console.log(
    ipRanges.prefixes
      .filter((p) => p.service === 'CLOUDFRONT')
      .map((el) => el.ip_prefix)
      .sort((a, b) => {
        const aArray = a.split('.').map(Number);
        const bArray = b.split('.').map(Number);
        if (aArray[0] === bArray[0]) {
          if (aArray[1] === bArray[1]) {
            if (aArray[2] === bArray[2]) {
              return aArray[3] > bArray[3] ? 1 : -1;
            }
            return aArray[2] > bArray[2] ? 1 : -1;
          }
          return aArray[1] > bArray[1] ? 1 : -1;
        }
        return aArray[0] > bArray[0] ? 1 : -1;
      })
      .map((el) => `"${el}"`)
      .join(',\n')
  );

  console.log(
    ipRanges.ipv6_prefixes
      .filter((p) => p.service === 'CLOUDFRONT')
      .map((el) => el.ipv6_prefix)
      .sort((a, b) => {
        const aArray = a.split(':').map(Number);
        const bArray = b.split(':').map(Number);
        if (aArray[0] === bArray[0]) {
          if (aArray[1] === bArray[1]) {
            if (aArray[2] === bArray[2]) {
              return aArray[3] > bArray[3] ? 1 : -1;
            }
            return aArray[2] > bArray[2] ? 1 : -1;
          }
          return aArray[1] > bArray[1] ? 1 : -1;
        }
        return aArray[0] > bArray[0] ? 1 : -1;
      })
      .map((el) => `"${el}"`)
      .join(',\n')
  );
}

main();
