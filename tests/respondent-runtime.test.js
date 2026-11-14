const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createServer } = require('../src/server');

test('E-02: respondent runtime is isolated in survey.html + survey.js and within 20 KB gzip', async (t) => {
  const root = path.resolve(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-respondent-'));
  const dataFile = path.join(tempDir, 'state.json');

  const server = createServer({ dataFile, disableWorker: true });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. GET /s/:slug returns survey.html loading survey.js and not app.js
  const surveyPageRes = await fetch(`${baseUrl}/s/customer-satisfaction`);
  assert.equal(surveyPageRes.status, 200);
  const surveyHtml = await surveyPageRes.text();
  assert.match(surveyHtml, /<script src="\/survey\.js"><\/script>/);
  assert.doesNotMatch(surveyHtml, /app\.js/);

  // 2. GET /survey.js returns 200 with javascript
  const surveyJsRes = await fetch(`${baseUrl}/survey.js`);
  assert.equal(surveyJsRes.status, 200);
  assert.match(surveyJsRes.headers.get('content-type') || '', /javascript/);
  const surveyJs = await surveyJsRes.text();
  assert.match(surveyJs, /initPublic/);
  assert.match(surveyJs, /renderPublicSurvey/);

  // 3. Respondent bundle gzip size <= 20 KB
  const respondentFiles = ['public/survey.html', 'public/styles.css', 'public/survey.js'];
  const totalGzip = respondentFiles.reduce((sum, file) => {
    const content = fs.readFileSync(path.join(root, file));
    return sum + zlib.gzipSync(content, { level: 9 }).length;
  }, 0);
  assert.ok(totalGzip < 20 * 1024, `Respondent bundle (${totalGzip} bytes) should be < 20 KB`);
});
