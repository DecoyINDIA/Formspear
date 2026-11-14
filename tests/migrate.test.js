const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listMigrations, applyMigrations } = require('../scripts/migrate');

test('listMigrations returns migrations sorted by filename matching pattern', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-list-test-'));
  try {
    fs.writeFileSync(path.join(tempDir, '0002_second.sql'), 'SELECT 2;');
    fs.writeFileSync(path.join(tempDir, '0001_first.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(tempDir, '0003_third.sql'), 'SELECT 3;');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Ignore me');
    fs.writeFileSync(path.join(tempDir, 'invalid.sql'), 'SELECT 0;');

    const list = listMigrations(tempDir);
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((m) => m.name), ['0001_first', '0002_second', '0003_third']);
    assert.equal(path.basename(list[0].file), '0001_first.sql');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('applyMigrations applies migrations on empty database and records in schema_migrations', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-apply-test-'));
  try {
    fs.writeFileSync(path.join(tempDir, '0001_initial.sql'), 'CREATE TABLE test1 (id text);');
    fs.writeFileSync(path.join(tempDir, '0002_second.sql'), 'CREATE TABLE test2 (id text);');

    const queries = [];
    const schemaMigrations = [];
    let tableExists = false;

    const fakeClient = {
      async query(sql, params) {
        queries.push({ sql: sql.trim(), params });
        if (sql.includes('to_regclass')) {
          return { rows: [{ regclass: tableExists ? 'schema_migrations' : null }] };
        }
        if (sql.includes('SELECT version, name FROM schema_migrations')) {
          return { rows: schemaMigrations };
        }
        if (sql.startsWith('INSERT INTO schema_migrations')) {
          tableExists = true;
          schemaMigrations.push({ version: params[0], name: params[1] });
          return { rowCount: 1 };
        }
        return { rows: [] };
      }
    };

    const res = await applyMigrations(fakeClient, { dir: tempDir });
    assert.deepEqual(res.applied, ['0001_initial', '0002_second']);
    assert.deepEqual(res.skipped, []);

    // Check queries include BEGIN, migration SQL, INSERT, COMMIT
    const sqls = queries.map((q) => q.sql);
    assert.ok(sqls.includes('BEGIN'));
    assert.ok(sqls.includes('CREATE TABLE test1 (id text);'));
    assert.ok(sqls.includes('CREATE TABLE test2 (id text);'));
    assert.ok(sqls.includes('COMMIT'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('applyMigrations skips migrations already recorded in schema_migrations', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-skip-test-'));
  try {
    fs.writeFileSync(path.join(tempDir, '0001_initial.sql'), 'CREATE TABLE test1 (id text);');
    fs.writeFileSync(path.join(tempDir, '0002_second.sql'), 'CREATE TABLE test2 (id text);');

    const queries = [];
    const schemaMigrations = [{ version: '0001', name: '0001_initial' }];

    const fakeClient = {
      async query(sql, params) {
        queries.push({ sql: sql.trim(), params });
        if (sql.includes('to_regclass')) {
          return { rows: [{ regclass: 'schema_migrations' }] };
        }
        if (sql.includes('SELECT version, name FROM schema_migrations')) {
          return { rows: schemaMigrations };
        }
        if (sql.startsWith('INSERT INTO schema_migrations')) {
          schemaMigrations.push({ version: params[0], name: params[1] });
          return { rowCount: 1 };
        }
        return { rows: [] };
      }
    };

    const res = await applyMigrations(fakeClient, { dir: tempDir });
    assert.deepEqual(res.applied, ['0002_second']);
    assert.deepEqual(res.skipped, ['0001_initial']);

    const sqls = queries.map((q) => q.sql);
    assert.ok(!sqls.includes('CREATE TABLE test1 (id text);'));
    assert.ok(sqls.includes('CREATE TABLE test2 (id text);'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('applyMigrations rolls back and rethrows on failure without recording partial migration', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-fail-test-'));
  try {
    fs.writeFileSync(path.join(tempDir, '0001_ok.sql'), 'CREATE TABLE test1 (id text);');
    fs.writeFileSync(path.join(tempDir, '0002_bad.sql'), 'SYNTAX ERROR;');

    const queries = [];
    const schemaMigrations = [];
    let tableExists = true;

    const fakeClient = {
      async query(sql, params) {
        queries.push({ sql: sql.trim(), params });
        if (sql.includes('to_regclass')) {
          return { rows: [{ regclass: 'schema_migrations' }] };
        }
        if (sql.includes('SELECT version, name FROM schema_migrations')) {
          return { rows: schemaMigrations };
        }
        if (sql.startsWith('INSERT INTO schema_migrations')) {
          schemaMigrations.push({ version: params[0], name: params[1] });
          return { rowCount: 1 };
        }
        if (sql.includes('SYNTAX ERROR')) {
          throw new Error('syntax error at or near SYNTAX');
        }
        return { rows: [] };
      }
    };

    await assert.rejects(
      () => applyMigrations(fakeClient, { dir: tempDir }),
      /syntax error at or near SYNTAX/
    );

    const sqls = queries.map((q) => q.sql);
    assert.ok(sqls.includes('ROLLBACK'));
    assert.deepEqual(schemaMigrations.map((m) => m.name), ['0001_ok']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
