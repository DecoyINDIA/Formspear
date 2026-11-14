const PLACEHOLDER_PATTERN = /^(replace-with|changeme|example|test|your[-_])/i;

const REQUIRED_PRODUCTION_VARIABLES = [
  'APP_URL', 'DATABASE_URL', 'ENCRYPTION_KEY', 'IP_HASH_SALT',
  'WEBHOOK_SIGNING_SECRET', 'CRON_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD',
  'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'S3_ACCESS_KEY',
  'S3_SECRET_KEY', 'S3_BUCKET', 'FILE_SCAN_PROVIDER_URL', 'UPTIME_CHECK_URL',
  'MONITORING_ALERT_WEBHOOK_URL', 'SUPER_ADMIN_EMAIL'
];

const SECRET_VARIABLES = [
  'ENCRYPTION_KEY', 'IP_HASH_SALT', 'WEBHOOK_SIGNING_SECRET', 'CRON_SECRET',
  'SMTP_PASSWORD', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'S3_SECRET_KEY'
];

function configured(env, name) {
  const value = String(env[name] || '').trim();
  return Boolean(value) && !PLACEHOLDER_PATTERN.test(value);
}

function productionConfigurationIssues(env = process.env) {
  const issues = REQUIRED_PRODUCTION_VARIABLES
    .filter((name) => !configured(env, name))
    .map((name) => `${name} is required`);
  for (const name of SECRET_VARIABLES) {
    if (configured(env, name) && String(env[name]).length < 16) issues.push(`${name} must be at least 16 characters`);
  }
  if (!configured(env, 'SENTRY_DSN') && !configured(env, 'POSTHOG_KEY')) issues.push('SENTRY_DSN or POSTHOG_KEY is required');
  if (String(env.AI_PROVIDER_DPA_ACCEPTED || '').toLowerCase() !== 'true') issues.push('AI_PROVIDER_DPA_ACCEPTED must be true');
  if (String(env.FILE_SCAN_FAIL_OPEN || '').toLowerCase() === 'true') issues.push('FILE_SCAN_FAIL_OPEN must be false');
  if (String(env.POSTGRES_COMPATIBILITY_SNAPSHOT || '').toLowerCase() === 'true') issues.push('POSTGRES_COMPATIBILITY_SNAPSHOT must be false');
  if (configured(env, 'APP_URL') && !/^https:\/\//i.test(String(env.APP_URL))) issues.push('APP_URL must use HTTPS');
  if (configured(env, 'UPTIME_CHECK_URL') && !/^https:\/\//i.test(String(env.UPTIME_CHECK_URL))) issues.push('UPTIME_CHECK_URL must use HTTPS');
  return [...new Set(issues)];
}

function validateProductionEnvironment(options = {}, env = process.env) {
  if (env.NODE_ENV !== 'production' || options.allowIncompleteProduction) return;
  const issues = productionConfigurationIssues(env);
  if (issues.length) throw new Error(`Production configuration is incomplete: ${issues.join(', ')}`);
}

module.exports = { REQUIRED_PRODUCTION_VARIABLES, productionConfigurationIssues, validateProductionEnvironment };
