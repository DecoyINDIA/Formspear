const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers/server-fixture');

test('server-admin: admin overview, custom plans, readiness probe, and access control', async (t) => {
  const previousAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.test';
  t.after(() => {
    if (previousAdminEmail === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    else process.env.BOOTSTRAP_ADMIN_EMAIL = previousAdminEmail;
  });

  const { client: adminClient, createClient } = await setupTestServer(t);

  // 1. Signup bootstrap admin
  await adminClient.request('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Admin', email: 'admin@example.test', password: 'Password123!', acceptTerms: true }
  });

  // 2. Signup non-admin user
  const regularClient = createClient();
  await regularClient.request('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Regular', email: 'regular@example.test', password: 'Password123!', acceptTerms: true }
  });

  // 3. Regular user rejected from admin endpoints
  await assert.rejects(
    regularClient.request('/api/admin/overview'),
    (err) => err.status === 403
  );

  // 4. Admin accesses overview
  const overview = await adminClient.request('/api/admin/overview');
  assert.ok(overview.totals.workspaces >= 1);

  // 5. Admin lists and creates custom plan
  const planRes = await adminClient.request('/api/admin/plans', {
    method: 'POST',
    body: {
      id: 'modular_plan_test',
      name: 'Modular Test Plan',
      priceMonthlyInr: 9999,
      setupFeeRange: 'INR 5,000',
      limits: { surveys: 10, responsesPerMonth: 500, teamMembers: 5, aiCredits: 50 },
      features: ['Priority support']
    }
  });
  assert.equal(planRes.plan.id, 'modular_plan_test');

  const plans = await adminClient.request('/api/admin/plans');
  assert.ok(plans.plans.some((p) => p.id === 'modular_plan_test'));

  // 6. Admin readiness check
  const readiness = await adminClient.request('/api/admin/readiness');
  assert.equal(typeof readiness.productionReady, 'boolean');
  assert.ok(Array.isArray(readiness.checks));
});
