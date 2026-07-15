const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAiSummary } = require('../src/server');

test('AI summary themes include traceable response evidence', () => {
  const survey = { id: 'survey_1', title: 'Delivery feedback', schema: { questions: [] } };
  const responses = [
    { id: 'response_1', answersJson: { comment: 'Delivery was delayed and communication was unclear.' }, sentiment: 'negative', leadScore: 20 },
    { id: 'response_2', answersJson: { comment: 'Delivery tracking and communication were excellent.' }, sentiment: 'positive', leadScore: 70 },
    { id: 'response_3', answersJson: { comment: 'The product quality was excellent.' }, sentiment: 'positive', leadScore: 50 }
  ];

  const summary = buildAiSummary(survey, responses);
  assert.ok(summary.themeEvidence.length > 0);
  const communication = summary.themeEvidence.find((item) => item.theme === 'communication');
  assert.ok(communication);
  assert.equal(communication.responseCount, 2);
  assert.deepEqual(communication.evidence.map((item) => item.responseId), ['response_1', 'response_2']);
  assert.ok(communication.evidence.every((item) => item.excerpt.toLowerCase().includes('communication')));
});
