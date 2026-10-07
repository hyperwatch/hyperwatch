/**
 * IP addresses and CIDR ranges, on ip-address.
 *
 * Matching uses isHostInSubnet, the method ip-address recommends for an
 * address taken from a request: an address never matches a range of the
 * other family, and an IPv4 client seen through a dual-stack socket
 * (::ffff:192.0.2.1) is matched as its IPv4 address.
 */
const { Address4, Address6 } = require('ip-address');

// An address (no prefix) as an Address4 or Address6, IPv4-mapped IPv6
// addresses as IPv4. null when it isn't a valid address.
function parseAddress(value) {
  if (typeof value !== 'string' || !value || value.includes('/')) {
    return null;
  }
  // The constructors throw on what isValid() rejects
  if (!value.includes(':')) {
    return Address4.isValid(value) ? new Address4(value) : null;
  }
  if (!Address6.isValid(value)) {
    return null;
  }
  const address = new Address6(value);
  return address.isMapped4() ? address.to4() : address;
}

const isValidAddress = (value) => parseAddress(value) !== null;

// A range (address/prefix) as an Address4 or Address6. null when invalid.
function parseCidr(value) {
  if (typeof value !== 'string' || !/^[^/]+\/\d{1,3}$/.test(value)) {
    return null;
  }
  const Address = value.includes(':') ? Address6 : Address4;
  return Address.isValid(value) ? new Address(value) : null;
}

const isValidCidr = (value) => parseCidr(value) !== null;

// The first address of a valid range: 10.0.0.0 for 10.1.2.3/8
const networkAddress = (value) => parseCidr(value).startAddress().correctForm();

// Whether an address (string, or one parsed by parseAddress) is in a parsed
// range, both of the same family
function inRange(range, address) {
  const parsed = typeof address === 'string' ? parseAddress(address) : address;
  return (
    parsed !== null &&
    parsed !== undefined &&
    parsed instanceof Address6 === range instanceof Address6 &&
    parsed.isHostInSubnet(range)
  );
}

/**
 * Compile a list of ranges (address/prefix, or a bare address for a single
 * host) once. The matcher returns the first range containing the address,
 * as written in the list, or null.
 */
function compileRanges(values) {
  const ranges = values.map((value) => {
    const cidr = value.includes('/')
      ? value
      : `${value}/${value.includes(':') ? 128 : 32}`;
    const range = parseCidr(cidr);
    if (!range) {
      throw new Error(`invalid CIDR "${value}"`);
    }
    return { value, range };
  });
  return (address) => {
    const parsed = parseAddress(address);
    if (!parsed) {
      return null;
    }
    const match = ranges.find(({ range }) => inRange(range, parsed));
    return match ? match.value : null;
  };
}

module.exports = {
  compileRanges,
  inRange,
  isValidAddress,
  isValidCidr,
  networkAddress,
  parseAddress,
  parseCidr,
};
