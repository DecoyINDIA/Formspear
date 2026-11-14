const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer, processDueJobs } = require('../src/server');

test('E-06: WhatsApp alerts and survey link delivery', async (t) => {
  const root = path.resolve(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-whatsapp-'));
  const dataFile = path.join(tempDir, 'state.json');

  const server = createServer({ dataFile, disableWorker: true });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Sign up user
  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'wa-owner@example.com', password: 'Password123!', name: 'WA Owner', acceptTerms: true })
  });
  assert.equal(signupRes.status, 201);
  const authCookie = signupRes.headers.get('set-cookie');
  const session = await signupRes.json();
  const workspaceId = session.workspaces[0].id;

  // 2. Create survey and publish
  const surveyRes = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({ workspaceId, title: 'Customer Feedback WA' })
  });
  const { survey } = await surveyRes.json();

  const publishRes = await fetch(`${baseUrl}/api/surveys/${survey.id}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({})
  });
  assert.equal(publishRes.status, 200);

  // 3. Create Alert with whatsapp channel
  const alertRes = await fetch(`${baseUrl}/api/alerts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({
      workspaceId,
      surveyId: survey.id,
      name: 'Negative Sentiment WhatsApp Alert',
      conditionsJson: { type: 'negative_sentiment' },
      channelsJson: {
        whatsapp: true,
        whatsappTo: '+15551234567',
        whatsappTemplate: 'survey_alert'
      }
    })
  });
  assert.equal(alertRes.status, 201);

  // 4. Submit negative response to trigger alert
  const responseRes = await fetch(`${baseUrl}/api/public/surveys/${survey.slug}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: { [survey.schema.questions[0].id]: 'terrible experience and broken product' }
    })
  });
  assert.equal(responseRes.status, 201);

  // Verify whatsapp_delivery job is queued in state
  const state = server.state;
  const db = state.db;
  const waJob = db.jobs.find((j) => j.type === 'whatsapp_delivery');
  assert.ok(waJob, 'whatsapp_delivery job must be queued');
  assert.equal(waJob.payloadJson.message.to, '+15551234567');
  assert.match(waJob.payloadJson.message.body, /negative response/);
  assert.match(waJob.payloadJson.message.surveyUrl, new RegExp(`/s/${survey.slug}`));

  // 5. Process job in local simulated mode
  await processDueJobs(state);
  assert.equal(waJob.status, 'completed');
  const waLog = db.integrationLogs.find((l) => l.to === '+15551234567');
  assert.ok(waLog, 'integrationLog must record simulated delivery');
  assert.equal(waLog.status, 'sent_simulated');

  // 6. Test direct survey link distribution via WhatsApp endpoint
  const distRes = await fetch(`${baseUrl}/api/surveys/${survey.id}/distribute/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({
      phone: '+15559876543',
      template: 'survey_invite',
      message: 'Please take our quick survey'
    })
  });
  assert.equal(distRes.status, 200);
  const distData = await distRes.json();
  assert.equal(distData.success, true);
  assert.match(distData.surveyUrl, /source=whatsapp/);

  const directJob = db.jobs.find((j) => j.type === 'whatsapp_delivery' && j.payloadJson.message.to === '+15559876543');
  assert.ok(directJob, 'direct distribution whatsapp_delivery job must be queued');
  assert.equal(directJob.payloadJson.message.template, 'survey_invite');

  // Process the direct job
  await processDueJobs(state);
  assert.equal(directJob.status, 'completed');
});
