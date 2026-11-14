const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers/server-fixture');

test('server-surveys: survey CRUD, template instantiation, logic validation, and publishing', async (t) => {
  const { client } = await setupTestServer(t);

  // 1. Signup owner
  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Owner', email: 'owner@example.test', password: 'Password123!', acceptTerms: true }
  });
  const workspaceId = signup.workspaces[0].id;

  // 2. Fetch built-in templates
  const templates = await client.request('/api/templates');
  assert.ok(templates.templates.some((template) => template.id === 'customer-feedback'));

  // 3. Create survey from template
  const created = await client.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, templateId: 'customer-feedback' }
  });
  assert.equal(created.survey.status, 'draft');
  assert.ok(created.survey.schema.questions.length >= 4);

  // 4. Update survey title and schema
  const updated = await client.request(`/api/surveys/${created.survey.id}`, {
    method: 'PUT',
    body: {
      title: 'Customer Satisfaction Survey 2026',
      schema: {
        ...created.survey.schema,
        title: 'Customer Satisfaction Survey 2026'
      }
    }
  });
  assert.equal(updated.survey.title, 'Customer Satisfaction Survey 2026');

  // 5. Publish survey
  const published = await client.request(`/api/surveys/${created.survey.id}/publish`, {
    method: 'POST',
    body: {}
  });
  assert.equal(published.survey.status, 'published');
  assert.ok(published.survey.slug);
  assert.ok(published.survey.publishedAt);
});
