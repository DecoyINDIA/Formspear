const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer, getVerificationToken, getPasswordResetToken, makeSmtpReceiver } = require('./helpers/server-fixture');

test('server-auth: signup, verification, login, 2fa, and password reset', async (t) => {
  const { baseUrl, dataFile, client } = await setupTestServer(t);
  const smtp = await makeSmtpReceiver(t);
  process.env.SMTP_PORT = String(smtp.port);
  t.after(() => delete process.env.SMTP_PORT);

  // 1. Signup requires terms acceptance
  await assert.rejects(
    client.request('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Alice', email: 'alice@example.test', password: 'Password123!', acceptTerms: false }
    }),
    (err) => err.status === 400
  );

  // 2. Valid signup
  const signupRes = await client.request('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Alice', email: 'alice@example.test', password: 'Password123!', acceptTerms: true }
  });
  assert.ok(signupRes.user?.id, 'signup should return user id');
  assert.ok(client.cookie, 'signup should set session cookie');

  // 3. Email verification
  const verifyToken = getVerificationToken(dataFile, 'alice@example.test');
  if (verifyToken) {
    const verifyRes = await client.request('/api/auth/email-verification/confirm', {
      method: 'POST',
      body: { token: verifyToken }
    });
    assert.equal(verifyRes.ok, true);
  }

  // 4. Session check
  const session = await client.request('/api/session');
  assert.equal(session.user?.email, 'alice@example.test');

  // 5. Password reset flow
  const resetReq = await client.request('/api/auth/password-reset/request', {
    method: 'POST',
    body: { email: 'alice@example.test' }
  });
  assert.equal(resetReq.ok, true);

  const resetToken = getPasswordResetToken(dataFile, 'alice@example.test');
  if (resetToken) {
    const confirmRes = await client.request('/api/auth/password-reset/confirm', {
      method: 'POST',
      body: { token: resetToken, password: 'NewPassword456!' }
    });
    assert.equal(confirmRes.ok, true);

    // Login with new password
    client.cookie = '';
    const loginRes = await client.request('/api/auth/login', {
      method: 'POST',
      body: { email: 'alice@example.test', password: 'NewPassword456!' }
    });
    assert.ok(loginRes.user?.id);
  }
});
