const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setupTestServer, makeWebhookReceiver } = require('./helpers/server-fixture');

process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS = 'true';

test('server-integrations: webhooks, alerts, and encrypted secrets', async (t) => {
  const { client, dataFile } = await setupTestServer(t);
  const webhookReceiver = await makeWebhookReceiver(t);

  // 1. Signup owner
  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Owner', email: 'owner@example.test', password: 'Password123!', acceptTerms: true }
  });
  const workspaceId = signup.workspaces[0].id;

  // 2. Register webhook integration with encrypted secret
  const webhookRes = await client.request('/api/integrations', {
    method: 'POST',
    body: {
      workspaceId,
      type: 'webhook',
      url: webhookReceiver.url,
      events: ['response.completed']
    }
  });
  assert.equal(webhookRes.webhook?.secret, '[hidden]');

  const dbData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const savedWebhook = dbData.webhooks.find((w) => w.id === webhookRes.webhook.id);
  assert.ok(savedWebhook.secretEncrypted, 'webhook secret should be stored encrypted in database');
  assert.equal(savedWebhook.secret, undefined, 'plaintext secret should not be stored');

  // 3. Register alert rule
  const alertRes = await client.request('/api/alerts', {
    method: 'POST',
    body: {
      workspaceId,
      name: 'High Urgency Alert',
      condition: { type: 'negative_sentiment' },
      channels: { email: true, emailTo: 'ops@example.test', inApp: true }
    }
  });
  assert.ok(alertRes.alert?.id);
});
