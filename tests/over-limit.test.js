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

test('E-07: over-limit responses are stored with status over_limit and hidden until upgrade', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formspear-overlimit-'));
  const dataFile = path.join(dir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = makeClient(baseUrl);

  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Owner', email: 'owner@example.test', password: 'password123', workspaceName: 'Test Wks', acceptTerms: true }
  });
  assert.equal(signup.status, 201);
  const workspaceId = signup.payload.workspaces[0].id;

  const surveyRes = await client.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Limit Test Survey' }
  });
  assert.equal(surveyRes.status, 201);
  const surveyId = surveyRes.payload.survey.id;
  await client.request(`/api/surveys/${surveyId}/publish`, {
    method: 'POST',
    body: {}
  });

  const rawDb = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const currentPeriod = new Date().toISOString().slice(0, 7);
  rawDb.usageMeters = [{
    id: 'usg_1',
    workspaceId,
    period: currentPeriod,
    responsesCount: 500,
    storageUsed: 0,
    aiCreditsUsed: 0
  }];
  fs.writeFileSync(dataFile, JSON.stringify(rawDb, null, 2));

  await new Promise((resolve) => server.close(resolve));
  const server2 = createServer({ dataFile, disableWorker: true });
  await new Promise((resolve) => server2.listen(0, resolve));
  t.after(() => server2.close());
  const baseUrl2 = `http://127.0.0.1:${server2.address().port}`;
  const client2 = makeClient(baseUrl2);
  // Re-login to get session on server2
  const login = await client2.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.test', password: 'password123' }
  });
  assert.equal(login.status, 200);

  // Client 2 is a public respondent (no cookie)
  const respondentClient = makeClient(baseUrl2);
  const q0 = surveyRes.payload.survey.schema.questions[0].id;
  const submission = await respondentClient.request(`/api/public/surveys/${surveyRes.payload.survey.slug}/responses`, {
    method: 'POST',
    body: {
      answers: { [q0]: 5 }
    }
  });
  assert.equal(submission.status, 201);
  assert.ok(submission.payload.responseId);
  assert.ok(submission.payload.completion);

  // Check stored response in db has status: 'over_limit'
  const dbAfter = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const stored = dbAfter.responses.find((r) => r.id === submission.payload.responseId);
  assert.equal(stored.status, 'over_limit');

  // Owner listing without filter: over_limit response is hidden
  const list = await client2.request(`/api/surveys/${surveyId}/responses`);
  assert.equal(list.payload.responses.length, 0);

  // Owner listing with status=over_limit: response is returned but locked
  const overLimitList = await client2.request(`/api/surveys/${surveyId}/responses?status=over_limit`);
  assert.equal(overLimitList.payload.responses.length, 1);

  // Response detail is locked
  const detail = await client2.request(`/api/surveys/${surveyId}/responses/${submission.payload.responseId}`);
  assert.equal(detail.payload.response.locked, true);
  assert.equal(detail.payload.response.answersJson._locked, true);

  // Admin upgrades workspace to pro plan
  await client2.request(`/api/admin/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { planId: 'pro' }
  });

  // Now response is unlocked and visible in default listing
  const listAfterUpgrade = await client2.request(`/api/surveys/${surveyId}/responses`);
  assert.equal(listAfterUpgrade.payload.responses.length, 1);
  assert.equal(listAfterUpgrade.payload.responses[0].status, 'completed');

  const detailAfterUpgrade = await client2.request(`/api/surveys/${surveyId}/responses/${submission.payload.responseId}`);
  assert.equal(detailAfterUpgrade.payload.response.locked, false);
  assert.equal(detailAfterUpgrade.payload.response.answersJson[q0], '5');
});
