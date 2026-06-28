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

function runPowerShell(args) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`PowerShell failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

fs.writeFileSync(dataFile, `${JSON.stringify(seed, null, 2)}\n`);

const backupOutput = runPowerShell(['-File', 'scripts\\backup-data.ps1', '-DataFile', dataFile, '-BackupDir', backupDir]);
const backupFile = backupOutput.split(/\r?\n/).filter(Boolean).at(-1);
assert.ok(backupFile && fs.existsSync(backupFile), 'backup file should exist');

const manifestFile = `${backupFile}.manifest.json`;
assert.ok(fs.existsSync(manifestFile), 'backup manifest should exist');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
const backupBytes = fs.readFileSync(backupFile);
assert.equal(manifest.bytes, backupBytes.length);
assert.equal(manifest.sha256, crypto.createHash('sha256').update(backupBytes).digest('hex'));

fs.writeFileSync(dataFile, `${JSON.stringify({ users: [], workspaces: [] }, null, 2)}\n`);

const restoreOutput = runPowerShell(['-File', 'scripts\\restore-data.ps1', '-BackupFile', backupFile, '-DataFile', dataFile, '-Force']);
const restorePayload = JSON.parse(restoreOutput.split(/\r?\n/).filter(Boolean).at(-1));
assert.equal(path.resolve(restorePayload.dataFile).toLowerCase(), path.resolve(dataFile).toLowerCase());

const restored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
assert.deepEqual(restored, seed);
assert.ok(restorePayload.preRestoreBackup && fs.existsSync(restorePayload.preRestoreBackup), 'pre-restore copy should exist');

console.log(`Backup/restore smoke passed: ${backupFile}`);
