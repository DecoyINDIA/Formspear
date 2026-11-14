const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

function postgresSslConfig(databaseUrl) {
  const sslMode = String(process.env.PGSSLMODE || '').trim().toLowerCase();
  if (sslMode === 'disable') return false;
  if (sslMode === 'require' || /[?&]sslmode=require\b/i.test(databaseUrl)) {
    return { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' };
  }
  return false;
}

function listMigrations(dir) {
  const migrationsDir = dir || path.resolve(__dirname, '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) return [];
  const files = fs.readdirSync(migrationsDir);
  return files
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      name: file.replace(/\.sql$/, ''),
      file: path.resolve(migrationsDir, file)
    }));
}

async function applyMigrations(client, options = {}) {
  const dir = options.dir || path.resolve(__dirname, '..', 'migrations');
  const log = options.log || (() => {});
  const migrations = listMigrations(dir);

  const appliedSet = new Set();
  const regclassRes = await client.query("SELECT to_regclass('public.schema_migrations') AS regclass");
  const tableExists = Boolean(regclassRes?.rows?.[0]?.regclass);

  if (tableExists) {
    const existing = await client.query('SELECT version, name FROM schema_migrations');
    for (const row of existing.rows || []) {
      if (row.name) appliedSet.add(row.name);
      if (row.version) appliedSet.add(row.version);
      if (row.version && row.name) appliedSet.add(`${row.version}_${row.name}`);
    }
  }

  const applied = [];
  const skipped = [];

  for (const migration of migrations) {
    if (appliedSet.has(migration.name)) {
      skipped.push(migration.name);
      continue;
    }

    const sql = fs.readFileSync(migration.file, 'utf8');
    const match = migration.name.match(/^(\d{4})_(.+)$/);
    const version = match ? match[1] : migration.name;
    const name = migration.name;

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, now()) ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name',
        [version, name]
      );
      await client.query('COMMIT');
      applied.push(migration.name);
      appliedSet.add(migration.name);
      appliedSet.add(version);
      log(`Applied migration ${migration.name}`);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw err;
    }
  }

  return { applied, skipped };
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: postgresSslConfig(databaseUrl)
  });

  (async () => {
    try {
      await client.connect();
      const result = await applyMigrations(client, { log: (msg) => console.log(msg) });
      console.log(`Migrations complete: ${result.applied.length} applied, ${result.skipped.length} skipped.`);
      await client.end();
    } catch (err) {
      console.error('Migration failed:', err);
      try {
        await client.end();
      } catch (_) {}
      process.exit(1);
    }
  })();
}

module.exports = {
  listMigrations,
  applyMigrations,
  postgresSslConfig
};
