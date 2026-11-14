const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');

function parseCookieValue(setCookieHeader, name) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

test('session tokens are stored only as hashes and raw token is not exposed in db dump', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-hardening-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Auth Test User',
      email: 'authtest@example.test',
      password: 'Password123!',
      workspaceName: 'Auth Hardening Workspace',
      acceptTerms: true
    })
  });

  assert.strictEqual(signupRes.status, 201);
  const setCookie = signupRes.headers.get('set-cookie');
  const cookieToken = parseCookieValue(setCookie, 'fo_session');
  assert.ok(cookieToken, 'fo_session cookie should be present in signup response');
  assert.ok(cookieToken.startsWith('sess_'), 'cookie token starts with sess_');

  const storedSession = server.state.db.sessions[0];
  assert.ok(storedSession, 'a session must be stored');
  assert.strictEqual(typeof storedSession.id, 'string');
  assert.strictEqual(storedSession.id.length, 64, 'stored session id is 64 hex characters');
  assert.match(storedSession.id, /^[0-9a-f]{64}$/, 'stored session id is lowercase hex');
  assert.notStrictEqual(storedSession.id, cookieToken, 'stored session id differs from cookie token');

  const expectedHash = crypto.createHash('sha256').update(cookieToken).digest('hex');
  assert.strictEqual(storedSession.id, expectedHash, 'stored session id equals SHA-256 of cookie token');

  const serializedDb = JSON.stringify(server.state.db);
  assert.strictEqual(serializedDb.includes(cookieToken), false, 'JSON.stringify(db) must not contain the raw cookie token');

  // Verify the cookie authenticates GET /api/session
  const sessionRes = await fetch(`${baseUrl}/api/session`, {
    headers: {
      cookie: `fo_session=${cookieToken}`
    }
  });
  assert.strictEqual(sessionRes.status, 200);
  const sessionData = await sessionRes.json();
  assert.strictEqual(sessionData.user.email, 'authtest@example.test');
});

test('signup is rate limited per client IP regardless of email used', async (t) => {
  const origProxyHops = process.env.TRUST_PROXY_HOPS;
  process.env.TRUST_PROXY_HOPS = '1';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-ip-ratelimit-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    if (origProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = origProxyHops;

    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const testIp = '198.51.100.99';

  // Perform 10 signups from the same IP with different emails
  for (let i = 1; i <= 10; i++) {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': testIp
      },
      body: JSON.stringify({
        name: `User ${i}`,
        email: `rate-limit-user-${i}@example.test`,
        password: 'Password123!',
        workspaceName: `Workspace ${i}`,
        acceptTerms: true
      })
    });
    assert.strictEqual(res.status, 201, `Signup ${i} should succeed`);
  }

  // 11th signup from the same IP with yet another email must be rate limited
  const res11 = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': testIp
    },
    body: JSON.stringify({
      name: 'User 11',
      email: 'rate-limit-user-11@example.test',
      password: 'Password123!',
      workspaceName: 'Workspace 11',
      acceptTerms: true
    })
  });

  assert.strictEqual(res11.status, 429, '11th signup must return 429 Too Many Requests');
  const body11 = await res11.json();
  assert.strictEqual(body11.error.code, 'rate_limited');
});
