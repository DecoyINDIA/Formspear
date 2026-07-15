const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const initialFiles = ['public/index.html', 'public/styles.css', 'public/builder-history.js', 'public/app.js'];
const limit = Number(process.env.PUBLIC_INITIAL_GZIP_BUDGET_BYTES || 50 * 1024);
const assets = initialFiles.map((file) => {
  const contents = fs.readFileSync(path.join(root, file));
  return { file, rawBytes: contents.length, gzipBytes: zlib.gzipSync(contents, { level: 9 }).length };
});
const totalGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
if (totalGzipBytes > limit) {
  throw new Error(`Public initial payload is ${totalGzipBytes} gzip bytes, above the ${limit}-byte budget.`);
}
console.log(`Performance budget passed: ${totalGzipBytes}/${limit} gzip bytes (${assets.map((asset) => `${asset.file}=${asset.gzipBytes}`).join(', ')}).`);
