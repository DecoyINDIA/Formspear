const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers/server-fixture');

test('server-workspaces: workspace CRUD, invites, and timezone validation', async (t) => {
  const { client, createClient } = await setupTestServer(t);

  // 1. Signup owner
  const signup = await client.request('/api/auth/signup', {
    method: 'POST',
    body: { name: 'Owner', email: 'owner@example.test', password: 'Password123!', acceptTerms: true }
  });
  const workspaceId = signup.workspaces[0].id;

  // 2. Timezone validation: invalid timezone safely falls back to Asia/Kolkata
  const invalidTzWorkspace = await client.request('/api/workspaces', {
    method: 'POST',
    body: {
      name: 'Invalid Timezone Workspace',
      timezone: 'Not/A/Valid/Timezone'
    }
  });
  assert.equal(invalidTzWorkspace.workspace.timezone, 'Asia/Kolkata');

  // 3. Timezone validation: valid IANA timezone accepted
  const validTzWorkspace = await client.request('/api/workspaces', {
    method: 'POST',
    body: {
      name: 'Valid Timezone Workspace',
      timezone: 'Europe/Paris'
    }
  });
  assert.equal(validTzWorkspace.workspace.timezone, 'Europe/Paris');

  // 4. Create invite link
  const invite = await client.request(`/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    body: { email: 'colleague@example.test', role: 'analyst' }
  });
  assert.match(invite.token, /^fo_inv_/);

  // 5. Member accepts invite
  const colleagueClient = createClient();
  const accepted = await colleagueClient.request('/api/auth/invite-signup', {
    method: 'POST',
    body: {
      token: invite.token,
      name: 'Colleague',
      email: 'colleague@example.test',
      password: 'Password123!'
    }
  });
  assert.ok(accepted.workspaces.find((w) => w.id === workspaceId));

  // 6. Verify workspace members
  const membersRes = await client.request(`/api/workspaces/${workspaceId}/members`);
  assert.ok(membersRes.members.some((m) => m.userId === accepted.user.id));
});
