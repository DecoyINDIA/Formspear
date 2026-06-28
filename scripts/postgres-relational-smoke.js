const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const { createServer } = require('../src/server');

const root = path.resolve(__dirname, '..');
const externalDatabaseUrl = process.env.POSTGRES_RELATIONAL_SMOKE_DATABASE_URL || '';
const externalConfirmation = 'I_UNDERSTAND_THIS_RESETS_THE_DATABASE';
let container = '';
let databaseUrl = '';
let server = null;
let pool = null;

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: options.stdio || 'pipe' }).trim();
}

async function prepareDatabaseUrl() {
  if (externalDatabaseUrl) {
    assert.equal(
      process.env.POSTGRES_RELATIONAL_SMOKE_CONFIRM,
      externalConfirmation,
      `Set POSTGRES_RELATIONAL_SMOKE_CONFIRM=${externalConfirmation} to run against an external disposable database.`
    );
    console.warn('Using external PostgreSQL database for relational smoke. This target must be disposable.');
    return externalDatabaseUrl;
  }

  container = `formspear-postgres-rel-${crypto.randomBytes(4).toString('hex')}`;
  docker(['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=formspear', '-p', '127.0.0.1::5432', '--name', container, 'postgres:16-alpine']);
  const portLine = docker(['port', container, '5432/tcp']);
  const port = portLine.match(/:(\d+)$/)?.[1];
  assert.ok(port, `Could not determine mapped PostgreSQL port from ${portLine}`);
  return `postgres://postgres:postgres@127.0.0.1:${port}/formspear`;
}

async function waitForPostgres(url) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    const probe = new Pool({ connectionString: url });
    try {
      await probe.query('SELECT 1');
      await probe.end();
      return;
    } catch (error) {
      lastError = error;
      await probe.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error('PostgreSQL did not become ready.');
}

function makeClient(baseUrl) {
  let cookie = '';
  return {
    async request(route, options = {}) {
      const response = await fetch(`${baseUrl}${route}`, {
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
      if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      return payload;
    }
  };
}

async function main() {
  databaseUrl = await prepareDatabaseUrl();
  await waitForPostgres(databaseUrl);

  pool = new Pool({ connectionString: databaseUrl });
  const migration = fs.readFileSync(path.join(root, 'migrations', '0001_initial_postgres.sql'), 'utf8');
  await pool.query(migration);

  server = createServer({ databaseUrl, disableWorker: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = makeClient(baseUrl);

  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Relational Smoke',
      email: 'relational@example.test',
      password: 'FeedbackOS123',
      workspaceName: 'Relational Workspace',
      acceptTerms: true
    }
  });
  const workspaceId = signup.workspaces[0].id;
  await client.request(`/api/workspaces/${workspaceId}/api-keys`, {
    method: 'POST',
    body: {
      name: 'Relational API key',
      scopes: ['surveys:read', 'responses:write'],
      rateLimitPerMinute: 60
    }
  });
  await client.request('/api/auth/password-reset/request', {
    method: 'POST',
    body: { email: 'relational@example.test' }
  });
  await client.request('/api/auth/email-verification/request', {
    method: 'POST',
    body: { email: 'relational@example.test' }
  });
  const survey = await client.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Relational Survey' }
  });
  await client.request('/api/alerts', {
    method: 'POST',
    body: {
      workspaceId,
      surveyId: survey.survey.id,
      name: 'Relational alert',
      condition: { type: 'negative_sentiment' },
      channels: { email: true, inApp: true }
    }
  });
  await client.request('/api/integrations', {
    method: 'POST',
    body: {
      workspaceId,
      type: 'webhook',
      url: 'https://example.test/webhook',
      events: ['response.completed']
    }
  });
  await client.request('/api/integrations', {
    method: 'POST',
    body: {
      workspaceId,
      type: 'google_sheets',
      name: 'Relational sheet sync',
      config: { sheetId: 'relational_sheet' },
      events: ['response.completed', 'campaign.sent']
    }
  });
  await client.request('/api/campaigns', {
    method: 'POST',
    body: {
      workspaceId,
      surveyId: survey.survey.id,
      name: 'Relational invite',
      subject: 'Please share feedback',
      message: 'A short smoke-test campaign.',
      contacts: 'relational-one@example.test\nrelational-two@example.test'
    }
  });
  await client.request(`/api/surveys/${survey.survey.id}/template`, {
    method: 'POST',
    body: {
      name: 'Relational saved template',
      useCase: 'Relational persistence smoke',
      tags: ['postgres', 'relational']
    }
  });
  const published = await client.request(`/api/surveys/${survey.survey.id}/publish`, {
    method: 'POST',
    body: {}
  });
  const answers = {};
  for (const question of published.survey.schema.questions || []) {
    if (question.type === 'email') answers[question.id] = 'lead@example.test';
    else if (['rating', 'nps', 'csat', 'ces', 'number'].includes(question.type)) answers[question.id] = 1;
    else if (question.type === 'consent') answers[question.id] = true;
    else answers[question.id] = 'Bad delay issue that needs follow-up';
  }
  await client.request(`/api/public/surveys/${published.survey.slug}/responses`, {
    method: 'POST',
    body: { answers, metadata: { source: 'relational-smoke', deviceType: 'desktop' } }
  });
  const campaignList = await client.request(`/api/campaigns?workspaceId=${workspaceId}`);
  const invite = campaignList.campaigns.find((item) => item.name === 'Relational invite');
  assert.ok(invite, 'Relational invite campaign should exist.');
  const recipientHash = invite.contacts[0].emailHash;
  await fetch(`${baseUrl}/api/public/campaigns/${invite.id}/open.gif?recipient=${recipientHash}`);
  await fetch(`${baseUrl}/api/public/campaigns/${invite.id}/click?recipient=${recipientHash}&url=${encodeURIComponent(`${baseUrl}/s/${published.survey.slug}`)}`, { redirect: 'manual' });
  await client.request(`/api/billing/${workspaceId}/invoices`, {
    method: 'POST',
    body: { amountDueInr: 1200, status: 'open' }
  });
  await client.request('/api/ai/monthly-report', {
    method: 'POST',
    body: { workspaceId, month: new Date().toISOString().slice(0, 7) }
  });

  await new Promise((resolve) => server.close(resolve));
  server = null;

  const rowCounts = {};
  for (const table of ['users', 'workspaces', 'workspace_members', 'api_keys', 'email_verification_tokens', 'password_reset_tokens', 'subscriptions', 'usage_meters', 'surveys', 'survey_versions', 'responses', 'respondents', 'contacts', 'alerts', 'integrations', 'webhooks', 'webhook_logs', 'email_campaigns', 'campaign_events', 'custom_templates', 'notifications', 'jobs', 'invoices', 'monthly_reports', 'ai_jobs', 'ai_provider_logs', 'audit_logs']) {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    rowCounts[table] = result.rows[0].count;
  }
  assert.equal(rowCounts.users, 1);
  assert.equal(rowCounts.workspaces, 1);
  assert.equal(rowCounts.workspace_members, 1);
  assert.equal(rowCounts.api_keys, 1);
  assert.ok(rowCounts.email_verification_tokens >= 1);
  assert.equal(rowCounts.password_reset_tokens, 1);
  assert.equal(rowCounts.surveys, 1);
  assert.ok(rowCounts.survey_versions >= 1);
  assert.equal(rowCounts.responses, 1);
  assert.equal(rowCounts.alerts, 1);
  assert.equal(rowCounts.integrations, 1);
  assert.equal(rowCounts.webhooks, 1);
  assert.ok(rowCounts.webhook_logs >= 1);
  assert.equal(rowCounts.email_campaigns, 1);
  assert.equal(rowCounts.campaign_events, 2);
  assert.equal(rowCounts.custom_templates, 1);
  assert.ok(rowCounts.notifications >= 1);
  assert.ok(rowCounts.jobs >= 2);
  assert.equal(rowCounts.invoices, 1);
  assert.equal(rowCounts.monthly_reports, 1);
  assert.ok(rowCounts.ai_jobs >= 1);
  assert.ok(rowCounts.ai_provider_logs >= 1);
  assert.ok(rowCounts.audit_logs >= 6);

  const integration = await pool.query("SELECT events_json FROM integrations WHERE type = 'google_sheets'");
  assert.deepEqual(integration.rows[0].events_json, ['response.completed', 'campaign.sent']);
  const apiKey = await pool.query('SELECT scopes_json, rate_limit_per_minute, token_hash FROM api_keys');
  assert.deepEqual(apiKey.rows[0].scopes_json, ['surveys:read', 'responses:write']);
  assert.equal(apiKey.rows[0].rate_limit_per_minute, 60);
  assert.match(apiKey.rows[0].token_hash, /^[a-f0-9]{64}$/);
  const passwordReset = await pool.query('SELECT token_hash, token_preview, expires_at FROM password_reset_tokens');
  assert.match(passwordReset.rows[0].token_hash, /^[a-f0-9]{64}$/);
  assert.match(passwordReset.rows[0].token_preview, /^fo_reset_/);
  assert.ok(passwordReset.rows[0].expires_at);
  const campaignEvent = await pool.query('SELECT survey_id, email, user_agent, ip_hash FROM campaign_events ORDER BY created_at LIMIT 1');
  assert.equal(campaignEvent.rows[0].survey_id, survey.survey.id);
  assert.equal(campaignEvent.rows[0].email, 'relational-one@example.test');
  assert.ok(campaignEvent.rows[0].ip_hash);
  const template = await pool.query('SELECT type, visibility, use_case, source_survey_id FROM custom_templates');
  assert.equal(template.rows[0].type, 'feedback_form');
  assert.equal(template.rows[0].visibility, 'workspace');
  assert.equal(template.rows[0].use_case, 'Relational persistence smoke');
  assert.equal(template.rows[0].source_survey_id, survey.survey.id);
  const report = await pool.query('SELECT report_json FROM monthly_reports');
  assert.ok(Array.isArray(report.rows[0].report_json.recommendedActions));
  assert.equal(typeof report.rows[0].report_json.sentiment, 'object');
  const aiProviderLog = await pool.query("SELECT task, status, duration_ms FROM ai_provider_logs WHERE task = 'monthly_report'");
  assert.equal(aiProviderLog.rows[0].status, 'skipped_unconfigured');
  assert.ok(aiProviderLog.rows[0].duration_ms >= 0);

  const runtimeState = await pool.query('SELECT value_json FROM platform_settings WHERE key = $1', ['__feedbackos_runtime_state__']);
  assert.equal(runtimeState.rows.length, 1);
  assert.equal(runtimeState.rows[0].value_json.surveys[0].id, survey.survey.id);
  const platformSettings = await pool.query('SELECT value_json FROM platform_settings WHERE key = $1', ['__feedbackos_platform_settings__']);
  assert.equal(platformSettings.rows.length, 1);

  console.log(`PostgreSQL relational smoke passed: ${JSON.stringify(rowCounts)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end().catch(() => {});
    if (container) {
      try {
        docker(['rm', '-f', container]);
      } catch {}
    }
  });
