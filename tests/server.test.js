const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');

function makeClient(baseUrl) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async request(route, options = {}) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: options.method || 'GET',
        headers: {
          'content-type': 'application/json',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(cookie ? { cookie } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await response.text();
      const payload = response.headers.get('content-type')?.includes('application/json') && text ? JSON.parse(text) : text;
      if (!response.ok) {
        const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    }
  };
}

async function makeWebhookReceiver(t) {
  const deliveries = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      deliveries.push({ headers: req.headers, body: JSON.parse(body || '{}') });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  return {
    url: `http://127.0.0.1:${server.address().port}/hook`,
    deliveries
  };
}

async function makeSmtpReceiver(t) {
  const messages = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let dataMode = false;
    let data = [];
    socket.setEncoding('utf8');
    socket.write('220 local.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (dataMode) {
          if (line === '.') {
            messages.push(data.join('\n'));
            data = [];
            dataMode = false;
            socket.write('250 queued\r\n');
          } else {
            data.push(line);
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-local.test\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (upper.startsWith('AUTH')) {
          socket.write('235 authenticated\r\n');
        } else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO')) {
          socket.write('250 ok\r\n');
        } else if (upper === 'DATA') {
          dataMode = true;
          socket.write('354 end with dot\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    port: server.address().port,
    messages
  };
}

async function makeOpenAiReceiver(t) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const taskPayload = JSON.parse(parsed.messages?.[1]?.content || '{}');
      requests.push({ headers: req.headers, body: parsed, task: taskPayload.task, payload: taskPayload.payload });
      const content = providerContent(taskPayload.task);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl_test',
        model: parsed.model || 'fake-model',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24 }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests
  };
}

async function makeOAuthReceiver(t) {
  const requests = [];
  const profiles = new Map();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
      requests.push({ method: req.method, path: url.pathname, headers: req.headers, body });
      if (url.pathname === '/token') {
        const params = new URLSearchParams(body);
        const code = params.get('code') || '';
        const email = code === 'existing' ? 'admin@example.test' : 'oauth-owner@example.test';
        profiles.set(`access_${code}`, {
          sub: `sub_${code || 'unknown'}`,
          email,
          email_verified: true,
          name: code === 'existing' ? 'Test Admin' : 'OAuth Owner',
          picture: 'https://images.example.test/avatar.png'
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: `access_${code}`, token_type: 'Bearer', expires_in: 3600 }));
        return;
      }
      if (url.pathname === '/userinfo') {
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const profile = profiles.get(token);
        if (!profile) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_token' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(profile));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>Fake OAuth authorization endpoint</body></html>');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    authUrl: `${baseUrl}/auth`,
    tokenUrl: `${baseUrl}/token`,
    userInfoUrl: `${baseUrl}/userinfo`,
    requests
  };
}

async function makeStripeReceiver(t) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      requests.push({ headers: req.headers, body, params });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.includes('/billing_portal/sessions')) {
        res.end(JSON.stringify({
          id: 'bps_test_formspear',
          object: 'billing_portal.session',
          url: 'https://billing.stripe.test/session/bps_test_formspear'
        }));
        return;
      }
      res.end(JSON.stringify({
        id: 'cs_test_formspear',
        object: 'checkout.session',
        status: 'open',
        url: 'https://checkout.stripe.test/session/cs_test_formspear'
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests
  };
}

function stripeSignature(secret, body, timestamp = '1700000000') {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function signedSamlResponse({ baseUrl, workspaceId, requestId, email, name, issuer, privateKey }) {
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60 * 1000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const acsUrl = `${baseUrl}/api/auth/sso/assertion`;
  const audience = `${baseUrl}/api/auth/sso/metadata/${workspaceId}`;
  const xml = [
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    ` ID="rsp_${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${testEscapeXml(acsUrl)}" InResponseTo="${testEscapeXml(requestId)}">`,
    `<saml:Issuer>${testEscapeXml(issuer)}</saml:Issuer>`,
    `<saml:Assertion ID="ast_${crypto.randomBytes(8).toString('hex')}" IssueInstant="${now.toISOString()}" Version="2.0">`,
    `<saml:Issuer>${testEscapeXml(issuer)}</saml:Issuer>`,
    '<saml:Subject>',
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${testEscapeXml(email)}</saml:NameID>`,
    `<saml:SubjectConfirmation><saml:SubjectConfirmationData InResponseTo="${testEscapeXml(requestId)}" Recipient="${testEscapeXml(acsUrl)}" NotOnOrAfter="${notOnOrAfter}"/></saml:SubjectConfirmation>`,
    '</saml:Subject>',
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${testEscapeXml(audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`,
    '<saml:AttributeStatement>',
    `<saml:Attribute Name="email"><saml:AttributeValue>${testEscapeXml(email)}</saml:AttributeValue></saml:Attribute>`,
    `<saml:Attribute Name="name"><saml:AttributeValue>${testEscapeXml(name)}</saml:AttributeValue></saml:Attribute>`,
    '</saml:AttributeStatement>',
    '</saml:Assertion>',
    '</samlp:Response>'
  ].join('');
  const response = Buffer.from(xml, 'utf8').toString('base64');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(response);
  signer.end();
  return { response, signature: signer.sign(privateKey, 'base64'), xml };
}

function testEscapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function makeObjectStorageReceiver(t) {
  const uploads = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      uploads.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end('<PutObjectResult />');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    uploads
  };
}

async function makeFileScanReceiver(t) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: 'clean',
        provider: 'fake_scan',
        signature: '',
        message: 'clean in test scanner'
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    url: `http://127.0.0.1:${server.address().port}/scan`,
    requests
  };
}

async function makeSslProvisionReceiver(t) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: 'active',
        provider: 'fake_ssl',
        certificateId: `cert_${String(parsed.customDomain || 'domain').replace(/[^a-z0-9]+/gi, '_')}`,
        provisionedAt: '2026-06-28T00:00:00.000Z',
        message: 'certificate active'
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    url: `http://127.0.0.1:${server.address().port}/ssl`,
    requests
  };
}

async function makeMonitoringReceiver(t) {
  const events = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      events.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    events
  };
}

function providerContent(task) {
  if (task === 'survey_generation') {
    return {
      title: 'Provider Generated Survey',
      description: 'Generated by the fake provider for acceptance coverage.',
      type: 'feedback_form',
      questions: [
        { id: 'provider_csat', type: 'csat', title: 'How satisfied are you with the provider flow?', required: true, settings: { scale: 5 }, validation: {} },
        { id: 'provider_text', type: 'long_text', title: 'What should we improve?', required: false, settings: {}, validation: {} },
        { id: 'provider_email', type: 'email', title: 'Email for follow-up', required: false, settings: {}, validation: {} }
      ],
      logic: [],
      completion: { type: 'message', message: 'Provider thanks you.' }
    };
  }
  if (task === 'question_improvement') {
    return {
      improvedTitle: 'How would you rate the visit experience?',
      suggestedType: 'csat',
      suggestedOptions: ['Very poor', 'Poor', 'Okay', 'Good', 'Excellent'],
      rationale: 'Provider made the wording neutral and measurable.'
    };
  }
  if (task === 'survey_summary') {
    return {
      headline: 'Provider summary: delays and follow-up are the dominant issues.',
      keyThemes: ['delays', 'follow-up', 'communication'],
      positiveThemes: ['clear staff communication'],
      negativeThemes: ['service delay'],
      recommendedActions: ['Escalate delay complaints within one business day.'],
      intentSummary: { complaint: 2, highIntent: 1 },
      intentClassifications: [{ responseId: 'provider_response', intent: 'Complaint', confidence: 0.9, excerpt: 'Delay needs attention.' }],
      responseClusters: [{ label: 'delay', value: 2, responseIds: ['provider_response'], example: 'Delay needs attention.' }],
      complaintClusters: [{ label: 'Service delay', value: 2, responseIds: ['provider_response'], example: 'Delay needs attention.' }]
    };
  }
  if (task === 'monthly_report') {
    return {
      title: 'Provider Monthly Feedback Report',
      topIssues: [{ label: 'service delay', value: 3 }],
      topOpportunities: [{ label: 'faster follow-up', value: 2 }],
      recommendedActions: ['Assign an owner to every high-intent complaint.'],
      importantQuotes: [{ responseId: 'provider_quote', sentiment: 'negative', excerpt: 'Delay needs attention.' }]
    };
  }
  return { ok: true };
}

test('FeedbackOS core MVP and V1 loops work over HTTP', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formspear-test-'));
  const dataFile = path.join(dir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true, enableTestFaults: true });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const admin = makeClient(baseUrl);
  const other = makeClient(baseUrl);
  const invited = makeClient(baseUrl);
  const editor = makeClient(baseUrl);
  const oauthClient = makeClient(baseUrl);
  const oauthExistingClient = makeClient(baseUrl);
  const ssoClient = makeClient(baseUrl);
  const ssoStrictClient = makeClient(baseUrl);
  const ssoRejectClient = makeClient(baseUrl);
  const ssoPasswordClient = makeClient(baseUrl);
  const ssoLoginAttempt = makeClient(baseUrl);
  const verificationClient = makeClient(baseUrl);
  const webhookReceiver = await makeWebhookReceiver(t);
  const integrationReceiver = await makeWebhookReceiver(t);
  const smtpReceiver = await makeSmtpReceiver(t);
  const oauthReceiver = await makeOAuthReceiver(t);
  const openAiReceiver = await makeOpenAiReceiver(t);
  const stripeReceiver = await makeStripeReceiver(t);
  const objectStorageReceiver = await makeObjectStorageReceiver(t);
  const fileScanReceiver = await makeFileScanReceiver(t);
  const sslProvisionReceiver = await makeSslProvisionReceiver(t);
  const monitoringReceiver = await makeMonitoringReceiver(t);
  const ssoKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ssoPublicKeyPem = ssoKeyPair.publicKey.export({ type: 'spki', format: 'pem' });
  const smtpEnvKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_SECURE'];
  const oauthEnvKeys = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_AUTH_URL', 'GOOGLE_OAUTH_TOKEN_URL', 'GOOGLE_OAUTH_USERINFO_URL', 'GOOGLE_OAUTH_REDIRECT_URI', 'GOOGLE_OAUTH_SCOPE'];
  const openAiEnvKeys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_TIMEOUT_MS', 'OPENAI_ALLOWED_MODELS', 'AI_PROVIDER_DPA_ACCEPTED', 'AI_PROVIDER_DPA_URL', 'AI_PROVIDER_DATA_RETENTION_DAYS'];
  const stripeEnvKeys = ['STRIPE_SECRET_KEY', 'STRIPE_BASE_URL', 'STRIPE_WEBHOOK_SECRET'];
  const billingPolicyEnvKeys = ['BILLING_TAX_MODE', 'BILLING_TAX_PERCENT', 'BILLING_PRORATION_POLICY', 'STRIPE_AUTOMATIC_TAX', 'STRIPE_TAX_ID_COLLECTION'];
  const storageEnvKeys = ['S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_PUBLIC_BASE_URL', 'S3_LIFECYCLE_DAYS'];
  const customDomainSslEnvKeys = ['CUSTOM_DOMAIN_SSL_PROVIDER_URL', 'CUSTOM_DOMAIN_SSL_PROVIDER_TOKEN', 'CUSTOM_DOMAIN_SSL_PROVIDER_NAME', 'CUSTOM_DOMAIN_SSL_TIMEOUT_MS'];
  const fileScanEnvKeys = ['FILE_SCAN_MODE', 'FILE_SCAN_PROVIDER_URL', 'FILE_SCAN_PROVIDER_TOKEN', 'FILE_SCAN_TIMEOUT_MS', 'FILE_SCAN_FAIL_OPEN', 'FILE_SCAN_BLOCKED_EXTENSIONS'];
  const monitoringEnvKeys = ['SENTRY_DSN', 'POSTHOG_KEY', 'POSTHOG_HOST', 'MONITORING_TIMEOUT_MS', 'UPTIME_CHECK_PROVIDER', 'UPTIME_CHECK_URL', 'MONITORING_ALERT_WEBHOOK_URL'];
  const cronEnvKeys = ['CRON_SECRET'];
  const previousSmtpEnv = Object.fromEntries(smtpEnvKeys.map((key) => [key, process.env[key]]));
  const previousOauthEnv = Object.fromEntries(oauthEnvKeys.map((key) => [key, process.env[key]]));
  const previousOpenAiEnv = Object.fromEntries(openAiEnvKeys.map((key) => [key, process.env[key]]));
  const previousStripeEnv = Object.fromEntries(stripeEnvKeys.map((key) => [key, process.env[key]]));
  const previousBillingPolicyEnv = Object.fromEntries(billingPolicyEnvKeys.map((key) => [key, process.env[key]]));
  const previousStorageEnv = Object.fromEntries(storageEnvKeys.map((key) => [key, process.env[key]]));
  const previousCustomDomainSslEnv = Object.fromEntries(customDomainSslEnvKeys.map((key) => [key, process.env[key]]));
  const previousFileScanEnv = Object.fromEntries(fileScanEnvKeys.map((key) => [key, process.env[key]]));
  const previousMonitoringEnv = Object.fromEntries(monitoringEnvKeys.map((key) => [key, process.env[key]]));
  const previousCronEnv = Object.fromEntries(cronEnvKeys.map((key) => [key, process.env[key]]));
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtpReceiver.port);
  process.env.SMTP_USER = 'smtp-user';
  process.env.SMTP_PASSWORD = 'smtp-password';
  process.env.SMTP_FROM = 'notifications@example.test';
  process.env.SMTP_SECURE = 'false';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client-test';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret-test';
  process.env.GOOGLE_OAUTH_AUTH_URL = oauthReceiver.authUrl;
  process.env.GOOGLE_OAUTH_TOKEN_URL = oauthReceiver.tokenUrl;
  process.env.GOOGLE_OAUTH_USERINFO_URL = oauthReceiver.userInfoUrl;
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://127.0.0.1/oauth-callback-test';
  process.env.GOOGLE_OAUTH_SCOPE = 'openid email profile';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_BASE_URL = openAiReceiver.baseUrl;
  process.env.OPENAI_MODEL = 'fake-feedback-model';
  process.env.OPENAI_TIMEOUT_MS = '5000';
  process.env.OPENAI_ALLOWED_MODELS = 'fake-feedback-model';
  process.env.AI_PROVIDER_DPA_ACCEPTED = 'true';
  process.env.AI_PROVIDER_DPA_URL = 'https://legal.example.test/openai-dpa';
  process.env.AI_PROVIDER_DATA_RETENTION_DAYS = '30';
  process.env.STRIPE_SECRET_KEY = 'sk_test_formspear';
  process.env.STRIPE_BASE_URL = stripeReceiver.baseUrl;
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_formspear';
  process.env.BILLING_TAX_MODE = 'exclusive';
  process.env.BILLING_TAX_PERCENT = '18';
  process.env.BILLING_PRORATION_POLICY = 'create_prorations';
  process.env.STRIPE_AUTOMATIC_TAX = 'true';
  process.env.STRIPE_TAX_ID_COLLECTION = 'true';
  process.env.S3_ACCESS_KEY = 's3-access-test';
  process.env.S3_SECRET_KEY = 's3-secret-test';
  process.env.S3_BUCKET = 'formspear-test-bucket';
  process.env.S3_REGION = 'auto';
  process.env.S3_ENDPOINT = objectStorageReceiver.endpoint;
  process.env.S3_PUBLIC_BASE_URL = 'https://cdn.formspear.test/uploads';
  process.env.S3_LIFECYCLE_DAYS = '365';
  process.env.CUSTOM_DOMAIN_SSL_PROVIDER_URL = sslProvisionReceiver.url;
  process.env.CUSTOM_DOMAIN_SSL_PROVIDER_TOKEN = 'ssl-token-test';
  process.env.CUSTOM_DOMAIN_SSL_PROVIDER_NAME = 'fake_ssl';
  process.env.CUSTOM_DOMAIN_SSL_TIMEOUT_MS = '2000';
  process.env.FILE_SCAN_MODE = 'provider';
  process.env.FILE_SCAN_PROVIDER_URL = fileScanReceiver.url;
  process.env.FILE_SCAN_PROVIDER_TOKEN = 'scan-token-test';
  process.env.FILE_SCAN_TIMEOUT_MS = '2000';
  process.env.FILE_SCAN_FAIL_OPEN = 'false';
  process.env.FILE_SCAN_BLOCKED_EXTENSIONS = 'exe,bat,cmd,ps1,sh,js';
  process.env.SENTRY_DSN = `${monitoringReceiver.endpoint.replace('http://', 'http://public@')}/1`;
  process.env.POSTHOG_KEY = 'phc_formspear';
  process.env.POSTHOG_HOST = monitoringReceiver.endpoint;
  process.env.MONITORING_TIMEOUT_MS = '2000';
  process.env.UPTIME_CHECK_PROVIDER = 'fake_uptime';
  process.env.UPTIME_CHECK_URL = `${baseUrl}/api/health`;
  process.env.MONITORING_ALERT_WEBHOOK_URL = `${monitoringReceiver.endpoint}/alerts`;
  process.env.CRON_SECRET = 'cron-secret-test';
  t.after(() => {
    for (const key of smtpEnvKeys) {
      if (previousSmtpEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousSmtpEnv[key];
    }
    for (const key of oauthEnvKeys) {
      if (previousOauthEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousOauthEnv[key];
    }
    for (const key of openAiEnvKeys) {
      if (previousOpenAiEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousOpenAiEnv[key];
    }
    for (const key of stripeEnvKeys) {
      if (previousStripeEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousStripeEnv[key];
    }
    for (const key of billingPolicyEnvKeys) {
      if (previousBillingPolicyEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousBillingPolicyEnv[key];
    }
    for (const key of storageEnvKeys) {
      if (previousStorageEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousStorageEnv[key];
    }
    for (const key of customDomainSslEnvKeys) {
      if (previousCustomDomainSslEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousCustomDomainSslEnv[key];
    }
    for (const key of fileScanEnvKeys) {
      if (previousFileScanEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousFileScanEnv[key];
    }
    for (const key of monitoringEnvKeys) {
      if (previousMonitoringEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousMonitoringEnv[key];
    }
    for (const key of cronEnvKeys) {
      if (previousCronEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousCronEnv[key];
    }
  });

  const signup = await admin.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Test Admin',
      email: 'admin@example.test',
      password: 'FeedbackOS123',
      workspaceName: 'Clinic Feedback',
      acceptTerms: true
    }
  });
  assert.equal(signup.user.platformRole, 'super_admin');
  const workspaceId = signup.workspaces[0].id;

  const otherSignup = await other.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Other User',
      email: 'other@example.test',
      password: 'FeedbackOS123',
      workspaceName: 'Other Tenant',
      acceptTerms: true
    }
  });
  assert.notEqual(otherSignup.workspaces[0].id, workspaceId);

  const oauthSignupStart = await oauthClient.request('/api/auth/oauth/google/start', {
    method: 'POST',
    body: {
      mode: 'signup',
      responseMode: 'json',
      name: 'OAuth Owner',
      workspaceName: 'OAuth Workspace',
      industry: 'SaaS',
      companySize: '1-10',
      acceptTerms: true
    }
  });
  assert.match(oauthSignupStart.oauth.authorizationUrl, /client_id=google-client-test/);
  const oauthSignupState = new URL(oauthSignupStart.oauth.authorizationUrl).searchParams.get('state');
  const oauthSignup = await oauthClient.request(`/api/auth/oauth/google/callback?state=${encodeURIComponent(oauthSignupState)}&code=new`, { method: 'GET' });
  assert.equal(oauthSignup.user.email, 'oauth-owner@example.test');
  assert.equal(oauthSignup.user.authProvider, 'google');
  assert.ok(oauthSignup.user.oauthProviders.includes('google'));
  assert.equal(oauthSignup.workspaces[0].name, 'OAuth Workspace');

  const oauthExistingStart = await oauthExistingClient.request('/api/auth/oauth/google/start', {
    method: 'POST',
    body: { mode: 'login', responseMode: 'json' }
  });
  const oauthExistingState = new URL(oauthExistingStart.oauth.authorizationUrl).searchParams.get('state');
  const oauthExistingLogin = await oauthExistingClient.request(`/api/auth/oauth/google/callback?state=${encodeURIComponent(oauthExistingState)}&code=existing`, { method: 'GET' });
  assert.equal(oauthExistingLogin.user.email, 'admin@example.test');
  assert.ok(oauthExistingLogin.user.oauthProviders.includes('google'));
  assert.ok(oauthReceiver.requests.some((request) => request.path === '/token'));
  assert.ok(oauthReceiver.requests.some((request) => request.path === '/userinfo'));

  await assert.rejects(
    () => other.request(`/api/agency/overview?workspaceId=${otherSignup.workspaces[0].id}`),
    (error) => error.status === 402 && error.payload.error.code === 'agency_plan_required'
  );

  await assert.rejects(
    () => makeClient(baseUrl).request('/api/auth/signup', {
      method: 'POST',
      body: {
        name: 'No Consent',
        email: 'no-consent@example.test',
        password: 'FeedbackOS123',
        workspaceName: 'No Consent Workspace'
      }
    }),
    (error) => error.status === 400 && error.payload.error.code === 'terms_required'
  );

  await assert.rejects(
    () => other.request(`/api/surveys?workspaceId=${workspaceId}`),
    (error) => error.status === 403
  );

  const brandedWorkspace = await admin.request(`/api/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: {
      customDomain: 'feedback.clinic.test',
      customCss: '.public-form { border: 4px solid #176B5B; }\n@import url("https://bad.example/theme.css");\n.bad { background: url(javascript:alert(1)); }',
      customFooterText: 'Private feedback system for Clinic Feedback.'
    }
  });
  assert.equal(brandedWorkspace.workspace.customDomain, 'feedback.clinic.test');
  assert.equal(brandedWorkspace.workspace.customDomainStatus, 'pending_dns');
  assert.match(brandedWorkspace.workspace.customDomainVerificationToken, /^[a-f0-9]{32}$/);
  assert.match(brandedWorkspace.workspace.customCss, /border: 4px solid #176B5B/);
  assert.doesNotMatch(brandedWorkspace.workspace.customCss, /@import|url|javascript:/i);
  assert.equal(brandedWorkspace.workspace.customFooterText, 'Private feedback system for Clinic Feedback.');
  await assert.rejects(
    () => admin.request(`/api/workspaces/${workspaceId}/custom-domain/provision-ssl`, { method: 'POST', body: {} }),
    (error) => error.status === 409 && error.payload.error.code === 'custom_domain_not_verified'
  );
  await assert.rejects(
    () => admin.request(`/api/workspaces/${workspaceId}/custom-domain/verify`, { method: 'POST', body: { txtRecord: 'feedbackos-site-verification=wrong' } }),
    (error) => error.status === 400 && error.payload.error.code === 'dns_verification_failed'
  );
  await assert.rejects(
    () => admin.request(`/api/workspaces/${workspaceId}/custom-domain/verify`, { method: 'POST', body: {} }),
    (error) => error.status === 400 && ['dns_lookup_failed', 'dns_verification_failed'].includes(error.payload.error.code)
  );
  const domainVerification = await admin.request(`/api/workspaces/${workspaceId}/custom-domain/verify`, {
    method: 'POST',
    body: { txtRecord: `feedbackos-site-verification=${brandedWorkspace.workspace.customDomainVerificationToken}` }
  });
  assert.equal(domainVerification.customDomain.status, 'verified_local');
  assert.equal(domainVerification.customDomain.sslStatus, 'pending_provider');
  assert.ok(domainVerification.customDomain.observedTxtRecords.includes(`feedbackos-site-verification=${brandedWorkspace.workspace.customDomainVerificationToken}`));
  assert.ok(domainVerification.customDomain.dnsCheckedAt);
  const domainSsl = await admin.request(`/api/workspaces/${workspaceId}/custom-domain/provision-ssl`, { method: 'POST', body: {} });
  assert.equal(domainSsl.customDomain.sslStatus, 'active');
  assert.equal(domainSsl.customDomain.sslProvider, 'fake_ssl');
  assert.match(domainSsl.customDomain.sslCertificateId, /^cert_feedback_clinic_test/);
  assert.ok(domainSsl.customDomain.sslProvisionedAt);
  assert.equal(sslProvisionReceiver.requests.length, 1);
  assert.equal(sslProvisionReceiver.requests[0].headers.authorization, 'Bearer ssl-token-test');
  assert.equal(sslProvisionReceiver.requests[0].body.customDomain, 'feedback.clinic.test');
  assert.equal(sslProvisionReceiver.requests[0].body.expectedTxt, `feedbackos-site-verification=${brandedWorkspace.workspace.customDomainVerificationToken}`);

  const templates = await admin.request('/api/templates');
  assert.ok(templates.templates.some((template) => template.id === 'customer-feedback'));

  const created = await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, templateId: 'customer-feedback' }
  });
  assert.equal(created.survey.status, 'draft');
  assert.ok(created.survey.schema.questions.length >= 4);

  const savedTemplate = await admin.request(`/api/surveys/${created.survey.id}/template`, {
    method: 'POST',
    body: {
      name: 'Clinic saved feedback template',
      category: 'clinic',
      industry: 'Healthcare',
      tags: 'clinic, complaints, csat',
      status: 'draft'
    }
  });
  assert.equal(savedTemplate.template.workspaceId, workspaceId);
  assert.equal(savedTemplate.template.status, 'draft');
  assert.ok(savedTemplate.template.tags.includes('complaints'));

  const workspaceTemplates = await admin.request(`/api/templates?workspaceId=${workspaceId}`);
  assert.ok(workspaceTemplates.templates.some((template) => template.id === savedTemplate.template.id));
  const otherWorkspaceTemplates = await other.request(`/api/templates?workspaceId=${otherSignup.workspaces[0].id}`);
  assert.ok(!otherWorkspaceTemplates.templates.some((template) => template.id === savedTemplate.template.id));

  const customTemplateSurvey = await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, templateId: savedTemplate.template.id }
  });
  assert.equal(customTemplateSurvey.survey.schema.questions.length, created.survey.schema.questions.length);
  const usedWorkspaceTemplates = await admin.request(`/api/templates?workspaceId=${workspaceId}`);
  assert.equal(usedWorkspaceTemplates.templates.find((template) => template.id === savedTemplate.template.id).usageCount, 1);

  const pagedSchema = JSON.parse(JSON.stringify(created.survey.schema));
  pagedSchema.questions = pagedSchema.questions.map((question, index) => ({
    ...question,
    settings: { ...question.settings, page: index < 2 ? 1 : 2 }
  }));
  pagedSchema.questions.push({ id: 'logic_segment', type: 'hidden', title: 'Logic segment', required: false, settings: {}, validation: {} });
  const conditionalTargetId = pagedSchema.questions[2].id;
  const npsQuestionId = pagedSchema.questions.find((question) => question.type === 'nps').id;
  const emailQuestionId = pagedSchema.questions.find((question) => question.type === 'email').id;
  pagedSchema.logic = [{
    id: 'logic_show_followup',
    questionId: pagedSchema.questions[0].id,
    operator: 'equals',
    value: '2',
    action: 'show_question',
    targetQuestionId: conditionalTargetId
  }, {
    id: 'logic_skip_to_email',
    questionId: pagedSchema.questions[0].id,
    operator: 'equals',
    value: '2',
    action: 'skip_to_question',
    targetQuestionId: emailQuestionId
  }, {
    id: 'logic_assign_tag',
    questionId: pagedSchema.questions[0].id,
    operator: 'equals',
    value: '2',
    action: 'assign_tag',
    actionValue: 'low-csat'
  }, {
    id: 'logic_set_hidden',
    questionId: pagedSchema.questions[0].id,
    operator: 'equals',
    value: '2',
    action: 'set_hidden_field',
    targetQuestionId: 'logic_segment',
    actionValue: 'needs-service-recovery'
  }, {
    id: 'logic_score',
    questionId: pagedSchema.questions[0].id,
    operator: 'equals',
    value: '2',
    action: 'calculate_score',
    scoreDelta: 30
  }, {
    id: 'logic_alert',
    questionId: pagedSchema.questions[0].id,
    operator: 'equals',
    value: '2',
    action: 'trigger_alert',
    actionValue: 'Low CSAT needs service recovery.'
  }, {
    id: 'logic_end_message',
    questionId: pagedSchema.questions[0].id,
    operator: 'equals',
    value: '2',
    action: 'end_survey',
    actionValue: 'Thanks. A manager will review this feedback.'
  }];
  const invalidSkipSchema = JSON.parse(JSON.stringify(pagedSchema));
  invalidSkipSchema.logic.push({
    id: 'logic_skip_backward',
    questionId: emailQuestionId,
    operator: 'is_not_empty',
    value: '',
    action: 'skip_to_question',
    targetQuestionId: pagedSchema.questions[0].id
  });
  await admin.request(`/api/surveys/${created.survey.id}`, {
    method: 'PUT',
    body: { schema: invalidSkipSchema }
  });
  await assert.rejects(
    () => admin.request(`/api/surveys/${created.survey.id}/publish`, { method: 'POST', body: {} }),
    (error) => error.status === 400 && error.payload.error.code === 'publish_validation_failed' && error.payload.error.details.includes('Skip logic must point to a later question.')
  );
  const pagedSurvey = await admin.request(`/api/surveys/${created.survey.id}`, {
    method: 'PUT',
    body: { schema: pagedSchema }
  });
  assert.equal(pagedSurvey.survey.schema.questions[0].settings.page, 1);
  assert.equal(pagedSurvey.survey.schema.questions.find((question) => question.id === conditionalTargetId).settings.page, 2);

  const generatedTranslation = await admin.request(`/api/surveys/${created.survey.id}/translations/generate`, {
    method: 'POST',
    body: { language: 'es' }
  });
  assert.equal(generatedTranslation.language, 'es');
  assert.ok(generatedTranslation.survey.schema.translations.es.title);
  assert.notEqual(generatedTranslation.survey.schema.translations.es.title, created.survey.schema.title);

  const aiSurvey = await admin.request('/api/ai/generate-survey', {
    method: 'POST',
    body: {
      workspaceId,
      goal: 'Measure onboarding satisfaction',
      audience: 'new users',
      industry: 'SaaS',
      questionCount: 4
    }
  });
  assert.match(aiSurvey.survey.id, /^srv_/);
  assert.equal(aiSurvey.survey.title, 'Provider Generated Survey');
  assert.equal(aiSurvey.job.outputJson.provider, 'openai_compatible');
  assert.equal(aiSurvey.job.outputJson.providerUsage.totalTokens, 24);

  const improvedQuestion = await admin.request('/api/ai/improve-question', {
    method: 'POST',
    body: {
      workspaceId,
      surveyId: created.survey.id,
      question: 'Did you love our amazing service?',
      mode: 'remove_bias'
    }
  });
  assert.equal(improvedQuestion.improved.aiGenerated, true);
  assert.equal(improvedQuestion.improved.provider, 'openai_compatible');
  assert.equal(improvedQuestion.improved.providerUsage.totalTokens, 24);
  assert.equal(improvedQuestion.improved.improvedTitle, 'How would you rate the visit experience?');

  const invite = await admin.request(`/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    body: { email: 'analyst@example.test', role: 'analyst' }
  });
  assert.match(invite.token, /^fo_inv_/);

  const accepted = await invited.request('/api/auth/invite-signup', {
    method: 'POST',
    body: {
      token: invite.token,
      name: 'Analyst',
      email: 'analyst@example.test',
      password: 'FeedbackOS123'
    }
  });
  assert.equal(accepted.workspaces.find((workspace) => workspace.id === workspaceId).role, 'analyst');

  const restrictedSurvey = await admin.request(`/api/surveys/${created.survey.id}/access`, {
    method: 'PUT',
    body: { accessMode: 'selected', accessRules: [] }
  });
  assert.equal(restrictedSurvey.survey.accessMode, 'selected');
  await assert.rejects(
    () => invited.request(`/api/surveys/${created.survey.id}`),
    (error) => error.status === 403 && error.payload.error.code === 'forbidden'
  );
  const grantedSurvey = await admin.request(`/api/surveys/${created.survey.id}/access`, {
    method: 'PUT',
    body: { accessMode: 'selected', accessRules: [{ userId: accepted.user.id, role: 'analyst' }] }
  });
  assert.equal(grantedSurvey.survey.accessRules[0].userId, accepted.user.id);
  const invitedSurvey = await invited.request(`/api/surveys/${created.survey.id}`);
  assert.equal(invitedSurvey.survey.id, created.survey.id);

  const membersBeforeUpdate = await admin.request(`/api/workspaces/${workspaceId}/members`);
  const ownerMember = membersBeforeUpdate.members.find((member) => member.role === 'owner');
  const invitedMember = membersBeforeUpdate.members.find((member) => member.userId === accepted.user.id);
  assert.ok(invitedMember);
  await assert.rejects(
    () => admin.request(`/api/workspaces/${workspaceId}/members/${ownerMember.id}`, { method: 'PUT', body: { role: 'viewer' } }),
    (error) => error.status === 400 && error.payload.error.code === 'owner_required'
  );
  const roleUpdate = await admin.request(`/api/workspaces/${workspaceId}/members/${invitedMember.id}`, {
    method: 'PUT',
    body: { role: 'viewer' }
  });
  assert.equal(roleUpdate.member.role, 'viewer');
  await assert.rejects(
    () => admin.request(`/api/workspaces/${workspaceId}/members/${invitedMember.id}`, { method: 'PUT', body: { role: 'owner' } }),
    (error) => error.status === 400 && error.payload.error.code === 'invalid_member_role'
  );
  await admin.request(`/api/workspaces/${workspaceId}/members/${invitedMember.id}`, { method: 'DELETE', body: {} });
  const membersAfterRemoval = await admin.request(`/api/workspaces/${workspaceId}/members`);
  assert.ok(!membersAfterRemoval.members.some((member) => member.userId === accepted.user.id));
  await assert.rejects(
    () => invited.request(`/api/surveys/${created.survey.id}`),
    (error) => error.status === 403 && error.payload.error.code === 'forbidden'
  );

  const editorInvite = await admin.request(`/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    body: { email: 'editor@example.test', role: 'editor' }
  });
  const editorAccepted = await editor.request('/api/auth/invite-signup', {
    method: 'POST',
    body: {
      token: editorInvite.token,
      name: 'Editor',
      email: 'editor@example.test',
      password: 'FeedbackOS123'
    }
  });
  assert.equal(editorAccepted.workspaces.find((workspace) => workspace.id === workspaceId).role, 'editor');
  const approvalSettings = await admin.request(`/api/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { requirePublishApproval: true }
  });
  assert.equal(approvalSettings.workspace.requirePublishApproval, true);
  await admin.request(`/api/workspaces/${workspaceId}/subscription`, {
    method: 'POST',
    body: { planId: 'growth', prorationPolicy: 'none' }
  });
  const approvalSurvey = await editor.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Editor Approval Survey' }
  });
  await assert.rejects(
    () => editor.request(`/api/surveys/${approvalSurvey.survey.id}/publish`, { method: 'POST', body: {} }),
    (error) => error.status === 409 && error.payload.error.code === 'approval_required'
  );
  const approvalRequest = await editor.request(`/api/surveys/${approvalSurvey.survey.id}/approval/request`, {
    method: 'POST',
    body: { note: 'Ready for launch review.' }
  });
  assert.equal(approvalRequest.survey.approvalStatus, 'pending');
  assert.equal(approvalRequest.approval.required, true);
  const approvalRejection = await admin.request(`/api/surveys/${approvalSurvey.survey.id}/approval/reject`, {
    method: 'POST',
    body: { note: 'Tighten the intro copy.' }
  });
  assert.equal(approvalRejection.survey.approvalStatus, 'rejected');
  await assert.rejects(
    () => editor.request(`/api/surveys/${approvalSurvey.survey.id}/publish`, { method: 'POST', body: {} }),
    (error) => error.status === 409 && error.payload.error.code === 'approval_required'
  );
  await editor.request(`/api/surveys/${approvalSurvey.survey.id}/approval/request`, {
    method: 'POST',
    body: { note: 'Updated and ready.' }
  });
  const approvalAccepted = await admin.request(`/api/surveys/${approvalSurvey.survey.id}/approval/approve`, {
    method: 'POST',
    body: { note: 'Approved.' }
  });
  assert.equal(approvalAccepted.survey.approvalStatus, 'approved');
  const editorPublished = await editor.request(`/api/surveys/${approvalSurvey.survey.id}/publish`, { method: 'POST', body: {} });
  assert.equal(editorPublished.survey.status, 'published');
  const editorCsv = await editor.request(`/api/surveys/${approvalSurvey.survey.id}/export.csv`);
  assert.match(editorCsv, /submitted_at/);
  const exportPolicyOwner = await admin.request(`/api/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { permissionPolicy: { responseExport: 'owner' } }
  });
  assert.equal(exportPolicyOwner.workspace.permissionPolicy.responseExport, 'owner');
  await assert.rejects(
    () => editor.request(`/api/surveys/${approvalSurvey.survey.id}/export.csv`),
    (error) => error.status === 403 && error.payload.error.code === 'forbidden'
  );
  const ownerCsv = await admin.request(`/api/surveys/${approvalSurvey.survey.id}/export.csv`);
  assert.match(ownerCsv, /submitted_at/);
  const exportPolicyRestored = await admin.request(`/api/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { permissionPolicy: { responseExport: 'analyst' } }
  });
  assert.equal(exportPolicyRestored.workspace.permissionPolicy.responseExport, 'analyst');
  const staleApprovalSurvey = await editor.request(`/api/surveys/${approvalSurvey.survey.id}`, {
    method: 'PUT',
    body: { title: 'Editor Approval Survey Revised' }
  });
  assert.equal(staleApprovalSurvey.survey.approvalStatus, 'stale');
  await assert.rejects(
    () => editor.request(`/api/surveys/${approvalSurvey.survey.id}/publish`, { method: 'POST', body: {} }),
    (error) => error.status === 409 && error.payload.error.code === 'approval_required'
  );

  const ssoInvite = await admin.request(`/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    body: { email: 'password@sso.test', role: 'viewer' }
  });
  await ssoPasswordClient.request('/api/auth/invite-signup', {
    method: 'POST',
    body: {
      token: ssoInvite.token,
      name: 'Password SSO User',
      email: 'password@sso.test',
      password: 'FeedbackOS123'
    }
  });
  const ssoSettings = await admin.request(`/api/workspaces/${workspaceId}/sso`, {
    method: 'PUT',
    body: {
      enabled: true,
      enforce: true,
      jitProvisioning: true,
      devMode: true,
      providerName: 'Clinic Okta',
      entityId: 'https://idp.sso.test/entity',
      ssoUrl: 'https://idp.sso.test/saml',
      allowedDomains: ['sso.test'],
      defaultRole: 'viewer',
      x509Certificate: ssoPublicKeyPem
    }
  });
  assert.equal(ssoSettings.sso.enabled, true);
  assert.equal(ssoSettings.sso.allowedDomains[0], 'sso.test');
  const ssoMetadata = await fetch(`${baseUrl}${ssoSettings.metadataUrl}`);
  assert.equal(ssoMetadata.status, 200);
  const ssoMetadataXml = await ssoMetadata.text();
  assert.match(ssoMetadataXml, /EntityDescriptor/);
  assert.match(ssoMetadataXml, /\/api\/auth\/sso\/assertion/);
  await assert.rejects(
    () => ssoLoginAttempt.request('/api/auth/login', { method: 'POST', body: { email: 'password@sso.test', password: 'FeedbackOS123' } }),
    (error) => error.status === 403 && error.payload.error.code === 'sso_required'
  );
  await assert.rejects(
    () => ssoClient.request('/api/auth/sso/start', { method: 'POST', body: { email: 'outsider@example.net' } }),
    (error) => error.status === 404 && error.payload.error.code === 'sso_not_configured'
  );
  const ssoStart = await ssoClient.request('/api/auth/sso/start', {
    method: 'POST',
    body: { email: 'jit@sso.test' }
  });
  assert.equal(ssoStart.sso.providerName, 'Clinic Okta');
  assert.match(ssoStart.sso.samlRequest, /^[A-Za-z0-9+/=]+$/);
  const ssoSession = await ssoClient.request('/api/auth/sso/dev-login', {
    method: 'POST',
    body: { requestId: ssoStart.sso.requestId, relayState: ssoStart.sso.relayState, email: 'jit@sso.test', name: 'JIT SSO User' }
  });
  const ssoWorkspace = ssoSession.workspaces.find((workspace) => workspace.id === workspaceId);
  assert.equal(ssoWorkspace.role, 'viewer');
  const strictStart = await ssoStrictClient.request('/api/auth/sso/start', {
    method: 'POST',
    body: { email: 'strict@sso.test' }
  });
  assert.match(Buffer.from(strictStart.sso.samlRequest, 'base64').toString('utf8'), /\/api\/auth\/sso\/assertion/);
  const strictAssertion = signedSamlResponse({
    baseUrl,
    workspaceId,
    requestId: strictStart.sso.requestId,
    email: 'strict@sso.test',
    name: 'Strict SSO User',
    issuer: 'https://idp.sso.test/entity',
    privateKey: ssoKeyPair.privateKey
  });
  const strictSession = await ssoStrictClient.request('/api/auth/sso/assertion', {
    method: 'POST',
    body: {
      SAMLResponse: strictAssertion.response,
      RelayState: strictStart.sso.relayState,
      Signature: strictAssertion.signature
    }
  });
  assert.equal(strictSession.user.email, 'strict@sso.test');
  const strictWorkspace = strictSession.workspaces.find((workspace) => workspace.id === workspaceId);
  assert.equal(strictWorkspace.role, 'viewer');
  const rejectStart = await ssoRejectClient.request('/api/auth/sso/start', {
    method: 'POST',
    body: { email: 'reject@sso.test' }
  });
  const rejectedAssertion = signedSamlResponse({
    baseUrl,
    workspaceId,
    requestId: rejectStart.sso.requestId,
    email: 'reject@sso.test',
    name: 'Reject SSO User',
    issuer: 'https://idp.sso.test/entity',
    privateKey: ssoKeyPair.privateKey
  });
  await assert.rejects(
    () => ssoRejectClient.request('/api/auth/sso/assertion', {
      method: 'POST',
      body: {
        SAMLResponse: rejectedAssertion.response,
        RelayState: rejectStart.sso.relayState,
        Signature: `${rejectedAssertion.signature.slice(0, -8)}tampered`
      }
    }),
    (error) => error.status === 403 && error.payload.error.code === 'invalid_saml_signature'
  );

  const sessions = await admin.request('/api/sessions');
  assert.equal(sessions.sessions.filter((session) => session.current).length, 1);
  assert.ok(sessions.sessions.length >= 1);

  const rememberedClient = makeClient(baseUrl);
  await rememberedClient.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@example.test', password: 'FeedbackOS123', rememberMe: true }
  });
  const rememberedSessions = await rememberedClient.request('/api/sessions');
  const rememberedSession = rememberedSessions.sessions.find((session) => session.current);
  assert.equal(rememberedSession.remembered, true);
  assert.ok(new Date(rememberedSession.expiresAt).getTime() - new Date(rememberedSession.createdAt).getTime() > 1000 * 60 * 60 * 24 * 20);
  await admin.request(`/api/sessions/${rememberedSession.id}`, { method: 'DELETE', body: {} });

  const updatedProfile = await admin.request('/api/profile', {
    method: 'PUT',
    body: { name: 'Updated Admin', timezone: 'Asia/Kolkata', notificationPreferences: { emailAlerts: false } }
  });
  assert.equal(updatedProfile.user.name, 'Updated Admin');

  const twoFactorSetup = await admin.request('/api/profile/2fa/setup', { method: 'POST', body: {} });
  assert.match(twoFactorSetup.setup.secret, /^[A-Z2-7]+$/);
  assert.match(twoFactorSetup.setup.currentCode, /^\d{6}$/);
  await assert.rejects(
    () => admin.request('/api/profile/2fa/enable', { method: 'POST', body: { code: '000000' } }),
    (error) => error.status === 400 && error.payload.error.code === 'invalid_two_factor_code'
  );
  const twoFactorEnabled = await admin.request('/api/profile/2fa/enable', {
    method: 'POST',
    body: { code: twoFactorSetup.setup.currentCode }
  });
  assert.equal(twoFactorEnabled.user.twoFactorEnabled, true);
  assert.equal(twoFactorEnabled.recoveryCodes.length, 8);

  const twoFactorLogin = makeClient(baseUrl);
  const twoFactorChallenge = await twoFactorLogin.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@example.test', password: 'FeedbackOS123' }
  });
  assert.equal(twoFactorChallenge.requiresTwoFactor, true);
  assert.match(twoFactorChallenge.challengeToken, /^fo_2fa_/);
  await assert.rejects(
    () => twoFactorLogin.request('/api/auth/2fa/verify', {
      method: 'POST',
      body: {
        challengeId: twoFactorChallenge.challengeId,
        challengeToken: twoFactorChallenge.challengeToken,
        code: '111111'
      }
    }),
    (error) => error.status === 401 && error.payload.error.code === 'invalid_two_factor_code'
  );
  const twoFactorSession = await twoFactorLogin.request('/api/auth/2fa/verify', {
    method: 'POST',
    body: {
      challengeId: twoFactorChallenge.challengeId,
      challengeToken: twoFactorChallenge.challengeToken,
      code: twoFactorSetup.setup.currentCode
    }
  });
  assert.equal(twoFactorSession.user.twoFactorEnabled, true);
  assert.equal((await twoFactorLogin.request('/api/session')).user.email, 'admin@example.test');

  const twoFactorDisabled = await admin.request('/api/profile/2fa/disable', {
    method: 'POST',
    body: { password: 'FeedbackOS123' }
  });
  assert.equal(twoFactorDisabled.user.twoFactorEnabled, false);
  const postDisableLogin = await makeClient(baseUrl).request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@example.test', password: 'FeedbackOS123' }
  });
  assert.equal(postDisableLogin.user.email, 'admin@example.test');
  const adminSessionsAfterTwoFactorTest = await admin.request('/api/sessions');
  for (const session of adminSessionsAfterTwoFactorTest.sessions.filter((item) => !item.current)) {
    await admin.request(`/api/sessions/${session.id}`, { method: 'DELETE', body: {} });
  }

  const resetRequest = await admin.request('/api/auth/password-reset/request', {
    method: 'POST',
    body: { email: 'analyst@example.test' }
  });
  assert.match(resetRequest.resetToken, /^fo_reset_/);

  await admin.request('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: { token: resetRequest.resetToken, password: 'NewFeedbackOS123' }
  });

  const apiKeyResult = await admin.request(`/api/workspaces/${workspaceId}/api-keys`, {
    method: 'POST',
    body: {
      name: 'Acceptance test key',
      scopes: ['surveys:read', 'surveys:write', 'responses:read', 'responses:write', 'analytics:read', 'contacts:read', 'contacts:write', 'webhooks:read', 'webhooks:write']
    }
  });
  assert.match(apiKeyResult.token, /^fo_live_/);
  const originalApiToken = apiKeyResult.token;
  const rotatedApiKey = await admin.request(`/api/workspaces/${workspaceId}/api-keys/${apiKeyResult.apiKey.id}/rotate`, {
    method: 'POST',
    body: {}
  });
  assert.equal(rotatedApiKey.apiKey.id, apiKeyResult.apiKey.id);
  assert.match(rotatedApiKey.token, /^fo_live_/);
  assert.notEqual(rotatedApiKey.token, originalApiToken);
  let apiToken = rotatedApiKey.token;

  await admin.request('/api/alerts', {
    method: 'POST',
    body: {
      workspaceId,
      surveyId: created.survey.id,
      name: 'Negative feedback alert',
      condition: { type: 'negative_sentiment' },
      channels: { email: true, emailTo: 'ops@example.test', inApp: true }
    }
  });

  await admin.request('/api/integrations', {
    method: 'POST',
    body: {
      workspaceId,
      type: 'webhook',
      url: webhookReceiver.url,
      events: ['response.completed']
    }
  });

  await admin.request('/api/integrations', {
    method: 'POST',
    body: {
      workspaceId,
      type: 'google_sheets',
      name: 'Response sheet sync',
      config: { sheetId: 'sheet_acceptance' }
    }
  });

  await admin.request('/api/integrations', {
    method: 'POST',
    body: {
      workspaceId,
      type: 'slack',
      name: 'Slack complaint alerts',
      config: { channel: '#feedback', webhookUrl: integrationReceiver.url, signingSecret: 'integration-secret' }
    }
  });

  const published = await admin.request(`/api/surveys/${created.survey.id}/publish`, { method: 'POST', body: {} });
  assert.equal(published.survey.status, 'published');

  const qrResponse = await fetch(`${baseUrl}/api/surveys/${created.survey.id}/qr.svg`, {
    headers: { cookie: admin.cookie }
  });
  assert.equal(qrResponse.status, 200);
  assert.match(qrResponse.headers.get('content-type'), /image\/svg\+xml/);
  const qrSvg = await qrResponse.text();
  assert.match(qrSvg, /data-qr-version="6"/);
  assert.match(qrSvg, new RegExp(`/s/${published.survey.slug}`));
  assert.ok((qrSvg.match(/class="qr-module"/g) || []).length > 300);
  assert.match(qrSvg, /Scannable QR code/);
  assert.doesNotMatch(qrSvg, /Clickable share code/);

  const campaign = await admin.request('/api/campaigns', {
    method: 'POST',
    body: {
      workspaceId,
      surveyId: created.survey.id,
      name: 'Feedback invite',
      subject: 'Please share feedback',
      message: 'Your feedback helps us improve.',
      contacts: 'one@example.test\ntwo@example.test'
    }
  });
  assert.equal(campaign.campaign.contacts.length, 2);
  assert.match(campaign.campaign.contacts[0].emailHash, /^[a-f0-9]{24}$/);

  await assert.rejects(
    () => admin.request('/api/v1/surveys', { token: originalApiToken }),
    (error) => error.status === 401 && error.payload.error.code === 'invalid_api_key'
  );
  const apiSurveys = await admin.request('/api/v1/surveys', { token: apiToken });
  assert.ok(apiSurveys.surveys.some((survey) => survey.id === approvalSurvey.survey.id));
  assert.ok(apiSurveys.surveys.length >= 4);

  const adminTemplate = await admin.request('/api/admin/templates', {
    method: 'POST',
    body: {
      name: 'Global churn reason template',
      description: 'Collect cancellation reasons and next-step signals.',
      type: 'product_feedback',
      category: 'saas',
      industry: 'SaaS',
      useCase: 'Churn survey',
      tags: 'saas, churn',
      status: 'draft'
    }
  });
  assert.equal(adminTemplate.template.status, 'draft');
  const editedAdminTemplate = await admin.request(`/api/admin/templates/${adminTemplate.template.id}`, {
    method: 'PUT',
    body: { status: 'published', tags: 'saas, churn, retention', category: 'retention' }
  });
  assert.equal(editedAdminTemplate.template.status, 'published');
  assert.equal(editedAdminTemplate.template.category, 'retention');
  assert.ok(editedAdminTemplate.template.tags.includes('retention'));
  const marketplaceTemplates = await admin.request(`/api/templates?workspaceId=${workspaceId}`);
  assert.ok(marketplaceTemplates.templates.some((template) => template.id === adminTemplate.template.id));
  const apiTemplateSurvey = await admin.request('/api/v1/surveys', {
    method: 'POST',
    token: apiToken,
    body: { title: 'API Global Template Survey', templateId: adminTemplate.template.id }
  });
  assert.equal(apiTemplateSurvey.survey.title, 'API Global Template Survey');
  const adminTemplatesAfterUse = await admin.request('/api/admin/templates');
  assert.equal(adminTemplatesAfterUse.templates.find((template) => template.id === adminTemplate.template.id).usageCount, 1);
  const unpublishedTemplate = await admin.request(`/api/admin/templates/${adminTemplate.template.id}`, {
    method: 'PUT',
    body: { status: 'draft' }
  });
  assert.equal(unpublishedTemplate.template.status, 'draft');
  const hiddenMarketplaceTemplates = await admin.request(`/api/templates?workspaceId=${workspaceId}`);
  assert.ok(!hiddenMarketplaceTemplates.templates.some((template) => template.id === adminTemplate.template.id));

  const apiManagedSurvey = await admin.request('/api/v1/surveys', {
    method: 'POST',
    token: apiToken,
    body: { title: 'API Managed Survey', templateId: 'customer-feedback' }
  });
  assert.equal(apiManagedSurvey.survey.title, 'API Managed Survey');
  const apiUpdatedSurvey = await admin.request(`/api/v1/surveys/${apiManagedSurvey.survey.id}`, {
    method: 'PUT',
    token: apiToken,
    body: { title: 'API Managed Survey Updated' }
  });
  assert.equal(apiUpdatedSurvey.survey.title, 'API Managed Survey Updated');
  await assert.rejects(
    () => admin.request(`/api/v1/surveys/${apiManagedSurvey.survey.id}/publish`, { method: 'POST', token: apiToken, body: {} }),
    (error) => error.status === 409 && error.payload.error.code === 'approval_required'
  );
  await admin.request(`/api/surveys/${apiManagedSurvey.survey.id}/approval/approve`, {
    method: 'POST',
    body: { note: 'API managed survey approved.' }
  });
  const apiPublishedSurvey = await admin.request(`/api/v1/surveys/${apiManagedSurvey.survey.id}/publish`, { method: 'POST', token: apiToken, body: {} });
  assert.equal(apiPublishedSurvey.survey.status, 'published');
  const apiPausedSurvey = await admin.request(`/api/v1/surveys/${apiManagedSurvey.survey.id}/pause`, { method: 'POST', token: apiToken, body: {} });
  assert.equal(apiPausedSurvey.survey.status, 'paused');
  const apiArchivedSurvey = await admin.request(`/api/v1/surveys/${apiManagedSurvey.survey.id}`, { method: 'DELETE', token: apiToken, body: {} });
  assert.equal(apiArchivedSurvey.survey.status, 'archived');

  const apiWebhook = await admin.request('/api/v1/webhooks', {
    method: 'POST',
    token: apiToken,
    body: { url: webhookReceiver.url, events: ['response.completed'] }
  });
  assert.equal(apiWebhook.webhook.active, true);
  const apiWebhooks = await admin.request('/api/v1/webhooks', { token: apiToken });
  assert.ok(apiWebhooks.webhooks.some((webhook) => webhook.id === apiWebhook.webhook.id));
  await admin.request(`/api/v1/webhooks/${apiWebhook.webhook.id}`, { method: 'DELETE', token: apiToken, body: {} });

  const inAppSurvey = await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'In-app Onboarding Pulse' }
  });
  const configuredInApp = await admin.request(`/api/surveys/${inAppSurvey.survey.id}`, {
    method: 'PUT',
    body: {
      type: 'in_app_survey',
      settings: {
        inAppTriggerEvent: 'onboarding_done',
        inAppTargetPath: '/app/onboarding',
        inAppAudienceProperty: 'plan',
        inAppAudienceValue: 'pro',
        inAppFrequencyDays: 7
      }
    }
  });
  const publishedInApp = await admin.request(`/api/surveys/${configuredInApp.survey.id}/publish`, { method: 'POST', body: {} });
  const inAppMatch = await admin.request('/api/public/in-app/resolve', {
    method: 'POST',
    body: { eventName: 'onboarding_done', path: '/app/onboarding/complete', attributes: { plan: 'pro' }, userId: 'user_123' }
  });
  assert.equal(inAppMatch.survey.slug, publishedInApp.survey.slug);
  assert.equal(inAppMatch.survey.frequencyDays, 7);
  const inAppMiss = await admin.request('/api/public/in-app/resolve', {
    method: 'POST',
    body: { eventName: 'onboarding_done', path: '/app/onboarding/complete', attributes: { plan: 'starter' }, userId: 'user_456' }
  });
  assert.equal(inAppMiss.survey, null);

  const publicSurvey = await admin.request(`/api/public/surveys/${published.survey.slug}`);
  assert.match(publicSurvey.survey.branding.customCss, /border: 4px solid #176B5B/);
  assert.doesNotMatch(publicSurvey.survey.branding.customCss, /@import|url|javascript:/i);
  assert.equal(publicSurvey.survey.branding.footerText, 'Private feedback system for Clinic Feedback.');
  assert.deepEqual([...new Set(publicSurvey.survey.schema.questions.filter((question) => question.type !== 'hidden').map((question) => question.settings.page))], [1, 2]);
  const spanishPublicSurvey = await admin.request(`/api/public/surveys/${published.survey.slug}?lang=es`);
  assert.equal(spanishPublicSurvey.survey.language, 'es');
  assert.equal(spanishPublicSurvey.survey.schema.title, generatedTranslation.survey.schema.translations.es.title);
  const answers = {};
  for (const question of publicSurvey.survey.schema.questions) {
    if (question.type === 'csat') answers[question.id] = '2';
    if (question.type === 'nps') answers[question.id] = '4';
    if (question.type === 'long_text') answers[question.id] = 'The service was slow and I had a complaint about delays.';
    if (question.type === 'email') answers[question.id] = 'patient@example.test';
    if (question.type === 'consent') answers[question.id] = true;
  }

  const partial = await admin.request(`/api/public/surveys/${published.survey.slug}/responses/start`, {
    method: 'POST',
    body: { answers: {}, metadata: { source: 'website', branch: 'North Clinic', location: 'Pune' } }
  });
  assert.equal(partial.status, 'started');
  assert.match(partial.resumeToken, /^fo_resume_/);
  assert.ok(!partial.visibleQuestions.includes(conditionalTargetId));

  const partialDraftAnswers = { [publicSurvey.survey.schema.questions[0].id]: '2' };
  const savedPartial = await admin.request(`/api/public/surveys/${published.survey.slug}/responses/${partial.responseId}`, {
    method: 'PATCH',
    body: { answers: partialDraftAnswers, resumeToken: partial.resumeToken, metadata: { source: 'website', branch: 'North Clinic', location: 'Pune' } }
  });
  assert.equal(savedPartial.status, 'partial');
  assert.ok(savedPartial.visibleQuestions.includes(emailQuestionId));
  assert.ok(!savedPartial.visibleQuestions.includes(npsQuestionId));
  assert.ok(!savedPartial.visibleQuestions.includes(conditionalTargetId));
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${published.survey.slug}/responses/${partial.responseId}?resumeToken=wrong`),
    (error) => error.status === 404 && error.payload.error.code === 'response_not_found'
  );
  const restoredPartial = await admin.request(`/api/public/surveys/${published.survey.slug}/responses/${partial.responseId}?resumeToken=${partial.resumeToken}`);
  assert.equal(restoredPartial.answers[publicSurvey.survey.schema.questions[0].id], '2');
  assert.equal(restoredPartial.status, 'partial');
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${published.survey.slug}/responses/${partial.responseId}/send-resume`, {
      method: 'POST',
      body: { email: 'resume@example.test', resumeToken: 'wrong' }
    }),
    (error) => error.status === 404 && error.payload.error.code === 'response_not_found'
  );
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${published.survey.slug}/responses/${partial.responseId}/send-resume`, {
      method: 'POST',
      body: { email: 'not-an-email', resumeToken: partial.resumeToken }
    }),
    (error) => error.status === 400 && error.payload.error.code === 'invalid_resume_email'
  );
  const resumeEmail = await admin.request(`/api/public/surveys/${published.survey.slug}/responses/${partial.responseId}/send-resume`, {
    method: 'POST',
    body: { email: 'resume@example.test', resumeToken: partial.resumeToken }
  });
  assert.equal(resumeEmail.ok, true);
  assert.equal(resumeEmail.resumeExpiresAt, partial.resumeExpiresAt);

  const completedPartial = await admin.request(`/api/public/surveys/${published.survey.slug}/responses/${partial.responseId}`, {
    method: 'PATCH',
    body: { answers, complete: true, resumeToken: partial.resumeToken, metadata: { source: 'website', branch: 'North Clinic', location: 'Pune' } }
  });
  assert.equal(completedPartial.status, 'completed');
  assert.equal(completedPartial.completion.message, 'Thanks. A manager will review this feedback.');
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${published.survey.slug}/responses/${partial.responseId}?resumeToken=${partial.resumeToken}`),
    (error) => error.status === 404 && error.payload.error.code === 'response_not_found'
  );

  const submitted = await admin.request(`/api/public/surveys/${published.survey.slug}/responses`, {
    method: 'POST',
    body: { answers, metadata: { source: 'qr', branch: 'South Clinic', location: 'Mumbai' } }
  });
  assert.match(submitted.responseId, /^rsp_/);

  const apiSubmitted = await admin.request(`/api/v1/surveys/${created.survey.id}/responses`, {
    method: 'POST',
    token: apiToken,
    body: { answers, metadata: { source: 'api', branch: 'North Clinic', location: 'Pune' } }
  });
  assert.equal(apiSubmitted.response.sentiment, 'negative');

  const responses = await admin.request(`/api/surveys/${created.survey.id}/responses`);
  assert.equal(responses.responses.length, 3);
  assert.equal(responses.responses[0].sentiment, 'negative');
  assert.ok(responses.responses[0].tagsJson.includes('low-csat'));
  assert.equal(responses.responses[0].answersJson.logic_segment, 'needs-service-recovery');
  assert.ok(responses.responses[0].leadScore >= 80);

  const filteredResponses = await admin.request(`/api/surveys/${created.survey.id}/responses?status=completed&sentiment=negative&source=qr&q=delays&limit=10`);
  assert.equal(filteredResponses.total, 1);
  assert.equal(filteredResponses.responses[0].metadataJson.source, 'qr');

  const apiFilteredResponses = await admin.request(`/api/v1/responses?surveyId=${created.survey.id}&tag=api`, { token: apiToken });
  assert.equal(apiFilteredResponses.total, 1);
  assert.ok(apiFilteredResponses.responses[0].tagsJson.includes('api'));
  const apiResponseDetail = await admin.request(`/api/v1/responses/${apiFilteredResponses.responses[0].id}`, { token: apiToken });
  assert.equal(apiResponseDetail.response.id, apiFilteredResponses.responses[0].id);
  const apiPatchedResponse = await admin.request(`/api/v1/responses/${apiFilteredResponses.responses[0].id}`, {
    method: 'PATCH',
    token: apiToken,
    body: { addTag: 'api-reviewed' }
  });
  assert.ok(apiPatchedResponse.response.tagsJson.includes('api-reviewed'));

  const responseDetail = await admin.request(`/api/surveys/${created.survey.id}/responses/${responses.responses[0].id}`);
  assert.equal(responseDetail.response.aiSummary.aiGenerated, true);

  const responsePdf = await fetch(`${baseUrl}/api/surveys/${created.survey.id}/responses/${responses.responses[0].id}/export.pdf`, {
    headers: { cookie: admin.cookie }
  });
  assert.equal(responsePdf.status, 200);
  assert.match(responsePdf.headers.get('content-type'), /application\/pdf/);
  assert.match(responsePdf.headers.get('content-disposition'), /attachment/);
  assert.ok(Buffer.from(await responsePdf.arrayBuffer()).toString('latin1').startsWith('%PDF-1.4'));

  const updatedResponse = await admin.request(`/api/surveys/${created.survey.id}/responses/${responses.responses[0].id}`, {
    method: 'PATCH',
    body: { addTag: 'vip', note: 'Follow up today.', important: true, anonymize: true }
  });
  assert.equal(updatedResponse.response.important, true);
  assert.ok(updatedResponse.response.tagsJson.includes('vip'));
  assert.ok(updatedResponse.response.tagsJson.includes('anonymized'));
  assert.equal(updatedResponse.response.respondentId, null);
  assert.equal(updatedResponse.response.internalNotes.length, 1);

  const analytics = await admin.request(`/api/surveys/${created.survey.id}/analytics`);
  assert.equal(analytics.analytics.totals.completions, 3);
  assert.equal(analytics.analytics.sentiment.negative, 3);
  assert.equal(analytics.analytics.byBranch.find((item) => item.label === 'North Clinic').value, 2);
  assert.equal(analytics.analytics.byLocation.find((item) => item.label === 'Pune').value, 2);
  assert.equal(analytics.analytics.funnel.startToCompletionRate, 100);
  assert.equal(analytics.analytics.funnel.steps.find((step) => step.id === 'completions').count, 3);
  assert.equal(analytics.analytics.channelConversion.find((item) => item.label === 'website').conversionRate, 100);
  assert.equal(analytics.analytics.channelConversion.find((item) => item.label === 'api').starts, 1);
  const firstQuestionDropOff = analytics.analytics.questionDropOff.find((item) => item.id === publicSurvey.survey.schema.questions[0].id);
  assert.equal(firstQuestionDropOff.reached, 3);
  assert.equal(firstQuestionDropOff.answered, 3);
  assert.equal(firstQuestionDropOff.answerRate, 100);

  const analyticsComparison = await admin.request(`/api/surveys/${created.survey.id}/analytics?from=2020-01-01&to=2030-01-01&compareFrom=2000-01-01&compareTo=2000-01-02`);
  assert.equal(analyticsComparison.analytics.totals.completions, 3);
  assert.equal(analyticsComparison.analytics.comparison.previous.completions, 0);
  assert.equal(analyticsComparison.analytics.comparison.deltaCompletions, 3);

  const benchmark = await admin.request(`/api/analytics/benchmark?workspaceId=${workspaceId}`);
  const createdBenchmark = benchmark.benchmarks.find((item) => item.surveyId === created.survey.id);
  assert.equal(createdBenchmark.completions, 3);
  assert.ok(benchmark.sources.some((item) => item.label === 'api'));
  assert.equal(benchmark.branches.find((item) => item.label === 'North Clinic').value, 2);
  assert.equal(benchmark.locations.find((item) => item.label === 'Mumbai').value, 1);

  const apiAnalytics = await admin.request(`/api/v1/surveys/${created.survey.id}/analytics`, { token: apiToken });
  assert.equal(apiAnalytics.analytics.totals.completions, 3);

  const ai = await admin.request(`/api/surveys/${created.survey.id}/ai-summary`, { method: 'POST', body: {} });
  assert.equal(ai.summary.aiGenerated, true);
  assert.equal(ai.summary.provider, 'openai_compatible');
  assert.equal(ai.summary.providerUsage.totalTokens, 24);
  assert.match(ai.summary.headline, /Provider summary/);
  assert.ok(ai.summary.recommendedActions.length > 0);
  assert.equal(ai.summary.intentSummary.Complaint, 2);
  assert.equal(ai.summary.intentSummary['High intent'], 1);
  assert.equal(ai.summary.intentClassifications[0].intent, 'Complaint');
  assert.equal(ai.summary.complaintClusters[0].label, 'Service delay');
  assert.equal(ai.summary.responseClusters[0].label, 'delay');

  const monthlyReport = await admin.request('/api/ai/monthly-report', {
    method: 'POST',
    body: { workspaceId, month: new Date().toISOString().slice(0, 7) }
  });
  assert.equal(monthlyReport.report.aiGenerated, true);
  assert.equal(monthlyReport.report.provider, 'openai_compatible');
  assert.equal(monthlyReport.report.title, 'Provider Monthly Feedback Report');
  assert.equal(monthlyReport.report.totalResponses, 3);
  assert.match(monthlyReport.report.pdfUrl, /\.pdf$/);

  const monthlyReportPdf = await fetch(`${baseUrl}${monthlyReport.report.pdfUrl}`, {
    headers: { cookie: admin.cookie }
  });
  assert.equal(monthlyReportPdf.status, 200);
  assert.match(monthlyReportPdf.headers.get('content-type'), /application\/pdf/);
  const monthlyReportPdfText = Buffer.from(await monthlyReportPdf.arrayBuffer()).toString('latin1');
  assert.ok(monthlyReportPdfText.startsWith('%PDF-1.4'));
  assert.match(monthlyReportPdfText, /Executive summary/);
  assert.match(monthlyReportPdfText, /Recommended actions/);
  assert.match(monthlyReportPdfText, /Important customer quotes/);

  const reports = await admin.request(`/api/ai/monthly-reports/${workspaceId}`);
  assert.equal(reports.reports.length, 1);
  assert.match(reports.reports[0].pdfUrl, /\.pdf$/);

  const scheduledReportJob = await admin.request('/api/ai/monthly-report/schedule', {
    method: 'POST',
    body: {
      workspaceId,
      month: new Date().toISOString().slice(0, 7),
      recipients: 'owner@example.test, ops@example.test',
      nextRunAt: new Date(Date.now() - 1000).toISOString()
    }
  });
  assert.equal(scheduledReportJob.job.type, 'monthly_report');

  const csv = await admin.request(`/api/surveys/${created.survey.id}/export.csv`);
  assert.match(csv, /response_id,status,submitted_at/);
  assert.match(csv, /patient@example.test/);

  const xlsxResponse = await fetch(`${baseUrl}/api/surveys/${created.survey.id}/export.xlsx`, {
    headers: { cookie: admin.cookie }
  });
  assert.equal(xlsxResponse.status, 200);
  assert.match(xlsxResponse.headers.get('content-type'), /spreadsheetml\.sheet/);
  assert.match(xlsxResponse.headers.get('content-disposition'), /responses\.xlsx/);
  const xlsxBuffer = Buffer.from(await xlsxResponse.arrayBuffer());
  assert.equal(xlsxBuffer.slice(0, 2).toString('latin1'), 'PK');
  assert.ok(xlsxBuffer.length > 1000);

  const jsonExport = await admin.request(`/api/surveys/${created.survey.id}/export.json`);
  assert.equal(jsonExport.responses.length, 3);

  await admin.request(`/api/workspaces/${workspaceId}/subscription`, {
    method: 'POST',
    body: { planId: 'growth' }
  });

  const secureSurvey = await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Secure Upload Form' }
  });
  const secureSchema = {
    title: 'Secure Upload Form',
    description: 'Protected survey with upload and duplicate controls.',
    questions: [
      { id: 'secure_email', type: 'email', title: 'Email address', required: true, settings: { placeholder: 'you@example.test' }, validation: {} },
      { id: 'secure_file', type: 'file_upload', title: 'Attach notes', required: true, settings: { allowedFileTypes: ['txt'], maxSizeMB: 1 }, validation: {} }
    ],
    logic: [],
    translations: {
      hi: {
        title: 'सुरक्षित अपलोड फॉर्म',
        description: 'पासवर्ड वाला सर्वे',
        completionMessage: 'सुरक्षित जवाब मिला.',
        questions: {
          secure_email: { title: 'ईमेल पता', placeholder: 'aap@example.test' },
          secure_file: { title: 'नोट्स जोड़ें' }
        }
      }
    },
    completion: { type: 'message', message: 'Secure response received.', redirectUrl: '' }
  };
  await admin.request(`/api/surveys/${secureSurvey.survey.id}`, {
    method: 'PUT',
    body: {
      slug: 'secure-upload-test',
      settings: {
        passwordProtected: true,
        password: 'client-secret',
        duplicatePrevention: 'one_per_email',
        responseLimit: 2,
        completionRedirectUrl: 'https://example.test/thanks'
      },
      schema: secureSchema
    }
  });
  const securePublished = await admin.request(`/api/surveys/${secureSurvey.survey.id}/publish`, { method: 'POST', body: {} });
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${securePublished.survey.slug}`),
    (error) => error.status === 401 && error.payload.error.code === 'password_required'
  );
  const unlocked = await admin.request(`/api/public/surveys/${securePublished.survey.slug}?password=client-secret`);
  assert.equal(unlocked.survey.settings.completionRedirectUrl, 'https://example.test/thanks');
  const translated = await admin.request(`/api/public/surveys/${securePublished.survey.slug}?password=client-secret&lang=hi`);
  assert.equal(translated.survey.schema.title, 'सुरक्षित अपलोड फॉर्म');
  assert.equal(translated.survey.schema.questions[0].title, 'ईमेल पता');

  const secureAnswers = {
    secure_email: 'upload@example.test',
    secure_file: {
      name: 'notes.txt',
      type: 'text/plain',
      size: 12,
      extension: 'txt',
      dataUrl: 'data:text/plain;base64,SGVsbG8='
    }
  };
  const secureSubmission = await admin.request(`/api/public/surveys/${securePublished.survey.slug}/responses`, {
    method: 'POST',
    body: {
      password: 'client-secret',
      answers: secureAnswers,
      metadata: { source: 'secure-link', browserId: 'browser-a' }
    }
  });
  assert.equal(secureSubmission.completion.redirectUrl, 'https://example.test/thanks');
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${securePublished.survey.slug}/responses`, {
      method: 'POST',
      body: { password: 'client-secret', answers: secureAnswers, metadata: { source: 'secure-link', browserId: 'browser-b' } }
    }),
    (error) => error.status === 409 && error.payload.error.code === 'duplicate_response'
  );
  assert.equal(fileScanReceiver.requests.length, 1);
  assert.equal(fileScanReceiver.requests[0].headers.authorization, 'Bearer scan-token-test');
  assert.equal(fileScanReceiver.requests[0].body.name, 'notes.txt');
  assert.equal(Buffer.from(fileScanReceiver.requests[0].body.contentBase64, 'base64').toString('utf8'), 'Hello');
  const eicarPayload = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'latin1').toString('base64');
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${securePublished.survey.slug}/responses`, {
      method: 'POST',
      body: {
        password: 'client-secret',
        answers: {
          secure_email: 'virus@example.test',
          secure_file: {
            name: 'eicar.txt',
            type: 'text/plain',
            size: eicarPayload.length,
            extension: 'txt',
            dataUrl: `data:text/plain;base64,${eicarPayload}`
          }
        },
        metadata: { source: 'secure-link', browserId: 'browser-virus' }
      }
    }),
    (error) => error.status === 400
      && error.payload.error.code === 'file_upload_rejected'
      && error.payload.error.details.status === 'infected'
  );
  assert.equal(fileScanReceiver.requests.length, 1);

  const limitSurvey = await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Limited Survey' }
  });
  await admin.request(`/api/surveys/${limitSurvey.survey.id}`, {
    method: 'PUT',
    body: {
      slug: 'limited-survey-test',
      settings: { responseLimit: 1 },
      schema: {
        title: 'Limited Survey',
        description: 'One response only.',
        questions: [{ id: 'limited_email', type: 'email', title: 'Email address', required: true, settings: {}, validation: {} }],
        logic: [],
        completion: { type: 'message', message: 'Thanks.' }
      }
    }
  });
  const limitPublished = await admin.request(`/api/surveys/${limitSurvey.survey.id}/publish`, { method: 'POST', body: {} });
  await admin.request(`/api/public/surveys/${limitPublished.survey.slug}/responses`, {
    method: 'POST',
    body: { answers: { limited_email: 'first@example.test' }, metadata: { browserId: 'limit-a' } }
  });
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${limitPublished.survey.slug}/responses`, {
      method: 'POST',
      body: { answers: { limited_email: 'second@example.test' }, metadata: { browserId: 'limit-b' } }
    }),
    (error) => error.status === 409 && error.payload.error.code === 'response_limit_reached'
  );

  const scheduledSurvey = await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Scheduled Survey' }
  });
  await admin.request(`/api/surveys/${scheduledSurvey.survey.id}`, {
    method: 'PUT',
    body: {
      slug: 'scheduled-survey-test',
      settings: { opensAt: new Date(Date.now() + 1000 * 60 * 60).toISOString() },
      schema: {
        title: 'Scheduled Survey',
        description: 'Not open yet.',
        questions: [{ id: 'scheduled_email', type: 'email', title: 'Email address', required: true, settings: {}, validation: {} }],
        logic: [],
        completion: { type: 'message', message: 'Thanks.' }
      }
    }
  });
  const scheduledPublished = await admin.request(`/api/surveys/${scheduledSurvey.survey.id}/publish`, { method: 'POST', body: {} });
  await assert.rejects(
    () => admin.request(`/api/public/surveys/${scheduledPublished.survey.slug}`),
    (error) => error.status === 425 && error.payload.error.code === 'survey_not_open'
  );

  const anonymousSurvey = await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId, title: 'Anonymous Employee Pulse' }
  });
  await admin.request(`/api/surveys/${anonymousSurvey.survey.id}`, {
    method: 'PUT',
    body: {
      slug: 'anonymous-employee-pulse',
      type: 'employee_pulse',
      settings: { anonymousMode: true, collectIpHash: true, collectUserAgent: true },
      schema: {
        title: 'Anonymous Employee Pulse',
        description: 'Collect anonymous staff feedback.',
        questions: [
          { id: 'employee_name', type: 'short_text', title: 'Employee name', required: false, settings: {}, validation: {} },
          { id: 'employee_email', type: 'email', title: 'Employee email', required: true, settings: {}, validation: {} },
          { id: 'employee_phone', type: 'phone', title: 'Phone number', required: false, settings: {}, validation: {} },
          { id: 'employee_feedback', type: 'long_text', title: 'Anonymous feedback', required: true, settings: {}, validation: {} }
        ],
        logic: [],
        completion: { type: 'message', message: 'Thank you for anonymous feedback.' }
      }
    }
  });
  const anonymousPublished = await admin.request(`/api/surveys/${anonymousSurvey.survey.id}/publish`, { method: 'POST', body: {} });
  const anonymousPublic = await admin.request(`/api/public/surveys/${anonymousPublished.survey.slug}`);
  assert.equal(anonymousPublic.survey.settings.anonymousMode, true);
  await admin.request(`/api/public/surveys/${anonymousPublished.survey.slug}/responses`, {
    method: 'POST',
    body: {
      answers: {
        employee_name: 'Employee One',
        employee_email: 'anonymous@example.test',
        employee_phone: '+911234567890',
        employee_feedback: 'I am unhappy about slow internal follow-up but need anonymity.'
      },
      metadata: {
        browserId: 'anon-browser',
        userId: 'employee-123',
        externalId: 'hris-456',
        source: 'employee',
        referrer: 'https://intranet.example/private'
      }
    }
  });
  const anonymousResponses = await admin.request(`/api/surveys/${anonymousSurvey.survey.id}/responses`);
  assert.equal(anonymousResponses.total, 1);
  const anonymousResponse = anonymousResponses.responses[0];
  assert.equal(anonymousResponse.answersJson.employee_name, '[anonymous]');
  assert.equal(anonymousResponse.answersJson.employee_email, '[anonymous]');
  assert.equal(anonymousResponse.answersJson.employee_phone, '[anonymous]');
  assert.match(anonymousResponse.answersJson.employee_feedback, /slow internal/);
  assert.equal(anonymousResponse.respondentId, null);
  assert.equal(anonymousResponse.metadataJson.anonymous, true);
  assert.equal(anonymousResponse.metadataJson.ipHash, '');
  assert.equal(anonymousResponse.metadataJson.userAgent, '');
  assert.equal(anonymousResponse.metadataJson.browserId, '');
  assert.equal(anonymousResponse.metadataJson.userId, '');
  assert.equal(anonymousResponse.metadataJson.externalId, '');
  assert.equal(anonymousResponse.metadataJson.referrer, '');
  const contactsAfterAnonymous = await admin.request(`/api/contacts?workspaceId=${workspaceId}`);
  assert.ok(!contactsAfterAnonymous.contacts.some((contact) => contact.email === 'anonymous@example.test'));

  const workspaceExport = await admin.request(`/api/workspaces/${workspaceId}/export.json`);
  const exportedAnonymous = workspaceExport.responses.find((response) => response.surveyId === anonymousSurvey.survey.id);
  assert.equal(exportedAnonymous.answersJson.employee_email, '[anonymous]');
  assert.equal(exportedAnonymous.metadataJson.browserId, '');
  const exportedUpload = workspaceExport.fileUploads.find((upload) => upload.name === 'notes.txt');
  assert.ok(exportedUpload);
  assert.equal(exportedUpload.storageProvider, 's3_compatible');
  assert.match(exportedUpload.storageKey, new RegExp(`${workspaceId}/`));
  assert.equal(exportedUpload.scanStatus, 'clean');
  assert.equal(exportedUpload.scanProvider, 'fake_scan');
  assert.equal(exportedUpload.quarantined, false);
  assert.equal(exportedUpload.lifecycleStatus, 'active');
  assert.ok(exportedUpload.retentionExpiresAt);
  assert.equal(exportedUpload.dataUrl, '');
  assert.equal(objectStorageReceiver.uploads.length, 1);
  assert.equal(objectStorageReceiver.uploads[0].method, 'PUT');
  assert.match(objectStorageReceiver.uploads[0].url, /formspear-test-bucket/);
  assert.match(objectStorageReceiver.uploads[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=s3-access-test/);
  assert.equal(objectStorageReceiver.uploads[0].body.toString('utf8'), 'Hello');
  const signedDownload = await admin.request(`/api/file-uploads/${exportedUpload.id}/download-url`);
  assert.equal(signedDownload.storageProvider, 's3_compatible');
  assert.match(signedDownload.url, /X-Amz-Signature=/);
  assert.match(signedDownload.url, /formspear-test-bucket/);

  const workspaceAuditLogs = await admin.request(`/api/workspaces/${workspaceId}/audit-logs?action=survey&limit=10`);
  assert.ok(workspaceAuditLogs.total >= 1);
  assert.ok(workspaceAuditLogs.auditLogs.every((log) => log.workspaceId === workspaceId));
  assert.ok(workspaceAuditLogs.auditLogs.some((log) => log.action.startsWith('survey.')));
  const workspaceAuditExport = await admin.request(`/api/workspaces/${workspaceId}/audit-logs/export.json?entityType=survey&limit=50`);
  assert.equal(workspaceAuditExport.workspaceId, workspaceId);
  assert.ok(workspaceAuditExport.auditLogs.every((log) => log.workspaceId === workspaceId && log.entityType === 'survey'));
  await assert.rejects(
    () => other.request(`/api/workspaces/${workspaceId}/audit-logs`),
    (error) => error.status === 403
  );

  const privacy = await admin.request(`/api/workspaces/${workspaceId}/privacy/delete`, {
    method: 'POST',
    body: { email: 'upload@example.test', mode: 'anonymize' }
  });
  assert.equal(privacy.responsesAffected, 1);
  const secureResponses = await admin.request(`/api/surveys/${secureSurvey.survey.id}/responses`);
  assert.equal(secureResponses.responses[0].answersJson.secure_email, '[redacted]');
  assert.equal(secureResponses.responses[0].respondentId, null);

  const retention = await admin.request(`/api/workspaces/${workspaceId}/retention/run`, { method: 'POST', body: {} });
  assert.equal(retention.job.status, 'completed');
  assert.equal(typeof retention.job.payloadJson.result.anonymized, 'number');
  assert.equal(typeof retention.job.payloadJson.result.fileUploadsExpired, 'number');

  const retentionSettings = await admin.request(`/api/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: {
      retentionScheduleEnabled: true,
      retentionNextRunAt: new Date(Date.now() - 1000).toISOString()
    }
  });
  assert.equal(retentionSettings.workspace.retentionScheduleEnabled, true);

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
  const privacyPage = await fetch(`${baseUrl}/privacy`);
  assert.equal(privacyPage.status, 200);
  assert.match(await privacyPage.text(), /Privacy Policy/);
  const termsPage = await fetch(`${baseUrl}/terms`);
  assert.equal(termsPage.status, 200);
  assert.match(await termsPage.text(), /Terms of Service/);

  const contacts = await admin.request(`/api/contacts?workspaceId=${workspaceId}`);
  assert.ok(contacts.contacts.some((contact) => contact.email === 'patient@example.test'));

  const apiContacts = await admin.request('/api/v1/contacts', { token: apiToken });
  const patientContact = apiContacts.contacts.find((contact) => contact.email === 'patient@example.test');
  assert.ok(patientContact);
  assert.equal(patientContact.stage, 'qualified');
  const apiContactDetail = await admin.request(`/api/v1/contacts/${patientContact.id}`, { token: apiToken });
  assert.equal(apiContactDetail.contact.email, 'patient@example.test');
  const nextFollowUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const contactPipeline = await admin.request(`/api/contacts/${patientContact.id}`, {
    method: 'PUT',
    body: { stage: 'contacted', ownerId: signup.user.id, nextFollowUpAt }
  });
  assert.equal(contactPipeline.contact.stage, 'contacted');
  assert.equal(contactPipeline.contact.ownerId, signup.user.id);
  assert.equal(contactPipeline.contact.nextFollowUpAt, nextFollowUpAt);
  const filteredContacts = await admin.request(`/api/contacts?workspaceId=${workspaceId}&stage=contacted&ownerId=${signup.user.id}`);
  assert.ok(filteredContacts.contacts.some((contact) => contact.id === patientContact.id));
  const apiUpdatedContact = await admin.request(`/api/v1/contacts/${patientContact.id}`, {
    method: 'PUT',
    token: apiToken,
    body: { company: 'Clinic Account', tags: ['priority'], leadScore: 88, stage: 'proposal', ownerId: signup.user.id, nextFollowUpAt }
  });
  assert.equal(apiUpdatedContact.contact.company, 'Clinic Account');
  assert.ok(apiUpdatedContact.contact.tagsJson.includes('priority'));
  assert.equal(apiUpdatedContact.contact.stage, 'proposal');
  assert.equal(apiUpdatedContact.contact.ownerId, signup.user.id);
  const apiCreatedContact = await admin.request('/api/v1/contacts', {
    method: 'POST',
    token: apiToken,
    body: { name: 'API Lead', email: 'api-lead@example.test', phone: '+911234567890', source: 'api', tags: ['lead'], leadScore: 72, stage: 'qualified', ownerId: signup.user.id }
  });
  assert.equal(apiCreatedContact.contact.email, 'api-lead@example.test');
  assert.equal(apiCreatedContact.contact.stage, 'qualified');
  assert.equal(apiCreatedContact.contact.ownerId, signup.user.id);

  const notifications = await admin.request(`/api/notifications?workspaceId=${workspaceId}`);
  assert.equal(notifications.notifications.length, 6);
  assert.ok(notifications.notifications.some((notification) => notification.title.startsWith('Logic alert')));

  const rejectedCron = await fetch(`${baseUrl}/api/cron/run`, { method: 'POST' });
  assert.equal(rejectedCron.status, 403);
  const cronRun = await fetch(`${baseUrl}/api/cron/run`, {
    method: 'POST',
    headers: { 'x-cron-secret': 'cron-secret-test' }
  });
  assert.equal(cronRun.status, 200);
  const drained = await cronRun.json();
  assert.ok(drained.processed >= 9);
  assert.equal(drained.scheduledRetentionJobs, 1);
  assert.equal(webhookReceiver.deliveries.length, 6);
  assert.equal(webhookReceiver.deliveries[0].headers['x-feedbackos-event'], 'response.completed');
  assert.match(webhookReceiver.deliveries[0].headers['x-feedbackos-signature'], /^sha256=/);
  assert.equal(integrationReceiver.deliveries.length, 6);
  assert.equal(integrationReceiver.deliveries[0].headers['x-feedbackos-integration'], 'slack');
  assert.match(integrationReceiver.deliveries[0].headers['x-feedbackos-signature'], /^sha256=/);
  assert.match(integrationReceiver.deliveries[0].body.text, /FeedbackOS response\.completed/);

  const sessionAfterDrain = await admin.request('/api/session');
  const workspaceAfterDrain = sessionAfterDrain.workspaces.find((workspace) => workspace.id === workspaceId);
  assert.ok(workspaceAfterDrain.retentionLastRunAt);
  assert.ok(new Date(workspaceAfterDrain.retentionNextRunAt).getTime() > Date.now());

  const usedAiCredits = workspaceAfterDrain.usage.aiCreditsUsed;
  const limitedAiWorkspace = await admin.request(`/api/admin/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { aiCreditLimitOverride: usedAiCredits }
  });
  assert.equal(limitedAiWorkspace.workspace.aiCreditLimitOverride, usedAiCredits);
  assert.equal(limitedAiWorkspace.workspace.aiCreditLimit, usedAiCredits);
  assert.equal(limitedAiWorkspace.workspace.aiCreditsRemaining, 0);
  await assert.rejects(
    () => admin.request('/api/ai/improve-question', {
      method: 'POST',
      body: { workspaceId, question: 'How was the visit?', goal: 'clarity' }
    }),
    (error) => error.status === 402 && error.payload.error.code === 'ai_credit_limit'
  );
  const expandedAiWorkspace = await admin.request(`/api/admin/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { aiCreditLimitOverride: usedAiCredits + 2 }
  });
  assert.equal(expandedAiWorkspace.workspace.aiCreditsRemaining, 2);
  const aiAfterOverride = await admin.request('/api/ai/improve-question', {
    method: 'POST',
    body: { workspaceId, question: 'How was the visit?', goal: 'clarity' }
  });
  assert.equal(aiAfterOverride.job.jobType, 'question_improvement');
  const resetAiWorkspace = await admin.request(`/api/admin/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { aiCreditLimitOverride: null }
  });
  assert.equal(resetAiWorkspace.workspace.aiCreditLimitOverride, null);

  const apiWebhookLogs = await admin.request('/api/v1/webhook-logs', { token: apiToken });
  assert.equal(apiWebhookLogs.webhookLogs.length, 6);
  assert.ok(apiWebhookLogs.webhookLogs.every((log) => log.responseStatus === '204'));

  const integrationsAfterDrain = await admin.request(`/api/integrations?workspaceId=${workspaceId}`);
  assert.equal(integrationsAfterDrain.integrationLogs.length, 12);
  assert.ok(integrationsAfterDrain.integrationLogs.some((log) => log.type === 'slack' && log.status === 'sent_provider' && log.responseStatus === '204'));
  assert.ok(integrationsAfterDrain.integrationLogs.some((log) => log.type === 'google_sheets' && log.status === 'synced_simulated'));

  const reportsAfterDrain = await admin.request(`/api/ai/monthly-reports/${workspaceId}`);
  const scheduledReport = reportsAfterDrain.reports.find((report) => report.scheduled);
  assert.ok(scheduledReport);
  assert.equal(scheduledReport.provider, 'openai_compatible');
  assert.equal(scheduledReport.title, 'Provider Monthly Feedback Report');
  assert.equal(scheduledReport.delivery.recipients.length, 2);
  assert.equal(scheduledReport.delivery.status, 'sent_provider');
  assert.ok(smtpReceiver.messages.length >= 3);
  assert.ok(smtpReceiver.messages.some((message) => message.includes('To: ops@example.test') && message.includes('Subject: Negative feedback alert')));
  assert.ok(smtpReceiver.messages.some((message) => message.includes('To: resume@example.test') && message.includes(`resumeResponseId=${partial.responseId}`) && message.includes('resumeToken=')));
  assert.ok(smtpReceiver.messages.some((message) => message.includes('To: owner@example.test') && message.includes('Monthly FeedbackOS report is ready')));
  assert.ok(openAiReceiver.requests.every((request) => request.headers.authorization === 'Bearer test-openai-key'));
  assert.ok(openAiReceiver.requests.every((request) => request.body.model === 'fake-feedback-model'));
  assert.ok(openAiReceiver.requests.some((request) => request.task === 'survey_generation'));
  assert.ok(openAiReceiver.requests.some((request) => request.task === 'question_improvement'));
  const summaryRequest = openAiReceiver.requests.find((request) => request.task === 'survey_summary');
  assert.ok(summaryRequest);
  assert.equal(summaryRequest.payload.responseCount, 3);
  assert.ok(summaryRequest.payload.responses.length <= 25);
  assert.ok(summaryRequest.payload.responses.every((response) => typeof response.text === 'string' && response.text.length <= 500));
  const monthlyReportRequests = openAiReceiver.requests.filter((request) => request.task === 'monthly_report');
  assert.ok(monthlyReportRequests.length >= 2);
  assert.ok(monthlyReportRequests.every((request) => request.payload.responseExcerpts.length <= 25));
  const providerRequestsBeforeOptOut = openAiReceiver.requests.length;
  const localAiWorkspace = await admin.request(`/api/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { allowExternalAi: false }
  });
  assert.equal(localAiWorkspace.workspace.allowExternalAi, false);
  const localOnlyImprovement = await admin.request('/api/ai/improve-question', {
    method: 'POST',
    body: { workspaceId, question: 'Did you love our amazing service?', mode: 'remove_bias' }
  });
  assert.equal(openAiReceiver.requests.length, providerRequestsBeforeOptOut);
  assert.equal(localOnlyImprovement.improved.provider, undefined);
  assert.match(localOnlyImprovement.improved.improvedTitle, /describe/i);
  const providerRequestsBeforeModelBlock = openAiReceiver.requests.length;
  await admin.request(`/api/workspaces/${workspaceId}`, {
    method: 'PUT',
    body: { allowExternalAi: true }
  });
  process.env.OPENAI_ALLOWED_MODELS = 'another-model';
  const modelBlockedImprovement = await admin.request('/api/ai/improve-question', {
    method: 'POST',
    body: { workspaceId, question: 'Was the experience perfect?', mode: 'remove_bias' }
  });
  assert.equal(openAiReceiver.requests.length, providerRequestsBeforeModelBlock);
  assert.equal(modelBlockedImprovement.improved.provider, undefined);
  process.env.OPENAI_ALLOWED_MODELS = 'fake-feedback-model';
  const providerRequestsBeforePolicyBlock = openAiReceiver.requests.length;
  process.env.AI_PROVIDER_DPA_ACCEPTED = 'false';
  const policyBlockedImprovement = await admin.request('/api/ai/improve-question', {
    method: 'POST',
    body: { workspaceId, question: 'Should we send this outside?', mode: 'clarity' }
  });
  assert.equal(openAiReceiver.requests.length, providerRequestsBeforePolicyBlock);
  assert.equal(policyBlockedImprovement.improved.provider, undefined);
  process.env.AI_PROVIDER_DPA_ACCEPTED = 'true';

  const openPixel = await fetch(`${baseUrl}/api/public/campaigns/${campaign.campaign.id}/open.gif?recipient=${campaign.campaign.contacts[0].emailHash}`);
  assert.equal(openPixel.status, 200);
  assert.equal(openPixel.headers.get('content-type'), 'image/gif');
  const click = await fetch(`${baseUrl}/api/public/campaigns/${campaign.campaign.id}/click?recipient=${campaign.campaign.contacts[0].emailHash}&url=${encodeURIComponent(`${baseUrl}/s/${published.survey.slug}`)}`, { redirect: 'manual' });
  assert.equal(click.status, 302);
  const trackedCampaigns = await admin.request(`/api/campaigns?workspaceId=${workspaceId}`);
  const trackedCampaign = trackedCampaigns.campaigns.find((item) => item.id === campaign.campaign.id);
  assert.equal(trackedCampaign.openedCount, 1);
  assert.equal(trackedCampaign.clickedCount, 1);
  assert.equal(trackedCampaign.events.length, 2);

  const campaigns = await admin.request(`/api/campaigns?workspaceId=${workspaceId}`);
  assert.equal(campaigns.campaigns[0].sentCount, 2);

  const invoice = await admin.request(`/api/billing/${workspaceId}/invoices`, {
    method: 'POST',
    body: { amountDueInr: 2999, lineItems: [{ description: 'Monthly subscription', quantity: 1, unitAmountInr: 2999 }] }
  });
  assert.equal(invoice.invoice.subtotalInr, 2999);
  assert.equal(invoice.invoice.taxMode, 'exclusive');
  assert.equal(invoice.invoice.taxPercent, 18);
  assert.equal(invoice.invoice.taxInr, 540);
  assert.equal(invoice.invoice.amountDueInr, 3539);

  const billingOverview = await admin.request(`/api/billing?workspaceId=${workspaceId}`);
  assert.equal(billingOverview.invoices.length, 1);

  const proratedPlanChange = await admin.request(`/api/workspaces/${workspaceId}/subscription`, {
    method: 'POST',
    body: { planId: 'agency', prorationPolicy: 'always_invoice' }
  });
  assert.equal(proratedPlanChange.subscription.planId, 'agency');
  assert.equal(proratedPlanChange.subscription.billingPolicy.prorationPolicy, 'always_invoice');
  assert.equal(proratedPlanChange.prorationInvoice.status, 'open');
  assert.equal(proratedPlanChange.prorationInvoice.taxMode, 'exclusive');
  assert.ok(proratedPlanChange.prorationInvoice.amountDueInr > 0);

  const agencyClientWorkspace = await admin.request('/api/workspaces', {
    method: 'POST',
    body: { name: 'Agency Client Workspace', industry: 'Real Estate', companySize: '11-50' }
  });
  const agencyOverview = await admin.request(`/api/agency/overview?workspaceId=${workspaceId}`);
  assert.equal(agencyOverview.agencyWorkspace.planId, 'agency');
  assert.ok(agencyOverview.clients.some((client) => client.workspaceId === agencyClientWorkspace.workspace.id && client.name === 'Agency Client Workspace'));
  assert.ok(agencyOverview.clients.some((client) => client.workspaceId === workspaceId && client.responses >= 6));
  assert.ok(agencyOverview.totals.clientWorkspaces >= 3);
  assert.ok(agencyOverview.totals.responses >= 6);
  assert.ok(agencyOverview.planDistribution.some((item) => item.label === 'agency'));

  const checkout = await admin.request(`/api/billing/${workspaceId}/checkout`, {
    method: 'POST',
    body: { planId: 'pro', provider: 'stripe' }
  });
  assert.equal(checkout.checkout.provider, 'stripe');
  assert.equal(checkout.checkout.providerCheckoutId, 'cs_test_formspear');
  assert.match(checkout.checkout.checkoutUrl, /checkout\.stripe\.test/);
  assert.equal(stripeReceiver.requests.length, 1);
  assert.equal(stripeReceiver.requests[0].headers.authorization, 'Bearer sk_test_formspear');
  assert.equal(stripeReceiver.requests[0].params.get('metadata[workspaceId]'), workspaceId);
  assert.equal(stripeReceiver.requests[0].params.get('metadata[planId]'), 'pro');
  assert.equal(stripeReceiver.requests[0].params.get('automatic_tax[enabled]'), 'true');
  assert.equal(stripeReceiver.requests[0].params.get('tax_id_collection[enabled]'), 'true');
  assert.equal(stripeReceiver.requests[0].params.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.equal(stripeReceiver.requests[0].params.get('line_items[0][price_data][unit_amount]'), '1999900');
  assert.equal(stripeReceiver.requests[0].params.get('metadata[taxMode]'), 'exclusive');
  assert.equal(stripeReceiver.requests[0].params.get('metadata[taxPercent]'), '18');
  assert.equal(stripeReceiver.requests[0].params.get('metadata[prorationPolicy]'), 'create_prorations');
  assert.equal(stripeReceiver.requests[0].params.get('subscription_data[metadata][planId]'), 'pro');
  assert.equal(checkout.checkout.subtotalInr, 19999);
  assert.equal(checkout.checkout.taxInr, 3600);
  assert.equal(checkout.checkout.amountInr, 23599);

  const checkoutEventBody = JSON.stringify({
    id: 'evt_checkout_completed',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_formspear',
        client_reference_id: workspaceId,
        customer: 'cus_test_formspear',
        subscription: 'sub_test_formspear',
        metadata: { workspaceId, planId: 'pro' }
      }
    }
  });
  const checkoutWebhook = await fetch(`${baseUrl}/api/billing/webhook/stripe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': stripeSignature('whsec_formspear', checkoutEventBody)
    },
    body: checkoutEventBody
  });
  assert.equal(checkoutWebhook.status, 200);
  assert.equal((await checkoutWebhook.json()).result.action, 'subscription_activated');
  const billingAfterCheckout = await admin.request(`/api/billing?workspaceId=${workspaceId}`);
  assert.equal(billingAfterCheckout.subscription.provider, 'stripe');
  assert.equal(billingAfterCheckout.subscription.planId, 'pro');
  assert.equal(billingAfterCheckout.subscription.providerSubscriptionId, 'sub_test_formspear');
  assert.equal(billingAfterCheckout.subscription.providerCustomerId, 'cus_test_formspear');
  assert.equal(billingAfterCheckout.subscription.billingPolicy.taxMode, 'exclusive');
  assert.equal(billingAfterCheckout.subscription.billingPolicy.prorationPolicy, 'create_prorations');

  const portal = await admin.request(`/api/billing/${workspaceId}/portal`, { method: 'POST', body: {} });
  assert.equal(portal.portal.provider, 'stripe');
  assert.equal(portal.portal.customerId, 'cus_test_formspear');
  assert.match(portal.portal.url, /billing\.stripe\.test/);
  const portalRequest = stripeReceiver.requests.find((request) => request.params.get('customer') === 'cus_test_formspear');
  assert.ok(portalRequest);
  assert.equal(portalRequest.headers.authorization, 'Bearer sk_test_formspear');

  const invoicePaidBody = JSON.stringify({
    id: 'evt_invoice_paid',
    type: 'invoice.paid',
    data: { object: { id: 'in_test_formspear', subscription: 'sub_test_formspear', amount_paid: 599900, amount_due: 599900 } }
  });
  const invoiceWebhook = await fetch(`${baseUrl}/api/billing/webhook/stripe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': stripeSignature('whsec_formspear', invoicePaidBody)
    },
    body: invoicePaidBody
  });
  assert.equal(invoiceWebhook.status, 200);
  const billingAfterInvoice = await admin.request(`/api/billing?workspaceId=${workspaceId}`);
  const stripeInvoice = billingAfterInvoice.invoices.find((item) => item.providerInvoiceId === 'in_test_formspear');
  assert.equal(stripeInvoice.provider, 'stripe');
  assert.equal(stripeInvoice.status, 'paid');
  assert.equal(stripeInvoice.amountPaidInr, 5999);
  assert.equal(stripeInvoice.taxMode, 'inclusive');
  assert.equal(stripeInvoice.taxInr, 915);

  const failedPayment = await admin.request(`/api/billing/${workspaceId}/payment-failed`, { method: 'POST', body: {} });
  assert.equal(failedPayment.subscription.status, 'past_due');
  assert.equal(failedPayment.workspace.planId, 'starter');

  const adminUsers = await admin.request('/api/admin/users');
  assert.ok(adminUsers.users.some((item) => item.email === 'other@example.test'));

  const disabled = await admin.request(`/api/admin/users/${otherSignup.user.id}`, { method: 'PUT', body: { disabled: true } });
  assert.equal(disabled.user.id, otherSignup.user.id);

  await assert.rejects(
    () => other.request('/api/session'),
    (error) => error.status === 401
  );

  const adminWorkspaces = await admin.request('/api/admin/workspaces');
  assert.ok(adminWorkspaces.workspaces.length >= 2);

  const customPlan = await admin.request('/api/admin/plans', {
    method: 'POST',
    body: {
      id: 'clinic_growth_test',
      name: 'Clinic Growth Test',
      priceMonthlyInr: 12345,
      setupFeeRange: 'INR 12,000-18,000',
      limits: { surveys: 1, responsesPerMonth: 50, teamMembers: 3, aiCredits: 7 },
      features: ['Clinic feedback', 'Complaint alerts']
    }
  });
  assert.equal(customPlan.plan.id, 'clinic_growth_test');
  assert.equal(customPlan.plan.limits.surveys, 1);
  const adminPlans = await admin.request('/api/admin/plans');
  assert.ok(adminPlans.plans.some((plan) => plan.id === 'clinic_growth_test'));
  const activePlans = await admin.request('/api/plans');
  assert.ok(activePlans.plans.some((plan) => plan.id === 'clinic_growth_test'));
  const customSession = await admin.request('/api/session');
  assert.ok(customSession.plans.some((plan) => plan.id === 'clinic_growth_test'));

  const limitedWorkspaceId = otherSignup.workspaces[0].id;
  const limitedWorkspace = await admin.request(`/api/admin/workspaces/${limitedWorkspaceId}`, {
    method: 'PUT',
    body: { planId: 'clinic_growth_test' }
  });
  assert.equal(limitedWorkspace.workspace.planId, 'clinic_growth_test');
  const customBilling = await admin.request(`/api/billing?workspaceId=${limitedWorkspaceId}`);
  assert.ok(customBilling.plans.some((plan) => plan.id === 'clinic_growth_test' && plan.priceMonthlyInr === 12345));
  await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId: limitedWorkspaceId, title: 'Custom plan first survey' }
  });
  await assert.rejects(
    () => admin.request('/api/surveys', { method: 'POST', body: { workspaceId: limitedWorkspaceId, title: 'Custom plan blocked survey' } }),
    (error) => error.status === 402 && error.payload.error.code === 'plan_limit'
  );
  const updatedCustomPlan = await admin.request('/api/admin/plans/clinic_growth_test', {
    method: 'PUT',
    body: { limits: { surveys: 2, responsesPerMonth: 75, teamMembers: 4, aiCredits: 9 }, priceMonthlyInr: 15000 }
  });
  assert.equal(updatedCustomPlan.plan.limits.surveys, 2);
  assert.equal(updatedCustomPlan.plan.priceMonthlyInr, 15000);
  await admin.request('/api/surveys', {
    method: 'POST',
    body: { workspaceId: limitedWorkspaceId, title: 'Custom plan second survey' }
  });
  const archivedCustomPlan = await admin.request('/api/admin/plans/clinic_growth_test', { method: 'DELETE', body: {} });
  assert.equal(archivedCustomPlan.plan.archived, true);
  const activePlansAfterArchive = await admin.request('/api/plans');
  assert.ok(!activePlansAfterArchive.plans.some((plan) => plan.id === 'clinic_growth_test'));

  const suspended = await admin.request(`/api/admin/workspaces/${otherSignup.workspaces[0].id}`, { method: 'PUT', body: { suspended: true } });
  assert.equal(suspended.workspace.suspended, true);
  const deletedWorkspace = await admin.request(`/api/admin/workspaces/${limitedWorkspaceId}`, { method: 'DELETE', body: {} });
  assert.equal(deletedWorkspace.ok, true);
  assert.equal(deletedWorkspace.deletedWorkspaceId, limitedWorkspaceId);
  assert.equal(deletedWorkspace.result.workspacesDeleted, 1);
  assert.ok(deletedWorkspace.result.surveysDeleted >= 2);
  const workspacesAfterDelete = await admin.request('/api/admin/workspaces');
  assert.ok(!workspacesAfterDelete.workspaces.some((workspace) => workspace.id === limitedWorkspaceId));
  const auditAfterDelete = await admin.request('/api/admin/audit-logs?action=admin.workspace_deleted&limit=5');
  assert.ok(auditAfterDelete.auditLogs.some((log) => log.entityId === limitedWorkspaceId));

  const platformSettings = await admin.request('/api/admin/settings');
  assert.equal(platformSettings.settings.requireEmailVerification, false);
  const verificationRequired = await admin.request('/api/admin/settings', { method: 'PUT', body: { requireEmailVerification: true } });
  assert.equal(verificationRequired.settings.requireEmailVerification, true);
  const needsVerification = await verificationClient.request('/api/auth/signup', {
    method: 'POST',
    body: {
      name: 'Needs Verification',
      email: 'verify-me@example.test',
      password: 'FeedbackOS123',
      workspaceName: 'Verification Workspace',
      acceptTerms: true
    }
  });
  assert.equal(needsVerification.emailVerificationRequired, true);
  assert.equal(needsVerification.user.emailVerifiedAt, null);
  assert.match(needsVerification.verificationToken, /^fo_verify_/);
  await assert.rejects(
    () => verificationClient.request('/api/session'),
    (error) => error.status === 401
  );
  await assert.rejects(
    () => verificationClient.request('/api/auth/login', { method: 'POST', body: { email: 'verify-me@example.test', password: 'FeedbackOS123' } }),
    (error) => error.status === 403 && error.payload.error.code === 'email_verification_required' && /^fo_verify_/.test(error.payload.verificationToken)
  );
  const resentVerification = await verificationClient.request('/api/auth/email-verification/request', { method: 'POST', body: { email: 'verify-me@example.test' } });
  assert.match(resentVerification.verificationToken, /^fo_verify_/);
  const verifiedEmail = await verificationClient.request('/api/auth/email-verification/confirm', {
    method: 'POST',
    body: { token: resentVerification.verificationToken }
  });
  assert.ok(verifiedEmail.user.emailVerifiedAt);
  const verifiedLogin = await verificationClient.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'verify-me@example.test', password: 'FeedbackOS123' }
  });
  assert.equal(verifiedLogin.user.email, 'verify-me@example.test');
  const verificationDisabled = await admin.request('/api/admin/settings', { method: 'PUT', body: { requireEmailVerification: false } });
  assert.equal(verificationDisabled.settings.requireEmailVerification, false);

  const testFault = await fetch(`${baseUrl}/api/__test__/boom`);
  assert.equal(testFault.status, 500);
  const testFaultPayload = await testFault.json();
  assert.equal(testFaultPayload.error.code, 'internal_error');

  const adminOverview = await admin.request('/api/admin/overview');
  assert.ok(adminOverview.totals.workspaces >= 4);
  assert.ok(!adminOverview.topWorkspaces.some((workspace) => workspace.id === limitedWorkspaceId));
  assert.ok(adminOverview.topWorkspaces.some((workspace) => workspace.name === 'OAuth Workspace'));
  assert.equal(adminOverview.totals.responseVolume, 6);
  assert.ok(adminOverview.totals.errorLogs >= 1);
  assert.ok(adminOverview.recentErrorLogs.some((log) => log.path === '/api/__test__/boom' && log.name === 'Error'));
  assert.ok(adminOverview.totals.aiProviderCalls >= 4);
  assert.ok(adminOverview.recentAiProviderLogs.some((log) => log.status === 'success' && log.model === 'fake-feedback-model'));
  assert.ok(adminOverview.recentAiProviderLogs.some((log) => log.status === 'skipped_privacy'));
  assert.ok(adminOverview.recentAiProviderLogs.some((log) => log.status === 'skipped_model_not_allowed' && log.model === 'fake-feedback-model'));
  assert.ok(adminOverview.recentAiProviderLogs.some((log) => log.status === 'skipped_policy_review' && log.model === 'fake-feedback-model'));
  assert.ok(monitoringReceiver.events.some((event) => event.url === '/api/1/store/' && event.body.message === 'Intentional test fault for error logging.'));
  assert.ok(monitoringReceiver.events.some((event) => event.url === '/capture/' && event.body.event === 'server_error' && event.body.api_key === 'phc_formspear'));

  const readiness = await admin.request('/api/admin/readiness');
  assert.equal(readiness.migration.present, true);
  assert.ok(readiness.checks.some((check) => check.id === 'migration' && check.status === 'pass'));
  assert.equal(typeof readiness.productionReady, 'boolean');
  assert.ok(Object.values(readiness.providers.database.variables).every((value) => typeof value === 'boolean'));
  assert.equal(readiness.providers.oauth.configured, true);
  assert.equal(readiness.providers.oauth.variables.GOOGLE_OAUTH_CLIENT_SECRET, true);
  assert.ok(readiness.checks.some((check) => check.id === 'google_oauth' && check.status === 'pass'));
  assert.equal(readiness.providers.ai.variables.OPENAI_MODEL_ALLOWED, true);
  assert.equal(readiness.providers.ai.policy.accepted, true);
  assert.equal(readiness.providers.ai.policy.dataRetentionDays, 30);
  assert.ok(readiness.providers.ai.allowedModels.includes('fake-feedback-model'));
  assert.equal(readiness.providers.billing.policy.taxMode, 'exclusive');
  assert.equal(readiness.providers.billing.policy.taxPercent, 18);
  assert.equal(readiness.providers.billing.policy.prorationPolicy, 'create_prorations');
  assert.ok(readiness.checks.some((check) => check.id === 'billing_policy' && check.status === 'pass'));
  assert.equal(readiness.providers.storage.lifecycleConfigured, true);
  assert.equal(readiness.providers.storage.lifecycleDays, 365);
  assert.equal(readiness.providers.customDomainSsl.configured, true);
  assert.equal(readiness.providers.customDomainSsl.providerName, 'fake_ssl');
  assert.equal(readiness.providers.fileScanning.configured, true);
  assert.equal(readiness.providers.fileScanning.mode, 'provider');
  assert.ok(readiness.checks.some((check) => check.id === 'storage_lifecycle' && check.status === 'pass'));
  assert.ok(readiness.checks.some((check) => check.id === 'custom_domain_ssl' && check.status === 'pass'));
  assert.ok(readiness.checks.some((check) => check.id === 'file_scan' && check.status === 'pass'));
  assert.equal(readiness.providers.monitoring.configured, true);
  assert.equal(readiness.providers.monitoring.uptimeProvider, 'fake_uptime');
  assert.equal(readiness.providers.monitoring.uptimeConfigured, true);
  assert.equal(readiness.providers.monitoring.alertRouteConfigured, true);
  assert.ok(readiness.checks.some((check) => check.id === 'monitoring' && check.status === 'pass'));
  assert.equal(readiness.providers.sso.strictReadyWorkspaces, 1);
  assert.equal(readiness.providers.sso.devModeWorkspaces, 1);
  assert.ok(readiness.checks.some((check) => check.id === 'sso_assertion' && check.status === 'pass'));
  assert.ok(readiness.checks.some((check) => check.id === 'database'));

  const adminAuditLogs = await admin.request('/api/admin/audit-logs?action=admin&limit=10');
  assert.ok(adminAuditLogs.auditLogs.some((log) => log.action === 'admin.workspace_updated'));
  const adminAuditExport = await admin.request(`/api/admin/audit-logs/export.json?workspaceId=${workspaceId}&limit=25`);
  assert.ok(adminAuditExport.auditLogs.every((log) => log.workspaceId === workspaceId));
  assert.ok(adminAuditExport.auditLogs.every((log) => !JSON.stringify(log.metadataJson).match(/fo_live_|FeedbackOS123/)));
});
