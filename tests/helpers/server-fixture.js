const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../src/server');

function makeClient(baseUrl) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(val) {
      cookie = val;
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

function getVerificationToken(dataFile, email) {
  if (!fs.existsSync(dataFile)) return null;
  const dbData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const jobs = (dbData.jobs || []).filter((job) => job.type === 'email_delivery' && job.payloadJson?.message?.to === email);
  if (jobs.length === 0) return null;
  jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const body = jobs[0].payloadJson?.message?.body || '';
  const match = body.match(/fo_verify_[a-f0-9]+/);
  return match ? match[0] : null;
}

function getPasswordResetToken(dataFile, email) {
  if (!fs.existsSync(dataFile)) return null;
  const dbData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const jobs = (dbData.jobs || []).filter((job) => job.type === 'email_delivery' && job.payloadJson?.message?.to === email);
  if (jobs.length === 0) return null;
  jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const body = jobs[0].payloadJson?.message?.body || '';
  const match = body.match(/fo_reset_[a-f0-9]+/);
  return match ? match[0] : null;
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  if (t && t.after) t.after(() => server.close());
  return {
    server,
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
  if (t && t.after) t.after(() => server.close());
  return {
    server,
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
  if (t && t.after) t.after(() => server.close());
  return {
    server,
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
  if (t && t.after) t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
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
  if (t && t.after) t.after(() => server.close());
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests
  };
}

function stripeSignature(secret, body, timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function testEscapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
  if (t && t.after) t.after(() => server.close());
  return {
    server,
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
  if (t && t.after) t.after(() => server.close());
  return {
    server,
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
  if (t && t.after) t.after(() => server.close());
  return {
    server,
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
  if (t && t.after) t.after(() => server.close());
  return {
    server,
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

async function setupTestServer(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formspear-fixture-'));
  const dataFile = path.join(dir, 'db.json');
  const server = createServer({ dataFile, disableWorker: true, enableTestFaults: true, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  if (t && t.after) {
    t.after(() => {
      server.close();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    });
  }

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    baseUrl,
    dataFile,
    dir,
    client: makeClient(baseUrl),
    createClient: () => makeClient(baseUrl)
  };
}

module.exports = {
  makeClient,
  getVerificationToken,
  getPasswordResetToken,
  makeWebhookReceiver,
  makeSmtpReceiver,
  makeOpenAiReceiver,
  makeOAuthReceiver,
  makeStripeReceiver,
  stripeSignature,
  testEscapeXml,
  signedSamlResponse,
  makeObjectStorageReceiver,
  makeFileScanReceiver,
  makeSslProvisionReceiver,
  makeMonitoringReceiver,
  providerContent,
  setupTestServer
};
