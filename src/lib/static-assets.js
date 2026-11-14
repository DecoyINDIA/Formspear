const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const assetCache = new Map();

async function loadAsset(filePath) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    const err = new Error('File not found.');
    err.code = 'ENOENT';
    throw err;
  }
  const cached = assetCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }
  const raw = await fs.promises.readFile(filePath);
  const etag = `"${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)}"`;
  const asset = {
    raw,
    etag,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
  assetCache.set(filePath, asset);
  return asset;
}

function isCompressible(contentType) {
  if (!contentType || typeof contentType !== 'string') return false;
  const lower = contentType.toLowerCase();
  return lower.startsWith('text/') || lower.includes('javascript') || lower.includes('json') || lower.includes('svg') || lower.includes('xml');
}

function negotiateEncoding(acceptEncodingHeader, asset = {}) {
  if (!acceptEncodingHeader || typeof acceptEncodingHeader !== 'string') return null;
  const tokens = acceptEncodingHeader.split(',').map((part) => part.trim());
  const allowed = new Set();
  for (const token of tokens) {
    if (!token) continue;
    const [encoding, ...params] = token.split(';').map((p) => p.trim());
    let q = 1;
    for (const param of params) {
      if (param.startsWith('q=')) {
        const val = parseFloat(param.slice(2));
        if (Number.isFinite(val)) q = val;
      }
    }
    if (q > 0) {
      allowed.add(encoding.toLowerCase());
    }
  }

  if (allowed.has('br') || allowed.has('*')) {
    if (asset && asset.raw && !asset.br) {
      asset.br = zlib.brotliCompressSync(asset.raw);
    }
    return 'br';
  }
  if (allowed.has('gzip')) {
    if (asset && asset.raw && !asset.gzip) {
      asset.gzip = zlib.gzipSync(asset.raw, { level: 9 });
    }
    return 'gzip';
  }
  return null;
}

module.exports = {
  loadAsset,
  isCompressible,
  negotiateEncoding
};
