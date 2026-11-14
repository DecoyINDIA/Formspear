const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const { createServer } = require('../src/server');
const { applyMigrations } = require('./migrate');

const root = path.resolve(__dirname, '..');
const runtimeStateKey = '__feedbackos_runtime_state__';
const platformSettingsKey = '__feedbackos_platform_settings__';
const externalDatabaseUrl = process.env.POSTGRES_BACKFILL_DRILL_DATABASE_URL || '';
const externalConfirmation = 'I_UNDERSTAND_THIS_RESETS_THE_DATABASE';
const relationalTables = [
  'users',
  'sessions',
  'two_factor_challenges',
  'email_verification_tokens',
  'password_reset_tokens',
  'oauth_auth_requests',
  'workspaces',
  'workspace_members',
  'sso_auth_requests',
  'api_keys',
  'workspace_invites',
  'surveys',
  'survey_versions',
  'respondents',
  'responses',
  'contacts',
  'integrations',
  'integration_logs',
  'webhooks',
  'webhook_logs',
  'alerts',
  'ai_jobs',
  'ai_provider_logs',
  'subscriptions',
  'invoices',
  'usage_meters',
  'custom_templates',
  'jobs',
  'email_logs',
  'email_campaigns',
  'campaign_events',
  'file_uploads',
  'monthly_reports',
  'audit_logs',
  'notifications',
  'error_logs'
];

let container = '';
let pool = null;
let jsonServer = null;
let pgServer = null;
let tempDataFile = '';

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: options.stdio || 'pipe' }).trim();
}

async function prepareDatabaseUrl() {
  if (externalDatabaseUrl) {
    assert.equal(
      process.env.POSTGRES_BACKFILL_DRILL_CONFIRM,
      externalConfirmation,
      `Set POSTGRES_BACKFILL_DRILL_CONFIRM=${externalConfirmation} to run against an external disposable database.`
    );
    console.warn('Using external PostgreSQL database for backfill drill. This target must be disposable.');
    return externalDatabaseUrl;
  }

  container = `formspear-postgres-backfill-${crypto.randomBytes(4).toString('hex')}`;
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

function makeClient(baseUrl, initialCookie = '') {
  let cookie = initialCookie;
  return {
    get cookie() {
      return cookie;
    },
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

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function seedJsonSnapshot() {
  tempDataFile = path.join(os.tmpdir(), `formspear-backfill-${process.pid}-${Date.now()}.json`);
  jsonServer = createServer({ dataFile: tempDataFile, disableWorker: true });
  const baseUrl = await listen(jsonServer);
  const client = makeClient(baseUrl);

  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Backfill Owner',
      email: 'backfill@example.test',
      password: 'FeedbackOS123',
      workspaceName: 'Backfill Workspace',
      acceptTerms: true
    }
  });
  const workspaceId = signup.workspaces[0].id;
  const survey = await client.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Backfill Survey' }
  });
  const published = await client.request(`/api/surveys/${survey.survey.id}/publish`, {
    method: 'POST',
    body: {}
  });
  const answers = {};
  for (const question of published.survey.schema.questions || []) {
    if (question.type === 'email') answers[question.id] = 'backfill-lead@example.test';
    else if (['rating', 'nps', 'csat', 'ces', 'number'].includes(question.type)) answers[question.id] = 9;
    else if (question.type === 'consent') answers[question.id] = true;
    else answers[question.id] = 'Backfill drill response';
  }
  await client.request(`/api/public/surveys/${published.survey.slug}/responses`, {
    method: 'POST',
    body: { answers, metadata: { source: 'postgres-backfill-drill' } }
  });

  await closeServer(jsonServer);
  jsonServer = null;
  const snapshot = JSON.parse(fs.readFileSync(tempDataFile, 'utf8'));
  return { snapshot, cookie: client.cookie, workspaceId, surveyId: survey.survey.id };
}

async function applyMigrationAndReset(pool) {
  await applyMigrations(pool, { dir: path.join(root, 'migrations') });
  await pool.query(`TRUNCATE TABLE platform_settings, ${relationalTables.join(', ')} RESTART IDENTITY CASCADE`);
}

async function countRows(pool, tableNames) {
  const counts = {};
  for (const table of tableNames) {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

async function main() {
  const databaseUrl = await prepareDatabaseUrl();
  await waitForPostgres(databaseUrl);
  const { snapshot, cookie, workspaceId, surveyId } = await seedJsonSnapshot();

  pool = new Pool({ connectionString: databaseUrl });
  await applyMigrationAndReset(pool);
  const beforeCounts = await countRows(pool, relationalTables);
  assert.equal(Object.values(beforeCounts).reduce((sum, count) => sum + count, 0), 0, 'Relational tables must start empty for the backfill drill.');
  await pool.query(
    `INSERT INTO platform_settings(key, value_json, updated_at)
     VALUES ($1, $2::jsonb, now())`,
    [runtimeStateKey, JSON.stringify(snapshot)]
  );

  pgServer = createServer({ databaseUrl, disableWorker: true });
  const pgBaseUrl = await listen(pgServer);
  const pgClient = makeClient(pgBaseUrl, cookie);
  await pgClient.request('/api/profile', {
    method: 'PUT',
    body: { name: 'Backfilled Owner' }
  });
  await closeServer(pgServer);
  pgServer = null;

  const afterCounts = await countRows(pool, relationalTables);
  assert.equal(afterCounts.users, 1);
  assert.equal(afterCounts.sessions, 1);
  assert.equal(afterCounts.workspaces, 1);
  assert.equal(afterCounts.workspace_members, 1);
  assert.equal(afterCounts.surveys, 1);
  assert.ok(afterCounts.survey_versions >= 1);
  assert.equal(afterCounts.responses, 1);
  assert.equal(afterCounts.respondents, 1);
  assert.equal(afterCounts.contacts, 1);
  assert.ok(afterCounts.audit_logs >= 1);

  const user = await pool.query('SELECT name, email FROM users WHERE email = $1', ['backfill@example.test']);
  assert.equal(user.rows[0].name, 'Backfilled Owner');
  const survey = await pool.query('SELECT title FROM surveys WHERE id = $1 AND workspace_id = $2', [surveyId, workspaceId]);
  assert.equal(survey.rows[0].title, 'Backfill Survey');
  const runtime = await pool.query('SELECT value_json FROM platform_settings WHERE key = $1', [runtimeStateKey]);
  assert.equal(runtime.rows.length, 1);
  assert.equal(runtime.rows[0].value_json.users[0].name, 'Backfilled Owner');
  const platformSettings = await pool.query('SELECT value_json FROM platform_settings WHERE key = $1', [platformSettingsKey]);
  assert.equal(platformSettings.rows.length, 1);

  console.log(`PostgreSQL backfill drill passed: ${JSON.stringify(afterCounts)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeServer(jsonServer).catch(() => {});
    await closeServer(pgServer).catch(() => {});
    if (pool) await pool.end().catch(() => {});
    if (container) {
      try {
        docker(['rm', '-f', container]);
      } catch {}
    }
    if (tempDataFile) fs.promises.rm(tempDataFile, { force: true }).catch(() => {});
  });
