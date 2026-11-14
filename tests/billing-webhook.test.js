const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');

function stripeSignature(secret, body, timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

test('Stripe webhook handles subscription lifecycle, timestamps, and deduplication', async (t) => {
  const origStripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const webhookSecret = 'whsec_test_secret_123456';
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-webhook-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    if (origStripeSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = origStripeSecret;

    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Helper to send a signed stripe webhook
  async function sendStripeWebhook(eventPayload) {
    const rawBody = JSON.stringify(eventPayload);
    const signature = stripeSignature(webhookSecret, rawBody);
    const res = await fetch(`${baseUrl}/api/billing/webhook/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature
      },
      body: rawBody
    });
    return { status: res.status, data: await res.json() };
  }

  // Create a user and workspace first
  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Owner',
      email: 'owner@example.test',
      password: 'Password123!',
      workspaceName: 'Billing Test Workspace',
      acceptTerms: true
    })
  });
  const signupData = await signupRes.json();
  const workspaceId = signupData.workspaces[0].id;

  // 1. Activate a subscription with signed checkout.session.completed
  const checkoutEvent = {
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_1',
        subscription: 'sub_1',
        customer: 'cus_test_1',
        metadata: {
          workspaceId,
          planId: 'growth'
        }
      }
    }
  };
  const activateRes = await sendStripeWebhook(checkoutEvent);
  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.data.result.action, 'subscription_activated');

  const workspaceAfterActivate = server.state.db.workspaces.find((w) => w.id === workspaceId);
  assert.equal(workspaceAfterActivate.planId, 'growth');
  const subAfterActivate = server.state.db.subscriptions.find((s) => s.workspaceId === workspaceId);
  assert.equal(subAfterActivate.planId, 'growth');
  assert.equal(subAfterActivate.status, 'active');
  assert.equal(subAfterActivate.providerSubscriptionId, 'sub_1');

  // 2. customer.subscription.updated with status: past_due and period timestamps
  const periodStartSec = Math.floor(Date.now() / 1000) - 3600;
  const periodEndSec = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
  const updateEvent = {
    id: 'evt_sub_update_1',
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_1',
        status: 'past_due',
        current_period_start: periodStartSec,
        current_period_end: periodEndSec
      }
    }
  };
  const updateRes = await sendStripeWebhook(updateEvent);
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.result.action, 'subscription_updated');

  const subAfterUpdate = server.state.db.subscriptions.find((s) => s.workspaceId === workspaceId);
  assert.equal(subAfterUpdate.status, 'past_due');
  assert.equal(subAfterUpdate.currentPeriodStart, new Date(periodStartSec * 1000).toISOString());
  assert.equal(subAfterUpdate.currentPeriodEnd, new Date(periodEndSec * 1000).toISOString());

  // 3. customer.subscription.deleted for sub_1 → downgraded to starter and status canceled
  const deleteEvent = {
    id: 'evt_sub_delete_1',
    type: 'customer.subscription.deleted',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_1'
      }
    }
  };
  const deleteRes = await sendStripeWebhook(deleteEvent);
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.data.result.action, 'subscription_canceled');

  const workspaceAfterDelete = server.state.db.workspaces.find((w) => w.id === workspaceId);
  assert.equal(workspaceAfterDelete.planId, 'starter');
  const subAfterDelete = server.state.db.subscriptions.find((s) => s.workspaceId === workspaceId);
  assert.equal(subAfterDelete.status, 'canceled');

  // 4. Send the same delete event id again → duplicate: true, state unchanged
  const dupDeleteRes = await sendStripeWebhook(deleteEvent);
  assert.equal(dupDeleteRes.status, 200);
  assert.equal(dupDeleteRes.data.duplicate, true);
  assert.equal(server.state.db.workspaces.find((w) => w.id === workspaceId).planId, 'starter');

  // 5. An event for an unknown subscription returns action: 'ignored' with HTTP 200
  const unknownSubEvent = {
    id: 'evt_unknown_sub_1',
    type: 'customer.subscription.deleted',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_unknown_999'
      }
    }
  };
  const unknownRes = await sendStripeWebhook(unknownSubEvent);
  assert.equal(unknownRes.status, 200);
  assert.equal(unknownRes.data.result.action, 'ignored');
});

test('Razorpay webhook handles subscription lifecycle, pausing, cancellation, and deduplication', async (t) => {
  const origSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const webhookSecret = 'rzp_test_webhook_secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'razorpay-webhook-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    if (origSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = origSecret;

    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function sendRazorpayWebhook(eventPayload) {
    const rawBody = JSON.stringify(eventPayload);
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const res = await fetch(`${baseUrl}/api/billing/webhook/razorpay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature
      },
      body: rawBody
    });
    return { status: res.status, data: await res.json() };
  }

  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Owner',
      email: 'rzp_owner@example.test',
      password: 'Password123!',
      workspaceName: 'Razorpay Test Workspace',
      acceptTerms: true
    })
  });
  const signupData = await signupRes.json();
  const workspaceId = signupData.workspaces[0].id;

  // 1. subscription.activated
  const activatedEvent = {
    id: 'evt_rzp_1',
    event: 'subscription.activated',
    created_at: 1700000000,
    payload: {
      subscription: {
        entity: {
          id: 'sub_rzp_12345',
          plan_id: 'plan_pro',
          customer_id: 'cust_rzp_1',
          notes: { workspaceId, planId: 'pro' }
        }
      }
    }
  };
  const activatedRes = await sendRazorpayWebhook(activatedEvent);
  assert.equal(activatedRes.status, 200);
  assert.equal(activatedRes.data.result.action, 'subscription_activated');

  const ws = server.state.db.workspaces.find((w) => w.id === workspaceId);
  assert.equal(ws.planId, 'pro');
  const sub = server.state.db.subscriptions.find((s) => s.workspaceId === workspaceId);
  assert.equal(sub.status, 'active');
  assert.equal(sub.providerSubscriptionId, 'sub_rzp_12345');

  // 2. subscription.paused
  const pauseEvent = {
    id: 'evt_rzp_2',
    event: 'subscription.paused',
    created_at: 1700000100,
    payload: {
      subscription: {
        entity: {
          id: 'sub_rzp_12345',
          notes: { workspaceId }
        }
      }
    }
  };
  const pauseRes = await sendRazorpayWebhook(pauseEvent);
  assert.equal(pauseRes.status, 200);
  assert.equal(pauseRes.data.result.action, 'subscription_paused');
  assert.equal(server.state.db.subscriptions.find((s) => s.workspaceId === workspaceId).status, 'paused');

  // 3. subscription.resumed
  const resumeEvent = {
    id: 'evt_rzp_3',
    event: 'subscription.resumed',
    created_at: 1700000200,
    payload: {
      subscription: {
        entity: {
          id: 'sub_rzp_12345',
          notes: { workspaceId }
        }
      }
    }
  };
  const resumeRes = await sendRazorpayWebhook(resumeEvent);
  assert.equal(resumeRes.status, 200);
  assert.equal(resumeRes.data.result.action, 'subscription_resumed');
  assert.equal(server.state.db.subscriptions.find((s) => s.workspaceId === workspaceId).status, 'active');

  // 4. subscription.cancelled
  const cancelEvent = {
    id: 'evt_rzp_4',
    event: 'subscription.cancelled',
    created_at: 1700000300,
    payload: {
      subscription: {
        entity: {
          id: 'sub_rzp_12345',
          notes: { workspaceId }
        }
      }
    }
  };
  const cancelRes = await sendRazorpayWebhook(cancelEvent);
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.data.result.action, 'subscription_cancelled');
  assert.equal(server.state.db.workspaces.find((w) => w.id === workspaceId).planId, 'starter');
  assert.equal(server.state.db.subscriptions.find((s) => s.workspaceId === workspaceId).status, 'cancelled');

  // 5. Deduplication
  const dupRes = await sendRazorpayWebhook(cancelEvent);
  assert.equal(dupRes.status, 200);
  assert.equal(dupRes.data.duplicate, true);
});
