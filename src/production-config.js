const PLACEHOLDER_PATTERN = /^(replace-with|changeme|example|test|your[-_])/i;

const CORE_PRODUCTION_VARIABLES = [
  'APP_URL', 'DATABASE_URL', 'ENCRYPTION_KEY', 'IP_HASH_SALT',
  'WEBHOOK_SIGNING_SECRET', 'CRON_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD',
  'SUPER_ADMIN_EMAIL'
];

const REQUIRED_PRODUCTION_VARIABLES = CORE_PRODUCTION_VARIABLES;

const OPTIONAL_PRODUCTION_GROUPS = {
  uploads: ['S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'FILE_SCAN_PROVIDER_URL'],
  ai:      ['OPENAI_API_KEY'],
  stripe:  ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']
};

const SECRET_VARIABLES = [
  'ENCRYPTION_KEY', 'IP_HASH_SALT', 'WEBHOOK_SIGNING_SECRET', 'CRON_SECRET',
  'SMTP_PASSWORD', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'S3_SECRET_KEY'
];

function configured(env, name) {
  const value = String(env[name] || '').trim();
  return Boolean(value) && !PLACEHOLDER_PATTERN.test(value);
}

function productionFeatureStatus(env = process.env) {
  const status = {};
  for (const [group, names] of Object.entries(OPTIONAL_PRODUCTION_GROUPS)) {
    status[group] = names.every((name) => configured(env, name));
  }
  return status;
}

function productionConfigurationIssues(env = process.env) {
  const issues = CORE_PRODUCTION_VARIABLES
    .filter((name) => !configured(env, name))
    .map((name) => `${name} is required`);

  for (const [group, names] of Object.entries(OPTIONAL_PRODUCTION_GROUPS)) {
    const configuredCount = names.filter((name) => configured(env, name)).length;
    if (configuredCount > 0 && configuredCount < names.length) {
      issues.push(`${group} is partially configured: set all of ${names.join(', ')} or none`);
    }
  }

  for (const name of SECRET_VARIABLES) {
    if (configured(env, name) && String(env[name]).length < 16) {
      issues.push(`${name} must be at least 16 characters`);
    }
  }

  if (configured(env, 'OPENAI_API_KEY')) {
    if (String(env.AI_PROVIDER_DPA_ACCEPTED || '').toLowerCase() !== 'true') {
      issues.push('AI_PROVIDER_DPA_ACCEPTED must be true');
    }
  }

  if (String(env.FILE_SCAN_FAIL_OPEN || '').toLowerCase() === 'true') {
    issues.push('FILE_SCAN_FAIL_OPEN must be false');
  }
  if (String(env.POSTGRES_COMPATIBILITY_SNAPSHOT || '').toLowerCase() === 'true') {
    issues.push('POSTGRES_COMPATIBILITY_SNAPSHOT must be false');
  }
  if (configured(env, 'APP_URL') && !/^https:\/\//i.test(String(env.APP_URL))) {
    issues.push('APP_URL must use HTTPS');
  }
  if (configured(env, 'UPTIME_CHECK_URL') && !/^https:\/\//i.test(String(env.UPTIME_CHECK_URL))) {
    issues.push('UPTIME_CHECK_URL must use HTTPS');
  }
  return [...new Set(issues)];
}

function validateProductionEnvironment(options = {}, env = process.env) {
  if (env.NODE_ENV !== 'production' || options.allowIncompleteProduction) return;
  const issues = productionConfigurationIssues(env);
  if (issues.length) throw new Error(`Production configuration is incomplete: ${issues.join(', ')}`);
}

module.exports = {
  CORE_PRODUCTION_VARIABLES,
  REQUIRED_PRODUCTION_VARIABLES,
  OPTIONAL_PRODUCTION_GROUPS,
  productionFeatureStatus,
  productionConfigurationIssues,
  validateProductionEnvironment
};
