const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Set MAX_BODY_BYTES before requiring server for the HTTP test
process.env.MAX_BODY_BYTES = '64';

const { readBodyBuffer } = require('../src/lib/http-body');
const { createServer } = require('../src/server');

test('readBodyBuffer preserves multi-byte UTF-8 split across chunks', async () => {
  const originalText = 'नमस्ते 🙂';
  const fullBytes = Buffer.from(originalText, 'utf8');
  // Split in the middle of multi-byte sequences
  const part1 = fullBytes.subarray(0, 4);
  const part2 = fullBytes.subarray(4, 9);
  const part3 = fullBytes.subarray(9);

  const stream = new PassThrough();
  stream.write(part1);
  stream.write(part2);
  stream.end(part3);

  const result = await readBodyBuffer(stream, 1024);
  assert.equal(result.toString('utf8'), originalText);
});

test('readBodyBuffer rejects with body_too_large when limit exceeded', async () => {
  const stream = new PassThrough();
  const chunk = Buffer.from('1234');
  stream.write(chunk);
  stream.write(chunk);
  // Total will become 12, exceeding maxBytes 10
  stream.write(chunk);
  stream.end();

  await assert.rejects(
    () => readBodyBuffer(stream, 10),
    (err) => {
      assert.equal(err.code, 'body_too_large');
      assert.match(err.message, /Request body too large/);
      return true;
    }
  );
});

test('readBodyBuffer resolves empty buffer for empty stream', async () => {
  const stream = new Readable({
    read() {
      this.push(null);
    }
  });

  const result = await readBodyBuffer(stream, 1024);
  assert.equal(result.length, 0);
});

test('readBodyBuffer rejects on stream error', async () => {
  const stream = new PassThrough();
  const promise = readBodyBuffer(stream, 1024);
  stream.destroy(new Error('Network disconnected'));

  await assert.rejects(
    () => promise,
    /Network disconnected/
  );
});

test('HTTP server returns 413 body_too_large on oversized request', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-body-test-'));
  const dataFile = path.join(tempDir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Send payload larger than MAX_BODY_BYTES (64 bytes)
  const oversizedPayload = JSON.stringify({ largeData: 'A'.repeat(200) });
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: oversizedPayload
  });

  assert.equal(response.status, 413);
  const data = await response.json();
  assert.equal(data.error.code, 'body_too_large');
});
