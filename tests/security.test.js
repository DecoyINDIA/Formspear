const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SECURITY_HEADERS,
  encryptConfig,
  decryptConfig,
  hashPassword,
  verifyPassword,
  publicWebhook
} = require('../src/security');

test('security module encrypts provider configuration and fails closed with the wrong key', () => {
  const firstEnv = { ENCRYPTION_KEY: 'first-key-that-is-long-enough' };
  const encrypted = encryptConfig({ token: 'provider-secret' }, firstEnv);
  assert.deepEqual(decryptConfig(encrypted, firstEnv), { token: 'provider-secret' });
  assert.deepEqual(decryptConfig(encrypted, { ENCRYPTION_KEY: 'different-key-that-is-long-enough' }), {});
  assert.throws(() => encryptConfig({ token: 'secret' }, { NODE_ENV: 'production' }), /ENCRYPTION_KEY/);
});

test('security module hashes passwords, masks webhooks, and owns browser headers', async () => {
  const stored = await hashPassword('Correct horse battery staple');
  assert.equal(await verifyPassword('Correct horse battery staple', stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
  assert.deepEqual(publicWebhook({ id: 'hook_1', secretEncrypted: 'ciphertext' }), { id: 'hook_1', secret: '[hidden]' });
  assert.match(SECURITY_HEADERS['content-security-policy'], /script-src 'self'/);
  assert.doesNotMatch(SECURITY_HEADERS['content-security-policy'], /script-src[^;]*unsafe-inline/);
});
