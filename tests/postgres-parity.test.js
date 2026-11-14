const test = require('node:test');
const assert = require('node:assert/strict');
const {
  POSTGRES_RELATIONAL_COLLECTIONS,
  POSTGRES_EXTRA_PROPERTIES,
  POSTGRES_TRANSIENT_PROPERTIES,
  postgresObjectToRow,
  postgresRowToObject,
  postgresPrepareItem,
  postgresHydrateItem
} = require('../src/server');

function removeKeys(obj, keys = []) {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

test('POSTGRES_EXTRA_PROPERTIES never contains a property that is also a mapped field', () => {
  for (const config of POSTGRES_RELATIONAL_COLLECTIONS) {
    const extraKeys = POSTGRES_EXTRA_PROPERTIES[config.collection] || [];
    const mappedProperties = new Set(Object.keys(config.fields));
    for (const extraKey of extraKeys) {
      assert.ok(
        !mappedProperties.has(extraKey),
        `Collection ${config.collection} extra property "${extraKey}" must not also be a mapped field.`
      );
    }
  }
});

test('postgresPrepareItem on unchanged user is deterministic across consecutive calls', () => {
  const usersConfig = POSTGRES_RELATIONAL_COLLECTIONS.find((c) => c.collection === 'users');
  assert.ok(usersConfig, 'users collection config should exist');

  const userFixture = {
    id: 'usr_det_1',
    name: 'Deterministic User',
    email: 'det@example.com',
    password: 'secure_password_hash',
    avatarUrl: 'https://example.com/pic.png',
    emailVerifiedAt: '2026-07-01T10:00:00.000Z',
    platformRole: 'user',
    timezone: 'Asia/Kolkata',
    notificationPreferences: { emailAlerts: true },
    disabled: false,
    twoFactorEnabled: true,
    twoFactorSecret: 'JBSWY3DPEHPK3PXP',
    twoFactorRecoveryCodeHashes: ['hash1'],
    authProvider: 'password',
    termsAcceptedAt: '2026-07-01T10:00:00.000Z',
    privacyAcceptedAt: '2026-07-01T10:00:00.000Z',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    twoFactorPendingAt: '2026-07-01T09:00:00.000Z',
    twoFactorEnabledAt: '2026-07-01T10:00:00.000Z',
    twoFactorDisabledAt: '2026-07-01T11:00:00.000Z',
    oauthProviders: { google: { sub: 'g123' } }
  };

  const prep1 = postgresPrepareItem(usersConfig, userFixture);
  const row1 = postgresObjectToRow(usersConfig, prep1);

  const prep2 = postgresPrepareItem(usersConfig, userFixture);
  const row2 = postgresObjectToRow(usersConfig, prep2);

  assert.deepEqual(row1.columns, row2.columns);
  assert.deepEqual(row1.values, row2.values, 'Repeated prepare of user must yield identical row values');
});

test('Postgres storage round-trip preserves all mapped and extra properties for all collections', () => {
  const fixtures = {
    users: {
      id: 'usr_parity_1',
      name: 'Parity User',
      email: 'parity@example.com',
      password: 'hashed_secret_pw',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerifiedAt: '2026-07-01T10:00:00.000Z',
      platformRole: 'admin',
      timezone: 'Asia/Kolkata',
      notificationPreferences: { emailAlerts: true },
      disabled: false,
      twoFactorEnabled: true,
      twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      twoFactorRecoveryCodeHashes: ['hash1', 'hash2'],
      authProvider: 'password',
      termsAcceptedAt: '2026-07-01T10:00:00.000Z',
      privacyAcceptedAt: '2026-07-01T10:00:00.000Z',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
      twoFactorPendingAt: '2026-07-01T09:00:00.000Z',
      twoFactorEnabledAt: '2026-07-01T10:00:00.000Z',
      twoFactorDisabledAt: '2026-07-01T11:00:00.000Z',
      oauthProviders: { google: { sub: 'goog_123' } },
      twoFactorPendingSecret: 'PENDING_TOTP_SECRET'
    },
    workspaces: {
      id: 'wks_parity_1',
      name: 'Parity Workspace',
      slug: 'parity-wks',
      logoUrl: 'https://example.com/logo.png',
      brandColor: '#0f62fe',
      buttonColor: '#000000',
      timezone: 'Asia/Kolkata',
      defaultLanguage: 'en',
      ownerId: 'usr_parity_1',
      planId: 'growth',
      aiCreditLimitOverride: 5000,
      allowExternalAi: true,
      industry: 'SaaS',
      companySize: '11-50',
      customDomain: 'feedback.example.com',
      customDomainStatus: 'verified',
      customDomainVerificationToken: 'tok_123',
      customDomainVerifiedAt: '2026-07-01T10:00:00.000Z',
      customDomainSslStatus: 'active',
      defaultSenderEmail: 'noreply@example.com',
      customCss: '.button { color: red; }',
      customFooterText: 'Custom Footer',
      sso: { enabled: true },
      dataRetentionSettings: { retain: true },
      privacyPolicyUrl: 'https://example.com/privacy',
      termsUrl: 'https://example.com/terms',
      retentionDays: 90,
      retentionScheduleEnabled: true,
      retentionLastRunAt: '2026-07-01T10:00:00.000Z',
      retentionNextRunAt: '2026-07-02T10:00:00.000Z',
      suspended: false,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
      permissionPolicy: { allowInvites: true },
      previousPlanId: 'starter',
      customDomainDnsCheckedAt: '2026-07-01T09:30:00.000Z',
      customDomainObservedTxt: 'forms-verify=123',
      customDomainSslCertificateId: 'cert_123',
      customDomainSslLastError: 'none',
      customDomainSslProvider: 'letsencrypt',
      customDomainSslProvisionedAt: '2026-07-01T09:45:00.000Z',
      customDomainSslUpdatedAt: '2026-07-01T09:50:00.000Z'
    },
    surveys: {
      id: 'srv_parity_1',
      workspaceId: 'wks_parity_1',
      title: 'Parity Survey',
      description: 'Survey description',
      internalName: 'Parity Internal',
      type: 'csat',
      status: 'published',
      slug: 'parity-survey',
      language: 'en',
      settings: { progressBar: true },
      branding: { showLogo: true },
      schema: { questions: [] },
      accessMode: 'public',
      accessRules: [{ type: 'ip' }],
      metrics: { views: 10 },
      createdBy: 'usr_parity_1',
      publishedVersionId: 'ver_parity_1',
      publishedAt: '2026-07-01T10:00:00.000Z',
      archivedAt: '',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
      hasUnpublishedChanges: true,
      approvalStatus: 'approved',
      approvalFingerprint: 'fp_12345',
      approvalNote: 'Looks good',
      approvalRequestedAt: '2026-07-01T08:00:00.000Z',
      approvalRequestedBy: 'usr_editor_1',
      approvalReviewedAt: '2026-07-01T09:00:00.000Z',
      approvalReviewedBy: 'usr_parity_1'
    },
    responses: {
      id: 'rsp_parity_1',
      workspaceId: 'wks_parity_1',
      surveyId: 'srv_parity_1',
      surveyVersionId: 'ver_parity_1',
      respondentId: 'resp_1',
      status: 'submitted',
      answersJson: { q1: 'Great' },
      metadataJson: { ip: '127.0.0.1' },
      tagsJson: ['nps_promoter'],
      sentiment: 'positive',
      leadScore: 85,
      important: true,
      internalNotes: ['Followed up'],
      resumeTokenHash: 'tokenhash123',
      resumeExpiresAt: '2026-07-08T10:00:00.000Z',
      startedAt: '2026-07-01T09:55:00.000Z',
      submittedAt: '2026-07-01T10:00:00.000Z',
      archivedAt: '',
      deletedAt: '',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
      logicCompletionJson: { completed: true },
      fileUploadBytes: 10240,
      resumeEmailSentAt: '2026-07-01T09:56:00.000Z',
      resumeEmailRecipientHash: 'rechash123'
    },
    jobs: {
      id: 'job_parity_1',
      workspaceId: 'wks_parity_1',
      type: 'send_email',
      status: 'completed',
      attempts: 1,
      maxAttempts: 3,
      nextRunAt: '2026-07-01T10:00:00.000Z',
      payloadJson: { to: 'user@example.com' },
      lastError: '',
      completedAt: '2026-07-01T10:00:05.000Z',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:05.000Z',
      externalQueue: true,
      externalQueueName: 'bullmq_default',
      externalQueuedAt: '2026-07-01T10:00:01.000Z'
    },
    webhooks: {
      id: 'whk_parity_1',
      workspaceId: 'wks_parity_1',
      url: 'https://example.com/webhook',
      events: ['response.submitted'],
      secretEncrypted: '11cf203eb243d0f69cb7dcfb:025840643fa448fdf752ea28a4c8e4f2:7b21886ac049c9ec6a97cf1a81ce3ec8dd1b407d9058',
      active: true,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
      deletedAt: '2026-07-01T11:00:00.000Z'
    },
    workspaceInvites: {
      id: 'inv_parity_1',
      workspaceId: 'wks_parity_1',
      email: 'invitee@example.com',
      role: 'editor',
      tokenHash: 'invtokenhash',
      tokenPreview: 'fo_inv_123...',
      invitedBy: 'usr_parity_1',
      acceptedAt: '2026-07-01T10:30:00.000Z',
      expiresAt: '2026-07-08T10:00:00.000Z',
      createdAt: '2026-07-01T10:00:00.000Z',
      status: 'accepted'
    }
  };

  const collections = Object.keys(fixtures);
  for (const colName of collections) {
    const config = POSTGRES_RELATIONAL_COLLECTIONS.find((c) => c.collection === colName);
    assert.ok(config, `Config for ${colName} must exist`);

    const fixture = fixtures[colName];
    const prepared = postgresPrepareItem(config, fixture);
    const { columns, values } = postgresObjectToRow(config, prepared);

    // Simulate PostgreSQL row returned to pg client:
    // JSON columns are parsed objects/arrays
    const row = {};
    for (let i = 0; i < columns.length; i++) {
      const colName = columns[i];
      const val = values[i];
      const fieldEntry = Object.values(config.fields).find((f) => (typeof f === 'string' ? f : f.column) === colName);
      const type = typeof fieldEntry === 'object' ? fieldEntry.type : 'text';
      row[colName] = type === 'json' && typeof val === 'string' ? JSON.parse(val) : val;
    }

    const rowObj = postgresRowToObject(config, row);
    const back = postgresHydrateItem(config, rowObj, row);

    const ignoredKeys = colName === 'users' ? ['twoFactorSecretEncrypted'] : [];
    const transientKeys = POSTGRES_TRANSIENT_PROPERTIES[colName] || [];

    const expected = removeKeys(fixture, [...transientKeys, ...ignoredKeys]);
    const actual = removeKeys(back, ignoredKeys);

    assert.deepEqual(actual, expected, `Parity round-trip failed for ${colName}`);
  }
});
