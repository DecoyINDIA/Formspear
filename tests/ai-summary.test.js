const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAiSummary, selectResponsesForAi } = require('../src/server');

test('AI summary themes include traceable response evidence and correct honesty metadata', () => {
  const survey = { id: 'survey_1', title: 'Delivery feedback', schema: { questions: [] } };
  const responses = [
    { id: 'response_1', answersJson: { comment: 'Delivery was delayed and communication was unclear.' }, sentiment: 'negative', leadScore: 20 },
    { id: 'response_2', answersJson: { comment: 'Delivery tracking and communication were excellent.' }, sentiment: 'positive', leadScore: 70 },
    { id: 'response_3', answersJson: { comment: 'The product quality was excellent.' }, sentiment: 'positive', leadScore: 50 }
  ];

  const summary = buildAiSummary(survey, responses);
  assert.equal(summary.aiGenerated, false);
  assert.equal(summary.coverage.strategy, 'all_responses_keyword');
  assert.equal(summary.coverage.analyzed, 3);
  assert.equal(summary.coverage.total, 3);
  assert.ok(summary.themeEvidence.length > 0);
  const communication = summary.themeEvidence.find((item) => item.theme === 'communication');
  assert.ok(communication);
  assert.equal(communication.responseCount, 2);
  assert.deepEqual(communication.evidence.map((item) => item.responseId), ['response_1', 'response_2']);
  assert.ok(communication.evidence.every((item) => item.excerpt.toLowerCase().includes('communication')));
});

test('selectResponsesForAi samples stratified recent responses correctly with 200 responses', () => {
  const responses = [];
  const baseTime = 1700000000000;

  // 30 negatives with valid text
  for (let i = 0; i < 30; i++) {
    responses.push({
      id: `neg_${i}`,
      answersJson: { text: `Negative comment ${i}` },
      sentiment: 'negative',
      leadScore: 20,
      submittedAt: new Date(baseTime + i * 1000).toISOString()
    });
  }

  // 20 highIntent (leadScore 90) with valid text
  for (let i = 0; i < 20; i++) {
    responses.push({
      id: `intent_${i}`,
      answersJson: { text: `High intent lead ${i}` },
      sentiment: 'positive',
      leadScore: 90,
      submittedAt: new Date(baseTime + (100 + i) * 1000).toISOString()
    });
  }

  // 10 with empty text
  for (let i = 0; i < 10; i++) {
    responses.push({
      id: `empty_${i}`,
      answersJson: { text: '   ' },
      sentiment: 'neutral',
      leadScore: 10,
      submittedAt: new Date(baseTime + (200 + i) * 1000).toISOString()
    });
  }

  // 140 rest (neutral, leadScore 40) with valid text
  for (let i = 0; i < 140; i++) {
    responses.push({
      id: `rest_${i}`,
      answersJson: { text: `Neutral comment ${i}` },
      sentiment: 'neutral',
      leadScore: 40,
      submittedAt: new Date(baseTime + (300 + i) * 1000).toISOString()
    });
  }

  assert.equal(responses.length, 200);

  const result = selectResponsesForAi(responses, 60);
  assert.equal(result.total, 200);
  assert.equal(result.selected.length, 60);

  // At most 24 negatives leading
  const leadingNegatives = result.selected.slice(0, 24);
  assert.ok(leadingNegatives.every((r) => r.sentiment === 'negative' || r.sentiment === 'mixed'));

  // Contains no empty-text response
  assert.ok(result.selected.every((r) => !r.id.startsWith('empty_')));

  // Most recent first within each group
  for (let i = 1; i < 24; i++) {
    const prevDate = new Date(leadingNegatives[i - 1].submittedAt).getTime();
    const currDate = new Date(leadingNegatives[i].submittedAt).getTime();
    assert.ok(prevDate >= currDate, 'negatives group should be sorted most recent first');
  }

  const highIntentGroup = result.selected.slice(24, 36);
  assert.equal(highIntentGroup.length, 12);
  assert.ok(highIntentGroup.every((r) => r.leadScore >= 80));
  for (let i = 1; i < highIntentGroup.length; i++) {
    const prevDate = new Date(highIntentGroup[i - 1].submittedAt).getTime();
    const currDate = new Date(highIntentGroup[i].submittedAt).getTime();
    assert.ok(prevDate >= currDate, 'high intent group should be sorted most recent first');
  }

  const restGroup = result.selected.slice(36, 60);
  assert.equal(restGroup.length, 24);
  for (let i = 1; i < restGroup.length; i++) {
    const prevDate = new Date(restGroup[i - 1].submittedAt).getTime();
    const currDate = new Date(restGroup[i].submittedAt).getTime();
    assert.ok(prevDate >= currDate, 'rest group should be sorted most recent first');
  }
});

test('selectResponsesForAi with 5 responses and limit 60 returns all 5', () => {
  const responses = [
    { id: 'r1', answersJson: { text: 'One' }, sentiment: 'positive', leadScore: 50, submittedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'r2', answersJson: { text: 'Two' }, sentiment: 'negative', leadScore: 30, submittedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'r3', answersJson: { text: 'Three' }, sentiment: 'neutral', leadScore: 85, submittedAt: '2026-01-03T00:00:00.000Z' },
    { id: 'r4', answersJson: { text: 'Four' }, sentiment: 'positive', leadScore: 60, submittedAt: '2026-01-04T00:00:00.000Z' },
    { id: 'r5', answersJson: { text: 'Five' }, sentiment: 'mixed', leadScore: 20, submittedAt: '2026-01-05T00:00:00.000Z' }
  ];

  const result = selectResponsesForAi(responses, 60);
  assert.equal(result.total, 5);
  assert.equal(result.selected.length, 5);
  const selectedIds = new Set(result.selected.map((r) => r.id));
  assert.equal(selectedIds.size, 5);
  for (const r of responses) {
    assert.ok(selectedIds.has(r.id));
  }
});
