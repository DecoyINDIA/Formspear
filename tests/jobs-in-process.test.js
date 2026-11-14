const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, processDueJobs } = require('../src/server');

async function request(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${pathname} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

test('in-process jobs complete without Redis in JSON mode', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-in-process-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const email = `inproc-${Date.now()}@example.test`;
  await request(baseUrl, '/api/auth/signup', {
    name: 'In Process User',
    email,
    password: 'FeedbackOS123',
    workspaceName: 'InProcess Wks',
    acceptTerms: true
  });

  await request(baseUrl, '/api/auth/password-reset/request', { email });

  const result = await processDueJobs(server.state);
  assert.ok(result.processed >= 1, 'Expected at least 1 job processed in-process');

  const emailJob = server.state.db.jobs.find(
    (job) => job.type === 'email_delivery' && job.payloadJson?.message?.to === email
  );
  assert.ok(emailJob, 'email_delivery job should exist');
  assert.equal(emailJob.status, 'completed', 'Job status must be completed');

  assert.ok(
    server.state.db.emailLogs.some((log) => log.to === email),
    'Email log entry should exist for the address'
  );
});
