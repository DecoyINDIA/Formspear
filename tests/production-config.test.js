const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CORE_PRODUCTION_VARIABLES,
  OPTIONAL_PRODUCTION_GROUPS,
  productionFeatureStatus,
  productionConfigurationIssues,
  validateProductionEnvironment
} = require('../src/production-config');

const CORE_ENV = {
  NODE_ENV: 'production',
  APP_URL: 'https://formspear.example',
  DATABASE_URL: 'postgres://example',
  ENCRYPTION_KEY: 'a-strong-production-encryption-key',
  IP_HASH_SALT: 'a-strong-production-ip-salt',
  WEBHOOK_SIGNING_SECRET: 'a-strong-webhook-secret',
  CRON_SECRET: 'a-strong-cron-secret',
  SMTP_HOST: 'smtp.example',
  SMTP_USER: 'formspear',
  SMTP_PASSWORD: 'smtp-secret-that-is-long-enough',
  SUPER_ADMIN_EMAIL: 'admin@formspear.example'
};

const FULL_PRODUCTION_ENV = {
  ...CORE_ENV,
  OPENAI_API_KEY: 'provider-key-that-is-long-enough',
  AI_PROVIDER_DPA_ACCEPTED: 'true',
  STRIPE_SECRET_KEY: 'stripe-key-that-is-long-enough',
  STRIPE_WEBHOOK_SECRET: 'stripe-webhook-secret',
  S3_ACCESS_KEY: 'storage-key',
  S3_SECRET_KEY: 'storage-secret-that-is-long-enough',
  S3_BUCKET: 'formspear',
  FILE_SCAN_PROVIDER_URL: 'https://scanner.example/scan',
  FILE_SCAN_FAIL_OPEN: 'false'
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

test('production configuration accepts core-only environment', () => {
  withEnvironment(CORE_ENV, () => {
    assert.doesNotThrow(() => validateProductionEnvironment());
    assert.deepEqual(productionConfigurationIssues(CORE_ENV), []);
    assert.deepEqual(productionFeatureStatus(CORE_ENV), {
      uploads: false,
      ai: false,
      stripe: false
    });
  });
});

test('production configuration accepts the full optional provider set', () => {
  withEnvironment(FULL_PRODUCTION_ENV, () => {
    assert.doesNotThrow(() => validateProductionEnvironment());
    assert.deepEqual(productionConfigurationIssues(FULL_PRODUCTION_ENV), []);
    assert.deepEqual(productionFeatureStatus(FULL_PRODUCTION_ENV), {
      uploads: true,
      ai: true,
      stripe: true
    });
  });
});

test('production configuration rejects partial optional groups naming the group', () => {
  // Partial uploads group (e.g. S3_ACCESS_KEY present, rest missing)
  const partialUploadsEnv = {
    ...CORE_ENV,
    S3_ACCESS_KEY: 'storage-access-key'
  };
  const uploadIssues = productionConfigurationIssues(partialUploadsEnv);
  assert.ok(uploadIssues.some((issue) => issue.includes('uploads is partially configured')));

  // Partial stripe group (e.g. STRIPE_SECRET_KEY present, STRIPE_WEBHOOK_SECRET missing)
  const partialStripeEnv = {
    ...CORE_ENV,
    STRIPE_SECRET_KEY: 'stripe-secret-key-long-enough'
  };
  const stripeIssues = productionConfigurationIssues(partialStripeEnv);
  assert.ok(stripeIssues.some((issue) => issue.includes('stripe is partially configured')));
});

test('OPENAI_API_KEY set without DPA accepted reports an issue', () => {
  const aiWithoutDpa = {
    ...CORE_ENV,
    OPENAI_API_KEY: 'provider-key-that-is-long-enough',
    AI_PROVIDER_DPA_ACCEPTED: 'false'
  };
  const issues = productionConfigurationIssues(aiWithoutDpa);
  assert.ok(issues.includes('AI_PROVIDER_DPA_ACCEPTED must be true'));

  // Without OPENAI_API_KEY, AI_PROVIDER_DPA_ACCEPTED is not required
  const noAiIssues = productionConfigurationIssues(CORE_ENV);
  assert.ok(!noAiIssues.includes('AI_PROVIDER_DPA_ACCEPTED must be true'));
});

test('production configuration fails closed when core variables are absent', () => {
  withEnvironment({ NODE_ENV: 'production', APP_URL: 'http://localhost:4173' }, () => {
    assert.throws(
      () => validateProductionEnvironment(),
      /Production configuration is incomplete:.*DATABASE_URL is required.*APP_URL must use HTTPS/
    );
  });
});

test('production configuration requires SUPER_ADMIN_EMAIL', () => {
  const envWithoutAdmin = { ...CORE_ENV };
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
    ...FULL_PRODUCTION_ENV,
    ENCRYPTION_KEY: 'replace-with-32-byte-secret',
    CRON_SECRET: 'short'
  });
  assert.ok(issues.includes('ENCRYPTION_KEY is required'));
  assert.ok(issues.includes('CRON_SECRET must be at least 16 characters'));
});
