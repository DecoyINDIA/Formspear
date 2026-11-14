const test = require('node:test');
const assert = require('node:assert/strict');
const { savePostgresRelationalCollections } = require('../src/server');

test('savePostgresRelationalCollections computes diffs correctly and avoids full truncate', async () => {
  const queries = [];
  const clientMock = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    }
  };

  const state = {
    pgShadow: {
      surveys: new Map([
        ['srv_1', { columns: ['id', 'title'], values: ['srv_1', 'Old Survey'] }],
        ['srv_2', { columns: ['id', 'title'], values: ['srv_2', 'Survey to Delete'] }]
      ])
    }
  };

  const db = {
    surveys: [
      { id: 'srv_1', title: 'Updated Survey' }, // Updated
      { id: 'srv_3', title: 'New Survey' }      // Inserted
      // srv_2 is omitted (Deleted)
    ]
  };

  const nextShadow = {};
  await savePostgresRelationalCollections(clientMock, db, state, nextShadow);

  // Assert that exact queries were called
  const deleteQuery = queries.find(q => q.sql.includes('DELETE'));
  assert.ok(deleteQuery, 'Should perform a DELETE query');
  assert.deepEqual(deleteQuery.params, ['srv_2']);

  const upsertQueries = queries.filter(q => q.sql.includes('INSERT INTO'));
  assert.equal(upsertQueries.length, 2, 'Should perform two upserts');

  // Verify srv_1 was updated
  const srv1Upsert = upsertQueries.find(q => q.params.includes('srv_1'));
  assert.ok(srv1Upsert, 'Should upsert srv_1');
  assert.ok(srv1Upsert.sql.includes('ON CONFLICT (id) DO UPDATE'), 'Should use ON CONFLICT DO UPDATE clause');

  // Verify srv_3 was inserted
  const srv3Upsert = upsertQueries.find(q => q.params.includes('srv_3'));
  assert.ok(srv3Upsert, 'Should upsert srv_3');

  // Verify full table truncate is absent
  const hasTruncate = queries.some(q => q.sql.toLowerCase().includes('truncate'));
  assert.equal(hasTruncate, false, 'Should not contain TRUNCATE queries');
});

test('savePostgresRelationalCollections treats append-only collections as append-only', async () => {
  const queries = [];
  const clientMock = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    }
  };

  const state = {
    pgShadow: {
      auditLogs: new Map([
        ['a1', { columns: ['id', 'action', 'entity_type', 'metadata_json'], values: ['a1', 'login', 'user', '{}'] }],
        ['a2', { columns: ['id', 'action', 'entity_type', 'metadata_json'], values: ['a2', 'login', 'user', '{}'] }],
        ['a3', { columns: ['id', 'action', 'entity_type', 'metadata_json'], values: ['a3', 'login', 'user', '{}'] }]
      ]),
      notifications: new Map([
        ['n1', { columns: ['id', 'workspace_id', 'title'], values: ['n1', 'w1', 'Old Notification'] }]
      ])
    }
  };

  const db = {
    auditLogs: [
      { id: 'a3', action: 'login', entityType: 'user' },
      { id: 'a4', action: 'logout', entityType: 'user' }
    ],
    notifications: []
  };

  const nextShadow = {};
  await savePostgresRelationalCollections(clientMock, db, state, nextShadow);

  // Assert that NO delete query matches /DELETE FROM audit_logs/
  const auditDelete = queries.find(q => /DELETE FROM audit_logs/i.test(q.sql));
  assert.equal(auditDelete, undefined, 'Should not emit DELETE for audit_logs');

  // Assert that a4 was inserted
  const a4Upsert = queries.find(q => /INSERT INTO audit_logs/i.test(q.sql) && q.params.includes('a4'));
  assert.ok(a4Upsert, 'Should insert new audit log entry a4');

  // Guard against over-broad change: non-append-only collection (notifications) still emits DELETE
  const notifDelete = queries.find(q => /DELETE FROM notifications/i.test(q.sql));
  assert.ok(notifDelete, 'Should emit DELETE for non-append-only collection notifications');
  assert.deepEqual(notifDelete.params, ['n1']);
});
