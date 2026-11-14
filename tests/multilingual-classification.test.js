const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createServer,
  processDueJobs,
  classifyMultilingualResponse,
  validateEvidenceCitations
} = require('../src/server');

test('E-03: multilingual classification and evidence-based synthesis', async (t) => {
  // 1. Multilingual classification across languages
  // English
  const enRes = classifyMultilingualResponse('The pricing is very high and the app is slow');
  assert.equal(enRes.language, 'en');
  assert.equal(enRes.sentiment, 'negative');
  assert.ok(enRes.topics.includes('pricing') || enRes.topics.includes('performance'));

  // Spanish
  const esRes = classifyMultilingualResponse('Excelente servicio y la interfaz es muy rapido, gracias');
  assert.equal(esRes.language, 'es');
  assert.equal(esRes.sentiment, 'positive');
  assert.equal(esRes.intent, 'praise');

  // Hindi (Devanagari)
  const hiRes = classifyMultilingualResponse('उत्पाद बहुत अच्छा है, तुरंत सहायता मिली');
  assert.equal(hiRes.language, 'hi');
  assert.equal(hiRes.sentiment, 'positive');

  // Hindi (Transliterated) with high urgency and churn intent
  const hiUrgent = classifyMultilingualResponse('bahut bekaar service hai, turant cancel karo aur refund do');
  assert.equal(hiUrgent.language, 'hi');
  assert.equal(hiUrgent.sentiment, 'negative');
  assert.equal(hiUrgent.urgency, 3);
  assert.equal(hiUrgent.intent, 'churn_risk');

  // French
  const frRes = classifyMultilingualResponse('Très bon service client, merci pour votre aide rapide');
  assert.equal(frRes.language, 'fr');
  assert.equal(frRes.sentiment, 'positive');

  // German
  const deRes = classifyMultilingualResponse('Das System ist kaputt, ein dringendes Problem');
  assert.equal(deRes.language, 'de');
  assert.equal(deRes.sentiment, 'negative');
  assert.ok(deRes.urgency >= 2);

  // Japanese
  const jaRes = classifyMultilingualResponse('素晴らしいサービス、最高です');
  assert.equal(jaRes.language, 'ja');
  assert.equal(jaRes.sentiment, 'positive');

  // Strict schema checks
  assert.ok(['positive', 'neutral', 'negative'].includes(enRes.sentiment));
  assert.ok(typeof enRes.intent === 'string');
  assert.ok([0, 1, 2, 3].includes(enRes.urgency));
  assert.ok(Array.isArray(enRes.topics) && enRes.topics.length <= 3);
  assert.ok(typeof enRes.summary === 'string' && enRes.summary.length <= 160);

  // 2. Classify response job execution via server flow
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ml-class-'));
  const dataFile = path.join(tempDir, 'state.json');

  const server = createServer({ dataFile, disableWorker: true });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ml-owner@example.com', password: 'Password123!', name: 'ML Owner', acceptTerms: true })
  });
  assert.equal(signupRes.status, 201);
  const authCookie = signupRes.headers.get('set-cookie');
  const session = await signupRes.json();
  const workspaceId = session.workspaces[0].id;

  const surveyRes = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({ workspaceId, title: 'Global Multilingual Survey' })
  });
  const { survey } = await surveyRes.json();

  await fetch(`${baseUrl}/api/surveys/${survey.id}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: authCookie },
    body: JSON.stringify({})
  });

  // Submit response in Spanish
  const submitRes = await fetch(`${baseUrl}/api/public/surveys/${survey.slug}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: { [survey.schema.questions[0].id]: 'El servicio es excelente y muy facil de usar' }
    })
  });
  assert.equal(submitRes.status, 201);

  const state = server.state;
  const db = state.db;

  // Verify classify_response job is queued
  const classifyJob = db.jobs.find((j) => j.type === 'classify_response');
  assert.ok(classifyJob, 'classify_response job should be queued');

  // Process due jobs
  await processDueJobs(state);
  assert.equal(classifyJob.status, 'completed');

  const processedResponse = db.responses.find((r) => r.id === classifyJob.payloadJson.responseId);
  assert.ok(processedResponse.classificationJson, 'Response must have classificationJson attached');
  assert.equal(processedResponse.classificationJson.language, 'es');
  assert.equal(processedResponse.classificationJson.sentiment, 'positive');

  // 3. Evidence-based synthesis citation verification
  const validResponses = [{ id: 'rsp_valid_1', text: 'Valid quote' }, { id: 'rsp_valid_2', text: 'Second quote' }];
  const rawSummary = {
    themeEvidence: [
      {
        theme: 'Pricing',
        evidence: [
          { responseId: 'rsp_valid_1', excerpt: 'Fair price' },
          { responseId: 'rsp_hallucinated_999', excerpt: 'Invented' }
        ]
      },
      {
        theme: 'Ghost Theme',
        evidence: [
          { responseId: 'rsp_hallucinated_888', excerpt: 'Nonexistent' }
        ]
      }
    ],
    urgentResponses: [
      { responseId: 'rsp_valid_2', excerpt: 'Urgent valid' },
      { responseId: 'rsp_fake_000', excerpt: 'Fake' }
    ]
  };

  const validated = validateEvidenceCitations(rawSummary, validResponses);
  // Verified: Hallucinated responseIds are stripped
  assert.equal(validated.themeEvidence.length, 1);
  assert.equal(validated.themeEvidence[0].evidence.length, 1);
  assert.equal(validated.themeEvidence[0].evidence[0].responseId, 'rsp_valid_1');
  assert.equal(validated.urgentResponses.length, 1);
  assert.equal(validated.urgentResponses[0].responseId, 'rsp_valid_2');
});
