const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isCompressible, negotiateEncoding } = require('../src/lib/static-assets');
const { createServer } = require('../src/server');

test('isCompressible identifies compressible text and data content types', () => {
  assert.equal(isCompressible('text/html; charset=utf-8'), true);
  assert.equal(isCompressible('text/css'), true);
  assert.equal(isCompressible('application/javascript; charset=utf-8'), true);
  assert.equal(isCompressible('application/json'), true);
  assert.equal(isCompressible('image/svg+xml'), true);
  assert.equal(isCompressible('application/xml'), true);
  assert.equal(isCompressible('image/png'), false);
  assert.equal(isCompressible('image/jpeg'), false);
  assert.equal(isCompressible('application/octet-stream'), false);
  assert.equal(isCompressible(''), false);
});

test('negotiateEncoding respects client preferences and priorities', () => {
  const asset = { raw: Buffer.from('console.log("hello world");') };

  // Prefer br when both br and gzip are supported
  assert.equal(negotiateEncoding('br, gzip', asset), 'br');
  assert.ok(asset.br, 'Brotli buffer was populated');

  // gzip only
  assert.equal(negotiateEncoding('gzip', asset), 'gzip');
  assert.ok(asset.gzip, 'Gzip buffer was populated');

  // Ignore q=0
  assert.equal(negotiateEncoding('br;q=0, gzip', asset), 'gzip');
  assert.equal(negotiateEncoding('gzip;q=0, br;q=0', asset), null);

  // Wildcard
  assert.equal(negotiateEncoding('*', asset), 'br');

  // No encoding or unsupported
  assert.equal(negotiateEncoding('', asset), null);
  assert.equal(negotiateEncoding('deflate', asset), null);
});

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(parsed, { method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBody: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('HTTP server serves compressed static assets with ETag revalidation', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-assets-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. GET /app.js with accept-encoding: gzip → content-encoding: gzip, gunzips to file contents
  const gzipRes = await httpGet(`${baseUrl}/app.js`, { 'accept-encoding': 'gzip' });
  assert.equal(gzipRes.statusCode, 200);
  assert.equal(gzipRes.headers['content-encoding'], 'gzip');
  const unzipped = zlib.gunzipSync(gzipRes.rawBody).toString('utf8');
  assert.match(unzipped, /FeedbackOS/i);

  // 2. accept-encoding: br, gzip → br
  const brRes = await httpGet(`${baseUrl}/app.js`, { 'accept-encoding': 'br, gzip' });
  assert.equal(brRes.statusCode, 200);
  assert.equal(brRes.headers['content-encoding'], 'br');
  const unbrotlied = zlib.brotliDecompressSync(brRes.rawBody).toString('utf8');
  assert.match(unbrotlied, /FeedbackOS/i);

  // 3. no accept-encoding → no content-encoding, raw body
  const rawRes = await httpGet(`${baseUrl}/app.js`);
  assert.equal(rawRes.statusCode, 200);
  assert.equal(rawRes.headers['content-encoding'], undefined);
  assert.match(rawRes.rawBody.toString('utf8'), /FeedbackOS/i);

  // 4. second request with if-none-match = returned etag → 304, empty body
  const etag = rawRes.headers['etag'];
  assert.ok(etag, 'ETag must be present');
  const revalRes = await httpGet(`${baseUrl}/app.js`, { 'if-none-match': etag });
  assert.equal(revalRes.statusCode, 304);
  assert.equal(revalRes.rawBody.length, 0);

  // 5. GET /s/x still has embeddable headers from T-P0-04 and GET / still has x-frame-options
  const embedRes = await httpGet(`${baseUrl}/s/any-slug`);
  assert.equal(embedRes.statusCode, 200);
  assert.equal(embedRes.headers['x-frame-options'], undefined);
  assert.match(embedRes.headers['content-security-policy'] || '', /frame-ancestors \*/);

  const homeRes = await httpGet(`${baseUrl}/`);
  assert.equal(homeRes.statusCode, 200);
  assert.equal(homeRes.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(homeRes.headers['content-security-policy'] || '', /frame-ancestors 'self'/);

  // 6. GET /missing.js → 404 JSON
  const missingRes = await httpGet(`${baseUrl}/missing.js`);
  assert.equal(missingRes.statusCode, 404);
  const missingJson = JSON.parse(missingRes.rawBody.toString('utf8'));
  assert.equal(missingJson.error.code, 'not_found');
});
