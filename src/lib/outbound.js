const net = require('node:net');
const dns = require('node:dns').promises;

const blockedSubnets = new net.BlockList();

const IPV4_SUBNETS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

for (const [address, prefix] of IPV4_SUBNETS) {
  blockedSubnets.addSubnet(address, prefix, 'ipv4');
}

const IPV6_SUBNETS = [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
];

for (const [address, prefix] of IPV6_SUBNETS) {
  blockedSubnets.addSubnet(address, prefix, 'ipv6');
}

function isNonPublicAddress(ip) {
  if (!ip || typeof ip !== 'string') return true;
  let clean = ip.trim();
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }
  if (clean.startsWith('::ffff:')) {
    clean = clean.slice(7);
  }
  const family = net.isIP(clean);
  if (family === 0) return true;
  return blockedSubnets.check(clean, family === 4 ? 'ipv4' : 'ipv6');
}

const dnsCache = new Map();
const DNS_CACHE_TTL_MS = 60 * 1000;

async function isSafeOutboundUrl(rawUrl, options = {}) {
  const env = options.env || process.env;
  if (env.WEBHOOK_ALLOW_PRIVATE_HOSTS === 'true') {
    return true;
  }
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }

  if (net.isIP(host) !== 0) {
    return !isNonPublicAddress(host);
  }

  const lookupFn = options.lookup || dns.lookup;
  const now = Date.now();

  if (!options.lookup && dnsCache.has(host)) {
    const cached = dnsCache.get(host);
    if (cached.expiresAt > now) {
      return cached.addresses.length > 0 && cached.addresses.every((addr) => !isNonPublicAddress(addr));
    }
    dnsCache.delete(host);
  }

  let addresses;
  try {
    const result = await lookupFn(host, { all: true });
    addresses = Array.isArray(result)
      ? result.map((item) => (typeof item === 'string' ? item : item.address))
      : [];
  } catch {
    return false;
  }

  if (!addresses || addresses.length === 0) {
    return false;
  }

  if (!options.lookup) {
    dnsCache.set(host, {
      addresses,
      expiresAt: now + DNS_CACHE_TTL_MS
    });
  }

  return addresses.every((addr) => !isNonPublicAddress(addr));
}

module.exports = {
  isNonPublicAddress,
  isSafeOutboundUrl
};
