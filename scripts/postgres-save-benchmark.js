const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');
const { createServer } = require('../src/server');
const { applyMigrations } = require('./migrate');

const externalDatabaseUrl = process.env.POSTGRES_SAVE_BENCHMARK_DATABASE_URL || '';
const externalConfirmation = 'I_UNDERSTAND_THIS_RESETS_THE_DATABASE';

async function waitForAdvisoryLockFree(databaseUrl) {
  const probePool = new Pool({ connectionString: databaseUrl });
  const deadline = Date.now() + 10000;
  let unlocked = false;
  try {
    while (Date.now() < deadline) {
      const lockRes = await probePool.query('SELECT pg_try_advisory_lock($1) AS locked', [4159283748291029n]);
      if (lockRes.rows[0]?.locked) {
        await probePool.query('SELECT pg_advisory_unlock($1)', [4159283748291029n]);
        unlocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await probePool.end().catch(() => {});
  }
  if (!unlocked) {
    throw new Error('Timed out waiting for PostgreSQL advisory lock to be released.');
  }
}

async function submitPublicResponse(baseUrl, slug) {
  const res = await fetch(`${baseUrl}/api/public/surveys/${slug}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: {
        q1: 'Detailed feedback text that provides realistic survey response content. '.repeat(4).slice(0, 300),
        q2: 'Another feedback response containing user comments and suggestions. '.repeat(4).slice(0, 300),
        q3: 'Yes',
        q4: 5,
        q5: 10
      }
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Public response submission failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function main() {
  if (!externalDatabaseUrl) {
    console.error('POSTGRES_SAVE_BENCHMARK_DATABASE_URL is not set.');
    console.error(`Provide a disposable PostgreSQL database URL and set POSTGRES_SAVE_BENCHMARK_CONFIRM=${externalConfirmation}`);
    process.exitCode = 1;
    return;
  }

  if (process.env.POSTGRES_SAVE_BENCHMARK_CONFIRM !== externalConfirmation) {
    console.error(`Set POSTGRES_SAVE_BENCHMARK_CONFIRM=${externalConfirmation} to confirm database reset.`);
    process.exitCode = 1;
    return;
  }

  process.env.POSTGRES_COMPATIBILITY_SNAPSHOT = 'false';

  console.log('Resetting public schema and applying migrations...');
  const pool = new Pool({ connectionString: externalDatabaseUrl });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await applyMigrations(pool, path.resolve(__dirname, '..', 'migrations'));
  } finally {
    await pool.end();
  }

  let server = createServer({ databaseUrl: externalDatabaseUrl, disableWorker: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let baseUrl = `http://127.0.0.1:${server.address().port}`;

  console.log('Seeding initial survey and template response...');
  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Benchmark Admin',
      email: 'bench@example.test',
      password: 'Password123!',
      workspaceName: 'Benchmark Workspace',
      acceptTerms: true
    })
  });
  assert.strictEqual(signupRes.status, 201);
  const cookie = signupRes.headers.get('set-cookie');
  const signupData = await signupRes.json();
  const workspaceId = signupData.workspaces[0].id;

  const surveyRes = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ workspaceId, title: 'Benchmark Capacity Survey' })
  });
  assert.strictEqual(surveyRes.status, 201);
  const surveyData = await surveyRes.json();
  const surveyId = surveyData.survey.id;

  const updateRes = await fetch(`${baseUrl}/api/surveys/${surveyId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title: 'Benchmark Capacity Survey',
      type: 'feedback',
      schema: {
        questions: [
          { id: 'q1', type: 'text', title: 'Detailed Feedback 1', required: true, settings: {}, validation: {} },
          { id: 'q2', type: 'text', title: 'Detailed Feedback 2', required: true, settings: {}, validation: {} },
          { id: 'q3', type: 'single_choice', title: 'Choice', required: true, settings: { options: ['Yes', 'No'] }, validation: {} },
          { id: 'q4', type: 'rating', title: 'Rating', required: true, settings: { maxRating: 5 }, validation: {} },
          { id: 'q5', type: 'nps', title: 'NPS', required: true, settings: {}, validation: {} }
        ],
        logic: []
      }
    })
  });
  assert.strictEqual(updateRes.status, 200);

  const publishRes = await fetch(`${baseUrl}/api/surveys/${surveyId}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({})
  });
  assert.strictEqual(publishRes.status, 200);
  const publishedSurvey = await publishRes.json();
  const slug = publishedSurvey.survey.slug;

  // Submit initial response
  await submitPublicResponse(baseUrl, slug);
  const templateResponse = { ...server.state.db.responses[0] };
  assert.ok(templateResponse.id, 'Template response must exist');

  // Set unlimited plan on the workspace so response quotas don't limit submissions
  const ws = server.state.db.workspaces.find((w) => w.id === workspaceId);
  if (ws) ws.planId = 'agency';

  const rawSizes = process.env.BENCH_SIZES;
  const targetSizes = rawSizes ? rawSizes.split(',').map((s) => Number(s.trim())) : [10000, 100000, 300000];

  const results = [];
  const baseTime = Date.now() - 90 * 24 * 60 * 60 * 1000;

  for (const targetN of targetSizes) {
    console.log(`\n--- Starting Benchmark for N = ${targetN} ---`);
    const currentCount = server.state.db.responses.length;
    const needed = targetN - currentCount;

    if (needed > 0) {
      console.log(`Generating ${needed} responses in-memory...`);
      for (let i = 0; i < needed; i++) {
        const timestamp = new Date(baseTime + Math.floor(Math.random() * 90 * 24 * 60 * 60 * 1000)).toISOString();
        server.state.db.responses.push({
          ...templateResponse,
          id: `resp_${crypto.randomBytes(16).toString('hex')}`,
          submittedAt: timestamp,
          createdAt: timestamp,
          answersJson: {
            q1: 'Detailed feedback text that provides realistic survey response content. '.repeat(4).slice(0, 300),
            q2: 'Another feedback response containing user comments and suggestions. '.repeat(4).slice(0, 300),
            q3: 'Yes',
            q4: 5,
            q5: 10
          }
        });
      }
    }

    console.log(`Triggering bulk save via public submission at N = ${targetN}...`);
    const bulkStart = Date.now();
    try {
      await submitPublicResponse(baseUrl, slug);
    } catch (err) {
      console.error(`Bulk insert failed for N = ${targetN}:`, err.message);
      results.push({
        n: targetN,
        bulkInsertMs: 'FAILED',
        p50SaveMs: 'FAILED',
        p95SaveMs: 'FAILED',
        heapUsedMb: 0,
        rssMb: 0,
        coldLoadMs: 'FAILED',
        error: err.message
      });
      break;
    }
    const bulkInsertMs = Date.now() - bulkStart;
    console.log(`Bulk insert completed in ${bulkInsertMs} ms`);

    if (bulkInsertMs > 10 * 60 * 1000) {
      console.warn(`Bulk insert exceeded 10 minutes (${bulkInsertMs} ms). Aborting further sizes.`);
      results.push({
        n: targetN,
        bulkInsertMs,
        p50SaveMs: 'ABORTED',
        p95SaveMs: 'ABORTED',
        heapUsedMb: 0,
        rssMb: 0,
        coldLoadMs: 'ABORTED',
        error: 'bulkInsertMs exceeded 10 minutes'
      });
      break;
    }

    console.log(`Submitting 20 sequential requests to measure steady save latency...`);
    const durations = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      await submitPublicResponse(baseUrl, slug);
      durations.push(Date.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    console.log(`Steady save: p50 = ${p50} ms, p95 = ${p95} ms`);

    if (typeof global.gc === 'function') {
      global.gc();
    }
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
    const rssMb = Math.round(mem.rss / (1024 * 1024));
    console.log(`Memory: heapUsed = ${heapUsedMb} MB, rss = ${rssMb} MB`);

    console.log(`Measuring cold load latency across restart...`);
    await new Promise((resolve) => server.close(resolve));
    await waitForAdvisoryLockFree(externalDatabaseUrl);

    const coldStart = Date.now();
    server = createServer({ databaseUrl: externalDatabaseUrl, disableWorker: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    await fetch(`${baseUrl}/api/public/surveys/${slug}`);
    const coldLoadMs = Date.now() - coldStart;
    console.log(`Cold load: ${coldLoadMs} ms`);

    results.push({
      n: targetN,
      bulkInsertMs,
      p50SaveMs: p50,
      p95SaveMs: p95,
      heapUsedMb,
      rssMb,
      coldLoadMs
    });
  }

  await new Promise((resolve) => server.close(resolve)).catch(() => {});

  console.log('\n=== Benchmark Results ===');
  console.log(JSON.stringify(results, null, 2));

  console.log('\n| Target N | Bulk Insert (ms) | Steady p50 (ms) | Steady p95 (ms) | Heap Used (MB) | RSS (MB) | Cold Load (ms) |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    console.log(`| ${r.n} | ${r.bulkInsertMs} | ${r.p50SaveMs} | ${r.p95SaveMs} | ${r.heapUsedMb} | ${r.rssMb} | ${r.coldLoadMs} |`);
  }
}

main().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exitCode = 1;
});
