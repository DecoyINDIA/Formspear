const net = require('node:net');

function clientIp(req, env = process.env) {
  const socketIp = req?.socket?.remoteAddress || 'unknown';
  const hops = parseInt(env.TRUST_PROXY_HOPS, 10);
  if (!Number.isFinite(hops) || hops < 1) return socketIp;

  const rawHeader = req?.headers ? req.headers['x-forwarded-for'] : undefined;
  if (!rawHeader) return socketIp;

  const header = Array.isArray(rawHeader) ? rawHeader.join(',') : String(rawHeader);
  const parts = header.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < hops) return socketIp;

  let candidate = parts[parts.length - hops];
  if (candidate.startsWith('::ffff:')) {
    candidate = candidate.slice(7);
  }
  if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(candidate)) {
    candidate = candidate.split(':')[0];
  }
  if (net.isIP(candidate) === 0) return socketIp;

  return candidate;
}

module.exports = { clientIp };
