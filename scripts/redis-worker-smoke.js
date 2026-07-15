const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createServer, processDueJobs, startBullMqWorker, closeBullMq } = require('../src/server');

const redisUrl = process.env.REDIS_WORKER_SMOKE_URL || process.env.REDIS_URL || '';

async function main() {
  if (!redisUrl) throw new Error('Set REDIS_WORKER_SMOKE_URL to a disposable Redis instance.');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formspear-redis-smoke-'));
  const server = createServer({ dataFile: path.join(tempDir, 'db.json'), redisUrl, disableWorker: true });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const email = `redis-smoke-${Date.now()}@example.test`;
    await request(baseUrl, '/api/auth/signup', {
      name: 'Redis Smoke', email, password: 'FeedbackOS123', workspaceName: 'Redis Smoke', acceptTerms: true
    });
    await request(baseUrl, '/api/auth/password-reset/request', { email });
    await startBullMqWorker(server.state);
    const queued = await processDueJobs(server.state);
    assert.ok(queued.enqueuedExternal >= 1, 'Expected a persisted job to be mirrored into BullMQ.');
    await waitFor(() => server.state.db.jobs.some((job) => job.type === 'email_delivery' && job.status === 'completed'), 10000);
    assert.ok(server.state.db.emailLogs.some((log) => log.to === email), 'Worker should create an email delivery log.');
    console.log(`Redis/BullMQ worker smoke passed: ${queued.enqueuedExternal} job(s) enqueued and completed.`);
  } finally {
    await closeBullMq(server.state).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

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

async function waitFor(check, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for BullMQ completion.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
