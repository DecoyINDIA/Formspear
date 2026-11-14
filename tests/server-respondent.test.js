const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers/server-fixture');

test('server-respondent: public survey flow, partial responses, and submission', async (t) => {
  const { client, createClient, baseUrl } = await setupTestServer(t);

  // 1. Signup owner & create published survey
  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Owner', email: 'owner@example.test', password: 'Password123!', acceptTerms: true }
  });
  const workspaceId = signup.workspaces[0].id;

  const created = await client.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, templateId: 'customer-feedback' }
  });
  const published = await client.request(`/api/surveys/${created.survey.id}/publish`, {
    method: 'POST',
    body: {}
  });

  // 2. Public client starts response
  const respondent = createClient();
  const publicSurvey = await respondent.request(`/api/public/surveys/${published.survey.slug}`);
  assert.equal(publicSurvey.survey.title, created.survey.title);

  // 3. Start partial response
  const partial = await respondent.request(`/api/public/surveys/${published.survey.slug}/responses/start`, {
    method: 'POST',
    body: { answers: {}, metadata: { source: 'web' } }
  });
  assert.equal(partial.status, 'started');
  assert.match(partial.resumeToken, /^fo_resume_/);

  // 4. Submit complete response
  const answers = {};
  for (const question of publicSurvey.survey.schema.questions) {
    if (question.type === 'csat') answers[question.id] = '5';
    if (question.type === 'nps') answers[question.id] = '9';
    if (question.type === 'long_text') answers[question.id] = 'Great service and very friendly staff!';
    if (question.type === 'email') answers[question.id] = 'visitor@example.test';
    if (question.type === 'consent') answers[question.id] = true;
  }

  const submitted = await respondent.request(`/api/public/surveys/${published.survey.slug}/responses`, {
    method: 'POST',
    body: { answers, metadata: { source: 'web' } }
  });
  assert.match(submitted.responseId, /^rsp_/);

  // 5. Verify admin sees completed response
  const responses = await client.request(`/api/surveys/${created.survey.id}/responses`);
  assert.ok(responses.responses.some((r) => r.id === submitted.responseId));
});
