const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setupTestServer } = require('./helpers/server-fixture');

test('golden-path: complete survey creation, respondent lifecycle, and analytics synthesis', async (t) => {
  const { client, createClient } = await setupTestServer(t);

  // Step 1: User Signs Up
  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Dr. Jane Smith',
      email: 'jane.smith@clinic.test',
      password: 'SecurePassword2026!',
      acceptTerms: true
    }
  });
  assert.ok(signup.user?.id);
  const workspaceId = signup.workspaces[0].id;

  // Step 2: Create Survey from Template
  const created = await client.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, templateId: 'customer-feedback' }
  });
  const surveyId = created.survey.id;
  assert.equal(created.survey.status, 'draft');

  // Step 3: Customize Questions and Logic
  const customSchema = JSON.parse(JSON.stringify(created.survey.schema));
  customSchema.title = 'Clinic Patient Experience Survey';

  const updated = await client.request(`/api/surveys/${surveyId}`, {
    method: 'PUT',
    body: {
      title: 'Clinic Patient Experience Survey',
      schema: customSchema
    }
  });
  assert.equal(updated.survey.title, 'Clinic Patient Experience Survey');

  // Step 4: Publish Survey Version
  const published = await client.request(`/api/surveys/${surveyId}/publish`, {
    method: 'POST',
    body: {}
  });
  assert.equal(published.survey.status, 'published');
  const slug = published.survey.slug;
  assert.ok(slug);

  // Step 5: Public Respondent Experience
  const respondent = createClient();

  // 5a. Public survey view
  const publicSurvey = await respondent.request(`/api/public/surveys/${slug}`);
  assert.equal(publicSurvey.survey.title, 'Clinic Patient Experience Survey');

  // 5b. Start partial response
  const partial = await respondent.request(`/api/public/surveys/${slug}/responses/start`, {
    method: 'POST',
    body: { answers: {}, metadata: { source: 'kiosk', location: 'Seattle' } }
  });
  assert.equal(partial.status, 'started');
  assert.ok(partial.resumeToken);

  // 5c. Complete response submission
  const answers = {};
  for (const q of customSchema.questions) {
    if (q.type === 'csat') answers[q.id] = '5';
    else if (q.type === 'nps') answers[q.id] = '10';
    else if (q.type === 'long_text') answers[q.id] = 'Exceptional doctors and very attentive nurses.';
    else if (q.type === 'email') answers[q.id] = 'patient@example.test';
    else if (q.type === 'consent') answers[q.id] = true;
    else if (q.type === 'short_text') answers[q.id] = 'Great';
    else if (q.type === 'single_choice' && q.settings?.options?.[0]) answers[q.id] = q.settings.options[0];
  }

  const submission = await respondent.request(`/api/public/surveys/${slug}/responses`, {
    method: 'POST',
    body: {
      answers,
      metadata: { source: 'kiosk', location: 'Seattle' }
    }
  });
  assert.ok(submission.responseId);

  // Step 6: Admin Analytics Verification
  const responsesRes = await client.request(`/api/surveys/${surveyId}/responses`);
  assert.equal(responsesRes.responses.length, 2);
  const completed = responsesRes.responses.find((r) => r.id === submission.responseId);
  assert.ok(completed);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.metadataJson.source, 'kiosk');
  assert.equal(completed.metadataJson.location, 'Seattle');
});
