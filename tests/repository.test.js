const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, responsesRepo, jobsRepo, auditLogsRepo } = require('../src/server');

test('E-01: repository layer provides unified responses, jobs, and audit logs access', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-repo-'));
  const dataFile = path.join(tempDir, 'state.json');

  const server = createServer({ dataFile, disableWorker: true });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const state = server.state;
  const db = state.db;

  // 1. responsesRepo: save and findById
  const sampleResponse = {
    id: 'rsp_test_001',
    workspaceId: 'wsp_test_001',
    surveyId: 'srv_test_001',
    status: 'completed',
    answersJson: { q1: 'Great service' },
    metadataJson: { source: 'web' },
    tagsJson: ['feedback'],
    sentiment: 'positive',
    leadScore: 85,
    important: false,
    internalNotes: [],
    resumeTokenHash: '',
    resumeExpiresAt: null,
    startedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    archivedAt: null,
    deletedAt: null,
    extraJson: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await responsesRepo.save(db, state, sampleResponse);

  const found = await responsesRepo.findById(db, state, 'rsp_test_001');
  assert.ok(found, 'Should find response by ID');
  assert.equal(found.id, 'rsp_test_001');
  assert.equal(found.sentiment, 'positive');

  // 2. responsesRepo: listBySurvey & listByWorkspace & count
  const bySurvey = await responsesRepo.listBySurvey(db, state, 'srv_test_001');
  assert.equal(bySurvey.length, 1);
  assert.equal(bySurvey[0].id, 'rsp_test_001');

  const byWorkspace = await responsesRepo.listByWorkspace(db, state, 'wsp_test_001');
  assert.equal(byWorkspace.length, 1);

  const count = await responsesRepo.count(db, state, { workspaceId: 'wsp_test_001' });
  assert.equal(count, 1);

  // 3. responsesRepo: dualReadVerify
  const verify = await responsesRepo.dualReadVerify(db, state, 'rsp_test_001');
  assert.equal(verify.matched, true);

  // 4. jobsRepo: save and listDue
  const sampleJob = {
    id: 'job_test_001',
    workspaceId: 'wsp_test_001',
    type: 'email_delivery',
    status: 'queued',
    attempts: 0,
    maxAttempts: 5,
    payloadJson: { to: 'test@example.com' },
    lastError: '',
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
  await jobsRepo.save(db, state, sampleJob);

  const dueJobs = await jobsRepo.listDue(db, state);
  assert.ok(dueJobs.some((j) => j.id === 'job_test_001'));

  // 5. auditLogsRepo: append and listByWorkspace
  const sampleLog = {
    id: 'aud_test_001',
    workspaceId: 'wsp_test_001',
    userId: 'usr_test_001',
    action: 'survey.publish',
    targetType: 'survey',
    targetId: 'srv_test_001',
    metadataJson: {},
    createdAt: new Date().toISOString()
  };
  await auditLogsRepo.append(db, state, sampleLog);

  const auditLogs = await auditLogsRepo.listByWorkspace(db, state, 'wsp_test_001');
  assert.ok(auditLogs.some((l) => l.id === 'aud_test_001'));
});
