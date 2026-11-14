const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ALL_FEATURES, enabledFeatures, featureEnabled } = require('../src/lib/features');
const { createServer } = require('../src/server');

test('features module: enabledFeatures resolves correctly across environments', () => {
  // Empty or undefined in development returns ALL_FEATURES
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'development' }), ALL_FEATURES);
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'development', FORMSPEAR_FEATURES: '' }), ALL_FEATURES);
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'development', FORMSPEAR_FEATURES: '   ' }), ALL_FEATURES);

  // Empty or undefined in production returns []
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'production' }), []);
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'production', FORMSPEAR_FEATURES: '' }), []);

  // 'all' returns ALL_FEATURES
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'production', FORMSPEAR_FEATURES: 'all' }), ALL_FEATURES);
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'development', FORMSPEAR_FEATURES: ' all ' }), ALL_FEATURES);

  // 'none' returns []
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'production', FORMSPEAR_FEATURES: 'none' }), []);
  assert.deepEqual(enabledFeatures({ NODE_ENV: 'development', FORMSPEAR_FEATURES: ' none ' }), []);

  // Comma-separated list with unknown features and duplicates
  const env = { FORMSPEAR_FEATURES: 'sso, apiV1, unknownFeature, sso, campaigns' };
  assert.deepEqual(enabledFeatures(env), ['sso', 'apiV1', 'campaigns']);

  assert.strictEqual(featureEnabled('sso', env), true);
  assert.strictEqual(featureEnabled('apiV1', env), true);
  assert.strictEqual(featureEnabled('agency', env), false);
  assert.strictEqual(featureEnabled('unknownFeature', env), false);
});

test('HTTP tests with FORMSPEAR_FEATURES="none"', async (t) => {
  const origFeatures = process.env.FORMSPEAR_FEATURES;
  process.env.FORMSPEAR_FEATURES = 'none';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'features-none-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    if (origFeatures === undefined) delete process.env.FORMSPEAR_FEATURES;
    else process.env.FORMSPEAR_FEATURES = origFeatures;

    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. GET /api/v1/surveys with any bearer token -> 404 feature_disabled
  const v1Res = await fetch(`${baseUrl}/api/v1/surveys`, {
    headers: { authorization: 'Bearer fo_live_any_token' }
  });
  assert.strictEqual(v1Res.status, 404);
  const v1Body = await v1Res.json();
  assert.strictEqual(v1Body.error.code, 'feature_disabled');

  // 2. POST /api/auth/sso/start -> 404 feature_disabled
  const ssoRes = await fetch(`${baseUrl}/api/auth/sso/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'sso@example.test' })
  });
  assert.strictEqual(ssoRes.status, 404);
  const ssoBody = await ssoRes.json();
  assert.strictEqual(ssoBody.error.code, 'feature_disabled');

  // Sign up a user to get an authenticated cookie for campaigns and survey creation
  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Feature Test User',
      email: 'features@example.test',
      password: 'Password123!',
      workspaceName: 'Features Workspace',
      acceptTerms: true
    })
  });
  assert.strictEqual(signupRes.status, 201);
  const cookie = signupRes.headers.get('set-cookie');
  const signupData = await signupRes.json();
  const workspaceId = signupData.workspaces[0].id;

  // 3. Authenticated GET /api/campaigns?workspaceId=... -> 404 feature_disabled
  const campaignsRes = await fetch(`${baseUrl}/api/campaigns?workspaceId=${workspaceId}`, {
    headers: { cookie }
  });
  assert.strictEqual(campaignsRes.status, 404);
  const campaignsBody = await campaignsRes.json();
  assert.strictEqual(campaignsBody.error.code, 'feature_disabled');

  // 4. POST /api/public/in-app/resolve -> 404 feature_disabled
  const inAppRes = await fetch(`${baseUrl}/api/public/in-app/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'test_event' })
  });
  assert.strictEqual(inAppRes.status, 404);
  const inAppBody = await inAppRes.json();
  assert.strictEqual(inAppBody.error.code, 'feature_disabled');

  // 5. GET /api/session -> features is []
  const sessionRes = await fetch(`${baseUrl}/api/session`, {
    headers: { cookie }
  });
  assert.strictEqual(sessionRes.status, 200);
  const sessionData = await sessionRes.json();
  assert.deepEqual(sessionData.features, []);

  // 6. Core route still works: create a survey -> 201
  const surveyRes = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie
    },
    body: JSON.stringify({
      workspaceId,
      title: 'Core Survey Title'
    })
  });
  assert.strictEqual(surveyRes.status, 201);
  const surveyData = await surveyRes.json();
  assert.strictEqual(surveyData.survey.title, 'Core Survey Title');
});

test('HTTP tests with FORMSPEAR_FEATURES="apiV1"', async (t) => {
  const origFeatures = process.env.FORMSPEAR_FEATURES;
  process.env.FORMSPEAR_FEATURES = 'apiV1';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'features-apiv1-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    if (origFeatures === undefined) delete process.env.FORMSPEAR_FEATURES;
    else process.env.FORMSPEAR_FEATURES = origFeatures;

    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // With apiV1 enabled, /api/v1/surveys no longer returns feature_disabled (returns 401 without a valid key)
  const v1Res = await fetch(`${baseUrl}/api/v1/surveys`);
  assert.notStrictEqual(v1Res.status, 404);
  assert.strictEqual(v1Res.status, 401);
  const v1Body = await v1Res.json();
  assert.strictEqual(v1Body.error.code, 'api_key_required');

  // Other features like SSO are still disabled
  const ssoRes = await fetch(`${baseUrl}/api/auth/sso/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'sso@example.test' })
  });
  assert.strictEqual(ssoRes.status, 404);
  const ssoBody = await ssoRes.json();
  assert.strictEqual(ssoBody.error.code, 'feature_disabled');
});
