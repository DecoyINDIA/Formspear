const test = require('node:test');
const assert = require('node:assert/strict');

const { productionConfigurationIssues, validateProductionEnvironment } = require('../src/production-config');

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  APP_URL: 'https://formspear.example',
  DATABASE_URL: 'postgres://example',
  REDIS_URL: 'redis://example',
  ENCRYPTION_KEY: 'a-strong-production-encryption-key',
  IP_HASH_SALT: 'a-strong-production-ip-salt',
  WEBHOOK_SIGNING_SECRET: 'a-strong-webhook-secret',
  CRON_SECRET: 'a-strong-cron-secret',
  SMTP_HOST: 'smtp.example',
  SMTP_USER: 'formspear',
  SMTP_PASSWORD: 'smtp-secret-that-is-long-enough',
  OPENAI_API_KEY: 'provider-key-that-is-long-enough',
  AI_PROVIDER_DPA_ACCEPTED: 'true',
  STRIPE_SECRET_KEY: 'stripe-key-that-is-long-enough',
  STRIPE_WEBHOOK_SECRET: 'stripe-webhook-secret',
  S3_ACCESS_KEY: 'storage-key',
  S3_SECRET_KEY: 'storage-secret-that-is-long-enough',
  S3_BUCKET: 'formspear',
  FILE_SCAN_PROVIDER_URL: 'https://scanner.example/scan',
  FILE_SCAN_FAIL_OPEN: 'false',
  SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
  UPTIME_CHECK_URL: 'https://formspear.example/api/health',
  MONITORING_ALERT_WEBHOOK_URL: 'https://alerts.example/formspear',
  SUPER_ADMIN_EMAIL: 'admin@formspear.example'
};

function withEnvironment(values, callback) {
  const original = { ...process.env };
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    Object.keys(process.env).forEach((key) => delete process.env[key]);
    Object.assign(process.env, original);
  }
}

test('production configuration fails closed when durable services are absent', () => {
  withEnvironment({ NODE_ENV: 'production', APP_URL: 'http://localhost:4173' }, () => {
    assert.throws(
      () => validateProductionEnvironment(),
      /Production configuration is incomplete:.*DATABASE_URL is required.*APP_URL must use HTTPS/
    );
  });
});

test('production configuration accepts the complete shipped provider set', () => {
  withEnvironment(PRODUCTION_ENV, () => assert.doesNotThrow(() => validateProductionEnvironment()));
  const envWithoutRedis = { ...PRODUCTION_ENV };
  delete envWithoutRedis.REDIS_URL;
  withEnvironment(envWithoutRedis, () => assert.doesNotThrow(() => validateProductionEnvironment()));
});

test('production configuration requires SUPER_ADMIN_EMAIL', () => {
  const envWithoutAdmin = { ...PRODUCTION_ENV };
  delete envWithoutAdmin.SUPER_ADMIN_EMAIL;
  withEnvironment(envWithoutAdmin, () => {
    assert.throws(
      () => validateProductionEnvironment(),
      /SUPER_ADMIN_EMAIL is required/
    );
  });
});

test('local development remains provider-optional', () => {
  withEnvironment({ NODE_ENV: 'development' }, () => assert.doesNotThrow(() => validateProductionEnvironment()));
});

test('production configuration rejects placeholders and weak secrets', () => {
  const issues = productionConfigurationIssues({
    ...PRODUCTION_ENV,
    ENCRYPTION_KEY: 'replace-with-32-byte-secret',
    CRON_SECRET: 'short'
  });
  assert.ok(issues.includes('ENCRYPTION_KEY is required'));
  assert.ok(issues.includes('CRON_SECRET must be at least 16 characters'));
});
