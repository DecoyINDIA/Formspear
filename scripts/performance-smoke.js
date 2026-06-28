#!/usr/bin/env node

process.env.PUBLIC_RATE_LIMIT_MAX = process.env.PUBLIC_RATE_LIMIT_MAX || '120';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createServer } = require('../src/server');

const CONCURRENT_SUBMISSIONS = Number(process.env.PERF_SMOKE_CONCURRENCY || 100);
const LARGE_RESPONSE_COUNT = Number(process.env.PERF_SMOKE_LARGE_RESPONSES || 100000);
const DASHBOARD_MAX_MS = Number(process.env.PERF_SMOKE_DASHBOARD_MAX_MS || 3000);
const SUBMISSION_P95_MAX_MS = Number(process.env.PERF_SMOKE_SUBMISSION_P95_MAX_MS || 500);
const OUTPUT_DIR = path.join(__dirname, '..', 'artifacts', 'performance-smoke');

async function main() {
  assert.ok(CONCURRENT_SUBMISSIONS >= 100, 'Performance smoke must exercise at least 100 concurrent submissions.');
  assert.ok(LARGE_RESPONSE_COUNT >= 100000, 'Performance smoke must exercise at least 100,000 responses.');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formspear-perf-'));
  const server = createServer({ dataFile: path.join(dir, 'db.json'), disableWorker: true });
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = makeClient(baseUrl);

  try {
    const { workspaceId, survey } = await setupSurvey(client);
    const publicSurvey = await client.request(`/api/public/surveys/${survey.slug}`);
    const answers = buildAnswers(publicSurvey.survey.schema.questions, 0);

    await client.request(`/api/workspaces/${workspaceId}/subscription`, {
      method: 'POST',
      body: { planId: 'agency' }
    });

    const concurrencyResult = await runConcurrentSubmissions(baseUrl, survey.slug, publicSurvey.survey.schema.questions);
    assert.equal(concurrencyResult.accepted, CONCURRENT_SUBMISSIONS, 'All concurrent submissions should be accepted.');
    assert.ok(concurrencyResult.p95Ms <= SUBMISSION_P95_MAX_MS, `Submission p95 ${concurrencyResult.p95Ms}ms exceeded ${SUBMISSION_P95_MAX_MS}ms.`);

    const responseList = await client.request(`/api/surveys/${survey.id}/responses?limit=${CONCURRENT_SUBMISSIONS}`);
    assert.equal(responseList.total, CONCURRENT_SUBMISSIONS, 'Dashboard response total must match concurrent submissions.');

    const csv = await client.request(`/api/surveys/${survey.id}/export.csv`);
    assert.equal(countCsvRows(csv), CONCURRENT_SUBMISSIONS, 'CSV export row count must match dashboard response count.');

    seedLargeResponseSet(server.state.db, survey.id, LARGE_RESPONSE_COUNT, answers);
    const dashboardStart = performance.now();
    const largeDashboard = await client.request(`/api/surveys/${survey.id}/responses?limit=100&sort=submitted_desc`);
    const dashboardMs = Math.round(performance.now() - dashboardStart);
    assert.equal(largeDashboard.total, LARGE_RESPONSE_COUNT, 'Large dashboard total must include the seeded 100,000-response set.');
    assert.equal(largeDashboard.responses.length, 100, 'Dashboard pagination must keep the first page bounded.');
    assert.ok(dashboardMs <= DASHBOARD_MAX_MS, `Dashboard 100,000-response query ${dashboardMs}ms exceeded ${DASHBOARD_MAX_MS}ms.`);

    const manifest = {
      ok: true,
      generatedAt: new Date().toISOString(),
      thresholds: {
        concurrentSubmissions: CONCURRENT_SUBMISSIONS,
        submissionP95MaxMs: SUBMISSION_P95_MAX_MS,
        largeResponseCount: LARGE_RESPONSE_COUNT,
        dashboardMaxMs: DASHBOARD_MAX_MS
      },
      results: {
        acceptedSubmissions: concurrencyResult.accepted,
        submissionP95Ms: concurrencyResult.p95Ms,
        submissionMaxMs: concurrencyResult.maxMs,
        csvRows: countCsvRows(csv),
        dashboardTotal: largeDashboard.total,
        dashboardPageSize: largeDashboard.responses.length,
        dashboardMs
      }
    };
    await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Performance smoke passed: ${CONCURRENT_SUBMISSIONS} concurrent submissions, ${LARGE_RESPONSE_COUNT} response dashboard in ${dashboardMs}ms.`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
      if (!response.ok) {
        throw new Error(`${options.method || 'GET'} ${route} failed with ${response.status}: ${text}`);
      }
      return payload;
    }
  };
}

async function setupSurvey(client) {
  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Performance Owner',
      email: `perf-${Date.now()}@example.test`,
      password: 'FeedbackOS123',
      workspaceName: 'Performance Workspace',
      acceptTerms: true,
      acceptPrivacy: true
    }
  });
  const workspaceId = signup.workspaces[0].id;
  const created = await client.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Performance Survey' }
  });
  const schema = {
    title: 'Performance Survey',
    description: 'Synthetic survey for response throughput and dashboard pagination checks.',
    questions: [
      { id: 'perf_email', type: 'email', title: 'Email', required: true, description: '', settings: {}, validation: {} },
      { id: 'perf_nps', type: 'nps', title: 'How likely are you to recommend us?', required: true, description: '', settings: { scale: 10 }, validation: {} },
      { id: 'perf_comment', type: 'long_text', title: 'What should we improve?', required: false, description: '', settings: {}, validation: {} }
    ],
    logic: [],
    completion: { type: 'message', message: 'Thanks for the performance smoke response.' }
  };
  await client.request(`/api/surveys/${created.survey.id}`, {
    method: 'PUT',
    body: { schema }
  });
  const published = await client.request(`/api/surveys/${created.survey.id}/publish`, {
    method: 'POST',
    body: {}
  });
  return { workspaceId, survey: published.survey };
}

async function runConcurrentSubmissions(baseUrl, slug, questions) {
  const submissions = Array.from({ length: CONCURRENT_SUBMISSIONS }, async (_, index) => {
    const started = performance.now();
    const response = await fetch(`${baseUrl}/api/public/surveys/${slug}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: buildAnswers(questions, index),
        metadata: {
          source: index % 2 ? 'website' : 'qr',
          branch: index % 3 ? 'North' : 'South',
          location: index % 5 ? 'Pune' : 'Mumbai'
        }
      })
    });
    const elapsed = Math.round(performance.now() - started);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Concurrent submission ${index} failed with ${response.status}: ${text}`);
    }
    return { elapsed, payload: text ? JSON.parse(text) : {} };
  });
  const results = await Promise.all(submissions);
  const durations = results.map((item) => item.elapsed).sort((a, b) => a - b);
  return {
    accepted: results.length,
    p95Ms: percentile(durations, 95),
    maxMs: durations[durations.length - 1]
  };
}

function buildAnswers(questions, index) {
  const answers = {};
  for (const question of questions) {
    if (question.id === 'perf_email') answers[question.id] = `respondent-${index}@example.test`;
    if (question.id === 'perf_nps') answers[question.id] = String(7 + (index % 4));
    if (question.id === 'perf_comment') answers[question.id] = index % 4 === 0 ? 'Fast and helpful service.' : 'Please keep improving follow-up speed.';
  }
  return answers;
}

function seedLargeResponseSet(db, surveyId, targetCount, answers) {
  const survey = db.surveys.find((item) => item.id === surveyId);
  assert.ok(survey, 'Survey must exist before seeding large response set.');
  const existing = db.responses.filter((item) => item.surveyId === surveyId);
  assert.ok(existing.length, 'At least one real response is required before seeding synthetic rows.');
  const template = existing[0];
  for (let index = existing.length; index < targetCount; index += 1) {
    const submittedAt = new Date(Date.now() - index * 1000).toISOString();
    db.responses.push({
      ...template,
      id: `rsp_perf_${index}_${crypto.randomBytes(5).toString('hex')}`,
      respondentId: null,
      answersJson: {
        ...answers,
        perf_email: `bulk-${index}@example.test`,
        perf_nps: String(7 + (index % 4)),
        perf_comment: index % 9 === 0 ? 'Slow follow-up but useful process.' : 'Helpful experience.'
      },
      metadataJson: {
        ...template.metadataJson,
        source: index % 2 ? 'website' : 'qr',
        branch: index % 3 ? 'North' : 'South',
        location: index % 5 ? 'Pune' : 'Mumbai'
      },
      tagsJson: index % 10 === 0 ? ['needs-follow-up'] : [],
      sentiment: index % 9 === 0 ? 'negative' : 'positive',
      leadScore: 50 + (index % 50),
      submittedAt,
      createdAt: submittedAt,
      updatedAt: submittedAt,
      internalNotes: [],
      important: index % 25 === 0
    });
  }
  survey.metrics.completions = targetCount;
  survey.metrics.starts = Math.max(survey.metrics.starts || 0, targetCount);
}

function countCsvRows(csv) {
  return String(csv || '').trim().split(/\n/).filter(Boolean).length - 1;
}

function percentile(sortedNumbers, percentileValue) {
  if (!sortedNumbers.length) return 0;
  const index = Math.min(sortedNumbers.length - 1, Math.ceil((percentileValue / 100) * sortedNumbers.length) - 1);
  return sortedNumbers[index];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
