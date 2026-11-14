async function handleBillingRoute(context) {
  const {
    req, res, url, segments, db, state, user,
    requireWorkspacePermission, billingPlans, readJson, createInvoice, audit, saveDb, sendJson,
    findBillingPlan, createBillingCheckoutSession, createBillingPortalSession, applyGracefulDowngrade,
    manualBillingAllowed
  } = context;
  const workspaceId = url.searchParams.get('workspaceId') || segments[0];
  if (!requireWorkspacePermission(res, db, user, workspaceId, 'billingManagement')) return;

  if ((segments.length === 0 || segments[1] === 'overview') && req.method === 'GET') {
    const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
    const invoices = db.invoices.filter((invoice) => invoice.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const usage = db.usageMeters.filter((meter) => meter.workspaceId === workspaceId).sort((a, b) => b.period.localeCompare(a.period));
    sendJson(res, 200, { subscription, invoices, usage, plans: billingPlans(db) });
    return;
  }

  if (segments[1] === 'invoices' && req.method === 'POST') {
    if (typeof manualBillingAllowed === 'function' && !manualBillingAllowed(user)) {
      sendJson(res, 403, { error: { code: 'forbidden', message: 'Manual invoice creation requires super admin access.' } });
      return;
    }
    const body = await readJson(req);
    const invoice = createInvoice(workspaceId, body);
    db.invoices.push(invoice);
    db.auditLogs.push(audit(workspaceId, user.id, 'billing.invoice_created', 'invoice', invoice.id, { amount: invoice.amountDueInr }));
    await saveDb(state);
    sendJson(res, 201, { invoice });
    return;
  }

  if (segments[1] === 'checkout' && req.method === 'POST') {
    const body = await readJson(req);
    const plan = findBillingPlan(db, body.planId);
    if (!plan) {
      sendJson(res, 400, { error: { code: 'invalid_plan', message: 'Unknown plan.' } });
      return;
    }
    const workspace = db.workspaces.find((item) => item.id === workspaceId);
    const checkout = await createBillingCheckoutSession(workspace, plan, user, body);
    if (!checkout.ok) {
      sendJson(res, 502, { error: { code: 'billing_provider_failed', message: checkout.message || 'Billing provider checkout failed.' } });
      return;
    }
    db.auditLogs.push(audit(workspaceId, user.id, 'billing.checkout_created', 'billing_checkout', checkout.session.id, {
      provider: checkout.session.provider, planId: plan.id, mode: checkout.session.mode
    }));
    await saveDb(state);
    sendJson(res, 201, { checkout: checkout.session });
    return;
  }

  if (segments[1] === 'portal' && req.method === 'POST') {
    const portal = await createBillingPortalSession(db, workspaceId);
    if (!portal.ok) {
      sendJson(res, 400, { error: { code: 'billing_portal_unavailable', message: portal.message } });
      return;
    }
    db.auditLogs.push(audit(workspaceId, user.id, 'billing.portal_created', 'billing_portal', portal.session.id, { provider: portal.session.provider }));
    await saveDb(state);
    sendJson(res, 201, { portal: portal.session });
    return;
  }

  if (segments[1] === 'payment-failed' && req.method === 'POST') {
    const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
    if (subscription) {
      subscription.status = 'past_due';
      subscription.updatedAt = new Date().toISOString();
    }
    applyGracefulDowngrade(db, workspaceId);
    db.auditLogs.push(audit(workspaceId, user.id, 'billing.payment_failed', 'subscription', subscription?.id || null, {}));
    await saveDb(state);
    sendJson(res, 200, { subscription, workspace: db.workspaces.find((item) => item.id === workspaceId) });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Billing route not found.' } });
}

module.exports = { handleBillingRoute };
