const test = require('node:test');
const assert = require('node:assert/strict');

const { BuilderHistory } = require('../public/builder-history');

test('builder history supports bounded undo and redo without reference leaks', () => {
  const history = new BuilderHistory(2);
  const first = { survey: { title: 'First' }, selectedQuestionId: 'q1' };
  const second = { survey: { title: 'Second' }, selectedQuestionId: 'q2' };
  const third = { survey: { title: 'Third' }, selectedQuestionId: 'q3' };
  history.remember(first);
  history.remember(second);
  history.remember(third);
  first.survey.title = 'Mutated outside history';

  assert.equal(history.undo({ survey: { title: 'Current' } }).survey.title, 'Third');
  assert.equal(history.undo({ survey: { title: 'Third' } }).survey.title, 'Second');
  assert.equal(history.canUndo, false);
  assert.equal(history.redo({ survey: { title: 'Second' } }).survey.title, 'Third');
  assert.equal(history.canRedo, true);
  history.reset();
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});
