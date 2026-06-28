const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'migrations');

const requiredTables = [
  'schema_migrations',
  'platform_settings',
  'users',
  'sessions',
  'workspaces',
  'workspace_members',
  'workspace_invites',
  'surveys',
  'survey_versions',
  'questions',
  'respondents',
  'responses',
  'contacts',
  'integrations',
  'integration_logs',
  'webhooks',
  'webhook_logs',
  'alerts',
  'ai_jobs',
  'jobs',
  'email_logs',
  'email_campaigns',
  'campaign_events',
  'file_uploads',
  'monthly_reports',
  'subscriptions',
  'usage_meters',
  'invoices',
  'custom_templates',
  'audit_logs',
  'notifications',
  'error_logs'
];

const requiredIndexes = [
  'idx_surveys_workspace_id',
  'idx_surveys_slug',
  'idx_responses_workspace_id',
  'idx_responses_survey_id',
  'idx_responses_submitted_at',
  'idx_responses_workspace_submitted_at',
  'idx_responses_survey_submitted_at',
  'idx_jobs_status_next_run_at',
  'idx_audit_logs_workspace_created_at',
  'idx_usage_meters_workspace_period'
];

const requiredColumns = {
  users: ['email', 'password_hash', 'email_verified_at', 'platform_role'],
  workspaces: ['owner_id', 'plan_id', 'ai_credit_limit_override', 'allow_external_ai', 'custom_domain', 'retention_next_run_at'],
  surveys: ['workspace_id', 'status', 'slug', 'schema_json', 'settings_json', 'branding_json'],
  responses: ['workspace_id', 'survey_id', 'survey_version_id', 'answers_json', 'metadata_json', 'submitted_at'],
  file_uploads: ['workspace_id', 'survey_id', 'response_id', 'storage_provider', 'sha256', 'scan_status', 'scan_provider', 'quarantined', 'lifecycle_status', 'retention_expires_at'],
  jobs: ['workspace_id', 'type', 'status', 'next_run_at', 'payload_json'],
  subscriptions: ['workspace_id', 'plan_id', 'provider', 'provider_customer_id', 'status', 'billing_policy_json'],
  usage_meters: ['workspace_id', 'period', 'responses_count', 'ai_credits_used', 'storage_used'],
  invoices: ['workspace_id', 'provider', 'provider_invoice_id', 'subtotal_inr', 'tax_inr', 'tax_mode', 'tax_percent', 'proration_credit_inr', 'amount_due_inr', 'amount_paid_inr', 'billing_policy_json'],
  audit_logs: ['workspace_id', 'user_id', 'action', 'entity_type', 'metadata_json']
};

function main() {
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();

  if (!migrationFiles.length) fail('No migration files found.');

  const first = migrationFiles[0];
  if (first !== '0001_initial_postgres.sql') {
    fail(`First migration must be 0001_initial_postgres.sql, got ${first}.`);
  }

  const sql = migrationFiles
    .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    .join('\n')
    .replace(/--.*$/gm, '')
    .toLowerCase();

  if (!/\bbegin\s*;/.test(sql) || !/\bcommit\s*;/.test(sql)) {
    fail('Migrations must run inside an explicit transaction.');
  }

  const missingTables = requiredTables.filter((table) => !hasCreateTable(sql, table));
  const missingIndexes = requiredIndexes.filter((index) => !hasCreateIndex(sql, index));
  const missingColumns = [];

  for (const [table, columns] of Object.entries(requiredColumns)) {
    const body = tableBody(sql, table);
    if (!body) {
      missingColumns.push(`${table}.*`);
      continue;
    }
    for (const column of columns) {
      if (!new RegExp(`\\b${escapeRegExp(column)}\\b`).test(body)) missingColumns.push(`${table}.${column}`);
    }
  }

  const missingJsonb = ['schema_json', 'answers_json', 'metadata_json', 'payload_json']
    .filter((column) => !new RegExp(`\\b${column}\\s+jsonb\\b`).test(sql));

  const failures = [
    ...missingTables.map((item) => `missing table ${item}`),
    ...missingIndexes.map((item) => `missing index ${item}`),
    ...missingColumns.map((item) => `missing column ${item}`),
    ...missingJsonb.map((item) => `missing jsonb column ${item}`)
  ];

  if (failures.length) fail(failures.join('\n'));

  console.log(`Migration check passed: ${migrationFiles.length} file(s), ${requiredTables.length} tables, ${requiredIndexes.length} required indexes.`);
}

function hasCreateTable(sql, table) {
  return new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${escapeRegExp(table)}\\b`).test(sql);
}

function hasCreateIndex(sql, index) {
  return new RegExp(`create\\s+index\\s+if\\s+not\\s+exists\\s+${escapeRegExp(index)}\\b`).test(sql);
}

function tableBody(sql, table) {
  const match = sql.match(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${escapeRegExp(table)}\\s*\\(([\\s\\S]*?)\\n\\);`));
  return match ? match[1] : '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(message) {
  console.error(`Migration check failed:\n${message}`);
  process.exit(1);
}

main();
