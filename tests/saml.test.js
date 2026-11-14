const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createServer,
  parseSamlResponsePayload,
  validateSsoAssertion
} = require('../src/server');

test('E-11: SAML SSO feature gating, XML safety, and cryptographic assertion validation', async (t) => {
  // 1. XXE prevention in parseSamlResponsePayload
  const xxeXml = `<?xml version="1.0"?>
  <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
  <Response ID="resp_1"><Issuer>https://idp.example</Issuer><NameID>&xxe;</NameID></Response>`;
  const xxeBase64 = Buffer.from(xxeXml, 'utf8').toString('base64');
  const xxeParsed = parseSamlResponsePayload(xxeBase64);
  assert.equal(xxeParsed.ok, false);
  assert.match(xxeParsed.message, /forbidden XML declarations/i);

  // 2. Generate RSA keypair for testing
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const workspaceId = 'wks_saml_test';
  const url = new URL('http://127.0.0.1:4173/api/auth/sso/assertion');
  const expectedAudience = `http://127.0.0.1:4173/api/auth/sso/metadata/${workspaceId}`;
  const requestId = 'req_saml_123';

  const validXml = `<Response ID="resp_123" InResponseTo="${requestId}" Destination="http://127.0.0.1:4173/api/auth/sso/assertion">
    <Issuer>https://idp.example.com</Issuer>
    <SubjectConfirmationData InResponseTo="${requestId}" Recipient="http://127.0.0.1:4173/api/auth/sso/assertion" NotOnOrAfter="${new Date(Date.now() + 60000).toISOString()}" />
    <Conditions NotBefore="${new Date(Date.now() - 60000).toISOString()}" NotOnOrAfter="${new Date(Date.now() + 60000).toISOString()}">
      <Audience>${expectedAudience}</Audience>
    </Conditions>
    <NameID>sso.user@corporate.example.com</NameID>
    <Attribute Name="email"><AttributeValue>sso.user@corporate.example.com</AttributeValue></Attribute>
    <Attribute Name="name"><AttributeValue>SSO Test User</AttributeValue></Attribute>
  </Response>`;

  const validBase64 = Buffer.from(validXml, 'utf8').toString('base64');
  const parsed = parseSamlResponsePayload(validBase64);
  assert.equal(parsed.ok, true);

  // Sign the base64 payload using RSA-SHA256
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(validBase64);
  const signature = signer.sign(privateKey, 'base64');

  const workspaceConfig = {
    id: workspaceId,
    sso: {
      enabled: true,
      entityId: 'https://idp.example.com',
      x509Certificate: publicKey,
      allowedDomains: ['corporate.example.com']
    }
  };

  const context = {
    samlResponse: validBase64,
    detachedSignature: signature,
    url,
    workspace: workspaceConfig,
    request: { id: requestId, email: 'sso.user@corporate.example.com' }
  };

  // 3. Valid assertion passes
  const validResult = validateSsoAssertion(parsed.assertion, context);
  assert.equal(validResult.ok, true);
  assert.equal(validResult.email, 'sso.user@corporate.example.com');
  assert.equal(validResult.name, 'SSO Test User');

  // 4. Tampered payload rejects signature
  const tamperedContext = {
    ...context,
    detachedSignature: 'invalid_base64_sig'
  };
  const tamperedResult = validateSsoAssertion(parsed.assertion, tamperedContext);
  assert.equal(tamperedResult.ok, false);
  assert.equal(tamperedResult.code, 'invalid_saml_signature');

  // 5. Expired assertion rejects
  const expiredParsed = {
    ...parsed.assertion,
    notOnOrAfter: new Date(Date.now() - 1000).toISOString()
  };
  const expiredResult = validateSsoAssertion(expiredParsed, context);
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.code, 'saml_assertion_expired');

  // 6. Wrong audience rejects
  const wrongAudienceParsed = {
    ...parsed.assertion,
    audience: 'http://evil.example.com'
  };
  const wrongAudienceResult = validateSsoAssertion(wrongAudienceParsed, context);
  assert.equal(wrongAudienceResult.ok, false);
  assert.equal(wrongAudienceResult.code, 'invalid_saml_audience');

  // 7. Feature flag gating check over HTTP
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-saml-http-'));
  const dataFile = path.join(tempDir, 'state.json');

  // Start server without 'sso' feature
  process.env.FORMSPEAR_FEATURES = 'core';
  const server = createServer({ dataFile, disableWorker: true });
  t.after(async () => {
    delete process.env.FORMSPEAR_FEATURES;
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ssoStartRes = await fetch(`${baseUrl}/api/auth/sso/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com' })
  });
  assert.equal(ssoStartRes.status, 404);
  const ssoStartJson = await ssoStartRes.json();
  assert.equal(ssoStartJson.error.code, 'feature_disabled');
});
