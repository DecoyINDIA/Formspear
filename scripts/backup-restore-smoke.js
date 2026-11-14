const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formspear-backup-smoke-'));
const dataFile = path.join(tempDir, 'db.json');
const backupDir = path.join(tempDir, 'backups');
const seed = {
  users: [{ id: 'usr_backup_smoke', email: 'backup@example.test' }],
  workspaces: [{ id: 'wks_backup_smoke', name: 'Backup Smoke' }]
};

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`Node script failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

// 1. Seed data file
fs.writeFileSync(dataFile, `${JSON.stringify(seed, null, 2)}\n`);

// 2. Run backup-data.js
const backupOutput = runNode(['scripts/backup-data.js', '--data-file', dataFile, '--backup-dir', backupDir]);
const backupFile = backupOutput.split(/\r?\n/).filter(Boolean).at(-1);
assert.ok(backupFile && fs.existsSync(backupFile), 'backup file should exist');

// 3. Verify manifest
const manifestFile = `${backupFile}.manifest.json`;
assert.ok(fs.existsSync(manifestFile), 'backup manifest should exist');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
const backupBytes = fs.readFileSync(backupFile);
assert.equal(manifest.bytes, backupBytes.length);
assert.equal(manifest.sha256, crypto.createHash('sha256').update(backupBytes).digest('hex'));

// 4. Corrupt data file to test restoration
fs.writeFileSync(dataFile, `${JSON.stringify({ users: [], workspaces: [] }, null, 2)}\n`);

// 5. Run restore-data.js
const restoreOutput = runNode(['scripts/restore-data.js', '--backup-file', backupFile, '--data-file', dataFile, '--force']);
const restorePayload = JSON.parse(restoreOutput.split(/\r?\n/).filter(Boolean).at(-1));
assert.equal(path.resolve(restorePayload.dataFile).toLowerCase(), path.resolve(dataFile).toLowerCase());

// 6. Verify restored data and safety copy
const restored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
assert.deepEqual(restored, seed);
assert.ok(restorePayload.preRestoreBackup && fs.existsSync(restorePayload.preRestoreBackup), 'pre-restore copy should exist');

// 7. Verify checksum mismatch detection
const tamperedBackup = path.join(backupDir, 'tampered.json');
fs.writeFileSync(tamperedBackup, '{"tampered": true}');
fs.writeFileSync(`${tamperedBackup}.manifest.json`, JSON.stringify({ sha256: 'deadbeef' }));
const failRun = spawnSync(process.execPath, ['scripts/restore-data.js', '--backup-file', tamperedBackup, '--data-file', dataFile], {
  cwd: root,
  encoding: 'utf8'
});
assert.notEqual(failRun.status, 0, 'restore should fail on checksum mismatch');
assert.match(failRun.stderr, /checksum mismatch/i, 'should output checksum mismatch error');

// Cleanup
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch (_) {}

console.log(`Backup/restore smoke passed: ${backupFile}`);
