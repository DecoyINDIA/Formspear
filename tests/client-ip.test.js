const test = require('node:test');
const assert = require('node:assert/strict');
const { clientIp } = require('../src/lib/client-ip');

test('clientIp helper resolves client IP considering TRUST_PROXY_HOPS', () => {
  const socketReq = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {}
  };

  // No header, hops 1 → socket address
  assert.equal(clientIp(socketReq, { TRUST_PROXY_HOPS: '1' }), '127.0.0.1');

  // X-Forwarded-For: 203.0.113.9, hops 1 → 203.0.113.9
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } },
      { TRUST_PROXY_HOPS: '1' }
    ),
    '203.0.113.9'
  );

  // X-Forwarded-For: 1.1.1.1, 203.0.113.9, hops 1 → 203.0.113.9 (client-supplied first entry is ignored)
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' } },
      { TRUST_PROXY_HOPS: '1' }
    ),
    '203.0.113.9'
  );

  // Same header, hops 2 → 1.1.1.1
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' } },
      { TRUST_PROXY_HOPS: '2' }
    ),
    '1.1.1.1'
  );

  // hops 0 or unset with a header present → socket address
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } },
      { TRUST_PROXY_HOPS: '0' }
    ),
    '10.0.0.1'
  );
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } },
      {}
    ),
    '10.0.0.1'
  );

  // Garbage entry (not-an-ip) → socket address
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': 'not-an-ip' } },
      { TRUST_PROXY_HOPS: '1' }
    ),
    '10.0.0.1'
  );

  // ::ffff:203.0.113.9 → 203.0.113.9
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '::ffff:203.0.113.9' } },
      { TRUST_PROXY_HOPS: '1' }
    ),
    '203.0.113.9'
  );

  // IPv4 with port → stripped port
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9:8080' } },
      { TRUST_PROXY_HOPS: '1' }
    ),
    '203.0.113.9'
  );

  // Header as array
  assert.equal(
    clientIp(
      { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': ['1.1.1.1', '203.0.113.9'] } },
      { TRUST_PROXY_HOPS: '1' }
    ),
    '203.0.113.9'
  );

  // Missing socket address fallback to 'unknown'
  assert.equal(clientIp({}), 'unknown');
});
