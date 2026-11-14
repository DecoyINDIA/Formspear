const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');

test('public surveys are embeddable and public API responds to cross-origin requests', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-headers-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. GET /s/any-slug → 200, no x-frame-options, CSP contains frame-ancestors *
  const surveyPageRes = await fetch(`${baseUrl}/s/any-slug`);
  assert.equal(surveyPageRes.status, 200);
  assert.equal(surveyPageRes.headers.get('x-frame-options'), null);
  const surveyCsp = surveyPageRes.headers.get('content-security-policy') || '';
  assert.match(surveyCsp, /frame-ancestors \*/);

  // 2. GET / → x-frame-options: SAMEORIGIN, CSP contains frame-ancestors 'self'
  const homePageRes = await fetch(`${baseUrl}/`);
  assert.equal(homePageRes.status, 200);
  assert.equal(homePageRes.headers.get('x-frame-options'), 'SAMEORIGIN');
  const homeCsp = homePageRes.headers.get('content-security-policy') || '';
  assert.match(homeCsp, /frame-ancestors 'self'/);

  // 3. OPTIONS /api/public/in-app/resolve with foreign origin → 204 with the three access-control-* headers and access-control-allow-origin: *
  const optionsRes = await fetch(`${baseUrl}/api/public/in-app/resolve`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://customer.example'
    }
  });
  assert.equal(optionsRes.status, 204);
  assert.equal(optionsRes.headers.get('access-control-allow-origin'), '*');
  assert.equal(optionsRes.headers.get('access-control-allow-methods'), 'GET,POST,PATCH,OPTIONS');
  assert.equal(optionsRes.headers.get('access-control-allow-headers'), 'content-type');
  assert.equal(optionsRes.headers.get('access-control-max-age'), '600');

  // 4. POST /api/public/in-app/resolve with JSON body and foreign origin → 200 and access-control-allow-origin: *
  const postPublicRes = await fetch(`${baseUrl}/api/public/in-app/resolve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://customer.example'
    },
    body: JSON.stringify({
      eventName: 'test_event'
    })
  });
  assert.equal(postPublicRes.status, 200);
  assert.equal(postPublicRes.headers.get('access-control-allow-origin'), '*');

  // 5. OPTIONS /api/session → no access-control-allow-origin header
  const nonPublicOptionsRes = await fetch(`${baseUrl}/api/session`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://customer.example'
    }
  });
  assert.equal(nonPublicOptionsRes.headers.get('access-control-allow-origin'), null);
});
