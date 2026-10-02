const fs = require('fs');
const net = require('net');
const path = require('path');

const IPCIDR = require('ip-cidr').default;

const dataDir = path.join(__dirname, '..', 'src', 'data');

// Meta publishes no list: its crawler documentation
// (https://developers.facebook.com/docs/sharing/webmasters/web-crawlers)
// points to the routes of its network, AS32934, in the RADb registry:
//
//   whois -h whois.radb.net -- '-i origin AS32934' | grep ^route
const name = 'meta-ips';
const query = '-i origin AS32934';

function whois(host, request) {
  return new Promise((resolve, reject) => {
    let response = '';
    const socket = net.connect(43, host, () => socket.end(`${request}\r\n`));
    socket.setEncoding('utf8');
    socket.setTimeout(30000, () =>
      socket.destroy(new Error(`${host}: timed out`))
    );
    socket.on('data', (chunk) => (response += chunk));
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
  });
}

function extractCidrs(response) {
  const cidrs = new Set();
  for (const line of response.split('\n')) {
    const match = line.match(/^route6?:\s+(\S+)/);
    if (match) {
      cidrs.add(match[1]);
    }
  }
  return [...cidrs];
}

// Many routes are more specific announcements of a larger one: keep the
// largest only.
function removeNested(cidrs) {
  const ranges = cidrs.map((cidr) => {
    const [address, bits] = cidr.split('/');
    return { address, bits: Number(bits), range: new IPCIDR(cidr) };
  });
  return cidrs.filter((cidr, i) => {
    const { address, bits } = ranges[i];
    return !ranges.some(
      (other, j) =>
        j !== i &&
        other.bits <= bits &&
        // Same prefix length: the same range written twice, keep the first
        (other.bits < bits || j < i) &&
        other.range.contains(address)
    );
  });
}

async function main() {
  const cidrs = removeNested(
    extractCidrs(await whois('whois.radb.net', query))
  );
  if (cidrs.length === 0) {
    console.error(`Failed to build ${name}: empty list, keeping current file`);
    process.exitCode = 1;
    return;
  }
  const filePath = path.join(dataDir, `${name}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(cidrs, null, 2)}\n`);
  console.log(`${name}: ${cidrs.length} CIDRs (RADb, AS32934)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
