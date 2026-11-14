const test = require('node:test');
const assert = require('node:assert/strict');
const { isNonPublicAddress, isSafeOutboundUrl } = require('../src/lib/outbound');

test('isNonPublicAddress correctly classifies private vs public IP addresses', () => {
  const privateIps = [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '[::1]'
  ];

  for (const ip of privateIps) {
    assert.equal(isNonPublicAddress(ip), true, `Expected ${ip} to be non-public`);
  }

  const publicIps = [
    '8.8.8.8',
    '2606:4700:4700::1111',
    '172.32.0.1'
  ];

  for (const ip of publicIps) {
    assert.equal(isNonPublicAddress(ip), false, `Expected ${ip} to be public`);
  }
});

test('isSafeOutboundUrl validates outbound destinations correctly', async () => {
  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const mockMixedLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 }
  ];
  const mockThrowingLookup = async () => {
    throw new Error('ENOTFOUND');
  };

  // Public host → true
  assert.equal(
    await isSafeOutboundUrl('https://example.com/webhook', { lookup: mockPublicLookup }),
    true
  );

  // Host resolving to mixed public and private → false
  assert.equal(
    await isSafeOutboundUrl('https://example.com/webhook', { lookup: mockMixedLookup }),
    false
  );

  // Non http/https protocol → false
  assert.equal(
    await isSafeOutboundUrl('ftp://example.com/resource', { lookup: mockPublicLookup }),
    false
  );

  // Localhost hostname → false
  assert.equal(
    await isSafeOutboundUrl('http://localhost/test', { lookup: mockPublicLookup }),
    false
  );

  // .internal hostname → false
  assert.equal(
    await isSafeOutboundUrl('http://foo.internal/test', { lookup: mockPublicLookup }),
    false
  );

  // DNS lookup failure → false
  assert.equal(
    await isSafeOutboundUrl('https://nonexistent.domain.test', { lookup: mockThrowingLookup }),
    false
  );

  // Bypass via WEBHOOK_ALLOW_PRIVATE_HOSTS=true → true
  assert.equal(
    await isSafeOutboundUrl('http://localhost/test', { env: { WEBHOOK_ALLOW_PRIVATE_HOSTS: 'true' } }),
    true
  );

  // Decimal IP representation of 127.0.0.1 (2130706433) → false
  assert.equal(
    await isSafeOutboundUrl('http://2130706433/', { lookup: mockPublicLookup }),
    false
  );
});
