const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function backupData(options = {}) {
  const root = path.resolve(__dirname, '..');
  const dataFile = options.dataFile || process.env.FORMSPEAR_DATA_FILE || path.join(root, 'data', 'formspear.db.json');
  const backupDir = options.backupDir || path.join(root, 'backups');

  if (process.env.DATABASE_URL && !options.forceJson) {
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = path.join(backupDir, `postgres-backup-${stamp}.json`);

      const tablesRes = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
      const dump = {};
      for (const row of tablesRes.rows) {
        const table = row.tablename;
        const res = await client.query(`SELECT * FROM "${table}"`);
        dump[table] = res.rows;
      }

      const dumpJson = JSON.stringify(dump, null, 2);
      fs.writeFileSync(target, dumpJson, 'utf8');

      const hash = crypto.createHash('sha256').update(dumpJson).digest('hex');
      const manifest = {
        version: 1,
        type: 'postgres',
        createdAt: new Date().toISOString(),
        backupPath: path.resolve(target),
        bytes: Buffer.byteLength(dumpJson),
        sha256: hash
      };
      fs.writeFileSync(`${target}.manifest.json`, JSON.stringify(manifest, null, 2), 'utf8');
      return target;
    } finally {
      await client.end();
    }
  }

  if (!fs.existsSync(dataFile)) {
    throw new Error(`Data file not found: ${dataFile}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `formspear-${stamp}.json`);
  fs.copyFileSync(dataFile, target);

  const bytes = fs.readFileSync(target);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  if (!options.noManifest) {
    const manifest = {
      version: 1,
      type: 'json',
      createdAt: new Date().toISOString(),
      sourcePath: path.resolve(dataFile),
      backupPath: path.resolve(target),
      bytes: bytes.length,
      sha256: hash,
      restoreCommand: `node scripts/restore-data.js --backup "${target}"`
    };
    fs.writeFileSync(`${target}.manifest.json`, JSON.stringify(manifest, null, 2), 'utf8');
  }

  return target;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dataFileIndex = args.indexOf('--data-file');
  const backupDirIndex = args.indexOf('--backup-dir');
  const options = {
    dataFile: dataFileIndex >= 0 ? args[dataFileIndex + 1] : '',
    backupDir: backupDirIndex >= 0 ? args[backupDirIndex + 1] : '',
    noManifest: args.includes('--no-manifest')
  };
  backupData(options)
    .then((target) => console.log(target))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}

module.exports = { backupData };
