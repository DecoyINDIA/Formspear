const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');

function makeClient(baseUrl) {
  let cookie = '';
  return {
    async request(pathname, options = {}) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await response.text();
      const payload = response.headers.get('content-type')?.includes('application/json') && text ? JSON.parse(text) : text;
      return { status: response.status, ok: response.ok, payload };
    }
  };
}

test('billing guard prevents non-super-admin plan and invoice changes when provider is configured', async (t) => {
  const origStripeKey = process.env.STRIPE_SECRET_KEY;
  const origStripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const origNodeEnv = process.env.NODE_ENV;
  const origBootstrapAdmin = process.env.BOOTSTRAP_ADMIN_EMAIL;

  process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.test';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-guard-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    if (origStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = origStripeKey;

    if (origStripeSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = origStripeSecret;

    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;

    if (origBootstrapAdmin === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    else process.env.BOOTSTRAP_ADMIN_EMAIL = origBootstrapAdmin;

    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const superAdminClient = makeClient(baseUrl);
  const normalUserClient = makeClient(baseUrl);

  // User 1: first user created is super_admin
  const adminSignup = await superAdminClient.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Super Admin',
      email: 'admin@example.test',
      password: 'SuperPassword123',
      workspaceName: 'Admin Workspace',
      acceptTerms: true
    }
  });
  assert.equal(adminSignup.status, 201);
  const adminWorkspaceId = adminSignup.payload.workspaces[0].id;

  // User 2: normal user with their own workspace
  const userSignup = await normalUserClient.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Normal User',
      email: 'user@example.test',
      password: 'UserPassword123',
      workspaceName: 'User Workspace',
      acceptTerms: true
    }
  });
  assert.equal(userSignup.status, 201);
  const userWorkspaceId = userSignup.payload.workspaces[0].id;

  // 1. With Stripe configured: normal user gets 403 on plan change and invoice creation
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy_secret_for_test';

  const userPlanRes = await normalUserClient.request(`/api/workspaces/${userWorkspaceId}/subscription`, {
    method: 'POST',
    body: { planId: 'agency' }
  });
  assert.equal(userPlanRes.status, 403);
  assert.equal(userPlanRes.payload.error.code, 'checkout_required');

  // Verify workspace plan is unchanged
  const userWorkspace = server.state.db.workspaces.find((w) => w.id === userWorkspaceId);
  assert.notEqual(userWorkspace.planId, 'agency');

  // Normal user gets 403 on invoices endpoint
  const userInvoiceRes = await normalUserClient.request(`/api/billing/${userWorkspaceId}/invoices`, {
    method: 'POST',
    body: { planId: 'agency', subtotalInr: 49999 }
  });
  assert.equal(userInvoiceRes.status, 403);
  assert.equal(userInvoiceRes.payload.error.code, 'forbidden');

  // 2. Super admin gets 200 on subscription endpoint
  const adminPlanRes = await superAdminClient.request(`/api/workspaces/${adminWorkspaceId}/subscription`, {
    method: 'POST',
    body: { planId: 'agency' }
  });
  assert.equal(adminPlanRes.status, 200);

  // 3. With Stripe unset and NODE_ENV not production: normal user gets 200 in local mode
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'development';

  const userLocalPlanRes = await normalUserClient.request(`/api/workspaces/${userWorkspaceId}/subscription`, {
    method: 'POST',
    body: { planId: 'growth' }
  });
  assert.equal(userLocalPlanRes.status, 200);
});
