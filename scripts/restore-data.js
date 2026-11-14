const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function restoreData(options = {}) {
  const root = path.resolve(__dirname, '..');
  const backupFile = options.backupFile || options.backup;
  if (!backupFile) {
    throw new Error('Backup file must be specified (--backup-file)');
  }
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  const raw = fs.readFileSync(backupFile, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Backup file is not valid JSON: ${backupFile}`);
  }

  // Check manifest if available
  const manifestPath = `${backupFile}.manifest.json`;
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (_) {}
  }

  if (!options.skipChecksum && manifest && manifest.sha256) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex');
    if (hash.toLowerCase() !== String(manifest.sha256).toLowerCase()) {
      throw new Error(`Backup checksum mismatch for ${backupFile}`);
    }
  }

  // PostgreSQL restore
  if ((manifest && manifest.type === 'postgres') || (process.env.DATABASE_URL && options.postgres)) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required to restore PostgreSQL backup');
    }
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      for (const [table, rows] of Object.entries(parsed)) {
        // Truncate table with cascade
        await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
        if (Array.isArray(rows) && rows.length > 0) {
          const cols = Object.keys(rows[0]);
          for (const row of rows) {
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            const colNames = cols.map((c) => `"${c}"`).join(', ');
            const values = cols.map((c) => row[c]);
            await client.query(
              `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders})`,
              values
            );
          }
        }
      }
      await client.query('COMMIT');
      return {
        restoredAt: new Date().toISOString(),
        backupFile: path.resolve(backupFile),
        type: 'postgres',
        tableCount: Object.keys(parsed).length
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      await client.end();
    }
  }

  // File-based JSON restore
  const dataFile = options.dataFile || process.env.FORMSPEAR_DATA_FILE || path.join(root, 'data', 'formspear.db.json');
  const targetDir = path.dirname(dataFile);
  if (targetDir && !fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let preRestoreBackup = '';
  if (fs.existsSync(dataFile)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    preRestoreBackup = `${dataFile}.pre-restore-${stamp}`;
    fs.copyFileSync(dataFile, preRestoreBackup);
  }

  fs.copyFileSync(backupFile, dataFile);

  const result = {
    restoredAt: new Date().toISOString(),
    backupFile: path.resolve(backupFile),
    dataFile: path.resolve(dataFile),
    preRestoreBackup: preRestoreBackup ? path.resolve(preRestoreBackup) : ''
  };

  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let backupFile = '';
  let dataFile = '';
  let force = false;
  let skipChecksum = false;
  let postgres = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backup' || args[i] === '--backup-file' || args[i] === '-BackupFile') {
      backupFile = args[++i];
    } else if (args[i] === '--data-file' || args[i] === '-DataFile') {
      dataFile = args[++i];
    } else if (args[i] === '--force' || args[i] === '-Force') {
      force = true;
    } else if (args[i] === '--skip-checksum' || args[i] === '-SkipChecksum') {
      skipChecksum = true;
    } else if (args[i] === '--postgres') {
      postgres = true;
    }
  }

  restoreData({ backupFile, dataFile, force, skipChecksum, postgres })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}

module.exports = { restoreData };
