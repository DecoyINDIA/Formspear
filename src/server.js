const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const writeExcelFile = require('write-excel-file/node');
const { validateProductionEnvironment } = require('./production-config');
const { clientIp } = require('./lib/client-ip');
const { readBodyBuffer } = require('./lib/http-body');
const { isSafeOutboundUrl } = require('./lib/outbound');
const { loadAsset, isCompressible, negotiateEncoding } = require('./lib/static-assets');
const { ALL_FEATURES, enabledFeatures, featureEnabled } = require('./lib/features');
const {
  withSecurityHeaders,
  embeddableSecurityHeaders,
  encryptConfig,
  decryptConfig,
  publicWebhook,
  hashToken,
  signPayload,
  hashPassword,
  verifyPassword,
  hashIp
} = require('./security');
const { handleAiSummaryRoute } = require('./routes/ai-summary');
const { handleAnalyticsRoute } = require('./routes/analytics');
const { handleBillingRoute } = require('./routes/billing');
const { handleAdminReadinessRoute } = require('./routes/admin-readiness');
const { handleResponsesRoute } = require('./routes/responses');
const { handleAuthCredentialRoute } = require('./routes/auth-credentials');
const { handleSurveyLifecycleRoute } = require('./routes/survey-lifecycle');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_DATA_FILE = process.env.FORMSPEAR_DATA_FILE || path.join(ROOT, 'data', 'formspear.db.json');
const POSTGRES_RUNTIME_STATE_KEY = '__feedbackos_runtime_state__';
const POSTGRES_PLATFORM_SETTINGS_KEY = '__feedbackos_platform_settings__';
const BULLMQ_QUEUE_NAME = process.env.BULLMQ_QUEUE_NAME || 'feedbackos-jobs';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 8 * 1024 * 1024);
const LOG_MEMORY_MAX = Math.max(100, Number(process.env.LOG_MEMORY_MAX || 5000));
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const REMEMBER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const TWO_FACTOR_CHALLENGE_TTL_MS = 1000 * 60 * 10;
const PUBLIC_RATE_LIMIT_WINDOW_MS = Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const PUBLIC_RATE_LIMIT_MAX = Number(process.env.PUBLIC_RATE_LIMIT_MAX || 120);
const DB_SAVE_BATCH_DELAY_MS = Number(process.env.DB_SAVE_BATCH_DELAY_MS || 5);
const JOB_POLL_INTERVAL_MS = Number(process.env.JOB_POLL_INTERVAL_MS || 5000);
const JOB_MAX_ATTEMPTS = 5;
const RETENTION_SCHEDULE_INTERVAL_MS = Number(process.env.RETENTION_SCHEDULE_INTERVAL_MS || 24 * 60 * 60 * 1000);
const AI_PROVIDER_RESPONSE_LIMIT = 60;
const CONTACT_STAGES = ['new', 'qualified', 'contacted', 'proposal', 'won', 'lost', 'nurture'];
const INTENT_CATEGORIES = ['High intent', 'Medium intent', 'Low intent', 'Support request', 'Complaint', 'Spam'];
const WORKSPACE_PERMISSION_ACTIONS = [
  { key: 'responseExport', label: 'Response exports', defaultRole: 'analyst' },
  { key: 'workspaceExport', label: 'Workspace export', defaultRole: 'admin' },
  { key: 'privacyOperations', label: 'Privacy operations', defaultRole: 'admin' },
  { key: 'retentionOperations', label: 'Retention operations', defaultRole: 'admin' },
  { key: 'auditLogs', label: 'Audit logs', defaultRole: 'admin' },
  { key: 'integrationManagement', label: 'Integration management', defaultRole: 'admin' },
  { key: 'billingManagement', label: 'Billing management', defaultRole: 'owner' },
  { key: 'aiReports', label: 'AI reports', defaultRole: 'analyst' }
];
const COMPLAINT_CATEGORIES = [
  { label: 'Pricing', keywords: ['price', 'pricing', 'expensive', 'cost', 'budget', 'afford', 'overpriced'] },
  { label: 'Service delay', keywords: ['delay', 'delayed', 'slow', 'wait', 'waiting', 'late', 'timeline'] },
  { label: 'Staff behavior', keywords: ['rude', 'staff', 'behavior', 'attitude', 'manager', 'agent', 'representative'] },
  { label: 'Product quality', keywords: ['quality', 'broken', 'defect', 'damaged', 'poor', 'bad', 'faulty'] },
  { label: 'Support issue', keywords: ['support', 'help', 'follow-up', 'followup', 'callback', 'ticket', 'response'] },
  { label: 'Technical issue', keywords: ['technical', 'app', 'website', 'login', 'error', 'crash', 'bug', 'broken'] },
  { label: 'Billing issue', keywords: ['billing', 'bill', 'invoice', 'payment', 'refund', 'charge', 'subscription'] },
  { label: 'Other', keywords: [] }
];
const EICAR_TEST_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'yes_no',
  'rating',
  'nps',
  'csat',
  'ces',
  'star_rating',
  'emoji_rating',
  'date',
  'time',
  'consent',
  'hidden',
  'section',
  'statement',
  'file_upload'
];

class UploadScanError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UploadScanError';
    this.code = 'file_upload_rejected';
    this.details = details;
  }
}

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    priceMonthlyInr: 2999,
    setupFeeRange: 'INR 9,999-14,999',
    limits: { surveys: 3, responsesPerMonth: 500, teamMembers: 2, aiCredits: 25 },
    features: ['3 surveys', '500 responses/month', 'Basic analytics', 'Email alerts', 'CSV export', 'Basic branding']
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMonthlyInr: 7999,
    setupFeeRange: 'INR 24,999-49,999',
    limits: { surveys: 20, responsesPerMonth: 5000, teamMembers: 8, aiCredits: 250 },
    features: ['Website embed', 'Conditional logic', 'Google Sheets profile', 'AI summaries', 'Custom branding']
  },
  {
    id: 'pro',
    name: 'Pro',
    priceMonthlyInr: 19999,
    setupFeeRange: 'INR 75,000+',
    limits: { surveys: -1, responsesPerMonth: 25000, teamMembers: 25, aiCredits: 2000 },
    features: ['Unlimited surveys', 'Advanced AI', 'Webhooks', 'Custom domain profile', 'Team roles']
  },
  {
    id: 'agency',
    name: 'Agency',
    priceMonthlyInr: 49999,
    setupFeeRange: 'Custom',
    limits: { surveys: -1, responsesPerMonth: 100000, teamMembers: 100, aiCredits: 10000 },
    features: ['Multiple client workspaces', 'White-label controls', 'Client dashboard', 'Priority support']
  }
];

const SURVEY_TEMPLATES = [
  {
    id: 'customer-feedback',
    name: 'Customer Feedback + Complaint Alert',
    type: 'feedback_form',
    description: 'Collect satisfaction, complaints, and improvement ideas from customers.',
    schema: {
      title: 'Customer Feedback Survey',
      description: 'Help us improve your experience.',
      questions: [
        question('csat', 'How satisfied are you with your experience?', true, { scale: 5, lowLabel: 'Very dissatisfied', highLabel: 'Very satisfied' }),
        question('nps', 'How likely are you to recommend us?', true, { scale: 10 }),
        question('long_text', 'What can we improve?', false, { placeholder: 'Tell us what would make the experience better.' }),
        question('email', 'Email address for follow-up', false, { placeholder: 'you@example.com' }),
        question('consent', 'I agree to be contacted about this feedback.', false, { consentText: 'I agree to follow-up contact.' })
      ],
      logic: [],
      completion: { type: 'message', message: 'Thank you. Your feedback helps us improve.' }
    }
  },
  {
    id: 'lead-qualification',
    name: 'Lead Qualification Form',
    type: 'lead_capture',
    description: 'Capture budget, urgency, and service fit for sales follow-up.',
    schema: {
      title: 'Project Inquiry',
      description: 'Tell us what you need and we will recommend the next step.',
      questions: [
        question('short_text', 'Full name', true, { placeholder: 'Your name' }),
        question('email', 'Email address', true, { placeholder: 'you@example.com' }),
        question('single_choice', 'What is your budget range?', true, { options: ['Under INR 25,000', 'INR 25,000-75,000', 'INR 75,000+', 'Not sure yet'] }),
        question('single_choice', 'How soon do you want to start?', true, { options: ['Immediately', 'This month', 'This quarter', 'Just researching'] }),
        question('long_text', 'What outcome are you trying to achieve?', true, { placeholder: 'Describe the work or problem.' })
      ],
      logic: [],
      completion: { type: 'message', message: 'Thanks. We will review your inquiry and respond soon.' }
    }
  },
  {
    id: 'employee-pulse',
    name: 'Employee Pulse Survey',
    type: 'employee_pulse',
    description: 'Anonymous-friendly pulse survey for morale and attrition risk.',
    schema: {
      title: 'Employee Pulse Check',
      description: 'A short check-in to understand what is working and what needs attention.',
      questions: [
        question('rating', 'How would you rate your current workload?', true, { scale: 5, lowLabel: 'Too low', highLabel: 'Too high' }),
        question('rating', 'How supported do you feel by your manager?', true, { scale: 5, lowLabel: 'Not supported', highLabel: 'Very supported' }),
        question('long_text', 'What is one thing leadership should improve?', false, { placeholder: 'Share anything that would help.' }),
        question('consent', 'I understand this feedback may be reviewed by HR.', true, { consentText: 'I understand.' })
      ],
      logic: [],
      completion: { type: 'message', message: 'Thank you for sharing honest feedback.' }
    }
  },
  {
    id: 'saas-onboarding',
    name: 'SaaS Onboarding Feedback',
    type: 'product_feedback',
    description: 'Measure product onboarding quality and collect blockers.',
    schema: {
      title: 'Onboarding Feedback',
      description: 'Help us make setup easier for new users.',
      questions: [
        question('ces', 'How easy was it to complete onboarding?', true, { scale: 7 }),
        question('single_choice', 'What best describes your current status?', true, { options: ['Fully set up', 'Partially set up', 'Blocked', 'Still exploring'] }),
        question('long_text', 'What confused you or slowed you down?', false, { placeholder: 'Mention any blockers.' }),
        question('email', 'Email for follow-up', false, { placeholder: 'you@example.com' })
      ],
      logic: [],
      completion: { type: 'message', message: 'Thanks. We use this feedback to improve onboarding.' }
    }
  }
];

function listAvailableTemplates(db, workspaceId = '') {
  return [
    ...SURVEY_TEMPLATES.map((template) => templateResponse(template, { source: 'system', status: 'published', visibility: 'global' })),
    ...db.customTemplates
      .filter((template) => templateAvailableToWorkspace(template, workspaceId))
      .map((template) => templateResponse(template, { source: template.source || 'custom' }))
  ];
}

function templateAvailableToWorkspace(template, workspaceId = '') {
  if (!template || template.status === 'archived') return false;
  if (template.workspaceId) return Boolean(workspaceId && template.workspaceId === workspaceId);
  return template.status === 'published';
}

function findSurveyTemplate(db, templateId, workspaceId = '') {
  const id = cleanText(templateId || '', 120);
  if (!id) return null;
  const systemTemplate = SURVEY_TEMPLATES.find((template) => template.id === id);
  if (systemTemplate) return systemTemplate;
  return db.customTemplates.find((template) => template.id === id && templateAvailableToWorkspace(template, workspaceId)) || null;
}

function markTemplateUsed(db, template) {
  if (!template) return;
  const customTemplate = db.customTemplates.find((item) => item.id === template.id);
  if (!customTemplate) return;
  customTemplate.usageCount = Math.max(0, Number(customTemplate.usageCount || 0)) + 1;
  customTemplate.updatedAt = new Date().toISOString();
}

function createCustomTemplate(createdBy, input = {}, defaults = {}) {
  const schema = normalizeSchema(input.schema || generateSurveySchemaFromPrompt(input));
  const now = new Date().toISOString();
  const workspaceId = cleanText(defaults.workspaceId || input.workspaceId || '', 80);
  return {
    id: makeId('tpl'),
    name: cleanText(input.name || schema.title || 'Custom template', 160),
    type: cleanText(input.type || schema.type || defaults.type || 'feedback_form', 80),
    description: cleanText(input.description || schema.description || '', 500),
    category: cleanText(input.category || defaults.category || 'general', 80),
    industry: cleanText(input.industry || defaults.industry || '', 80),
    useCase: cleanText(input.useCase || defaults.useCase || '', 120),
    tags: normalizeTemplateTags(input.tags || defaults.tags || []),
    schema,
    status: normalizeTemplateStatus(input.status, defaults.status || 'published'),
    visibility: workspaceId ? 'workspace' : normalizeTemplateVisibility(input.visibility || defaults.visibility || 'global'),
    workspaceId: workspaceId || null,
    sourceSurveyId: cleanText(defaults.sourceSurveyId || input.sourceSurveyId || '', 80) || null,
    usageCount: Math.max(0, Number(input.usageCount || 0)),
    createdBy,
    createdAt: now,
    updatedAt: now,
    publishedAt: normalizeTemplateStatus(input.status, defaults.status || 'published') === 'published' ? now : null
  };
}

function createCustomTemplateFromSurvey(db, survey, userId, input = {}) {
  const workspace = db.workspaces.find((item) => item.id === survey.workspaceId);
  return createCustomTemplate(userId, {
    ...input,
    type: survey.type,
    name: input.name || `${survey.title} template`,
    description: input.description || survey.description,
    schema: structuredClone(survey.schema),
    status: input.status || 'draft',
    visibility: 'workspace'
  }, {
    workspaceId: survey.workspaceId,
    sourceSurveyId: survey.id,
    category: survey.type,
    industry: workspace?.industry || ''
  });
}

function updateCustomTemplate(template, input = {}) {
  const previousStatus = template.status;
  if (input.name !== undefined) template.name = cleanText(input.name || template.name, 160);
  if (input.type !== undefined) template.type = cleanText(input.type || template.type, 80);
  if (input.description !== undefined) template.description = cleanText(input.description || '', 500);
  if (input.category !== undefined) template.category = cleanText(input.category || 'general', 80);
  if (input.industry !== undefined) template.industry = cleanText(input.industry || '', 80);
  if (input.useCase !== undefined) template.useCase = cleanText(input.useCase || '', 120);
  if (input.tags !== undefined) template.tags = normalizeTemplateTags(input.tags);
  if (input.schema !== undefined) template.schema = normalizeSchema(input.schema);
  if (input.status !== undefined) template.status = normalizeTemplateStatus(input.status, template.status || 'draft');
  if (!template.workspaceId && input.visibility !== undefined) template.visibility = normalizeTemplateVisibility(input.visibility);
  template.updatedAt = new Date().toISOString();
  if (template.status === 'published' && previousStatus !== 'published') template.publishedAt = template.updatedAt;
  if (template.status !== 'published') template.publishedAt = null;
}

function templateResponse(template, overrides = {}) {
  return {
    ...template,
    ...overrides,
    category: template.category || 'general',
    industry: template.industry || '',
    useCase: template.useCase || '',
    tags: normalizeTemplateTags(template.tags || []),
    schema: structuredClone(template.schema)
  };
}

function normalizeTemplateStatus(value, fallback = 'draft') {
  const status = cleanText(value || fallback, 40);
  return ['draft', 'published', 'archived'].includes(status) ? status : fallback;
}

function normalizeTemplateVisibility(value) {
  const visibility = cleanText(value || 'global', 40);
  return visibility === 'workspace' ? 'workspace' : 'global';
}

function normalizeTemplateTags(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return [...new Set(raw.map((item) => cleanText(item, 40)).filter(Boolean))].slice(0, 12);
}

const publicBuckets = new Map();
const apiBuckets = new Map();
const authBuckets = new Map();

function sweepRateLimitBuckets() {
  const now = Date.now();
  for (const [key, bucket] of publicBuckets.entries()) {
    if (bucket.resetAt < now) publicBuckets.delete(key);
  }
  for (const [key, bucket] of authBuckets.entries()) {
    if (bucket.resetAt < now) authBuckets.delete(key);
  }
  for (const [key, bucket] of apiBuckets.entries()) {
    if (bucket.resetAt < now) apiBuckets.delete(key);
  }
}

function question(type, title, required = false, settings = {}) {
  return {
    id: makeId('q'),
    type,
    title,
    description: '',
    required,
    order: 0,
    settings,
    validation: {}
  };
}

function createServer(options = {}) {
  validateProductionEnvironment(options);
  const state = {
    dataFile: options.dataFile || DEFAULT_DATA_FILE,
    databaseUrl: options.databaseUrl || (options.dataFile ? '' : process.env.DATABASE_URL || ''),
    pgPool: null,
    pgReady: null,
    pgShadow: null,
    surveyViewLastSaved: new Map(),
    redisUrl: options.redisUrl || process.env.REDIS_URL || '',
    bullMqQueue: null,
    bullMqWorker: null,
    bullMqConnection: null,
    db: null,
    dbLoadPromise: null,
    writeQueue: Promise.resolve(),
    saveBatchPromise: null,
    saveDirty: false,
    jobTimer: null,
    rateLimitSweepTimer: null,
    processingJobs: false,
    testFaults: Boolean(options.enableTestFaults)
  };

  const server = http.createServer((req, res) => {
    routeRequest(req, res, state).catch(async (error) => {
      if (error?.code === 'file_upload_rejected') {
        if (!res.headersSent) {
          sendJson(res, 400, { error: { code: error.code, message: error.message, details: error.details || {} } });
        } else {
          res.destroy();
        }
        return;
      }
      if (error?.code === 'body_too_large') {
        if (!res.headersSent) {
          sendJson(res, 413, { error: { code: 'body_too_large', message: 'Request body too large.' } });
        } else {
          res.destroy();
        }
        return;
      }
      if (!state.testFaults) console.error(error);
      await recordErrorLog(state, req, error).catch((logError) => console.error(logError));
      if (!res.headersSent) {
        sendJson(res, 500, { error: { code: 'internal_error', message: 'Something went wrong.' } });
      } else {
        res.destroy();
      }
    });
  });

  server.state = state;
  server.on('listening', () => {
    state.rateLimitSweepTimer = setInterval(() => {
      sweepRateLimitBuckets();
    }, 5 * 60 * 1000);
    state.rateLimitSweepTimer.unref?.();

    if (options.disableWorker || state.jobTimer) return;
    if (bullMqEnabled(state)) {
      startBullMqWorker(state).catch((error) => console.error('BullMQ worker failed to start', error));
    }
    state.jobTimer = setInterval(() => {
      processDueJobs(state).catch((error) => console.error('Job worker failed', error));
    }, JOB_POLL_INTERVAL_MS);
    state.jobTimer.unref?.();
  });
  server.on('close', () => {
    if (state.rateLimitSweepTimer) clearInterval(state.rateLimitSweepTimer);
    state.rateLimitSweepTimer = null;
    if (state.jobTimer) clearInterval(state.jobTimer);
    state.jobTimer = null;
    if (state.pgLockClient) {
      state.pgLockClient.query('SELECT pg_advisory_unlock($1)', [4159283748291029n])
        .then(() => state.pgLockClient.release(true))
        .catch(() => {})
        .finally(() => { state.pgLockClient = null; });
    }
    if (state.pgPool) state.pgPool.end().catch((error) => console.error('PostgreSQL pool close failed', error));
    closeBullMq(state).catch((error) => console.error('BullMQ close failed', error));
  });
  return server;
}

async function routeRequest(req, res, state) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (state.testFaults && url.pathname === '/api/__test__/boom') {
    throw new Error('Intentional test fault for error logging.');
  }

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url, state);
    return;
  }

  if (url.pathname === '/privacy') {
    await sendFile(req, res, path.join(PUBLIC_DIR, 'privacy.html'), 'text/html; charset=utf-8');
    return;
  }

  if (url.pathname === '/terms') {
    await sendFile(req, res, path.join(PUBLIC_DIR, 'terms.html'), 'text/html; charset=utf-8');
    return;
  }

  if (url.pathname === '/' || url.pathname === '/app') {
    await sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
    return;
  }

  if (url.pathname.startsWith('/s/')) {
    await sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8', embeddableSecurityHeaders);
    return;
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const target = path.resolve(PUBLIC_DIR, safePath);
  const resolvedPublicDir = path.resolve(PUBLIC_DIR);
  if (target !== resolvedPublicDir && !target.startsWith(resolvedPublicDir + path.sep)) {
    sendJson(res, 403, { error: { code: 'forbidden', message: 'Forbidden.' } });
    return;
  }

  await sendFile(req, res, target);
}

function requireFeature(res, name) {
  if (featureEnabled(name)) return true;
  sendJson(res, 404, { error: { code: 'feature_disabled', message: 'This feature is not enabled.' } });
  return false;
}

async function handleApi(req, res, url, state) {
  const isPublicApi = url.pathname === '/api/public' || url.pathname.startsWith('/api/public/');
  if (isPublicApi) {
    res.setHeader('access-control-allow-origin', '*');
    if ((req.method || 'GET') === 'OPTIONS') {
      res.writeHead(204, withSecurityHeaders({
        'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600'
      }));
      res.end();
      return;
    }
  }
  if (!sameOriginAllowed(req, url)) {
    sendJson(res, 403, { error: { code: 'csrf_blocked', message: 'Cross-site state changing requests are blocked.' } });
    return;
  }
  const db = await getDb(state);
  const method = req.method || 'GET';
  const segments = url.pathname.split('/').filter(Boolean).slice(1);

  if (method === 'GET' && segments[0] === 'health') {
    sendJson(res, 200, { ok: true, service: 'FeedbackOS', time: new Date().toISOString() });
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'signup' && method === 'POST') {
    await handleSignup(req, res, db, state);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'login' && method === 'POST') {
    await handleLogin(req, res, db, state);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === '2fa' && segments[2] === 'verify' && method === 'POST') {
    await handleTwoFactorVerify(req, res, db, state);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'oauth' && segments[2] === 'google' && segments[3] === 'start' && method === 'POST') {
    await handleGoogleOAuthStart(req, res, url, db, state);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'oauth' && segments[2] === 'google' && segments[3] === 'callback' && method === 'GET') {
    await handleGoogleOAuthCallback(req, res, url, db, state);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'sso' && !requireFeature(res, 'sso')) return;

  if (segments[0] === 'auth' && segments[1] === 'sso' && segments[2] === 'start' && method === 'POST') {
    await handleSsoStart(req, res, url, db, state);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'sso' && segments[2] === 'assertion' && method === 'POST') {
    await handleSsoAssertion(req, res, url, db, state);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'sso' && segments[2] === 'dev-login' && method === 'POST') {
    await handleSsoDevLogin(req, res, db, state);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'sso' && segments[2] === 'metadata' && segments[3] && method === 'GET') {
    await handleSsoMetadata(req, res, url, db, segments[3]);
    return;
  }

  if (segments[0] === 'auth' && segments[1] === 'invite-signup' && method === 'POST') {
    await handleInviteSignup(req, res, db, state);
    return;
  }

  if (await handleAuthCredentialRoute({
    req, res, segments, db, state, readJson, cleanEmail, authRateAllowed, sendJson,
    makeId, hashToken, queueEmailJob, audit, saveDb, hashPassword,
    createEmailVerificationToken, publicUser
  })) return;

  if (segments[0] === 'auth' && segments[1] === 'logout' && method === 'POST') {
    const session = getSession(req, db);
    if (session) db.sessions = db.sessions.filter((item) => item.id !== session.id);
    await saveDb(state);
    setSessionCookie(res, '', new Date(0));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (segments[0] === 'v1') {
    if (!requireFeature(res, 'apiV1')) return;
    await handleApiV1(req, res, url, segments.slice(1), db, state);
    return;
  }

  if (segments[0] === 'public') {
    await handlePublic(req, res, url, segments.slice(1), db, state);
    return;
  }

  if (segments[0] === 'billing' && segments[1] === 'webhook' && method === 'POST') {
    await handleBillingWebhook(req, res, segments[2] || '', db, state);
    return;
  }

  if (segments[0] === 'cron' && segments[1] === 'run' && method === 'POST') {
    await handleCronRun(req, res, state);
    return;
  }

  if (segments[0] === 'agency' && !requireFeature(res, 'agency')) return;
  if (segments[0] === 'campaigns' && !requireFeature(res, 'campaigns')) return;

  const auth = requireUser(req, res, db);
  if (!auth) return;

  if (segments[0] === 'session' && method === 'GET') {
    sendJson(res, 200, buildSessionPayload(db, auth.user));
    return;
  }

  if (segments[0] === 'profile') {
    await handleProfile(req, res, segments.slice(1), db, state, auth.user, auth.session);
    return;
  }

  if (segments[0] === 'sessions') {
    await handleSessions(req, res, segments.slice(1), db, state, auth.user, auth.session);
    return;
  }

  if (segments[0] === 'analytics' && segments[1] === 'benchmark' && method === 'GET') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!requireWorkspace(res, db, auth.user, workspaceId, 'viewer')) return;
    sendJson(res, 200, buildWorkspaceBenchmark(db, workspaceId, url));
    return;
  }

  if (segments[0] === 'agency' && segments[1] === 'overview' && method === 'GET') {
    const requestedWorkspaceId = url.searchParams.get('workspaceId') || defaultAgencyWorkspaceId(db, auth.user);
    if (!requestedWorkspaceId) {
      sendJson(res, 400, { error: { code: 'workspace_required', message: 'Agency overview requires a workspace.' } });
      return;
    }
    const membership = requireWorkspace(res, db, auth.user, requestedWorkspaceId, 'admin');
    if (!membership) return;
    const selectedPlanId = workspacePlanId(db, membership.workspace);
    if (auth.user.platformRole !== 'super_admin' && selectedPlanId !== 'agency') {
      sendJson(res, 402, { error: { code: 'agency_plan_required', message: 'Agency overview requires the Agency plan.' } });
      return;
    }
    sendJson(res, 200, buildAgencyOverview(db, auth.user, membership.workspace.id));
    return;
  }

  if (segments[0] === 'plans' && method === 'GET') {
    sendJson(res, 200, { plans: billingPlans(db) });
    return;
  }

  if (segments[0] === 'templates' && method === 'GET') {
    const workspaceId = url.searchParams.get('workspaceId') || '';
    if (workspaceId && !requireWorkspace(res, db, auth.user, workspaceId, 'viewer')) return;
    sendJson(res, 200, { templates: listAvailableTemplates(db, workspaceId) });
    return;
  }

  if (segments[0] === 'workspaces') {
    await handleWorkspaces(req, res, url, segments.slice(1), db, state, auth.user);
    return;
  }

  if (segments[0] === 'surveys') {
    await handleSurveys(req, res, url, segments.slice(1), db, state, auth.user);
    return;
  }

  if (segments[0] === 'alerts') {
    await handleAlerts(req, res, url, segments.slice(1), db, state, auth.user);
    return;
  }

  if (segments[0] === 'integrations') {
    await handleIntegrations(req, res, url, segments.slice(1), db, state, auth.user);
    return;
  }

  if (segments[0] === 'contacts') {
    await handleContacts(req, res, url, segments.slice(1), db, state, auth.user);
    return;
  }

  if (segments[0] === 'file-uploads') {
    await handleFileUploads(req, res, segments.slice(1), db, auth.user);
    return;
  }

  if (segments[0] === 'campaigns') {
    await handleCampaigns(req, res, url, segments.slice(1), db, state, auth.user);
    return;
  }

  if (segments[0] === 'ai') {
    await handleAiTools(req, res, segments.slice(1), db, state, auth.user);
    return;
  }

  if (segments[0] === 'billing') {
    await handleBilling(req, res, url, segments.slice(1), db, state, auth.user);
    return;
  }

  if (segments[0] === 'jobs' && segments[1] === 'drain' && method === 'POST') {
    if (auth.user.platformRole !== 'super_admin') {
      sendJson(res, 403, { error: { code: 'forbidden', message: 'Super admin access required.' } });
      return;
    }
    const result = await processDueJobs(state, { force: true });
    sendJson(res, 200, result);
    return;
  }

  if (segments[0] === 'notifications' && method === 'GET') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!requireWorkspace(res, db, auth.user, workspaceId, 'viewer')) return;
    const notifications = db.notifications.filter((item) => item.workspaceId === workspaceId).slice(-50).reverse();
    sendJson(res, 200, { notifications });
    return;
  }

  if (segments[0] === 'admin' && segments[1] === 'overview' && method === 'GET') {
    if (auth.user.platformRole !== 'super_admin') {
      sendJson(res, 403, { error: { code: 'forbidden', message: 'Super admin access required.' } });
      return;
    }
    sendJson(res, 200, buildAdminOverview(db));
    return;
  }

  if (segments[0] === 'admin') {
    await handleAdmin(req, res, url, segments.slice(1), db, state, auth.user);
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'API route not found.' } });
}

async function handleSignup(req, res, db, state) {
  const body = await readJson(req);
  const name = cleanText(body.name, 120);
  const email = cleanEmail(body.email);
  if (!authRateAllowed(`signup:${clientIp(req)}`)) {
    sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } });
    return;
  }
  const rlKey = `${clientIp(req)}:${email}`;
  if (!authRateAllowed(rlKey)) {
    sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } });
    return;
  }
  const password = String(body.password || '');
  const workspaceName = cleanText(body.workspaceName || `${name || 'My'} Workspace`, 120);
  const acceptedTerms = body.acceptTerms === true || body.acceptTerms === 'true' || body.acceptTerms === 'on';

  if (!name || !email || password.length < 8) {
    sendJson(res, 400, { error: { code: 'invalid_signup', message: 'Name, valid email, and an 8+ character password are required.' } });
    return;
  }

  if (!acceptedTerms) {
    sendJson(res, 400, { error: { code: 'terms_required', message: 'You must accept the terms and privacy policy to create an account.' } });
    return;
  }

  if (db.users.some((user) => user.email === email)) {
    sendJson(res, 409, { error: { code: 'email_exists', message: 'An account with this email already exists.' } });
    return;
  }

  const user = {
    id: makeId('usr'),
    name,
    email,
    avatarUrl: '',
    password: await hashPassword(password),
    emailVerifiedAt: platformSettings(db).requireEmailVerification ? null : new Date().toISOString(),
    platformRole: bootstrapPlatformRole(db, email),
    timezone: cleanTimezone(body.timezone, 'Asia/Kolkata'),
    notificationPreferences: { emailAlerts: true, weeklyDigest: true },
    termsAcceptedAt: new Date().toISOString(),
    privacyAcceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const workspace = createWorkspace({
    name: workspaceName,
    ownerId: user.id,
    industry: cleanText(body.industry || 'General services', 80),
    companySize: cleanText(body.companySize || '1-10', 40),
    timezone: user.timezone
  });

  db.users.push(user);
  db.workspaces.push(workspace);
  db.workspaceMembers.push({
    id: makeId('mem'),
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
    invitedBy: user.id,
    joinedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  });
  db.subscriptions.push(createSubscription(workspace.id, 'starter'));
  db.usageMeters.push(createUsageMeter(workspace.id));
  db.auditLogs.push(audit(workspace.id, user.id, 'workspace.created', 'workspace', workspace.id, { name: workspace.name }));

  if (platformSettings(db).requireEmailVerification) {
    const verification = createEmailVerificationToken(db, user);
    db.auditLogs.push(audit(null, user.id, 'auth.email_verification_required', 'user', user.id, {}));
    await saveDb(state);
    sendJson(res, 201, {
      emailVerificationRequired: true,
      user: publicUser(user),
      plans: billingPlans(db)
    });
    return;
  }

  const session = createSession(user.id);
  db.sessions.push(session);
  await saveDb(state);
  setSessionCookie(res, session.token, new Date(session.expiresAt));
  sendJson(res, 201, buildSessionPayload(db, user));
}

async function handleLogin(req, res, db, state) {
  const body = await readJson(req);
  const email = cleanEmail(body.email);
  const rlKey = `${clientIp(req)}:${email}`;
  if (!authRateAllowed(rlKey)) {
    sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } });
    return;
  }
  const password = String(body.password || '');
  const rememberMe = parseBoolean(body.rememberMe || body.remember);
  const user = db.users.find((item) => item.email === email);

  if (!user || user.disabled || !(await verifyPassword(password, user.password))) {
    sendJson(res, 401, { error: { code: 'invalid_login', message: 'Email or password is incorrect.' } });
    return;
  }

  if (emailVerificationRequiredForUser(db, user)) {
    const verification = createEmailVerificationToken(db, user);
    db.auditLogs.push(audit(null, user.id, 'auth.email_verification_required', 'user', user.id, {}));
    await saveDb(state);
    sendJson(res, 403, {
      error: { code: 'email_verification_required', message: 'Verify your email before signing in.' },
      email: user.email
    });
    return;
  }

  if (featureEnabled('sso')) {
    const enforcedSso = enforcedSsoWorkspaceForEmail(db, user.email);
    if (enforcedSso && db.workspaceMembers.some((member) => member.workspaceId === enforcedSso.id && member.userId === user.id)) {
      sendJson(res, 403, { error: { code: 'sso_required', message: 'This workspace requires SSO sign-in.', workspaceId: enforcedSso.id } });
      return;
    }
  }

  if (user.twoFactorEnabled) {
    const challenge = createTwoFactorChallenge(user.id, { rememberMe });
    db.twoFactorChallenges.push(challenge.record);
    pruneTwoFactorChallenges(db);
    db.auditLogs.push(audit(null, user.id, 'auth.two_factor_challenge_created', 'user', user.id, { rememberMe }));
    await saveDb(state);
    sendJson(res, 200, {
      requiresTwoFactor: true,
      challengeId: challenge.record.id,
      challengeToken: challenge.token,
      expiresAt: challenge.record.expiresAt,
      user: { id: user.id, email: user.email }
    });
    return;
  }

  const session = createSession(user.id, { rememberMe });
  db.sessions.push(session);
  db.auditLogs.push(audit(null, user.id, 'auth.login', 'user', user.id, { rememberMe }));
  await saveDb(state);
  setSessionCookie(res, session.token, new Date(session.expiresAt));
  sendJson(res, 200, buildSessionPayload(db, user));
}

async function handleTwoFactorVerify(req, res, db, state) {
  const body = await readJson(req);
  const challengeId = cleanText(body.challengeId || '', 100);
  const challengeToken = cleanText(body.challengeToken || '', 160);
  const code = cleanText(body.code || body.recoveryCode || '', 80);
  const challenge = db.twoFactorChallenges.find((item) => item.id === challengeId && !item.usedAt);
  if (!challenge || new Date(challenge.expiresAt).getTime() < Date.now() || challenge.tokenHash !== hashToken(challengeToken)) {
    sendJson(res, 401, { error: { code: 'invalid_two_factor_challenge', message: 'Two-factor challenge is invalid or expired.' } });
    return;
  }
  const user = db.users.find((item) => item.id === challenge.userId);
  if (!user || user.disabled || !user.twoFactorEnabled) {
    sendJson(res, 401, { error: { code: 'invalid_two_factor_challenge', message: 'Two-factor challenge is no longer valid.' } });
    return;
  }
  const verified = verifyTwoFactorCode(user, code) || consumeRecoveryCode(user, code);
  if (!verified) {
    challenge.attempts = Number(challenge.attempts || 0) + 1;
    challenge.updatedAt = new Date().toISOString();
    if (challenge.attempts >= 5) challenge.usedAt = challenge.updatedAt;
    db.auditLogs.push(audit(null, user.id, 'auth.two_factor_failed', 'user', user.id, { attempts: challenge.attempts }));
    await saveDb(state);
    sendJson(res, 401, { error: { code: 'invalid_two_factor_code', message: 'Two-factor code is incorrect.' } });
    return;
  }
  challenge.usedAt = new Date().toISOString();
  const session = createSession(user.id, { rememberMe: challenge.rememberMe });
  db.sessions.push(session);
  db.auditLogs.push(audit(null, user.id, 'auth.login', 'user', user.id, { twoFactor: true, method: verified, rememberMe: Boolean(challenge.rememberMe) }));
  await saveDb(state);
  setSessionCookie(res, session.token, new Date(session.expiresAt));
  sendJson(res, 200, buildSessionPayload(db, user));
}

async function handleGoogleOAuthStart(req, res, url, db, state) {
  const body = await readJson(req);
  const config = googleOAuthConfig(url);
  if (!config.configured) {
    sendJson(res, 503, { error: { code: 'oauth_not_configured', message: 'Google OAuth is not configured.' }, oauth: googleOAuthPublicConfig(config) });
    return;
  }
  const mode = cleanText(body.mode || 'login', 20) === 'signup' ? 'signup' : 'login';
  const acceptedTerms = body.acceptTerms === true || body.acceptTerms === 'true' || body.acceptTerms === 'on';
  if (mode === 'signup' && !acceptedTerms) {
    sendJson(res, 400, { error: { code: 'terms_required', message: 'You must accept the terms and privacy policy to create an account.' } });
    return;
  }
  const stateToken = `fo_oauth_${crypto.randomBytes(24).toString('hex')}`;
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const request = {
    id: makeId('oauth'),
    provider: 'google',
    stateHash: hashToken(stateToken),
    codeVerifier,
    mode,
    responseMode: cleanText(body.responseMode || '', 20) === 'json' ? 'json' : 'redirect',
    name: cleanText(body.name || '', 120),
    workspaceName: cleanText(body.workspaceName || '', 120),
    industry: cleanText(body.industry || 'General services', 80),
    companySize: cleanText(body.companySize || '1-10', 40),
    timezone: cleanTimezone(body.timezone, 'Asia/Kolkata'),
    acceptedTerms,
    status: 'pending',
    expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
    createdAt: new Date().toISOString(),
    completedAt: ''
  };
  db.oauthAuthRequests.push(request);
  db.oauthAuthRequests = db.oauthAuthRequests.filter((item) => !item.completedAt && new Date(item.expiresAt).getTime() > Date.now());
  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', config.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', config.scope);
  authUrl.searchParams.set('state', stateToken);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'select_account');
  db.auditLogs.push(audit(null, null, 'auth.oauth_started', 'oauth_request', request.id, { provider: 'google', mode }));
  await saveDb(state);
  sendJson(res, 200, { oauth: { provider: 'google', authorizationUrl: authUrl.toString(), state: stateToken, expiresAt: request.expiresAt } });
}

async function handleGoogleOAuthCallback(req, res, url, db, state) {
  const config = googleOAuthConfig(url);
  if (!config.configured) {
    sendJson(res, 503, { error: { code: 'oauth_not_configured', message: 'Google OAuth is not configured.' } });
    return;
  }
  const stateToken = cleanText(url.searchParams.get('state') || '', 200);
  const code = cleanText(url.searchParams.get('code') || '', 2000);
  const error = cleanText(url.searchParams.get('error') || '', 200);
  const request = db.oauthAuthRequests.find((item) => !item.completedAt && item.provider === 'google' && item.stateHash === hashToken(stateToken));
  if (error) {
    sendJson(res, 400, { error: { code: 'oauth_denied', message: `Google OAuth returned ${error}.` } });
    return;
  }
  if (!request || new Date(request.expiresAt).getTime() < Date.now()) {
    sendJson(res, 400, { error: { code: 'invalid_oauth_state', message: 'OAuth state is invalid or expired.' } });
    return;
  }
  if (!code) {
    sendJson(res, 400, { error: { code: 'oauth_code_required', message: 'OAuth callback is missing an authorization code.' } });
    return;
  }
  try {
    const tokens = await exchangeGoogleOAuthCode(config, code, request);
    const profile = await fetchGoogleOAuthProfile(config, tokens);
    const result = await completeGoogleOAuthLogin(db, profile, request);
    request.completedAt = new Date().toISOString();
    request.status = 'completed';
    const policyError = postIdentityPolicyError(db, result.user, { federated: true });
    if (policyError) {
      db.auditLogs.push(audit(result.workspaceId || null, result.user.id, 'auth.oauth_policy_blocked', 'user', result.user.id, { provider: 'google', code: policyError.code }));
      await saveDb(state);
      sendJson(res, 403, { error: policyError });
      return;
    }
    const session = createSession(result.user.id);
    db.sessions.push(session);
    db.auditLogs.push(audit(result.workspaceId || null, result.user.id, result.created ? 'auth.oauth_signup' : 'auth.oauth_login', 'user', result.user.id, { provider: 'google' }));
    await saveDb(state);
    setSessionCookie(res, session.token, new Date(session.expiresAt));
    if (request.responseMode === 'json') {
      sendJson(res, result.created ? 201 : 200, buildSessionPayload(db, result.user));
      return;
    }
    res.writeHead(302, withSecurityHeaders({ location: '/' }));
    res.end();
  } catch (callbackError) {
    request.status = 'failed';
    request.lastError = cleanText(callbackError.message || String(callbackError), 300);
    db.auditLogs.push(audit(null, null, 'auth.oauth_failed', 'oauth_request', request.id, { provider: 'google', message: request.lastError }));
    await saveDb(state);
    sendJson(res, 400, { error: { code: 'oauth_failed', message: request.lastError } });
  }
}

async function handleSsoStart(req, res, url, db, state) {
  const body = await readJson(req);
  const email = cleanEmail(body.email || '', true);
  const workspace = findSsoWorkspace(db, body.workspaceId, email, body.workspaceSlug);
  if (!workspace || !workspace.sso?.enabled) {
    sendJson(res, 404, { error: { code: 'sso_not_configured', message: 'SSO is not configured for this workspace or email domain.' } });
    return;
  }
  if (email && !ssoEmailAllowed(workspace, email)) {
    sendJson(res, 403, { error: { code: 'sso_domain_not_allowed', message: 'This email domain is not allowed for workspace SSO.' } });
    return;
  }
  const request = createSsoRequest(workspace, email);
  db.ssoAuthRequests.push(request);
  db.ssoAuthRequests = db.ssoAuthRequests.filter((item) => !item.completedAt && new Date(item.expiresAt).getTime() > Date.now());
  db.auditLogs.push(audit(workspace.id, null, 'auth.sso_started', 'workspace', workspace.id, { email: email ? maskEmail(email) : '' }));
  await saveDb(state);
  sendJson(res, 200, { sso: ssoStartPayload(url, workspace, request) });
}

async function handleSsoDevLogin(req, res, db, state) {
  if (process.env.NODE_ENV === 'production') {
    sendJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
    return;
  }
  const body = await readJson(req);
  const requestId = cleanText(body.requestId || '', 80);
  const relayState = cleanText(body.relayState || '', 120);
  const request = db.ssoAuthRequests.find((item) => !item.completedAt && item.id === requestId && (!relayState || item.relayState === relayState));
  if (!request || new Date(request.expiresAt).getTime() < Date.now()) {
    sendJson(res, 400, { error: { code: 'invalid_sso_request', message: 'SSO request is invalid or expired.' } });
    return;
  }
  const workspace = db.workspaces.find((item) => item.id === request.workspaceId);
  if (!workspace || !workspace.sso?.enabled || !workspace.sso.devMode) {
    sendJson(res, 403, { error: { code: 'sso_dev_mode_disabled', message: 'Local SSO dev login is disabled for this workspace.' } });
    return;
  }
  const email = cleanEmail(body.email || request.email || '');
  const name = cleanText(body.name || email.split('@')[0] || 'SSO User', 120);
  if (!email || !ssoEmailAllowed(workspace, email)) {
    sendJson(res, 403, { error: { code: 'sso_domain_not_allowed', message: 'This email domain is not allowed for workspace SSO.' } });
    return;
  }
  await completeSsoLogin(req, res, db, state, workspace, request, email, name, 'auth.sso_dev_login');
}

async function handleSsoAssertion(req, res, url, db, state) {
  const body = await readJson(req);
  const relayState = cleanText(body.RelayState || body.relayState || '', 160);
  const samlResponse = cleanText(body.SAMLResponse || body.samlResponse || '', MAX_BODY_BYTES);
  const detachedSignature = cleanText(body.Signature || body.signature || '', 12000);
  const parsed = parseSamlResponsePayload(samlResponse);
  if (!parsed.ok) {
    sendJson(res, 400, { error: { code: 'invalid_saml_response', message: parsed.message } });
    return;
  }
  const requestId = parsed.assertion.inResponseTo || cleanText(body.requestId || '', 80);
  const request = db.ssoAuthRequests.find((item) => !item.completedAt && item.id === requestId && (!relayState || item.relayState === relayState));
  if (!request || new Date(request.expiresAt).getTime() < Date.now()) {
    sendJson(res, 400, { error: { code: 'invalid_sso_request', message: 'SSO request is invalid or expired.' } });
    return;
  }
  const workspace = db.workspaces.find((item) => item.id === request.workspaceId);
  if (!workspace || !workspace.sso?.enabled) {
    sendJson(res, 403, { error: { code: 'sso_not_configured', message: 'SSO is not configured for this workspace.' } });
    return;
  }
  const validation = validateSsoAssertion(parsed.assertion, { samlResponse, detachedSignature, url, workspace, request });
  if (!validation.ok) {
    db.auditLogs.push(audit(workspace.id, null, 'auth.sso_assertion_rejected', 'workspace', workspace.id, { code: validation.code, message: validation.message }));
    await saveDb(state);
    sendJson(res, validation.status || 403, { error: { code: validation.code, message: validation.message } });
    return;
  }
  await completeSsoLogin(req, res, db, state, workspace, request, validation.email, validation.name, 'auth.sso_assertion_login');
}

async function completeSsoLogin(req, res, db, state, workspace, request, email, name, auditAction = 'auth.sso_login') {
  let user = db.users.find((item) => item.email === email);
  if (!user) {
    if (!workspace.sso.jitProvisioning) {
      sendJson(res, 403, { error: { code: 'sso_user_not_invited', message: 'SSO user is not provisioned and JIT provisioning is disabled.' } });
      return;
    }
    user = await createSsoUser(email, name, workspace);
    db.users.push(user);
  }
  if (user.disabled) {
    sendJson(res, 403, { error: { code: 'user_disabled', message: 'This user is disabled.' } });
    return;
  }
  let membership = db.workspaceMembers.find((item) => item.workspaceId === workspace.id && item.userId === user.id);
  if (!membership) {
    if (!workspace.sso.jitProvisioning) {
      sendJson(res, 403, { error: { code: 'sso_user_not_invited', message: 'SSO user is not a workspace member and JIT provisioning is disabled.' } });
      return;
    }
    membership = {
      id: makeId('mem'),
      workspaceId: workspace.id,
      userId: user.id,
      role: workspace.sso.defaultRole || 'viewer',
      invitedBy: null,
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    db.workspaceMembers.push(membership);
    syncTeamMemberUsage(db, workspace.id);
  }
  request.completedAt = new Date().toISOString();
  request.email = email;
  request.status = 'completed';
  const session = createSession(user.id);
  db.sessions.push(session);
  db.auditLogs.push(audit(workspace.id, user.id, auditAction, 'user', user.id, { providerName: workspace.sso.providerName, role: membership.role }));
  await saveDb(state);
  setSessionCookie(res, session.token, new Date(session.expiresAt));
  sendJson(res, 200, buildSessionPayload(db, user));
}

async function handleSsoMetadata(req, res, url, db, workspaceId) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  if (!workspace || !workspace.sso?.enabled) {
    sendJson(res, 404, { error: { code: 'sso_not_configured', message: 'SSO is not configured for this workspace.' } });
    return;
  }
  const xml = buildSsoMetadataXml(url, workspace);
  res.writeHead(200, withSecurityHeaders({ 'content-type': 'application/samlmetadata+xml; charset=utf-8' }));
  res.end(xml);
}

async function handleInviteSignup(req, res, db, state) {
  const body = await readJson(req);
  const token = cleanText(body.token, 200);
  const email = cleanEmail(body.email);
  const password = String(body.password || '');
  const name = cleanText(body.name || email.split('@')[0], 120);
  const invite = db.workspaceInvites.find((item) => item.status === 'pending' && item.tokenHash === hashToken(token));

  if (!invite || new Date(invite.expiresAt).getTime() < Date.now()) {
    sendJson(res, 400, { error: { code: 'invalid_invite', message: 'Invite token is invalid or expired.' } });
    return;
  }
  if (invite.email !== email) {
    sendJson(res, 403, { error: { code: 'invite_email_mismatch', message: 'Invite token is restricted to the invited email.' } });
    return;
  }
  if (password.length < 8 && !db.users.some((user) => user.email === email)) {
    sendJson(res, 400, { error: { code: 'invalid_signup', message: 'A new invited user needs an 8+ character password.' } });
    return;
  }

  let user = db.users.find((item) => item.email === email);
  if (!user) {
    user = {
      id: makeId('usr'),
      name,
      email,
      avatarUrl: '',
      password: await hashPassword(password),
      emailVerifiedAt: new Date().toISOString(),
      platformRole: 'user',
      timezone: cleanTimezone(body.timezone, 'Asia/Kolkata'),
      notificationPreferences: { emailAlerts: true, weeklyDigest: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.users.push(user);
  }

  const existingMember = db.workspaceMembers.find((item) => item.workspaceId === invite.workspaceId && item.userId === user.id);
  if (!existingMember) {
    db.workspaceMembers.push({
      id: makeId('mem'),
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role,
      invitedBy: invite.invitedBy,
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });
    syncTeamMemberUsage(db, invite.workspaceId);
  }

  invite.status = 'accepted';
  invite.acceptedAt = new Date().toISOString();
  const session = createSession(user.id);
  db.sessions.push(session);
  db.auditLogs.push(audit(invite.workspaceId, user.id, 'workspace.invite_accepted', 'workspace_invite', invite.id, { role: invite.role }));
  await saveDb(state);
  setSessionCookie(res, session.token, new Date(session.expiresAt));
  sendJson(res, 200, buildSessionPayload(db, user));
}

async function handleProfile(req, res, segments, db, state, user) {
  if (segments.length === 0 && req.method === 'GET') {
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }
  if (segments.length === 0 && req.method === 'PUT') {
    const body = await readJson(req);
    user.name = cleanText(body.name ?? user.name, 120);
    user.avatarUrl = cleanUrl(body.avatarUrl ?? user.avatarUrl);
    user.timezone = cleanTimezone(body.timezone, user.timezone);
    user.notificationPreferences = {
      ...user.notificationPreferences,
      ...(body.notificationPreferences && typeof body.notificationPreferences === 'object' ? body.notificationPreferences : {})
    };
    user.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(null, user.id, 'profile.updated', 'user', user.id, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }
  if (segments[0] === '2fa' && segments[1] === 'setup' && req.method === 'POST') {
    const secret = createTwoFactorSecret();
    user.twoFactorPendingSecret = secret;
    user.twoFactorPendingAt = new Date().toISOString();
    user.updatedAt = user.twoFactorPendingAt;
    db.auditLogs.push(audit(null, user.id, 'profile.two_factor_setup_started', 'user', user.id, {}));
    await saveDb(state);
    sendJson(res, 200, { setup: twoFactorSetupPayload(user, secret) });
    return;
  }
  if (segments[0] === '2fa' && segments[1] === 'enable' && req.method === 'POST') {
    const body = await readJson(req);
    const secret = user.twoFactorPendingSecret || user.twoFactorSecret;
    if (!secret || !verifyTotpCode(secret, body.code)) {
      sendJson(res, 400, { error: { code: 'invalid_two_factor_code', message: 'Enter a valid two-factor code to enable 2FA.' } });
      return;
    }
    const recoveryCodes = createRecoveryCodes();
    user.twoFactorEnabled = true;
    user.twoFactorSecret = secret;
    user.twoFactorPendingSecret = '';
    user.twoFactorPendingAt = '';
    user.twoFactorRecoveryCodeHashes = recoveryCodes.map(hashToken);
    user.twoFactorEnabledAt = new Date().toISOString();
    user.updatedAt = user.twoFactorEnabledAt;
    db.auditLogs.push(audit(null, user.id, 'profile.two_factor_enabled', 'user', user.id, {}));
    await saveDb(state);
    sendJson(res, 200, { user: publicUser(user), recoveryCodes });
    return;
  }
  if (segments[0] === '2fa' && segments[1] === 'disable' && req.method === 'POST') {
    const body = await readJson(req);
    const passwordOk = body.password ? await verifyPassword(String(body.password || ''), user.password) : false;
    const codeOk = verifyTwoFactorCode(user, body.code) || consumeRecoveryCode(user, body.recoveryCode || body.code);
    if (!passwordOk && !codeOk) {
      sendJson(res, 400, { error: { code: 'invalid_two_factor_code', message: 'Enter your password, authenticator code, or recovery code to disable 2FA.' } });
      return;
    }
    user.twoFactorEnabled = false;
    user.twoFactorSecret = '';
    user.twoFactorPendingSecret = '';
    user.twoFactorPendingAt = '';
    user.twoFactorRecoveryCodeHashes = [];
    user.twoFactorDisabledAt = new Date().toISOString();
    user.updatedAt = user.twoFactorDisabledAt;
    db.auditLogs.push(audit(null, user.id, 'profile.two_factor_disabled', 'user', user.id, { method: passwordOk ? 'password' : 'code' }));
    await saveDb(state);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }
  if (segments[0] === 'password' && req.method === 'POST') {
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!(await verifyPassword(currentPassword, user.password))) {
      sendJson(res, 400, { error: { code: 'invalid_password', message: 'Current password is incorrect.' } });
      return;
    }
    if (newPassword.length < 8) {
      sendJson(res, 400, { error: { code: 'weak_password', message: 'New password must be at least 8 characters.' } });
      return;
    }
    user.password = await hashPassword(newPassword);
    user.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(null, user.id, 'profile.password_changed', 'user', user.id, {}));
    await saveDb(state);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { error: { code: 'not_found', message: 'Profile route not found.' } });
}

async function handleSessions(req, res, segments, db, state, user, currentSession) {
  if (segments.length === 0 && req.method === 'GET') {
    const sessions = db.sessions
      .filter((session) => session.userId === user.id)
      .map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        remembered: Boolean(session.remembered),
        current: session.id === currentSession.id
      }));
    sendJson(res, 200, { sessions });
    return;
  }
  if (segments[0] && req.method === 'DELETE') {
    const sessionId = segments[0];
    if (sessionId === currentSession.id) {
      sendJson(res, 400, { error: { code: 'cannot_delete_current_session', message: 'Use logout to end the current session.' } });
      return;
    }
    db.sessions = db.sessions.filter((session) => !(session.userId === user.id && session.id === sessionId));
    db.auditLogs.push(audit(null, user.id, 'auth.session_revoked', 'session', sessionId, {}));
    await saveDb(state);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { error: { code: 'not_found', message: 'Session route not found.' } });
}

async function handleWorkspaces(req, res, url, segments, db, state, user) {
  if (segments.length === 0 && req.method === 'GET') {
    sendJson(res, 200, { workspaces: visibleWorkspaces(db, user) });
    return;
  }

  if (segments.length === 0 && req.method === 'POST') {
    const body = await readJson(req);
    const workspace = createWorkspace({
      name: cleanText(body.name, 120),
      ownerId: user.id,
      industry: cleanText(body.industry || 'General services', 80),
      companySize: cleanText(body.companySize || '1-10', 40),
      timezone: cleanTimezone(body.timezone, 'Asia/Kolkata')
    });

    if (!workspace.name) {
      sendJson(res, 400, { error: { code: 'invalid_workspace', message: 'Workspace name is required.' } });
      return;
    }

    db.workspaces.push(workspace);
    db.workspaceMembers.push({
      id: makeId('mem'),
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner',
      invitedBy: user.id,
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });
    db.subscriptions.push(createSubscription(workspace.id, 'starter'));
    db.usageMeters.push(createUsageMeter(workspace.id));
    db.auditLogs.push(audit(workspace.id, user.id, 'workspace.created', 'workspace', workspace.id, { name: workspace.name }));
    await saveDb(state);
    sendJson(res, 201, { workspace });
    return;
  }

  const workspaceId = segments[0];
  const membership = requireWorkspace(res, db, user, workspaceId, 'admin');
  if (!membership) return;

  if (segments.length === 1 && req.method === 'PUT') {
    const body = await readJson(req);
    const workspace = db.workspaces.find((item) => item.id === workspaceId);
    const previousCustomDomain = workspace.customDomain || '';
    const nextCustomDomain = cleanHostname(body.customDomain ?? workspace.customDomain);
    Object.assign(workspace, {
      name: cleanText(body.name ?? workspace.name, 120),
      industry: cleanText(body.industry ?? workspace.industry, 80),
      companySize: cleanText(body.companySize ?? workspace.companySize, 40),
      timezone: cleanTimezone(body.timezone, workspace.timezone),
      defaultLanguage: cleanText(body.defaultLanguage ?? workspace.defaultLanguage, 20),
      logoUrl: cleanUrl(body.logoUrl ?? workspace.logoUrl),
      brandColor: cleanColor(body.brandColor ?? workspace.brandColor),
      buttonColor: cleanColor(body.buttonColor ?? workspace.buttonColor),
      customDomain: nextCustomDomain,
      customCss: sanitizeCustomCss(body.customCss ?? workspace.customCss),
      customFooterText: cleanText(body.customFooterText ?? workspace.customFooterText, 280),
      hidePlatformBranding: body.hidePlatformBranding !== undefined ? parseBoolean(body.hidePlatformBranding) : Boolean(workspace.hidePlatformBranding),
      defaultSenderEmail: cleanEmail(body.defaultSenderEmail ?? workspace.defaultSenderEmail, true),
      privacyPolicyUrl: cleanUrl(body.privacyPolicyUrl ?? workspace.privacyPolicyUrl),
      termsUrl: cleanUrl(body.termsUrl ?? workspace.termsUrl),
      allowExternalAi: body.allowExternalAi !== undefined ? parseBoolean(body.allowExternalAi) : workspace.allowExternalAi,
      requirePublishApproval: body.requirePublishApproval !== undefined ? parseBoolean(body.requirePublishApproval) : Boolean(workspace.requirePublishApproval),
      permissionPolicy: body.permissionPolicy !== undefined ? normalizeWorkspacePermissionPolicy(body.permissionPolicy) : normalizeWorkspacePermissionPolicy(workspace.permissionPolicy),
      retentionDays: Number.isFinite(Number(body.retentionDays)) ? Math.max(1, Math.min(3650, Number(body.retentionDays))) : workspace.retentionDays,
      retentionScheduleEnabled: body.retentionScheduleEnabled !== undefined ? parseBoolean(body.retentionScheduleEnabled) : workspace.retentionScheduleEnabled,
      retentionNextRunAt: body.retentionNextRunAt !== undefined ? cleanFutureOrPastIso(body.retentionNextRunAt, workspace.retentionNextRunAt || nextRetentionRunAt()) : workspace.retentionNextRunAt,
      updatedAt: new Date().toISOString()
    });
    normalizeRetentionSchedule(workspace);
    if (nextCustomDomain !== previousCustomDomain) resetCustomDomainVerification(workspace);
    ensureCustomDomainState(workspace);
    db.auditLogs.push(audit(workspace.id, user.id, 'workspace.updated', 'workspace', workspace.id, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { workspace });
    return;
  }

  if (segments[1] === 'subscription' && req.method === 'POST') {
    if (!manualBillingAllowed(user)) {
      sendJson(res, 403, { error: { code: 'checkout_required', message: 'Plan changes require checkout.' } });
      return;
    }
    const body = await readJson(req);
    const plan = findBillingPlan(db, body.planId);
    if (!plan) {
      sendJson(res, 400, { error: { code: 'invalid_plan', message: 'Unknown plan.' } });
      return;
    }
    const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId) || createSubscription(workspaceId, plan.id);
    const previousPlan = findBillingPlan(db, subscription.planId) || null;
    const prorationInvoice = createPlanChangeProrationInvoice(workspaceId, previousPlan, plan, subscription, body);
    if (prorationInvoice) db.invoices.push(prorationInvoice);
    subscription.planId = plan.id;
    subscription.status = 'active';
    subscription.currentPeriodStart = startOfMonth();
    subscription.currentPeriodEnd = endOfMonth();
    subscription.billingPolicy = billingPolicySnapshot(body);
    subscription.updatedAt = new Date().toISOString();
    if (!db.subscriptions.includes(subscription)) db.subscriptions.push(subscription);
    db.workspaces.find((item) => item.id === workspaceId).planId = plan.id;
    db.auditLogs.push(audit(workspaceId, user.id, 'billing.plan_changed', 'subscription', subscription.id, {
      planId: plan.id,
      previousPlanId: previousPlan?.id || '',
      prorationInvoiceId: prorationInvoice?.id || '',
      prorationPolicy: subscription.billingPolicy.prorationPolicy
    }));
    await saveDb(state);
    sendJson(res, 200, { subscription, plan, prorationInvoice });
    return;
  }

  if (segments[1] === 'export.json' && req.method === 'GET') {
    if (!requireWorkspacePermission(res, db, user, workspaceId, 'workspaceExport')) return;
    const payload = buildWorkspaceExport(db, workspaceId);
    db.auditLogs.push(audit(workspaceId, user.id, 'privacy.workspace_exported', 'workspace', workspaceId, { responseCount: payload.responses.length }));
    await saveDb(state);
    sendJson(res, 200, payload);
    return;
  }

  if (segments[1] === 'audit-logs' && req.method === 'GET') {
    if (!requireWorkspacePermission(res, db, user, workspaceId, 'auditLogs')) return;
    const result = buildAuditLogResult(db, url, { workspaceId });
    if (segments[2] === 'export.json') {
      db.auditLogs.push(audit(workspaceId, user.id, 'compliance.audit_exported', 'workspace', workspaceId, { total: result.total }));
      await saveDb(state);
      sendJson(res, 200, { workspaceId, exportedAt: new Date().toISOString(), ...result });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (segments[1] === 'privacy' && segments[2] === 'delete' && req.method === 'POST') {
    if (!requireWorkspacePermission(res, db, user, workspaceId, 'privacyOperations')) return;
    const body = await readJson(req);
    const result = handlePrivacyDeletion(db, workspaceId, body, user.id);
    db.auditLogs.push(audit(workspaceId, user.id, 'privacy.delete_request_processed', 'workspace', workspaceId, result));
    await saveDb(state);
    sendJson(res, 200, result);
    return;
  }

  if (segments[1] === 'retention' && segments[2] === 'run' && req.method === 'POST') {
    if (!requireWorkspacePermission(res, db, user, workspaceId, 'retentionOperations')) return;
    const job = queueRetentionJob(db, workspaceId);
    job.status = 'processing';
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();
    await runRetentionJob(db, job);
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.lastError = '';
    db.auditLogs.push(audit(workspaceId, user.id, 'retention.sweep_queued', 'job', job.id, {}));
    await saveDb(state);
    sendJson(res, 200, { job });
    return;
  }

  if (segments[1] === 'custom-domain' && segments[2] === 'verify' && req.method === 'POST') {
    if (!requireWorkspace(res, db, user, workspaceId, 'admin')) return;
    const workspace = db.workspaces.find((item) => item.id === workspaceId);
    ensureCustomDomainState(workspace);
    if (!workspace.customDomain) {
      sendJson(res, 400, { error: { code: 'custom_domain_required', message: 'Add a custom domain before verifying DNS.' } });
      return;
    }
    const body = await readJson(req);
    const expectedTxt = customDomainTxtRecord(workspace);
    const providedTxt = cleanText(body.txtRecord || body.dnsTxt || body.verificationText || '', 300);
    let observedTxtRecords = [];
    let verificationMethod = 'manual_txt';
    if (providedTxt) {
      observedTxtRecords = [providedTxt];
      if (providedTxt !== expectedTxt) {
        sendJson(res, 400, { error: { code: 'dns_verification_failed', message: 'TXT record did not match the expected verification value.', expectedTxt, observedTxtRecords } });
        return;
      }
    } else {
      verificationMethod = 'live_dns';
      try {
        observedTxtRecords = await resolveCustomDomainTxtRecords(workspace.customDomain);
      } catch (error) {
        sendJson(res, 400, { error: { code: 'dns_lookup_failed', message: `Could not resolve TXT records for ${workspace.customDomain}.`, expectedTxt, detail: cleanText(error.message || String(error), 300) } });
        return;
      }
      if (!observedTxtRecords.includes(expectedTxt)) {
        sendJson(res, 400, { error: { code: 'dns_verification_failed', message: 'Live DNS TXT records did not include the expected verification value.', expectedTxt, observedTxtRecords } });
        return;
      }
    }
    workspace.customDomainStatus = verificationMethod === 'live_dns' ? 'verified_dns' : 'verified_local';
    workspace.customDomainVerifiedAt = new Date().toISOString();
    workspace.customDomainDnsCheckedAt = workspace.customDomainVerifiedAt;
    workspace.customDomainObservedTxt = observedTxtRecords.slice(0, 10);
    workspace.customDomainSslStatus = 'pending_provider';
    workspace.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(workspace.id, user.id, 'workspace.custom_domain_verified', 'workspace', workspace.id, { customDomain: workspace.customDomain, method: verificationMethod }));
    await saveDb(state);
    sendJson(res, 200, { customDomain: customDomainVerificationPayload(workspace) });
    return;
  }

  if (segments[1] === 'custom-domain' && segments[2] === 'provision-ssl' && req.method === 'POST') {
    if (!requireWorkspace(res, db, user, workspaceId, 'admin')) return;
    const workspace = db.workspaces.find((item) => item.id === workspaceId);
    ensureCustomDomainState(workspace);
    if (!workspace.customDomain) {
      sendJson(res, 400, { error: { code: 'custom_domain_required', message: 'Add a custom domain before provisioning SSL.' } });
      return;
    }
    if (!['verified_dns', 'verified_local'].includes(workspace.customDomainStatus)) {
      sendJson(res, 409, { error: { code: 'custom_domain_not_verified', message: 'Verify the custom-domain TXT record before provisioning SSL.', customDomain: customDomainVerificationPayload(workspace) } });
      return;
    }
    try {
      const ssl = await provisionCustomDomainSsl(workspace);
      applyCustomDomainSslResult(workspace, ssl);
      workspace.updatedAt = new Date().toISOString();
      db.auditLogs.push(audit(workspace.id, user.id, 'workspace.custom_domain_ssl_provisioned', 'workspace', workspace.id, {
        customDomain: workspace.customDomain,
        sslStatus: workspace.customDomainSslStatus,
        provider: workspace.customDomainSslProvider,
        certificateId: workspace.customDomainSslCertificateId
      }));
      await saveDb(state);
      sendJson(res, 200, { customDomain: customDomainVerificationPayload(workspace) });
    } catch (error) {
      workspace.customDomainSslStatus = 'failed';
      workspace.customDomainSslLastError = cleanText(error.message || String(error), 400);
      workspace.customDomainSslUpdatedAt = new Date().toISOString();
      workspace.updatedAt = workspace.customDomainSslUpdatedAt;
      db.auditLogs.push(audit(workspace.id, user.id, 'workspace.custom_domain_ssl_failed', 'workspace', workspace.id, {
        customDomain: workspace.customDomain,
        error: workspace.customDomainSslLastError
      }));
      await saveDb(state);
      sendJson(res, error.code === 'ssl_provider_not_configured' ? 400 : 502, {
        error: {
          code: error.code || 'ssl_provision_failed',
          message: workspace.customDomainSslLastError,
          customDomain: customDomainVerificationPayload(workspace)
        }
      });
    }
    return;
  }

  if (segments[1] === 'sso') {
    if (!requireFeature(res, 'sso')) return;
    if (segments.length === 2 && req.method === 'GET') {
      const workspace = db.workspaces.find((item) => item.id === workspaceId);
      workspace.sso = normalizeSsoConfig(workspace.sso || {});
      sendJson(res, 200, { sso: workspace.sso, metadataUrl: `/api/auth/sso/metadata/${workspace.id}` });
      return;
    }

    if (segments.length === 2 && req.method === 'PUT') {
      if (!requireWorkspace(res, db, user, workspaceId, 'admin')) return;
      const body = await readJson(req);
      const workspace = db.workspaces.find((item) => item.id === workspaceId);
      workspace.sso = normalizeSsoConfig({ ...(workspace.sso || {}), ...body });
      workspace.updatedAt = new Date().toISOString();
      db.auditLogs.push(audit(workspace.id, user.id, 'workspace.sso_updated', 'workspace', workspace.id, { enabled: workspace.sso.enabled, enforce: workspace.sso.enforce }));
      await saveDb(state);
      sendJson(res, 200, { sso: workspace.sso, metadataUrl: `/api/auth/sso/metadata/${workspace.id}` });
      return;
    }
  }

  if (segments[1] === 'members' && req.method === 'GET') {
    const members = db.workspaceMembers
      .filter((member) => member.workspaceId === workspaceId)
      .map((member) => ({
        ...member,
        user: publicUser(db.users.find((item) => item.id === member.userId) || {})
      }));
    const invites = db.workspaceInvites.filter((invite) => invite.workspaceId === workspaceId && invite.status === 'pending');
    sendJson(res, 200, { members, invites });
    return;
  }

  if (segments[1] === 'invites' && req.method === 'POST') {
    const body = await readJson(req);
    const role = normalizeRole(body.role || 'viewer');
    const email = cleanEmail(body.email);
    if (!email) {
      sendJson(res, 400, { error: { code: 'invalid_invite', message: 'A valid invite email is required.' } });
      return;
    }
    const limitCheck = checkPlanLimit(db, workspaceId, 'teamMembers');
    if (!limitCheck.ok) {
      sendJson(res, 402, { error: { code: 'plan_limit', message: limitCheck.message } });
      return;
    }
    const invite = {
      id: makeId('inv'),
      workspaceId,
      email,
      role,
      tokenHash: hashToken(`${workspaceId}:${email}:${crypto.randomBytes(24).toString('hex')}`),
      tokenPreview: '',
      invitedBy: user.id,
      status: 'pending',
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      createdAt: new Date().toISOString(),
      acceptedAt: null
    };
    const rawToken = `fo_inv_${crypto.randomBytes(24).toString('hex')}`;
    invite.tokenHash = hashToken(rawToken);
    invite.tokenPreview = `${rawToken.slice(0, 10)}...`;
    db.workspaceInvites.push(invite);
    queueEmailJob(db, workspaceId, {
      to: email,
      subject: `Invitation to ${membership.workspace.name}`,
      body: `You have been invited to ${membership.workspace.name} as ${role}. Use invite token ${rawToken}.`
    }, { inviteId: invite.id });
    db.auditLogs.push(audit(workspaceId, user.id, 'workspace.invite_created', 'workspace_invite', invite.id, { email, role }));
    await saveDb(state);
    sendJson(res, 201, { invite: { ...invite, tokenHash: '[hidden]' }, token: rawToken });
    return;
  }

  if (segments[1] === 'members' && segments[2] && req.method === 'PUT') {
    const member = db.workspaceMembers.find((item) => item.id === segments[2] && item.workspaceId === workspaceId);
    if (!member) {
      sendJson(res, 404, { error: { code: 'member_not_found', message: 'Member not found.' } });
      return;
    }
    const body = await readJson(req);
    const nextRole = normalizeRole(body.role || member.role);
    if (member.role === 'owner') {
      sendJson(res, 400, { error: { code: 'owner_required', message: 'Workspace owner role cannot be changed here.' } });
      return;
    }
    if (nextRole === 'owner') {
      sendJson(res, 400, { error: { code: 'invalid_member_role', message: 'Use ownership transfer to assign owner role.' } });
      return;
    }
    member.role = nextRole;
    db.auditLogs.push(audit(workspaceId, user.id, 'workspace.member_updated', 'workspace_member', member.id, { role: member.role }));
    await saveDb(state);
    sendJson(res, 200, { member });
    return;
  }

  if (segments[1] === 'members' && segments[2] && req.method === 'DELETE') {
    const member = db.workspaceMembers.find((item) => item.id === segments[2] && item.workspaceId === workspaceId);
    if (!member) {
      sendJson(res, 404, { error: { code: 'member_not_found', message: 'Member not found.' } });
      return;
    }
    if (member.role === 'owner') {
      sendJson(res, 400, { error: { code: 'owner_required', message: 'Workspace owner cannot be removed.' } });
      return;
    }
    db.workspaceMembers = db.workspaceMembers.filter((item) => item.id !== member.id);
    syncTeamMemberUsage(db, workspaceId);
    db.auditLogs.push(audit(workspaceId, user.id, 'workspace.member_removed', 'workspace_member', member.id, {}));
    await saveDb(state);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (segments[1] === 'api-keys') {
    if (!requireFeature(res, 'apiV1')) return;
    if (segments.length === 2 && req.method === 'GET') {
      const keys = db.apiKeys
        .filter((item) => item.workspaceId === workspaceId && !item.revokedAt)
        .map((item) => ({ ...item, tokenHash: '[hidden]' }));
      sendJson(res, 200, { apiKeys: keys });
      return;
    }

    if (segments[2] && segments[3] === 'rotate' && segments.length === 4 && req.method === 'POST') {
      const apiKey = db.apiKeys.find((item) => item.id === segments[2] && item.workspaceId === workspaceId && !item.revokedAt);
      if (!apiKey) {
        sendJson(res, 404, { error: { code: 'api_key_not_found', message: 'API key not found.' } });
        return;
      }
      const rawToken = `fo_live_${crypto.randomBytes(24).toString('hex')}`;
      apiKey.tokenHash = hashToken(rawToken);
      apiKey.tokenPreview = `${rawToken.slice(0, 12)}...`;
      apiKey.rotatedAt = new Date().toISOString();
      apiKey.lastUsedAt = null;
      apiKey.updatedAt = apiKey.rotatedAt;
      db.auditLogs.push(audit(workspaceId, user.id, 'api_key.rotated', 'api_key', apiKey.id, { name: apiKey.name }));
      await saveDb(state);
      sendJson(res, 200, { apiKey: { ...apiKey, tokenHash: '[hidden]' }, token: rawToken });
      return;
    }

    if (segments.length === 2 && req.method === 'POST') {
      const body = await readJson(req);
      const rawToken = `fo_live_${crypto.randomBytes(24).toString('hex')}`;
      const apiKey = {
        id: makeId('key'),
        workspaceId,
        name: cleanText(body.name || 'Workspace API key', 120),
        tokenHash: hashToken(rawToken),
        tokenPreview: `${rawToken.slice(0, 12)}...`,
        scopes: normalizeScopes(body.scopes || ['surveys:read', 'responses:read', 'responses:write', 'analytics:read']),
        rateLimitPerMinute: Math.max(10, Math.min(1000, Number(body.rateLimitPerMinute || 120))),
        createdBy: user.id,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.apiKeys.push(apiKey);
      db.auditLogs.push(audit(workspaceId, user.id, 'api_key.created', 'api_key', apiKey.id, { name: apiKey.name, scopes: apiKey.scopes }));
      await saveDb(state);
      sendJson(res, 201, { apiKey: { ...apiKey, tokenHash: '[hidden]' }, token: rawToken });
      return;
    }

    if (segments[2] && segments.length === 3 && req.method === 'DELETE') {
      const apiKey = db.apiKeys.find((item) => item.id === segments[2] && item.workspaceId === workspaceId);
      if (!apiKey) {
        sendJson(res, 404, { error: { code: 'api_key_not_found', message: 'API key not found.' } });
        return;
      }
      apiKey.revokedAt = new Date().toISOString();
      apiKey.updatedAt = new Date().toISOString();
      db.auditLogs.push(audit(workspaceId, user.id, 'api_key.revoked', 'api_key', apiKey.id, {}));
      await saveDb(state);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Workspace route not found.' } });
}

async function handleSurveys(req, res, url, segments, db, state, user) {
  const lifecycle = await handleSurveyLifecycleRoute({
    req, res, url, segments, db, state, user, readJson, requireWorkspace, surveyVisibleToUser,
    checkPlanLimit, findSurveyTemplate, createSurvey, cleanText, markTemplateUsed, createSurveyVersion,
    audit, saveDb, sendJson, requireSurveyAccess, surveyApprovalFingerprint, applySurveySlug,
    updateSurveyFromBody, markApprovalStaleIfChanged, createCustomTemplateFromSurvey,
    publishSurveyDraft, effectiveSurveyRole, requestSurveyApproval, surveyApprovalPayload,
    validateSurveyForPublish, reviewSurveyApproval, normalizeSurveyAccessMode, normalizeSurveyAccessRules,
    surveyAccessPolicyChanged
  });
  if (lifecycle.handled) return;
  const survey = lifecycle.survey;

  if (await handleResponsesRoute({
    req, res, url, segments, db, state, user, survey,
    filterResponses, requireWorkspacePermission, requireSurveyAccess, buildResponsePdf,
    audit, saveDb, withSecurityHeaders, slugify, sendJson, buildResponseDetail, readJson, updateResponseRecord,
    eraseResponse
  })) return;

  if (segments[1] === 'export.csv' && req.method === 'GET') {
    if (!requireWorkspacePermission(res, db, user, survey.workspaceId, 'responseExport')) return;
    const responses = filterResponses(db.responses.filter((item) => item.surveyId === survey.id && item.status !== 'deleted'), url, survey, { noPagination: true }).responses;
    const csv = buildCsv(survey, responses);
    res.writeHead(200, withSecurityHeaders({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${slugify(survey.title)}-responses.csv"`
    }));
    res.end(csv);
    return;
  }

  if (segments[1] === 'export.xlsx' && req.method === 'GET') {
    if (!requireWorkspacePermission(res, db, user, survey.workspaceId, 'responseExport')) return;
    const responses = filterResponses(db.responses.filter((item) => item.surveyId === survey.id && item.status !== 'deleted'), url, survey, { noPagination: true }).responses;
    const workbook = await buildXlsxExport(survey, responses);
    res.writeHead(200, withSecurityHeaders({
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${slugify(survey.title)}-responses.xlsx"`,
      'content-length': workbook.length
    }));
    res.end(workbook);
    return;
  }

  if (segments[1] === 'export.json' && req.method === 'GET') {
    if (!requireWorkspacePermission(res, db, user, survey.workspaceId, 'responseExport')) return;
    const responses = filterResponses(db.responses.filter((item) => item.surveyId === survey.id && item.status !== 'deleted'), url, survey, { noPagination: true }).responses
      .map((response) => buildResponseDetail(db, survey, response));
    sendJson(res, 200, { survey, responses });
    return;
  }

  if (handleAnalyticsRoute({ req, res, url, segments, db, survey, filterResponses, buildAnalytics, buildAnalyticsComparison, sendJson })) return;

  if (segments[1] === 'translations' && segments[2] === 'generate' && req.method === 'POST') {
    if (!requireSurveyAccess(res, db, user, survey, 'editor')) return;
    const body = await readJson(req);
    const language = cleanText(body.language || body.lang || 'es', 20).toLowerCase();
    if (!/^[a-z]{2,8}(-[a-z0-9]{2,8})?$/i.test(language)) {
      sendJson(res, 400, { error: { code: 'invalid_language', message: 'Use a valid language code such as es, hi, or fr.' } });
      return;
    }
    const translation = generateSurveyTranslation(survey.schema, language);
    survey.schema.translations = survey.schema.translations || {};
    survey.schema.translations[language] = translation;
    survey.updatedAt = new Date().toISOString();
    if (survey.status === 'published') survey.hasUnpublishedChanges = true;
    db.auditLogs.push(audit(survey.workspaceId, user.id, 'survey.translation_generated', 'survey', survey.id, { language }));
    await saveDb(state);
    sendJson(res, 200, { language, translation, survey });
    return;
  }

  if (await handleAiSummaryRoute({
    req,
    res,
    segments,
    db,
    state,
    user,
    survey,
    requireSurveyAccess,
    checkAiCreditLimit,
    consumeAiCredits,
    sendAiCreditLimitError,
    buildAiSummaryWithProvider,
    makeId,
    audit,
    saveDb,
    sendJson
  })) return;

  if (segments[1] === 'qr.svg' && req.method === 'GET') {
    const appUrl = process.env.APP_URL || `${url.protocol}//${url.host}`;
    const surveyUrl = `${appUrl}/s/${survey.slug}`;
    let svg;
    try {
      svg = buildQrCodeSvg(surveyUrl, survey.title, survey.branding?.brandColor || workspaceBrand(db, survey.workspaceId).brandColor);
    } catch (error) {
      sendJson(res, 400, { error: { code: 'qr_payload_too_large', message: error.message } });
      return;
    }
    res.writeHead(200, withSecurityHeaders({ 'content-type': 'image/svg+xml; charset=utf-8' }));
    res.end(svg);
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Survey route not found.' } });
}

async function handleAlerts(req, res, url, segments, db, state, user) {
  if (segments.length === 0 && req.method === 'GET') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!requireWorkspace(res, db, user, workspaceId, 'viewer')) return;
    sendJson(res, 200, { alerts: db.alerts.filter((item) => item.workspaceId === workspaceId) });
    return;
  }

  if (segments.length === 0 && req.method === 'POST') {
    const body = await readJson(req);
    const workspaceId = body.workspaceId;
    if (!requireWorkspacePermission(res, db, user, workspaceId, 'integrationManagement')) return;
    const alert = {
      id: makeId('alrt'),
      workspaceId,
      surveyId: body.surveyId || null,
      name: cleanText(body.name || 'Important response alert', 120),
      conditionsJson: normalizeAlertCondition(body.conditionsJson || body.condition || { type: 'negative_sentiment' }),
      channelsJson: normalizeAlertChannels(body.channelsJson || body.channels || { email: true, inApp: true }),
      active: body.active !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.alerts.push(alert);
    db.auditLogs.push(audit(workspaceId, user.id, 'alert.created', 'alert', alert.id, { name: alert.name }));
    await saveDb(state);
    sendJson(res, 201, { alert });
    return;
  }

  const alert = db.alerts.find((item) => item.id === segments[0]);
  if (!alert) {
    sendJson(res, 404, { error: { code: 'not_found', message: 'Alert not found.' } });
    return;
  }
  if (!requireWorkspace(res, db, user, alert.workspaceId, 'admin')) return;

  if (req.method === 'PUT') {
    const body = await readJson(req);
    alert.name = cleanText(body.name ?? alert.name, 120);
    alert.conditionsJson = normalizeAlertCondition(body.conditionsJson ?? alert.conditionsJson);
    alert.channelsJson = normalizeAlertChannels(body.channelsJson ?? alert.channelsJson);
    alert.active = body.active !== undefined ? Boolean(body.active) : alert.active;
    alert.updatedAt = new Date().toISOString();
    await saveDb(state);
    sendJson(res, 200, { alert });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Alert route not found.' } });
}

async function handleIntegrations(req, res, url, segments, db, state, user) {
  if (segments.length === 0 && req.method === 'GET') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!requireWorkspace(res, db, user, workspaceId, 'viewer')) return;
    const integrations = db.integrations
      .filter((item) => item.workspaceId === workspaceId)
      .map((item) => ({ ...item, configEncrypted: item.configEncrypted ? '[encrypted]' : '' }));
    const webhooks = db.webhooks.filter((item) => item.workspaceId === workspaceId).map(publicWebhook);
    const webhookLogs = db.webhookLogs.filter((item) => webhooks.some((hook) => hook.id === item.webhookId)).slice(-25).reverse();
    const integrationLogs = db.integrationLogs.filter((item) => item.workspaceId === workspaceId).slice(-50).reverse();
    sendJson(res, 200, { integrations, webhooks, webhookLogs, integrationLogs });
    return;
  }

  if (segments.length === 0 && req.method === 'POST') {
    const body = await readJson(req);
    const workspaceId = body.workspaceId;
    if (!requireWorkspace(res, db, user, workspaceId, 'admin')) return;
    if (body.type === 'webhook') {
      const webhookUrl = cleanUrl(body.url);
      if (!webhookUrl || !(await isSafeOutboundUrl(webhookUrl))) {
        sendJson(res, 400, { error: { code: 'invalid_webhook', message: 'A valid webhook URL is required.' } });
        return;
      }
      const rawSecret = crypto.randomBytes(24).toString('hex');
      const webhook = {
        id: makeId('wh'),
        workspaceId,
        url: webhookUrl,
        events: Array.isArray(body.events) ? body.events.slice(0, 20) : ['response.completed'],
        secretEncrypted: encryptConfig({ secret: rawSecret }),
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.webhooks.push(webhook);
      db.auditLogs.push(audit(workspaceId, user.id, 'webhook.created', 'webhook', webhook.id, { url: webhook.url }));
      await saveDb(state);
      sendJson(res, 201, { webhook: publicWebhook(webhook) });
      return;
    }

    const integrationType = normalizeIntegrationType(body.type || 'google_sheets');
    const configObj = body.config || body.configJson || {};
    const testUrl = cleanUrl(configObj.webhookUrl || configObj.url || configObj.apiUrl);
    if (testUrl && !(await isSafeOutboundUrl(testUrl))) {
      sendJson(res, 400, { error: { code: 'invalid_integration', message: 'A valid integration URL is required.' } });
      return;
    }

    const integration = {
      id: makeId('int'),
      workspaceId,
      type: integrationType,
      name: cleanText(body.name || 'Integration', 120),
      configEncrypted: encryptConfig(configObj),
      events: Array.isArray(body.events) ? body.events.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 20) : ['response.completed'],
      status: 'configured',
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.integrations.push(integration);
    db.auditLogs.push(audit(workspaceId, user.id, 'integration.created', 'integration', integration.id, { type: integration.type }));
    await saveDb(state);
    sendJson(res, 201, { integration: { ...integration, configEncrypted: '[encrypted]' } });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Integration route not found.' } });
}

async function handleContacts(req, res, url, segments, db, state, user) {
  if (segments.length === 0 && req.method === 'GET') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!requireWorkspace(res, db, user, workspaceId, 'viewer')) return;
    const query = cleanText(url.searchParams.get('q') || '', 120).toLowerCase();
    const stage = normalizeContactStage(url.searchParams.get('stage') || '');
    const ownerId = cleanText(url.searchParams.get('ownerId') || '', 80);
    const contacts = db.contacts
      .filter((contact) => contact.workspaceId === workspaceId)
      .filter((contact) => !stage || contact.stage === stage)
      .filter((contact) => !ownerId || contact.ownerId === ownerId)
      .filter((contact) => !query || [contact.name, contact.email, contact.phone, contact.company, contact.source, contact.stage].some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => (b.lastResponseAt || b.updatedAt || '').localeCompare(a.lastResponseAt || a.updatedAt || ''));
    sendJson(res, 200, { contacts });
    return;
  }

  const contact = db.contacts.find((item) => item.id === segments[0]);
  if (!contact) {
    sendJson(res, 404, { error: { code: 'contact_not_found', message: 'Contact not found.' } });
    return;
  }
  if (!requireWorkspace(res, db, user, contact.workspaceId, req.method === 'GET' ? 'viewer' : 'analyst')) return;

  if (req.method === 'GET') {
    const responses = db.responses.filter((response) => response.workspaceId === contact.workspaceId && response.respondentId && db.respondents.some((respondent) => respondent.id === response.respondentId && respondent.email === contact.email));
    sendJson(res, 200, { contact, responses });
    return;
  }

  if (req.method === 'PUT') {
    const body = await readJson(req);
    contact.name = cleanText(body.name ?? contact.name, 120);
    contact.email = cleanEmail(body.email ?? contact.email, true);
    contact.phone = cleanText(body.phone ?? contact.phone, 40);
    contact.company = cleanText(body.company ?? contact.company, 120);
    contact.tagsJson = Array.isArray(body.tags) ? uniqueTags(body.tags.map((item) => cleanText(item, 80)).filter(Boolean)) : contact.tagsJson;
    contact.leadScore = Number.isFinite(Number(body.leadScore)) ? Math.max(0, Math.min(100, Number(body.leadScore))) : contact.leadScore;
    updateContactCrmFields(db, contact, body);
    contact.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(contact.workspaceId, user.id, 'contact.updated', 'contact', contact.id, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { contact });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Contact route not found.' } });
}

async function handleFileUploads(req, res, segments, db, user) {
  const upload = db.fileUploads.find((item) => item.id === segments[0]);
  if (!upload) {
    sendJson(res, 404, { error: { code: 'file_upload_not_found', message: 'File upload not found.' } });
    return;
  }
  if (!requireWorkspace(res, db, user, upload.workspaceId, 'viewer')) return;
  if (segments[1] === 'download-url' && req.method === 'GET') {
    const parentResponse = upload.responseId ? db.responses.find((item) => item.id === upload.responseId) : null;
    if (upload.lifecycleStatus === 'expired' || upload.lifecycleStatus === 'deleted' || upload.deletedAt || parentResponse?.status === 'deleted') {
      sendJson(res, 410, { error: { code: 'file_upload_expired', message: 'File upload retention has expired.' } });
      return;
    }
    if (upload.quarantined || ['infected', 'blocked', 'quarantined'].includes(upload.scanStatus || '')) {
      sendJson(res, 423, { error: { code: 'file_upload_quarantined', message: 'File upload is quarantined and cannot be downloaded.' } });
      return;
    }
    const expiresIn = Math.max(60, Math.min(3600, Number(segments[2] || 900)));
    const payload = upload.storageProvider === 's3_compatible'
      ? {
        storageProvider: upload.storageProvider,
        url: presignObjectStorageGet(upload, expiresIn),
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
      }
      : {
        storageProvider: upload.storageProvider || 'local_json',
        url: upload.dataUrl || '',
        expiresAt: null
      };
    sendJson(res, 200, payload);
    return;
  }
  sendJson(res, 404, { error: { code: 'not_found', message: 'File upload route not found.' } });
}

async function handleCampaigns(req, res, url, segments, db, state, user) {
  if (segments.length === 0 && req.method === 'GET') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!requireWorkspace(res, db, user, workspaceId, 'viewer')) return;
    const campaigns = db.emailCampaigns
      .filter((campaign) => campaign.workspaceId === workspaceId)
      .map((campaign) => ({
        ...campaign,
        events: db.campaignEvents.filter((event) => event.campaignId === campaign.id).slice(-25).reverse()
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendJson(res, 200, { campaigns });
    return;
  }

  if (segments.length === 0 && req.method === 'POST') {
    const body = await readJson(req);
    const workspaceId = body.workspaceId;
    if (!requireWorkspace(res, db, user, workspaceId, 'admin')) return;
    const survey = db.surveys.find((item) => item.id === body.surveyId && item.workspaceId === workspaceId);
    if (!survey) {
      sendJson(res, 404, { error: { code: 'survey_not_found', message: 'Survey not found.' } });
      return;
    }
    const contacts = normalizeCampaignContacts(body.contacts || body.recipients || []);
    if (!contacts.length) {
      sendJson(res, 400, { error: { code: 'contacts_required', message: 'At least one recipient is required.' } });
      return;
    }
    const campaign = {
      id: makeId('cmp'),
      workspaceId,
      surveyId: survey.id,
      name: cleanText(body.name || `${survey.title} invite campaign`, 160),
      subject: cleanText(body.subject || `Share feedback for ${survey.title}`, 180),
      message: cleanText(body.message || 'Please take a minute to share your feedback.', 2000),
      contacts,
      status: body.scheduledAt ? 'scheduled' : 'queued',
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt).toISOString() : null,
      sentCount: 0,
      openedCount: 0,
      clickedCount: 0,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.emailCampaigns.push(campaign);
    queueCampaignJobs(db, campaign, survey);
    db.auditLogs.push(audit(workspaceId, user.id, 'campaign.created', 'email_campaign', campaign.id, { contacts: contacts.length }));
    await saveDb(state);
    sendJson(res, 201, { campaign });
    return;
  }

  const campaign = db.emailCampaigns.find((item) => item.id === segments[0]);
  if (!campaign) {
    sendJson(res, 404, { error: { code: 'campaign_not_found', message: 'Campaign not found.' } });
    return;
  }
  if (!requireWorkspace(res, db, user, campaign.workspaceId, req.method === 'GET' ? 'viewer' : 'admin')) return;

  if (req.method === 'GET') {
    sendJson(res, 200, { campaign });
    return;
  }

  if (segments[1] === 'send-now' && req.method === 'POST') {
    campaign.status = 'queued';
    campaign.scheduledAt = null;
    campaign.updatedAt = new Date().toISOString();
    const survey = db.surveys.find((item) => item.id === campaign.surveyId);
    queueCampaignJobs(db, campaign, survey);
    db.auditLogs.push(audit(campaign.workspaceId, user.id, 'campaign.send_now', 'email_campaign', campaign.id, {}));
    await saveDb(state);
    sendJson(res, 200, { campaign });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Campaign route not found.' } });
}

async function handleAiTools(req, res, segments, db, state, user) {
  if (segments[0] === 'generate-survey' && req.method === 'POST') {
    const body = await readJson(req);
    const workspaceId = body.workspaceId;
    if (!requireWorkspace(res, db, user, workspaceId, 'editor')) return;
    const creditCheck = checkAiCreditLimit(db, workspaceId, 2);
    if (!creditCheck.ok) {
      sendAiCreditLimitError(res, creditCheck);
      return;
    }
    const workspace = db.workspaces.find((item) => item.id === workspaceId);
    const generatedResult = await generateSurveySchemaWithProvider(db, body, workspace);
    const generated = generatedResult.schema;
    if (generatedResult.aiGenerated) {
      consumeAiCredits(db, workspaceId, 2);
    }
    const survey = createSurvey({
      workspaceId,
      userId: user.id,
      title: generated.title,
      description: generated.description,
      type: generated.type,
      schema: generated
    });
    db.surveys.push(survey);
    createSurveyVersion(db, survey, user.id);
    const job = createAiJob(workspaceId, survey.id, null, 'survey_generation', body, { surveyId: survey.id, schema: generated, provider: generatedResult.provider, providerUsage: generatedResult.providerUsage });
    db.aiJobs.push(job);
    db.auditLogs.push(audit(workspaceId, user.id, 'ai.survey_generated', 'survey', survey.id, { jobId: job.id }));
    await saveDb(state);
    sendJson(res, 201, { survey, job });
    return;
  }

  if (segments[0] === 'improve-question' && req.method === 'POST') {
    const body = await readJson(req);
    const workspaceId = body.workspaceId;
    if (!requireWorkspace(res, db, user, workspaceId, 'editor')) return;
    const creditCheck = checkAiCreditLimit(db, workspaceId, 1);
    if (!creditCheck.ok) {
      sendAiCreditLimitError(res, creditCheck);
      return;
    }
    const workspace = db.workspaces.find((item) => item.id === workspaceId);
    const improved = await improveQuestionWithProvider(db, body, workspace);
    if (improved.aiGenerated) {
      consumeAiCredits(db, workspaceId, 1);
    }
    const job = createAiJob(workspaceId, body.surveyId || null, null, 'question_improvement', body, improved);
    db.aiJobs.push(job);
    await saveDb(state);
    sendJson(res, 200, { improved, job });
    return;
  }

  if (segments[0] === 'monthly-report' && segments[1] === 'schedule' && req.method === 'POST') {
    const body = await readJson(req);
    const workspaceId = body.workspaceId;
    if (!requireWorkspacePermission(res, db, user, workspaceId, 'aiReports')) return;
    const month = cleanText(body.month || nextReportMonth(), 7);
    const recipients = normalizeEmailList(body.recipients || body.recipient || '');
    const job = {
      id: makeId('job'),
      workspaceId,
      type: 'monthly_report',
      status: 'queued',
      attempts: 0,
      maxAttempts: JOB_MAX_ATTEMPTS,
      nextRunAt: body.nextRunAt ? new Date(body.nextRunAt).toISOString() : firstDayOfMonthIso(month),
      payloadJson: { month, recipients, requestedBy: user.id },
      lastError: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.jobs.push(job);
    db.auditLogs.push(audit(workspaceId, user.id, 'ai.monthly_report_scheduled', 'job', job.id, { month, recipients: recipients.length }));
    await saveDb(state);
    sendJson(res, 201, { job });
    return;
  }

  if (segments[0] === 'monthly-report' && req.method === 'POST') {
    const body = await readJson(req);
    const workspaceId = body.workspaceId;
    if (!requireWorkspacePermission(res, db, user, workspaceId, 'aiReports')) return;
    const creditCheck = checkAiCreditLimit(db, workspaceId, 3);
    if (!creditCheck.ok) {
      sendAiCreditLimitError(res, creditCheck);
      return;
    }
    const report = await buildMonthlyReportWithProvider(db, workspaceId, body.month || new Date().toISOString().slice(0, 7));
    if (report.aiGenerated) {
      consumeAiCredits(db, workspaceId, 3);
    }
    report.pdfUrl = `/api/ai/monthly-reports/${workspaceId}/${report.id}.pdf`;
    db.monthlyReports.push(report);
    db.aiJobs.push(createAiJob(workspaceId, null, null, 'monthly_report', body, report));
    db.auditLogs.push(audit(workspaceId, user.id, 'ai.monthly_report_generated', 'monthly_report', report.id, { month: report.month }));
    await saveDb(state);
    sendJson(res, 201, { report });
    return;
  }

  if (segments[0] === 'monthly-reports' && req.method === 'GET') {
    const workspaceId = segments[1];
    if (!requireWorkspacePermission(res, db, user, workspaceId, 'aiReports')) return;
    if (segments[2] && segments[2].endsWith('.pdf')) {
      const reportId = segments[2].replace(/\.pdf$/, '');
      const report = db.monthlyReports.find((item) => item.id === reportId && item.workspaceId === workspaceId);
      if (!report) {
        sendJson(res, 404, { error: { code: 'report_not_found', message: 'Monthly report not found.' } });
        return;
      }
      const pdf = buildMonthlyReportPdf(db, report);
      res.writeHead(200, withSecurityHeaders({
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${slugify(report.title)}.pdf"`,
        'cache-control': 'no-store'
      }));
      res.end(pdf);
      return;
    }
    sendJson(res, 200, { reports: db.monthlyReports.filter((report) => report.workspaceId === workspaceId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)) });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'AI route not found.' } });
}

async function handleBilling(req, res, url, segments, db, state, user) {
  return handleBillingRoute({
    req, res, url, segments, db, state, user,
    requireWorkspacePermission, billingPlans, readJson, createInvoice, audit, saveDb, sendJson,
    findBillingPlan, createBillingCheckoutSession, createBillingPortalSession, applyGracefulDowngrade,
    manualBillingAllowed
  });
}

async function handleBillingWebhook(req, res, providerInput, db, state) {
  const provider = normalizeBillingProvider(providerInput);
  if (!provider) {
    sendJson(res, 404, { error: { code: 'billing_provider_not_found', message: 'Billing webhook provider is not supported.' } });
    return;
  }
  const rawBody = await readRawBody(req);
  const verification = verifyBillingWebhookSignature(provider, rawBody, req.headers);
  if (!verification.ok) {
    sendJson(res, 400, { error: { code: 'invalid_billing_signature', message: verification.message } });
    return;
  }
  let event;
  try {
    event = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: { code: 'invalid_billing_webhook', message: 'Billing webhook payload must be JSON.' } });
    return;
  }
  const eventId = cleanText(event.id || event.payload?.payment?.entity?.id || event.payload?.subscription?.entity?.id || '', 160);
  if (eventId && db.auditLogs.some((entry) => entry.action === 'billing.webhook_received' && entry.entityId === eventId)) {
    sendJson(res, 200, { ok: true, provider, duplicate: true });
    return;
  }
  const result = applyBillingWebhookEvent(db, provider, event);
  db.auditLogs.push(audit(result.workspaceId || null, null, 'billing.webhook_received', 'billing_webhook', result.eventId || null, {
    provider,
    eventType: result.eventType,
    action: result.action,
    verified: verification.mode
  }));
  await saveDb(state);
  sendJson(res, 200, { ok: true, provider, result });
}

async function handleCronRun(req, res, state) {
  if (!envConfigured('CRON_SECRET')) {
    sendJson(res, 503, { error: { code: 'cron_not_configured', message: 'CRON_SECRET is not configured.' } });
    return;
  }
  const bearer = String(req.headers.authorization || '').startsWith('Bearer ')
    ? String(req.headers.authorization || '').slice('Bearer '.length).trim()
    : '';
  const provided = String(req.headers['x-cron-secret'] || bearer || '');
  const expected = String(process.env.CRON_SECRET || '');
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (!provided || providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    sendJson(res, 403, { error: { code: 'invalid_cron_secret', message: 'Cron secret is invalid.' } });
    return;
  }
  const result = await processDueJobs(state, { force: false });
  sendJson(res, 200, { ok: true, ...result });
}

async function handleAdmin(req, res, url, segments, db, state, user) {
  if (user.platformRole !== 'super_admin') {
    sendJson(res, 403, { error: { code: 'forbidden', message: 'Super admin access required.' } });
    return;
  }

  if (handleAdminReadinessRoute({ req, res, segments, db, state, buildReadinessReport, sendJson })) return;

  if (segments[0] === 'users' && req.method === 'GET') {
    const query = cleanText(url.searchParams.get('q') || '', 120).toLowerCase();
    const users = db.users
      .filter((item) => !query || [item.name, item.email, item.platformRole].some((value) => String(value || '').toLowerCase().includes(query)))
      .map(publicUser);
    sendJson(res, 200, { users });
    return;
  }

  if (segments[0] === 'users' && segments[1] && req.method === 'PUT') {
    const target = db.users.find((item) => item.id === segments[1]);
    if (!target) {
      sendJson(res, 404, { error: { code: 'user_not_found', message: 'User not found.' } });
      return;
    }
    const body = await readJson(req);
    if (body.disabled !== undefined) target.disabled = Boolean(body.disabled);
    if (body.platformRole) target.platformRole = cleanText(body.platformRole, 40) === 'super_admin' ? 'super_admin' : 'user';
    target.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(null, user.id, 'admin.user_updated', 'user', target.id, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { user: publicUser(target) });
    return;
  }

  if (segments[0] === 'workspaces' && req.method === 'GET') {
    sendJson(res, 200, { workspaces: db.workspaces.map((workspace) => attachWorkspaceMeta(db, workspace, 'owner')) });
    return;
  }

  if (segments[0] === 'workspaces' && segments[1] && req.method === 'PUT') {
    const workspace = db.workspaces.find((item) => item.id === segments[1]);
    if (!workspace) {
      sendJson(res, 404, { error: { code: 'workspace_not_found', message: 'Workspace not found.' } });
      return;
    }
    const body = await readJson(req);
    if (body.suspended !== undefined) workspace.suspended = Boolean(body.suspended);
    if (body.planId && findBillingPlan(db, body.planId)) {
      workspace.planId = cleanText(body.planId, 80);
      unlockOverLimitResponses(db, workspace.id);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'aiCreditLimitOverride')) {
      const parsed = parseOptionalLimit(body.aiCreditLimitOverride);
      if (!parsed.ok) {
        sendJson(res, 400, { error: { code: 'invalid_ai_credit_limit', message: 'AI credit limit override must be a non-negative whole number or blank.' } });
        return;
      }
      workspace.aiCreditLimitOverride = parsed.value;
    }
    workspace.updatedAt = new Date().toISOString();
    db.auditLogs.push(audit(workspace.id, user.id, 'admin.workspace_updated', 'workspace', workspace.id, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { workspace: attachWorkspaceMeta(db, workspace, 'owner') });
    return;
  }

  if (segments[0] === 'workspaces' && segments[1] && req.method === 'DELETE') {
    const workspace = db.workspaces.find((item) => item.id === segments[1]);
    if (!workspace) {
      sendJson(res, 404, { error: { code: 'workspace_not_found', message: 'Workspace not found.' } });
      return;
    }
    const result = deleteWorkspaceData(db, workspace.id);
    db.auditLogs.push(audit(null, user.id, 'admin.workspace_deleted', 'workspace', workspace.id, result));
    await saveDb(state);
    sendJson(res, 200, { ok: true, deletedWorkspaceId: workspace.id, result });
    return;
  }

  if (segments[0] === 'plans' && req.method === 'GET') {
    sendJson(res, 200, { plans: billingPlans(db, { includeArchived: true }) });
    return;
  }

  if (segments[0] === 'plans' && req.method === 'POST') {
    const body = await readJson(req);
    const plan = normalizeBillingPlan({
      id: body.id || `custom_${crypto.randomBytes(5).toString('hex')}`,
      ...body,
      custom: true,
      archived: false
    }, null);
    if (!plan.id) {
      sendJson(res, 400, { error: { code: 'invalid_plan', message: 'Plan id is required.' } });
      return;
    }
    if (billingPlans(db, { includeArchived: true }).some((item) => item.id === plan.id)) {
      sendJson(res, 409, { error: { code: 'plan_exists', message: 'A plan with this id already exists.' } });
      return;
    }
    const settings = platformSettings(db);
    settings.plans.push(plan);
    settings.updatedAt = new Date().toISOString();
    settings.updatedBy = user.id;
    db.auditLogs.push(audit(null, user.id, 'admin.plan_created', 'billing_plan', plan.id, { name: plan.name }));
    await saveDb(state);
    sendJson(res, 201, { plan, plans: billingPlans(db, { includeArchived: true }) });
    return;
  }

  if (segments[0] === 'plans' && segments[1] && req.method === 'PUT') {
    const existing = billingPlans(db, { includeArchived: true }).find((item) => item.id === segments[1]);
    if (!existing) {
      sendJson(res, 404, { error: { code: 'plan_not_found', message: 'Plan not found.' } });
      return;
    }
    const body = await readJson(req);
    const updated = normalizeBillingPlan({ ...existing, ...body, id: existing.id, custom: existing.custom || !PLANS.some((plan) => plan.id === existing.id) }, existing);
    const settings = platformSettings(db);
    settings.plans = settings.plans.filter((item) => item.id !== updated.id);
    const defaultPlan = PLANS.find((item) => item.id === updated.id);
    if (!defaultPlan || JSON.stringify(normalizeBillingPlan(updated, null)) !== JSON.stringify(normalizeBillingPlan(defaultPlan, null))) {
      settings.plans.push(updated);
    }
    settings.updatedAt = new Date().toISOString();
    settings.updatedBy = user.id;
    db.auditLogs.push(audit(null, user.id, 'admin.plan_updated', 'billing_plan', updated.id, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { plan: updated, plans: billingPlans(db, { includeArchived: true }) });
    return;
  }

  if (segments[0] === 'plans' && segments[1] && req.method === 'DELETE') {
    const existing = billingPlans(db, { includeArchived: true }).find((item) => item.id === segments[1]);
    if (!existing) {
      sendJson(res, 404, { error: { code: 'plan_not_found', message: 'Plan not found.' } });
      return;
    }
    const archived = normalizeBillingPlan({ ...existing, archived: true }, existing);
    const settings = platformSettings(db);
    settings.plans = settings.plans.filter((item) => item.id !== archived.id);
    settings.plans.push(archived);
    settings.updatedAt = new Date().toISOString();
    settings.updatedBy = user.id;
    db.auditLogs.push(audit(null, user.id, 'admin.plan_archived', 'billing_plan', archived.id, {}));
    await saveDb(state);
    sendJson(res, 200, { plan: archived, plans: billingPlans(db, { includeArchived: true }) });
    return;
  }

  if (segments[0] === 'settings' && req.method === 'GET') {
    sendJson(res, 200, { settings: platformSettings(db) });
    return;
  }

  if (segments[0] === 'settings' && req.method === 'PUT') {
    const body = await readJson(req);
    const settings = platformSettings(db);
    if (body.requireEmailVerification !== undefined) settings.requireEmailVerification = parseBoolean(body.requireEmailVerification);
    settings.updatedAt = new Date().toISOString();
    settings.updatedBy = user.id;
    db.auditLogs.push(audit(null, user.id, 'admin.settings_updated', 'platform_settings', null, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { settings });
    return;
  }

  if (segments[0] === 'audit-logs' && req.method === 'GET') {
    const result = buildAuditLogResult(db, url, {});
    if (segments[1] === 'export.json') {
      db.auditLogs.push(audit(null, user.id, 'admin.audit_exported', 'audit_log', null, { total: result.total }));
      await saveDb(state);
      sendJson(res, 200, { exportedAt: new Date().toISOString(), ...result });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (segments[0] === 'templates' && req.method === 'GET') {
    sendJson(res, 200, { templates: db.customTemplates });
    return;
  }

  if (segments[0] === 'templates' && req.method === 'POST') {
    const body = await readJson(req);
    const template = createCustomTemplate(user.id, body);
    db.customTemplates.push(template);
    db.auditLogs.push(audit(null, user.id, 'admin.template_created', 'template', template.id, { name: template.name }));
    await saveDb(state);
    sendJson(res, 201, { template });
    return;
  }

  if (segments[0] === 'templates' && segments[1] && req.method === 'PUT') {
    const template = db.customTemplates.find((item) => item.id === segments[1]);
    if (!template) {
      sendJson(res, 404, { error: { code: 'template_not_found', message: 'Template not found.' } });
      return;
    }
    const body = await readJson(req);
    updateCustomTemplate(template, body);
    db.auditLogs.push(audit(template.workspaceId || null, user.id, 'admin.template_updated', 'template', template.id, { fields: Object.keys(body) }));
    await saveDb(state);
    sendJson(res, 200, { template });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Admin route not found.' } });
}

async function handleApiV1(req, res, url, segments, db, state) {
  const auth = requireApiKey(req, res, db);
  if (!auth) return;
  const { apiKey, workspaceId } = auth;
  apiKey.lastUsedAt = new Date().toISOString();
  apiKey.updatedAt = new Date().toISOString();

  if (segments[0] === 'surveys' && segments.length === 1 && req.method === 'GET') {
    if (!requireApiScope(res, apiKey, 'surveys:read')) return;
    const surveys = db.surveys.filter((survey) => survey.workspaceId === workspaceId && survey.status !== 'archived');
    sendJson(res, 200, { surveys });
    return;
  }

  if (segments[0] === 'surveys' && segments.length === 1 && req.method === 'POST') {
    if (!requireApiScope(res, apiKey, 'surveys:write')) return;
    const limitCheck = checkPlanLimit(db, workspaceId, 'surveys');
    if (!limitCheck.ok) {
      sendJson(res, 402, { error: { code: 'plan_limit', message: limitCheck.message } });
      return;
    }
    const body = await readJson(req);
    const template = findSurveyTemplate(db, body.templateId, workspaceId);
    const survey = createSurvey({
      workspaceId,
      userId: apiKey.createdBy,
      title: cleanText(body.title || template?.schema.title || 'API Survey', 160),
      description: cleanText(body.description || template?.schema.description || '', 500),
      type: cleanText(body.type || template?.type || 'feedback_form', 60),
      schema: body.schema || (template ? structuredClone(template.schema) : undefined)
    });
    db.surveys.push(survey);
    markTemplateUsed(db, template);
    createSurveyVersion(db, survey, apiKey.createdBy);
    db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.survey_created', 'survey', survey.id, { apiKeyId: apiKey.id }));
    await saveDb(state);
    sendJson(res, 201, { survey });
    return;
  }

  if (segments[0] === 'surveys' && segments[1]) {
    const survey = db.surveys.find((item) => item.id === segments[1] && item.workspaceId === workspaceId);
    if (!survey) {
      sendJson(res, 404, { error: { code: 'survey_not_found', message: 'Survey not found.' } });
      return;
    }

    if (segments.length === 2 && req.method === 'GET') {
      if (!requireApiScope(res, apiKey, 'surveys:read')) return;
      sendJson(res, 200, { survey });
      return;
    }

    if (segments.length === 2 && req.method === 'PUT') {
      if (!requireApiScope(res, apiKey, 'surveys:write')) return;
      const body = await readJson(req);
      if (surveyAccessPolicyChanged(db, survey, body)) {
        sendJson(res, 403, { error: { code: 'forbidden', message: 'API keys cannot change survey access policy.' } });
        return;
      }
      const beforeApprovalFingerprint = surveyApprovalFingerprint(survey);
      if (body.slug !== undefined) {
        const slugResult = applySurveySlug(db, survey, body.slug);
        if (!slugResult.ok) {
          sendJson(res, 400, { error: { code: 'invalid_slug', message: slugResult.message } });
          return;
        }
      }
      const beforePublishedVersion = survey.publishedVersionId;
      updateSurveyFromBody(db, survey, body);
      survey.updatedAt = new Date().toISOString();
      if (survey.status === 'published' && beforePublishedVersion) survey.hasUnpublishedChanges = true;
      markApprovalStaleIfChanged(survey, beforeApprovalFingerprint);
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.survey_updated', 'survey', survey.id, { apiKeyId: apiKey.id, fields: Object.keys(body) }));
      await saveDb(state);
      sendJson(res, 200, { survey });
      return;
    }

    if (segments.length === 2 && req.method === 'DELETE') {
      if (!requireApiScope(res, apiKey, 'surveys:write')) return;
      survey.status = 'archived';
      survey.updatedAt = new Date().toISOString();
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.survey_archived', 'survey', survey.id, { apiKeyId: apiKey.id }));
      await saveDb(state);
      sendJson(res, 200, { survey });
      return;
    }

    if (segments[2] === 'publish' && req.method === 'POST') {
      if (!requireApiScope(res, apiKey, 'surveys:write')) return;
      const publish = publishSurveyDraft(db, survey, apiKey.createdBy, { actorRole: 'api_key' });
      if (!publish.ok) {
        sendJson(res, publish.status, { error: publish.error });
        return;
      }
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.survey_published', 'survey', survey.id, { apiKeyId: apiKey.id, versionId: publish.version.id }));
      await saveDb(state);
      sendJson(res, 200, { survey, version: publish.version });
      return;
    }

    if (segments[2] === 'pause' && req.method === 'POST') {
      if (!requireApiScope(res, apiKey, 'surveys:write')) return;
      survey.status = 'paused';
      survey.updatedAt = new Date().toISOString();
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.survey_paused', 'survey', survey.id, { apiKeyId: apiKey.id }));
      await saveDb(state);
      sendJson(res, 200, { survey });
      return;
    }

    if (segments[2] === 'analytics' && req.method === 'GET') {
      if (!requireApiScope(res, apiKey, 'analytics:read')) return;
      const responses = db.responses.filter((item) => item.surveyId === survey.id && item.status !== 'deleted');
      sendJson(res, 200, { analytics: buildAnalytics(survey, responses) });
      return;
    }

    if (segments[2] === 'responses' && segments[3]) {
      const response = db.responses.find((item) => item.id === segments[3] && item.surveyId === survey.id && item.workspaceId === workspaceId);
      if (!response || response.status === 'deleted') {
        sendJson(res, 404, { error: { code: 'response_not_found', message: 'Response not found.' } });
        return;
      }

      if (req.method === 'GET') {
        if (!requireApiScope(res, apiKey, 'responses:read')) return;
        sendJson(res, 200, { response: buildResponseDetail(db, survey, response) });
        return;
      }

      if (req.method === 'PATCH') {
        if (!requireApiScope(res, apiKey, 'responses:write')) return;
        const body = await readJson(req);
        updateResponseRecord(response, body, apiKey.createdBy);
        db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.response_updated', 'response', response.id, { apiKeyId: apiKey.id, fields: Object.keys(body) }));
        await saveDb(state);
        sendJson(res, 200, { response: buildResponseDetail(db, survey, response) });
        return;
      }

      if (req.method === 'DELETE') {
        if (!requireApiScope(res, apiKey, 'responses:write')) return;
        response.status = 'deleted';
        response.deletedAt = new Date().toISOString();
        db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.response_deleted', 'response', response.id, { apiKeyId: apiKey.id }));
        await saveDb(state);
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    if (segments[2] === 'responses' && segments.length === 3 && req.method === 'POST') {
      if (!requireApiScope(res, apiKey, 'responses:write')) return;
      const body = await readJson(req);
      const availability = publicSurveyAvailability(db, survey);
      if (!availability.ok && availability.code === 'response_limit_reached') {
        sendJson(res, 409, { error: { code: availability.code, message: availability.message } });
        return;
      }
      const publishedVersion = db.surveyVersions.find((version) => version.id === survey.publishedVersionId);
      const schema = publishedVersion ? publishedVersion.schemaJson : survey.schema;
      const answers = normalizeAnswers(body.answers || {});
      const validation = validateAnswers(schema, answers);
      if (!validation.ok) {
        sendJson(res, 400, { error: { code: 'invalid_response', message: validation.message, details: validation.errors } });
        return;
      }
      const limitCheck = checkPlanLimit(db, workspaceId, 'responsesPerMonth');
      const isOverLimit = !limitCheck.ok;
      const metadata = captureMetadata(req, body.metadata || { source: 'api' }, survey);
      const duplicate = findDuplicateResponse(db, survey, schema, answers, metadata);
      if (duplicate) {
        sendJson(res, 409, { error: { code: 'duplicate_response', message: duplicate.message, responseId: duplicate.response.id } });
        return;
      }
      const response = {
        id: makeId('rsp'),
        workspaceId,
        surveyId: survey.id,
        surveyVersionId: survey.publishedVersionId,
        respondentId: null,
        status: 'partial',
        answersJson: answers,
        metadataJson: metadata,
        tagsJson: ['api'],
        sentiment: 'neutral',
        leadScore: 0,
        startedAt: body.startedAt || new Date().toISOString(),
        submittedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        internalNotes: [],
        important: false
      };
      db.responses.push(response);
      if (!(await completeResponseForSubmission(res, db, survey, schema, response, answers, response.metadataJson, { overLimit: isOverLimit, removeOnFailure: true }))) return;
      await saveDb(state);
      sendJson(res, 201, { response: buildResponseDetail(db, survey, response) });
      return;
    }
  }

  if (segments[0] === 'responses' && segments[1]) {
    const response = db.responses.find((item) => item.id === segments[1] && item.workspaceId === workspaceId);
    if (!response || response.status === 'deleted') {
      sendJson(res, 404, { error: { code: 'response_not_found', message: 'Response not found.' } });
      return;
    }
    const survey = db.surveys.find((item) => item.id === response.surveyId && item.workspaceId === workspaceId);
    if (!survey) {
      sendJson(res, 404, { error: { code: 'survey_not_found', message: 'Survey not found.' } });
      return;
    }

    if (req.method === 'GET') {
      if (!requireApiScope(res, apiKey, 'responses:read')) return;
      sendJson(res, 200, { response: buildResponseDetail(db, survey, response) });
      return;
    }

    if (req.method === 'PATCH') {
      if (!requireApiScope(res, apiKey, 'responses:write')) return;
      const body = await readJson(req);
      updateResponseRecord(response, body, apiKey.createdBy);
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.response_updated', 'response', response.id, { apiKeyId: apiKey.id, fields: Object.keys(body) }));
      await saveDb(state);
      sendJson(res, 200, { response: buildResponseDetail(db, survey, response) });
      return;
    }

    if (req.method === 'DELETE') {
      if (!requireApiScope(res, apiKey, 'responses:write')) return;
      response.status = 'deleted';
      response.deletedAt = new Date().toISOString();
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.response_deleted', 'response', response.id, { apiKeyId: apiKey.id }));
      await saveDb(state);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (segments[0] === 'responses' && segments.length === 1 && req.method === 'GET') {
    if (!requireApiScope(res, apiKey, 'responses:read')) return;
    const surveyId = url.searchParams.get('surveyId');
    const survey = surveyId ? db.surveys.find((item) => item.id === surveyId && item.workspaceId === workspaceId) : null;
    const base = db.responses.filter((item) => item.workspaceId === workspaceId && (!surveyId || item.surveyId === surveyId) && item.status !== 'deleted');
    const result = filterResponses(base, url, survey);
    sendJson(res, 200, result);
    return;
  }

  if (segments[0] === 'contacts' && segments.length === 1 && req.method === 'POST') {
    if (!requireApiScope(res, apiKey, 'contacts:write')) return;
    const body = await readJson(req);
    const email = cleanEmail(body.email || '', true);
    const phone = cleanText(body.phone || '', 40);
    if (!email && !phone) {
      sendJson(res, 400, { error: { code: 'invalid_contact', message: 'Contact requires an email or phone.' } });
      return;
    }
    let contact = email ? db.contacts.find((item) => item.workspaceId === workspaceId && item.email === email) : null;
    const created = !contact;
    if (!contact) {
      contact = {
        id: makeId('ctc'),
        workspaceId,
        name: '',
        email,
        phone,
        company: '',
        source: 'api',
        tagsJson: [],
        leadScore: 0,
        stage: normalizeContactStage(body.stage) || 'new',
        ownerId: '',
        nextFollowUpAt: '',
        pipelineUpdatedAt: new Date().toISOString(),
        lastResponseAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.contacts.push(contact);
    }
    updateApiContact(db, contact, body);
    db.auditLogs.push(audit(workspaceId, apiKey.createdBy, created ? 'api.contact_created' : 'api.contact_updated', 'contact', contact.id, { apiKeyId: apiKey.id }));
    await saveDb(state);
    sendJson(res, created ? 201 : 200, { contact });
    return;
  }

  if (segments[0] === 'contacts' && segments[1]) {
    const contact = db.contacts.find((item) => item.id === segments[1] && item.workspaceId === workspaceId);
    if (!contact) {
      sendJson(res, 404, { error: { code: 'contact_not_found', message: 'Contact not found.' } });
      return;
    }

    if (req.method === 'GET') {
      if (!requireApiScope(res, apiKey, 'contacts:read')) return;
      const responses = db.responses.filter((response) => response.workspaceId === workspaceId && response.respondentId && db.respondents.some((respondent) => respondent.id === response.respondentId && respondent.email === contact.email));
      sendJson(res, 200, { contact, responses });
      return;
    }

    if (req.method === 'PUT') {
      if (!requireApiScope(res, apiKey, 'contacts:write')) return;
      const body = await readJson(req);
      updateApiContact(db, contact, body);
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.contact_updated', 'contact', contact.id, { apiKeyId: apiKey.id, fields: Object.keys(body) }));
      await saveDb(state);
      sendJson(res, 200, { contact });
      return;
    }
  }

  if (segments[0] === 'contacts' && segments.length === 1 && req.method === 'GET') {
    if (!requireApiScope(res, apiKey, 'contacts:read')) return;
    sendJson(res, 200, { contacts: db.contacts.filter((item) => item.workspaceId === workspaceId) });
    return;
  }

  if (segments[0] === 'webhooks' && segments.length === 1 && req.method === 'GET') {
    if (!requireApiScope(res, apiKey, 'webhooks:read')) return;
    sendJson(res, 200, { webhooks: db.webhooks.filter((item) => item.workspaceId === workspaceId).map(publicWebhook) });
    return;
  }

  if (segments[0] === 'webhooks' && segments.length === 1 && req.method === 'POST') {
    if (!requireApiScope(res, apiKey, 'webhooks:write')) return;
    const body = await readJson(req);
    const webhookUrl = cleanUrl(body.url);
    if (!webhookUrl || !(await isSafeOutboundUrl(webhookUrl))) {
      sendJson(res, 400, { error: { code: 'invalid_webhook', message: 'A valid webhook URL is required.' } });
      return;
    }
    const rawSecret = crypto.randomBytes(24).toString('hex');
    const webhook = {
      id: makeId('wh'),
      workspaceId,
      url: webhookUrl,
      events: Array.isArray(body.events) ? body.events.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 20) : ['response.completed'],
      secretEncrypted: encryptConfig({ secret: rawSecret }),
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.webhooks.push(webhook);
    db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.webhook_created', 'webhook', webhook.id, { apiKeyId: apiKey.id, url: webhook.url }));
    await saveDb(state);
    sendJson(res, 201, { webhook: publicWebhook(webhook) });
    return;
  }

  if (segments[0] === 'webhooks' && segments[1]) {
    const webhook = db.webhooks.find((item) => item.id === segments[1] && item.workspaceId === workspaceId);
    if (!webhook) {
      sendJson(res, 404, { error: { code: 'webhook_not_found', message: 'Webhook not found.' } });
      return;
    }

    if (segments[2] === 'test' && req.method === 'POST') {
      if (!requireApiScope(res, apiKey, 'webhooks:write')) return;
      const payloadJson = { apiKeyId: apiKey.id, test: true };
      const log = {
        id: makeId('whlog'),
        workspaceId,
        webhookId: webhook.id,
        event: 'webhook.test',
        payloadJson,
        responseStatus: 'queued',
        error: '',
        createdAt: new Date().toISOString()
      };
      db.webhookLogs.push(log);
      queueWebhookJob(db, workspaceId, webhook.id, log.id, payloadJson, 'webhook.test');
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.webhook_tested', 'webhook', webhook.id, { apiKeyId: apiKey.id }));
      await saveDb(state);
      sendJson(res, 202, { webhookLog: log });
      return;
    }

    if (req.method === 'DELETE') {
      if (!requireApiScope(res, apiKey, 'webhooks:write')) return;
      webhook.active = false;
      webhook.deletedAt = new Date().toISOString();
      webhook.updatedAt = webhook.deletedAt;
      db.auditLogs.push(audit(workspaceId, apiKey.createdBy, 'api.webhook_deleted', 'webhook', webhook.id, { apiKeyId: apiKey.id }));
      await saveDb(state);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (segments[0] === 'webhook-logs' && req.method === 'GET') {
    if (!requireApiScope(res, apiKey, 'webhooks:read')) return;
    const webhookIds = db.webhooks.filter((item) => item.workspaceId === workspaceId).map((item) => item.id);
    sendJson(res, 200, { webhookLogs: db.webhookLogs.filter((log) => webhookIds.includes(log.webhookId)) });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'API v1 route not found.' } });
}

async function handlePublic(req, res, url, segments, db, state) {
  if (segments[0] === 'campaigns') {
    if (!requireFeature(res, 'campaigns')) return;
    await handlePublicCampaignTracking(req, res, url, segments.slice(1), db, state);
    return;
  }

  if (segments[0] === 'in-app') {
    if (!requireFeature(res, 'inAppSdk')) return;
    if (segments[1] === 'resolve' && req.method === 'POST') {
      if (!publicRateAllowed(req, 'in-app')) {
        sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many in-app survey events. Please try again shortly.' } });
        return;
      }
      const body = await readJson(req);
      const match = resolveInAppSurvey(db, body);
      sendJson(res, 200, match ? { survey: match } : { survey: null });
      return;
    }
  }

  if (segments[0] !== 'surveys' || !segments[1]) {
    sendJson(res, 404, { error: { code: 'not_found', message: 'Public route not found.' } });
    return;
  }

  const slug = segments[1];
  const survey = db.surveys.find((item) => item.slug === slug);
  const availability = survey ? publicSurveyAvailability(db, survey) : { ok: false, status: 404, code: 'not_found', message: 'Survey is not available.' };
  if (!availability.ok) {
    sendJson(res, availability.status, { error: { code: availability.code, message: availability.message } });
    return;
  }

  if ((req.method === 'GET' || req.method === 'POST') && segments.length === 2) {
    if (!publicRateAllowed(req, slug)) {
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many survey requests. Please try again shortly.' } });
      return;
    }
    let body = {};
    if (req.method === 'POST') {
      body = await readJson(req).catch(() => ({}));
    }
    if (survey.settings.passwordProtected && (req.method !== 'POST' || !surveyPasswordAllowed(survey, body.password || ''))) {
      sendJson(res, 401, { error: { code: 'password_required', message: 'This survey is password protected.' } });
      return;
    }
    survey.metrics.views += 1;
    survey.updatedAt = new Date().toISOString();
    const lastSaved = state.surveyViewLastSaved?.get(survey.id) || 0;
    const now = Date.now();
    if (now - lastSaved >= 10000) {
      state.surveyViewLastSaved?.set(survey.id, now);
      saveDb(state).catch((error) => console.error('Throttled survey view save failed', error));
    }
    const requestedLang = (req.method === 'POST' ? body.lang : null) || url.searchParams.get('lang') || '';
    sendJson(res, 200, { survey: publicSurveyPayload(db, survey, requestedLang) });
    return;
  }

  if (segments[2] === 'start' && req.method === 'POST') {
    if (!publicRateAllowed(req, slug)) {
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many survey events. Please try again shortly.' } });
      return;
    }
    const body = await readJson(req);
    if (!surveyPasswordAllowed(survey, body.password || '')) {
      sendJson(res, 401, { error: { code: 'password_required', message: 'This survey is password protected.' } });
      return;
    }
    survey.metrics.starts += 1;
    await saveDb(state);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (segments[2] === 'responses' && segments[3] === 'start' && req.method === 'POST') {
    if (!publicRateAllowed(req, slug)) {
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many survey events. Please try again shortly.' } });
      return;
    }
    const body = await readJson(req);
    if (!surveyPasswordAllowed(survey, body.password || '')) {
      sendJson(res, 401, { error: { code: 'password_required', message: 'This survey is password protected.' } });
      return;
    }
    const publishedVersion = db.surveyVersions.find((version) => version.id === survey.publishedVersionId);
    const schema = publishedVersion ? publishedVersion.schemaJson : survey.schema;
    const normalizedAnswers = normalizeAnswers(body.answers || {});
    const answers = survey.settings.anonymousMode ? anonymizeResponseAnswers(schema, normalizedAnswers) : normalizedAnswers;
    const resumeToken = `fo_resume_${crypto.randomBytes(24).toString('hex')}`;
    const response = {
      id: makeId('rsp'),
      workspaceId: survey.workspaceId,
      surveyId: survey.id,
      surveyVersionId: survey.publishedVersionId,
      respondentId: null,
      status: Object.keys(answers).length ? 'partial' : 'started',
      answersJson: answers,
      metadataJson: captureMetadata(req, body.metadata || {}, survey),
      tagsJson: [],
      sentiment: 'neutral',
      leadScore: 0,
      startedAt: body.startedAt || new Date().toISOString(),
      submittedAt: null,
      resumeTokenHash: hashToken(resumeToken),
      resumeExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      internalNotes: [],
      important: false
    };
    db.responses.push(response);
    survey.metrics.starts += 1;
    await saveDb(state);
    sendJson(res, 201, { responseId: response.id, resumeToken, resumeExpiresAt: response.resumeExpiresAt, status: response.status, visibleQuestions: visibleQuestions(schema, answers).map((item) => item.id) });
    return;
  }

  if (segments[2] === 'responses' && segments[3] && (req.method === 'GET' || req.method === 'POST') && segments.length === 4) {
    if (!publicRateAllowed(req, slug)) {
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many survey events. Please try again shortly.' } });
      return;
    }
    let body = {};
    if (req.method === 'POST') {
      body = await readJson(req).catch(() => ({}));
    }
    if (survey.settings.passwordProtected && (req.method !== 'POST' || !surveyPasswordAllowed(survey, body.password || ''))) {
      sendJson(res, 401, { error: { code: 'password_required', message: 'This survey is password protected.' } });
      return;
    }
    const resumeToken = (req.method === 'POST' ? body.resumeToken : null) || url.searchParams.get('resumeToken') || '';
    const response = db.responses.find((item) => item.id === segments[3] && item.surveyId === survey.id && ['started', 'partial'].includes(item.status));
    if (!response || !publicResumeAllowed(response, resumeToken)) {
      sendJson(res, 404, { error: { code: 'response_not_found', message: 'Partial response not found.' } });
      return;
    }
    sendJson(res, 200, {
      responseId: response.id,
      status: response.status,
      answers: response.answersJson,
      metadata: response.metadataJson,
      startedAt: response.startedAt,
      resumeExpiresAt: response.resumeExpiresAt
    });
    return;
  }

  if (segments[2] === 'responses' && segments[3] && segments[4] === 'send-resume' && req.method === 'POST') {
    if (!publicRateAllowed(req, slug)) {
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many survey events. Please try again shortly.' } });
      return;
    }
    const body = await readJson(req);
    if (!surveyPasswordAllowed(survey, body.password || '')) {
      sendJson(res, 401, { error: { code: 'password_required', message: 'This survey is password protected.' } });
      return;
    }
    const response = db.responses.find((item) => item.id === segments[3] && item.surveyId === survey.id && ['started', 'partial'].includes(item.status));
    if (!response || !response.resumeTokenHash || !publicResumeAllowed(response, body.resumeToken || '')) {
      sendJson(res, 404, { error: { code: 'response_not_found', message: 'Partial response not found.' } });
      return;
    }
    const email = cleanEmail(body.email || '', true);
    if (!email) {
      sendJson(res, 400, { error: { code: 'invalid_resume_email', message: 'A valid email is required for the resume link.' } });
      return;
    }
    const resumeLink = publicResumeLink(req, survey, response, body.resumeToken || '');
    queueEmailJob(db, survey.workspaceId, {
      to: email,
      subject: `Resume ${survey.title}`,
      body: `Resume your FeedbackOS survey here: ${resumeLink}\n\nThis link expires on ${response.resumeExpiresAt}.`
    }, { responseId: response.id, surveyId: survey.id, purpose: 'public_resume_link' });
    response.resumeEmailSentAt = new Date().toISOString();
    response.resumeEmailRecipientHash = hashToken(email).slice(0, 24);
    response.updatedAt = response.resumeEmailSentAt;
    db.auditLogs.push(audit(survey.workspaceId, null, 'public_response.resume_link_emailed', 'response', response.id, { recipientHash: response.resumeEmailRecipientHash }));
    await saveDb(state);
    sendJson(res, 202, { ok: true, emailedAt: response.resumeEmailSentAt, resumeExpiresAt: response.resumeExpiresAt });
    return;
  }

  if (segments[2] === 'responses' && segments[3] && req.method === 'PATCH') {
    if (!publicRateAllowed(req, slug)) {
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many survey events. Please try again shortly.' } });
      return;
    }
    const body = await readJson(req);
    if (!surveyPasswordAllowed(survey, body.password || '')) {
      sendJson(res, 401, { error: { code: 'password_required', message: 'This survey is password protected.' } });
      return;
    }
    const response = db.responses.find((item) => item.id === segments[3] && item.surveyId === survey.id && ['started', 'partial'].includes(item.status));
    if (!response || !publicResumeAllowed(response, body.resumeToken || '')) {
      sendJson(res, 404, { error: { code: 'response_not_found', message: 'Partial response not found.' } });
      return;
    }
    const publishedVersion = db.surveyVersions.find((version) => version.id === survey.publishedVersionId);
    const schema = publishedVersion ? publishedVersion.schemaJson : survey.schema;
    const normalizedIncomingAnswers = normalizeAnswers(body.answers || {});
    const incomingAnswers = survey.settings.anonymousMode ? anonymizeResponseAnswers(schema, normalizedIncomingAnswers) : normalizedIncomingAnswers;
    const answers = body.replaceAnswers ? incomingAnswers : { ...response.answersJson, ...incomingAnswers };
    response.answersJson = answers;
    response.metadataJson = { ...response.metadataJson, ...captureMetadata(req, body.metadata || {}, survey) };
    response.status = body.complete ? response.status : 'partial';
    response.updatedAt = new Date().toISOString();

    if (body.complete) {
      const validation = validateAnswers(schema, answers);
      if (!validation.ok) {
        sendJson(res, 400, { error: { code: 'invalid_response', message: validation.message, details: validation.errors } });
        return;
      }
      const limitCheck = checkPlanLimit(db, survey.workspaceId, 'responsesPerMonth');
      const isOverLimit = !limitCheck.ok;
      const availabilityNow = publicSurveyAvailability(db, survey);
      if (!availabilityNow.ok && availabilityNow.code === 'response_limit_reached') {
        sendJson(res, 409, { error: { code: availabilityNow.code, message: availabilityNow.message } });
        return;
      }
      const duplicate = findDuplicateResponse(db, survey, schema, answers, response.metadataJson, response.id);
      if (duplicate) {
        sendJson(res, 409, { error: { code: 'duplicate_response', message: duplicate.message, responseId: duplicate.response.id } });
        return;
      }
      if (!(await completeResponseForSubmission(res, db, survey, schema, response, answers, response.metadataJson, { overLimit: isOverLimit }))) return;
      response.resumeTokenHash = '';
      response.resumeExpiresAt = '';
    }

    await saveDb(state);
    sendJson(res, 200, {
      responseId: response.id,
      resumeExpiresAt: response.resumeExpiresAt,
      status: response.status,
      visibleQuestions: visibleQuestions(schema, answers).map((item) => item.id),
      completion: body.complete ? responseCompletion(survey, schema, response) : null
    });
    return;
  }

  if (segments[2] === 'responses' && req.method === 'POST') {
    if (!publicRateAllowed(req, slug)) {
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'Too many submissions. Please try again shortly.' } });
      return;
    }
    const body = await readJson(req);
    if (!surveyPasswordAllowed(survey, body.password || '')) {
      sendJson(res, 401, { error: { code: 'password_required', message: 'This survey is password protected.' } });
      return;
    }
    const publishedVersion = db.surveyVersions.find((version) => version.id === survey.publishedVersionId);
    const schema = publishedVersion ? publishedVersion.schemaJson : survey.schema;
    const answers = normalizeAnswers(body.answers || {});
    const validation = validateAnswers(schema, answers);
    if (!validation.ok) {
      sendJson(res, 400, { error: { code: 'invalid_response', message: validation.message, details: validation.errors } });
      return;
    }
    const limitCheck = checkPlanLimit(db, survey.workspaceId, 'responsesPerMonth');
    const isOverLimit = !limitCheck.ok;
    const metadata = captureMetadata(req, body.metadata || {}, survey);
    const duplicate = findDuplicateResponse(db, survey, schema, answers, metadata);
    if (duplicate) {
      sendJson(res, 409, { error: { code: 'duplicate_response', message: duplicate.message, responseId: duplicate.response.id } });
      return;
    }
    const response = {
      id: makeId('rsp'),
      workspaceId: survey.workspaceId,
      surveyId: survey.id,
      surveyVersionId: survey.publishedVersionId,
      respondentId: null,
      status: 'partial',
      answersJson: answers,
      metadataJson: metadata,
      tagsJson: [],
      sentiment: classifySentiment(answersToText(answers)),
      leadScore: calculateLeadScore(schema, answers, metadata),
      startedAt: body.startedAt || new Date().toISOString(),
      submittedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      internalNotes: [],
      important: false
    };
    db.responses.push(response);
    if (!(await completeResponseForSubmission(res, db, survey, schema, response, answers, metadata, { overLimit: isOverLimit, removeOnFailure: true }))) return;
    await saveDb(state);
    sendJson(res, 201, { responseId: response.id, completion: responseCompletion(survey, schema, response) });
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Public route not found.' } });
}

async function handlePublicCampaignTracking(req, res, url, segments, db, state) {
  const campaignId = segments[0];
  const action = segments[1] || '';
  const recipientHash = cleanText(url.searchParams.get('recipient') || '', 120);
  const campaign = db.emailCampaigns.find((item) => item.id === campaignId);
  if (!campaign) {
    sendJson(res, 404, { error: { code: 'campaign_not_found', message: 'Campaign not found.' } });
    return;
  }

  if (action === 'open.gif' && req.method === 'GET') {
    recordCampaignEvent(db, campaign, 'open', recipientHash, req);
    await saveDb(state);
    const pixel = Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
    res.writeHead(200, withSecurityHeaders({
      'content-type': 'image/gif',
      'cache-control': 'no-store, max-age=0',
      'content-length': pixel.length
    }));
    res.end(pixel);
    return;
  }

  if (action === 'click' && req.method === 'GET') {
    recordCampaignEvent(db, campaign, 'click', recipientHash, req);
    await saveDb(state);
    const target = cleanUrl(url.searchParams.get('url') || '') || '/';
    res.writeHead(302, withSecurityHeaders({ location: target, 'cache-control': 'no-store' }));
    res.end();
    return;
  }

  sendJson(res, 404, { error: { code: 'not_found', message: 'Campaign tracking route not found.' } });
}

function getDb(state) {
  if (state.db) return Promise.resolve(state.db);
  if (state.dbLoadPromise) return state.dbLoadPromise;
  state.dbLoadPromise = (state.databaseUrl ? loadPostgresDb(state) : loadJsonDb(state))
    .then((db) => {
      state.db = migrateDb(db);
      return state.db;
    })
    .finally(() => {
      state.dbLoadPromise = null;
    });
  return state.dbLoadPromise;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveDb(state) {
  if (state.db && Array.isArray(state.db.auditLogs) && state.db.auditLogs.length > LOG_MEMORY_MAX) {
    state.db.auditLogs = state.db.auditLogs.slice(-LOG_MEMORY_MAX);
  }
  state.saveDirty = true;
  if (state.saveBatchPromise) return state.saveBatchPromise;
  state.saveBatchPromise = state.writeQueue.then(async () => {
    if (DB_SAVE_BATCH_DELAY_MS > 0) await delay(DB_SAVE_BATCH_DELAY_MS);
    while (state.saveDirty) {
      state.saveDirty = false;
      if (state.databaseUrl) {
        await savePostgresDb(state, state.db);
      } else {
        await saveJsonDb(state);
      }
    }
  }).finally(() => {
    state.saveBatchPromise = null;
  });
  state.writeQueue = state.saveBatchPromise.catch(() => {});
  return state.saveBatchPromise;
}

async function loadJsonDb(state) {
  return fs.promises
    .readFile(state.dataFile, 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return createEmptyDb();
    });
}

async function saveJsonDb(state) {
  await fs.promises.mkdir(path.dirname(state.dataFile), { recursive: true });
  const temp = `${state.dataFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temp, JSON.stringify(state.db, null, 2));
  await fs.promises.rename(temp, state.dataFile);
}

async function loadPostgresDb(state) {
  const pool = await ensurePostgresRuntime(state);
  const result = await pool.query('SELECT value_json FROM platform_settings WHERE key = $1', [POSTGRES_RUNTIME_STATE_KEY]);
  const hasRelationalRows = await postgresHasRelationalRows(pool);
  if (!result.rows.length && !hasRelationalRows) {
    const db = createEmptyDb();
    await savePostgresDb(state, db);
    return db;
  }
  const value = result.rows[0]?.value_json || {};
  const snapshot = typeof value === 'string' ? JSON.parse(value) : value;
  const db = migrateDb({ ...createEmptyDb(), ...snapshot });
  await loadPostgresPlatformSettings(pool, db);
  if (hasRelationalRows) {
    await loadPostgresRelationalCollections(pool, db, state);
  }
  return db;
}

async function savePostgresDb(state, db) {
  const pool = await ensurePostgresRuntime(state);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (postgresCompatibilitySnapshotEnabled()) {
      await client.query(
        `INSERT INTO platform_settings(key, value_json, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key)
         DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()`,
        [POSTGRES_RUNTIME_STATE_KEY, JSON.stringify(db || createEmptyDb())]
      );
    }
    await savePostgresPlatformSettings(client, db || createEmptyDb());
    const nextPgShadow = {};
    await savePostgresRelationalCollections(client, db || createEmptyDb(), state, nextPgShadow);
    if (!postgresCompatibilitySnapshotEnabled()) {
      await client.query('DELETE FROM platform_settings WHERE key = $1', [POSTGRES_RUNTIME_STATE_KEY]);
    }
    await client.query('COMMIT');
    state.pgShadow = nextPgShadow;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function postgresCompatibilitySnapshotEnabled() {
  if (process.env.POSTGRES_COMPATIBILITY_SNAPSHOT !== undefined) {
    return String(process.env.POSTGRES_COMPATIBILITY_SNAPSHOT).toLowerCase() === 'true';
  }
  return process.env.NODE_ENV !== 'production';
}

async function loadPostgresPlatformSettings(pool, db) {
  const result = await pool.query('SELECT value_json FROM platform_settings WHERE key = $1', [POSTGRES_PLATFORM_SETTINGS_KEY]);
  if (!result.rows.length) return;
  const value = result.rows[0]?.value_json || {};
  db.platformSettings = normalizePlatformSettings(typeof value === 'string' ? JSON.parse(value) : value);
}

async function savePostgresPlatformSettings(client, db) {
  await client.query(
    `INSERT INTO platform_settings(key, value_json, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()`,
    [POSTGRES_PLATFORM_SETTINGS_KEY, JSON.stringify(normalizePlatformSettings(db.platformSettings || {}))]
  );
}

const POSTGRES_EXTRA_PROPERTIES = {
  users: ['twoFactorPendingAt', 'twoFactorEnabledAt', 'twoFactorDisabledAt', 'oauthProviders'],
  workspaces: ['permissionPolicy', 'previousPlanId', 'customDomainDnsCheckedAt', 'customDomainObservedTxt', 'customDomainSslCertificateId', 'customDomainSslLastError', 'customDomainSslProvider', 'customDomainSslProvisionedAt', 'customDomainSslUpdatedAt'],
  surveys: ['hasUnpublishedChanges', 'approvalStatus', 'approvalFingerprint', 'approvalNote', 'approvalRequestedAt', 'approvalRequestedBy', 'approvalReviewedAt', 'approvalReviewedBy'],
  responses: ['logicCompletionJson', 'fileUploadBytes', 'resumeEmailSentAt', 'resumeEmailRecipientHash'],
  jobs: ['externalQueue', 'externalQueueName', 'externalQueuedAt'],
  webhooks: ['deletedAt'],
  workspaceInvites: ['status']
};

const POSTGRES_TRANSIENT_PROPERTIES = {
  users: ['twoFactorPendingSecret']
};

const POSTGRES_RELATIONAL_COLLECTIONS = [
  {
    collection: 'users',
    table: 'users',
    orderBy: 'created_at',
    prepare: postgresPrepareUser,
    hydrate: postgresHydrateUser,
    fields: {
      id: 'id',
      name: 'name',
      email: 'email',
      password: 'password_hash',
      avatarUrl: 'avatar_url',
      emailVerifiedAt: { column: 'email_verified_at', type: 'date' },
      platformRole: 'platform_role',
      timezone: 'timezone',
      notificationPreferences: { column: 'notification_preferences', type: 'json', fallback: {} },
      disabled: { column: 'disabled', type: 'boolean' },
      twoFactorSecretEncrypted: 'two_factor_secret_encrypted',
      twoFactorEnabled: { column: 'two_factor_enabled', type: 'boolean' },
      twoFactorRecoveryCodeHashes: { column: 'two_factor_recovery_codes', type: 'json', fallback: [] },
      authProvider: 'auth_provider',
      termsAcceptedAt: { column: 'terms_accepted_at', type: 'date' },
      privacyAcceptedAt: { column: 'privacy_accepted_at', type: 'date' },
      extraJson: { column: 'extra_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'sessions',
    table: 'sessions',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      userId: 'user_id',
      remembered: { column: 'remembered', type: 'boolean' },
      createdAt: { column: 'created_at', type: 'date' },
      expiresAt: { column: 'expires_at', type: 'date' }
    }
  },
  {
    collection: 'twoFactorChallenges',
    table: 'two_factor_challenges',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      userId: 'user_id',
      tokenHash: 'token_hash',
      rememberMe: { column: 'remember_me', type: 'boolean' },
      attempts: { column: 'attempts', type: 'integer' },
      usedAt: { column: 'used_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' },
      expiresAt: { column: 'expires_at', type: 'date' }
    }
  },
  {
    collection: 'emailVerificationTokens',
    table: 'email_verification_tokens',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      userId: 'user_id',
      tokenHash: 'token_hash',
      tokenPreview: 'token_preview',
      expiresAt: { column: 'expires_at', type: 'date' },
      usedAt: { column: 'used_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'passwordResetTokens',
    table: 'password_reset_tokens',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      userId: 'user_id',
      tokenHash: 'token_hash',
      tokenPreview: 'token_preview',
      expiresAt: { column: 'expires_at', type: 'date' },
      usedAt: { column: 'used_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'oauthAuthRequests',
    table: 'oauth_auth_requests',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      provider: 'provider',
      stateHash: 'state_hash',
      codeVerifier: 'code_verifier',
      mode: 'mode',
      responseMode: 'response_mode',
      name: 'name',
      workspaceName: 'workspace_name',
      industry: 'industry',
      companySize: 'company_size',
      timezone: 'timezone',
      acceptedTerms: { column: 'accepted_terms', type: 'boolean' },
      status: 'status',
      lastError: 'last_error',
      expiresAt: { column: 'expires_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' },
      completedAt: { column: 'completed_at', type: 'date' }
    }
  },
  {
    collection: 'workspaces',
    table: 'workspaces',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      name: 'name',
      slug: 'slug',
      logoUrl: 'logo_url',
      brandColor: 'brand_color',
      buttonColor: 'button_color',
      timezone: 'timezone',
      defaultLanguage: 'default_language',
      ownerId: 'owner_id',
      planId: 'plan_id',
      aiCreditLimitOverride: { column: 'ai_credit_limit_override', type: 'integer' },
      allowExternalAi: { column: 'allow_external_ai', type: 'boolean' },
      industry: 'industry',
      companySize: 'company_size',
      customDomain: 'custom_domain',
      customDomainStatus: 'custom_domain_status',
      customDomainVerificationToken: 'custom_domain_verification_token',
      customDomainVerifiedAt: { column: 'custom_domain_verified_at', type: 'date' },
      customDomainSslStatus: 'custom_domain_ssl_status',
      defaultSenderEmail: 'default_sender_email',
      customCss: 'custom_css',
      customFooterText: 'custom_footer_text',
      sso: { column: 'sso_json', type: 'json', fallback: {} },
      dataRetentionSettings: { column: 'data_retention_settings', type: 'json', fallback: {} },
      privacyPolicyUrl: 'privacy_policy_url',
      termsUrl: 'terms_url',
      retentionDays: { column: 'retention_days', type: 'integer' },
      retentionScheduleEnabled: { column: 'retention_schedule_enabled', type: 'boolean' },
      retentionLastRunAt: { column: 'retention_last_run_at', type: 'date' },
      retentionNextRunAt: { column: 'retention_next_run_at', type: 'date' },
      suspended: { column: 'suspended', type: 'boolean' },
      billingWarning: 'billing_warning',
      extraJson: { column: 'extra_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'workspaceMembers',
    table: 'workspace_members',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      userId: 'user_id',
      role: 'role',
      invitedBy: { column: 'invited_by', nullable: true },
      joinedAt: { column: 'joined_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'ssoAuthRequests',
    table: 'sso_auth_requests',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      email: 'email',
      relayState: 'relay_state',
      status: 'status',
      createdAt: { column: 'created_at', type: 'date' },
      expiresAt: { column: 'expires_at', type: 'date' },
      completedAt: { column: 'completed_at', type: 'date' }
    }
  },
  {
    collection: 'apiKeys',
    table: 'api_keys',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      name: 'name',
      tokenHash: 'token_hash',
      tokenPreview: 'token_preview',
      scopes: { column: 'scopes_json', type: 'json', fallback: [] },
      rateLimitPerMinute: { column: 'rate_limit_per_minute', type: 'integer' },
      createdBy: { column: 'created_by', nullable: true },
      lastUsedAt: { column: 'last_used_at', type: 'date' },
      revokedAt: { column: 'revoked_at', type: 'date' },
      rotatedAt: { column: 'rotated_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'workspaceInvites',
    table: 'workspace_invites',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      email: 'email',
      role: 'role',
      tokenHash: 'token_hash',
      tokenPreview: 'token_preview',
      invitedBy: { column: 'invited_by', nullable: true },
      acceptedAt: { column: 'accepted_at', type: 'date' },
      expiresAt: { column: 'expires_at', type: 'date' },
      extraJson: { column: 'extra_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'surveys',
    table: 'surveys',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      title: 'title',
      description: 'description',
      internalName: 'internal_name',
      type: 'type',
      status: 'status',
      slug: 'slug',
      language: 'language',
      settings: { column: 'settings_json', type: 'json', fallback: {} },
      branding: { column: 'branding_json', type: 'json', fallback: {} },
      schema: { column: 'schema_json', type: 'json', fallback: {} },
      accessMode: 'access_mode',
      accessRules: { column: 'access_rules_json', type: 'json', fallback: [] },
      metrics: { column: 'metrics_json', type: 'json', fallback: {} },
      createdBy: { column: 'created_by', nullable: true },
      publishedVersionId: { column: 'published_version_id', nullable: true },
      publishedAt: { column: 'published_at', type: 'date' },
      archivedAt: { column: 'archived_at', type: 'date' },
      extraJson: { column: 'extra_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'surveyVersions',
    table: 'survey_versions',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      surveyId: 'survey_id',
      versionNumber: { column: 'version_number', type: 'integer' },
      schemaJson: { column: 'schema_json', type: 'json', fallback: {} },
      logicJson: { column: 'logic_json', type: 'json', fallback: [] },
      createdBy: { column: 'created_by', nullable: true },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'respondents',
    table: 'respondents',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      externalId: 'external_id',
      email: 'email',
      phone: 'phone',
      name: 'name',
      attributesJson: { column: 'attributes_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'responses',
    table: 'responses',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      surveyId: 'survey_id',
      surveyVersionId: { column: 'survey_version_id', nullable: true },
      respondentId: { column: 'respondent_id', nullable: true },
      status: 'status',
      answersJson: { column: 'answers_json', type: 'json', fallback: {} },
      metadataJson: { column: 'metadata_json', type: 'json', fallback: {} },
      tagsJson: { column: 'tags_json', type: 'json', fallback: [] },
      sentiment: 'sentiment',
      leadScore: { column: 'lead_score', type: 'integer' },
      important: { column: 'important', type: 'boolean' },
      internalNotes: { column: 'internal_notes_json', type: 'json', fallback: [] },
      resumeTokenHash: 'resume_token_hash',
      resumeExpiresAt: { column: 'resume_expires_at', type: 'date' },
      startedAt: { column: 'started_at', type: 'date' },
      submittedAt: { column: 'submitted_at', type: 'date' },
      archivedAt: { column: 'archived_at', type: 'date' },
      deletedAt: { column: 'deleted_at', type: 'date' },
      extraJson: { column: 'extra_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'contacts',
    table: 'contacts',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      name: 'name',
      email: 'email',
      phone: 'phone',
      company: 'company',
      source: 'source',
      tagsJson: { column: 'tags_json', type: 'json', fallback: [] },
      leadScore: { column: 'lead_score', type: 'integer' },
      stage: 'stage',
      ownerId: { column: 'owner_id', nullable: true },
      nextFollowUpAt: { column: 'next_follow_up_at', type: 'date' },
      pipelineUpdatedAt: { column: 'pipeline_updated_at', type: 'date' },
      lastResponseAt: { column: 'last_response_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'integrations',
    table: 'integrations',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      type: 'type',
      name: 'name',
      configEncrypted: 'config_encrypted',
      configJson: { column: 'config_json', type: 'json', fallback: {} },
      events: { column: 'events_json', type: 'json', fallback: [] },
      status: 'status',
      createdBy: { column: 'created_by', nullable: true },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'integrationLogs',
    table: 'integration_logs',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      integrationId: { column: 'integration_id', nullable: true },
      type: 'type',
      event: 'event',
      payloadJson: { column: 'payload_json', type: 'json', fallback: {} },
      provider: 'provider',
      status: 'status',
      responseStatus: 'response_status',
      error: 'error',
      jobId: { column: 'job_id', nullable: true },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'webhooks',
    table: 'webhooks',
    orderBy: 'created_at',
    prepare: postgresPrepareWebhook,
    hydrate: postgresHydrateWebhook,
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      url: 'url',
      events: { column: 'events_json', type: 'json', fallback: [] },
      secret: 'secret',
      active: { column: 'active', type: 'boolean' },
      extraJson: { column: 'extra_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'webhookLogs',
    table: 'webhook_logs',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      webhookId: { column: 'webhook_id', nullable: true },
      event: 'event',
      payloadJson: { column: 'payload_json', type: 'json', fallback: {} },
      responseStatus: 'response_status',
      error: 'error',
      deliveredAt: { column: 'delivered_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'alerts',
    table: 'alerts',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      surveyId: { column: 'survey_id', nullable: true },
      name: 'name',
      conditionsJson: { column: 'conditions_json', type: 'json', fallback: {} },
      channelsJson: { column: 'channels_json', type: 'json', fallback: {} },
      active: { column: 'active', type: 'boolean' },
      extraJson: { column: 'extra_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'aiJobs',
    table: 'ai_jobs',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      surveyId: { column: 'survey_id', nullable: true },
      responseId: { column: 'response_id', nullable: true },
      jobType: 'job_type',
      status: 'status',
      inputJson: { column: 'input_json', type: 'json', fallback: {} },
      outputJson: { column: 'output_json', type: 'json', fallback: {} },
      tokensUsed: { column: 'tokens_used', type: 'integer' },
      error: 'error',
      createdAt: { column: 'created_at', type: 'date' },
      completedAt: { column: 'completed_at', type: 'date' }
    }
  },
  {
    collection: 'aiProviderLogs',
    table: 'ai_provider_logs',
    orderBy: 'created_at',
    appendOnly: true,
    fields: {
      id: 'id',
      workspaceId: { column: 'workspace_id', nullable: true },
      task: 'task',
      provider: 'provider',
      model: 'model',
      status: 'status',
      durationMs: { column: 'duration_ms', type: 'integer' },
      totalTokens: { column: 'total_tokens', type: 'integer' },
      promptTokens: { column: 'prompt_tokens', type: 'integer' },
      completionTokens: { column: 'completion_tokens', type: 'integer' },
      error: 'error',
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'subscriptions',
    table: 'subscriptions',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      planId: 'plan_id',
      provider: 'provider',
      providerSubscriptionId: 'provider_subscription_id',
      providerCustomerId: 'provider_customer_id',
      status: 'status',
      currentPeriodStart: { column: 'current_period_start', type: 'date' },
      currentPeriodEnd: { column: 'current_period_end', type: 'date' },
      billingPolicy: { column: 'billing_policy_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'invoices',
    table: 'invoices',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      subscriptionId: { column: 'subscription_id', nullable: true },
      provider: 'provider',
      providerInvoiceId: 'provider_invoice_id',
      status: 'status',
      subtotalInr: { column: 'subtotal_inr', type: 'integer' },
      taxInr: { column: 'tax_inr', type: 'integer' },
      taxMode: 'tax_mode',
      taxPercent: { column: 'tax_percent', type: 'number' },
      prorationCreditInr: { column: 'proration_credit_inr', type: 'integer' },
      amountDueInr: { column: 'amount_due_inr', type: 'integer' },
      amountPaidInr: { column: 'amount_paid_inr', type: 'integer' },
      lineItems: { column: 'line_items_json', type: 'json', fallback: [] },
      billingPolicy: { column: 'billing_policy_json', type: 'json', fallback: {} },
      dueAt: { column: 'due_at', type: 'date' },
      paidAt: { column: 'paid_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'usageMeters',
    table: 'usage_meters',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      period: 'period',
      responsesCount: { column: 'responses_count', type: 'integer' },
      aiCreditsUsed: { column: 'ai_credits_used', type: 'integer' },
      storageUsed: { column: 'storage_used', type: 'integer' },
      teamMembersCount: { column: 'team_members_count', type: 'integer' },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'customTemplates',
    table: 'custom_templates',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: { column: 'workspace_id', nullable: true },
      scope: 'scope',
      status: 'status',
      name: 'name',
      type: 'type',
      visibility: 'visibility',
      category: 'category',
      industry: 'industry',
      useCase: 'use_case',
      description: 'description',
      tags: { column: 'tags_json', type: 'json', fallback: [] },
      schema: { column: 'schema_json', type: 'json', fallback: {} },
      sourceSurveyId: { column: 'source_survey_id', nullable: true },
      createdBy: { column: 'created_by', nullable: true },
      usageCount: { column: 'usage_count', type: 'integer' },
      publishedAt: { column: 'published_at', type: 'date' },
      archivedAt: { column: 'archived_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'jobs',
    table: 'jobs',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: { column: 'workspace_id', nullable: true },
      type: 'type',
      status: 'status',
      attempts: { column: 'attempts', type: 'integer' },
      maxAttempts: { column: 'max_attempts', type: 'integer' },
      nextRunAt: { column: 'next_run_at', type: 'date' },
      payloadJson: { column: 'payload_json', type: 'json', fallback: {} },
      lastError: 'last_error',
      completedAt: { column: 'completed_at', type: 'date' },
      extraJson: { column: 'extra_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'emailLogs',
    table: 'email_logs',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: { column: 'workspace_id', nullable: true },
      to: 'recipient',
      subject: 'subject',
      bodyPreview: 'body_preview',
      provider: 'provider',
      status: 'status',
      error: 'error',
      jobId: { column: 'job_id', nullable: true },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'emailCampaigns',
    table: 'email_campaigns',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      surveyId: { column: 'survey_id', nullable: true },
      name: 'name',
      subject: 'subject',
      message: 'message',
      contacts: { column: 'contacts_json', type: 'json', fallback: [] },
      status: 'status',
      sentCount: { column: 'sent_count', type: 'integer' },
      openedCount: { column: 'opened_count', type: 'integer' },
      clickedCount: { column: 'clicked_count', type: 'integer' },
      scheduledAt: { column: 'scheduled_at', type: 'date' },
      createdBy: { column: 'created_by', nullable: true },
      createdAt: { column: 'created_at', type: 'date' },
      updatedAt: { column: 'updated_at', type: 'date' }
    }
  },
  {
    collection: 'campaignEvents',
    table: 'campaign_events',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      campaignId: 'campaign_id',
      surveyId: { column: 'survey_id', nullable: true },
      eventType: 'event',
      recipientHash: 'recipient_hash',
      email: 'email',
      userAgent: 'user_agent',
      ipHash: 'ip_hash',
      metadataJson: { column: 'metadata_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'fileUploads',
    table: 'file_uploads',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      surveyId: { column: 'survey_id', nullable: true },
      responseId: { column: 'response_id', nullable: true },
      questionId: 'question_id',
      name: 'name',
      type: 'mime_type',
      extension: 'extension',
      size: { column: 'size_bytes', type: 'integer' },
      sha256: 'sha256',
      storageProvider: 'storage_provider',
      storageBucket: 'storage_bucket',
      storageKey: 'storage_key',
      storageUrl: 'storage_url',
      dataUrl: 'data_url',
      scanStatus: 'scan_status',
      scanProvider: 'scan_provider',
      scanSignature: 'scan_signature',
      scanMessage: 'scan_message',
      scanCheckedAt: { column: 'scan_checked_at', type: 'date' },
      quarantined: { column: 'quarantined', type: 'boolean' },
      lifecycleStatus: 'lifecycle_status',
      retentionExpiresAt: { column: 'retention_expires_at', type: 'date' },
      deletedAt: { column: 'deleted_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'monthlyReports',
    table: 'monthly_reports',
    orderBy: 'created_at',
    prepare: postgresPrepareMonthlyReport,
    hydrate: postgresHydrateMonthlyReport,
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      month: 'month',
      title: 'title',
      reportJson: { column: 'report_json', type: 'json', fallback: {} },
      aiGenerated: { column: 'ai_generated', type: 'boolean' },
      scheduled: { column: 'scheduled', type: 'boolean' },
      jobId: { column: 'job_id', nullable: true },
      pdfUrl: 'pdf_url',
      generatedAt: { column: 'generated_at', type: 'date' },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'auditLogs',
    table: 'audit_logs',
    orderBy: 'created_at',
    appendOnly: true,
    fields: {
      id: 'id',
      workspaceId: { column: 'workspace_id', nullable: true },
      userId: { column: 'user_id', nullable: true },
      action: 'action',
      entityType: 'entity_type',
      entityId: { column: 'entity_id', nullable: true },
      metadataJson: { column: 'metadata_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'notifications',
    table: 'notifications',
    orderBy: 'created_at',
    fields: {
      id: 'id',
      workspaceId: 'workspace_id',
      userId: { column: 'user_id', nullable: true },
      title: 'title',
      message: 'body',
      read: { column: 'read', type: 'boolean' },
      readAt: { column: 'read_at', type: 'date' },
      metadataJson: { column: 'metadata_json', type: 'json', fallback: {} },
      createdAt: { column: 'created_at', type: 'date' }
    }
  },
  {
    collection: 'errorLogs',
    table: 'error_logs',
    orderBy: 'created_at',
    appendOnly: true,
    fields: {
      id: 'id',
      method: 'method',
      path: 'path',
      query: 'query',
      name: 'name',
      message: 'message',
      stack: 'stack',
      userAgent: 'user_agent',
      createdAt: { column: 'created_at', type: 'date' }
    }
  }
];

async function postgresHasRelationalRows(pool) {
  for (const config of POSTGRES_RELATIONAL_COLLECTIONS) {
    const result = await pool.query(`SELECT EXISTS (SELECT 1 FROM ${config.table} LIMIT 1) AS has_rows`);
    if (result.rows[0]?.has_rows) return true;
  }
  return false;
}

async function loadPostgresRelationalCollections(pool, db, state) {
  if (state && !state.pgShadow) {
    state.pgShadow = {};
  }
  for (const config of POSTGRES_RELATIONAL_COLLECTIONS) {
    const query = config.appendOnly
      ? `SELECT * FROM (SELECT * FROM ${config.table} ORDER BY ${config.orderBy || 'id'} DESC LIMIT ${LOG_MEMORY_MAX}) recent ORDER BY ${config.orderBy || 'id'} ASC`
      : `SELECT * FROM ${config.table} ORDER BY ${config.orderBy || 'id'} ASC`;
    const result = await pool.query(query);
    const snapshotById = new Map((db[config.collection] || []).map((item) => [item.id, item]));
    db[config.collection] = result.rows.map((row) => {
      const item = {
        ...(snapshotById.get(row.id) || {}),
        ...postgresRowToObject(config, row)
      };
      return postgresHydrateItem(config, item, row);
    });
    if (state) {
      const currentById = new Map();
      for (const item of db[config.collection] || []) {
        const prepared = postgresPrepareItem(config, item);
        const { columns, values } = postgresObjectToRow(config, prepared);
        currentById.set(item.id, { columns, values });
      }
      state.pgShadow[config.collection] = currentById;
    }
  }
}

async function savePostgresRelationalCollections(client, db, state, nextPgShadow) {
  for (const config of POSTGRES_RELATIONAL_COLLECTIONS) {
    const currentById = new Map();
    for (const item of db[config.collection] || []) {
      const prepared = postgresPrepareItem(config, item);
      const { columns, values } = postgresObjectToRow(config, prepared);
      currentById.set(item.id, { columns, values });
    }
    nextPgShadow[config.collection] = currentById;
  }

  // Deletes: reverse order
  for (const config of [...POSTGRES_RELATIONAL_COLLECTIONS].reverse()) {
    if (config.appendOnly) continue;
    const currentById = nextPgShadow[config.collection];
    const shadowById = state.pgShadow?.[config.collection] ?? new Map();
    for (const id of shadowById.keys()) {
      if (!currentById.has(id)) {
        await client.query(`DELETE FROM ${config.table} WHERE id = $1`, [id]);
      }
    }
  }

  // Upserts: forward order
  for (const config of POSTGRES_RELATIONAL_COLLECTIONS) {
    const currentById = nextPgShadow[config.collection];
    const shadowById = state.pgShadow?.[config.collection] ?? new Map();
    for (const [id, row] of currentById.entries()) {
      const shadowRow = shadowById.get(id);
      const needsUpsert = !shadowRow || JSON.stringify(row.values) !== JSON.stringify(shadowRow.values);
      if (needsUpsert) {
        if (!row.columns.length) continue;
        const placeholders = row.columns.map((_, index) => `$${index + 1}`).join(', ');
        const nonIdCols = row.columns.filter((c) => c !== 'id');
        let queryStr = `INSERT INTO ${config.table} (${row.columns.join(', ')}) VALUES (${placeholders})`;
        if (nonIdCols.length > 0) {
          const updateClause = nonIdCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
          queryStr += ` ON CONFLICT (id) DO UPDATE SET ${updateClause}`;
        } else {
          queryStr += ` ON CONFLICT (id) DO NOTHING`;
        }
        await client.query(queryStr, row.values);
      }
    }
  }
}

function postgresObjectToRow(config, item) {
  const columns = [];
  const values = [];
  for (const [property, field] of Object.entries(config.fields)) {
    const descriptor = postgresFieldDescriptor(field);
    const value = item?.[property];
    if (value === undefined) continue;
    columns.push(descriptor.column);
    values.push(postgresSerializeValue(descriptor, value));
  }
  return { columns, values };
}

function postgresRowToObject(config, row) {
  const output = {};
  for (const [property, field] of Object.entries(config.fields)) {
    const descriptor = postgresFieldDescriptor(field);
    if (!(descriptor.column in row)) continue;
    output[property] = postgresDeserializeValue(descriptor, row[descriptor.column]);
  }
  return output;
}

function postgresFieldDescriptor(field) {
  return typeof field === 'string' ? { column: field, type: 'text' } : field;
}

function postgresPrepareMonthlyReport(item = {}) {
  return {
    ...item,
    reportJson: {
      totalResponses: item.totalResponses || 0,
      surveyCount: item.surveyCount || 0,
      satisfactionScore: item.satisfactionScore || 0,
      sentiment: item.sentiment || {},
      trends: item.trends || [],
      topIssues: item.topIssues || [],
      topOpportunities: item.topOpportunities || [],
      importantQuotes: item.importantQuotes || [],
      recommendedActions: item.recommendedActions || [],
      leadQualitySummary: item.leadQualitySummary || {},
      provider: item.provider || '',
      providerModel: item.providerModel || '',
      providerUsage: item.providerUsage || {}
    }
  };
}

function postgresPrepareItem(config, item) {
  let base = config.prepare ? config.prepare(item) : item;
  const extraKeys = POSTGRES_EXTRA_PROPERTIES[config.collection];
  if (extraKeys && extraKeys.length) {
    const extra = {};
    for (const key of extraKeys) {
      if (item && item[key] !== undefined) {
        extra[key] = item[key];
      }
    }
    base = { ...base, extraJson: extra };
  }
  return base;
}

function postgresHydrateItem(config, item, row) {
  let out = config.hydrate ? config.hydrate(item, row) : item;
  const extraKeys = POSTGRES_EXTRA_PROPERTIES[config.collection];
  if (extraKeys && extraKeys.length) {
    const extra = out.extraJson && typeof out.extraJson === 'object' && !Array.isArray(out.extraJson)
      ? out.extraJson
      : {};
    const pickedExtra = {};
    for (const key of extraKeys) {
      if (extra[key] !== undefined) {
        pickedExtra[key] = extra[key];
      }
    }
    out = { ...pickedExtra, ...out };
    delete out.extraJson;
  }
  return out;
}

function postgresPrepareUser(item = {}) {
  let twoFactorSecretEncrypted = '';
  if (item.twoFactorSecret) {
    if (item.twoFactorSecretEncrypted) {
      try {
        const decrypted = decryptConfig(item.twoFactorSecretEncrypted);
        if (decrypted?.secret === item.twoFactorSecret) {
          twoFactorSecretEncrypted = item.twoFactorSecretEncrypted;
        }
      } catch (_) {}
    }
    if (!twoFactorSecretEncrypted) {
      twoFactorSecretEncrypted = encryptConfig({ secret: item.twoFactorSecret });
      item.twoFactorSecretEncrypted = twoFactorSecretEncrypted;
    }
  } else {
    twoFactorSecretEncrypted = '';
    if (item.twoFactorSecretEncrypted) {
      delete item.twoFactorSecretEncrypted;
    }
  }

  const password = item.password && typeof item.password === 'object'
    ? `v1:${Buffer.from(JSON.stringify(item.password)).toString('base64url')}`
    : String(item.password || '');

  return {
    ...item,
    password,
    twoFactorSecretEncrypted
  };
}

function postgresHydrateUser(item = {}, row = {}) {
  let password = item.password;
  if (typeof password === 'string' && password.startsWith('v1:')) {
    try {
      password = JSON.parse(Buffer.from(password.slice(3), 'base64url').toString('utf8'));
    } catch {
      password = null;
    }
  }

  let twoFactorSecret = '';
  const encrypted = item.twoFactorSecretEncrypted || '';
  if (encrypted) {
    try {
      const decrypted = decryptConfig(encrypted);
      twoFactorSecret = cleanText(decrypted?.secret || '', 256);
    } catch (_) {
      twoFactorSecret = '';
    }
  }

  return {
    ...item,
    password,
    twoFactorSecret,
    twoFactorSecretEncrypted: encrypted
  };
}

function postgresHydrateMonthlyReport(item = {}) {
  const report = item.reportJson && typeof item.reportJson === 'object' && !Array.isArray(item.reportJson)
    ? item.reportJson
    : {};
  return {
    ...item,
    totalResponses: Number(report.totalResponses || 0),
    surveyCount: Number(report.surveyCount || 0),
    satisfactionScore: Number(report.satisfactionScore || 0),
    sentiment: report.sentiment || {},
    trends: Array.isArray(report.trends) ? report.trends : [],
    topIssues: Array.isArray(report.topIssues) ? report.topIssues : [],
    topOpportunities: Array.isArray(report.topOpportunities) ? report.topOpportunities : [],
    importantQuotes: Array.isArray(report.importantQuotes) ? report.importantQuotes : [],
    recommendedActions: Array.isArray(report.recommendedActions) ? report.recommendedActions : [],
    leadQualitySummary: report.leadQualitySummary || {},
    provider: report.provider || item.provider || '',
    providerModel: report.providerModel || item.providerModel || '',
    providerUsage: report.providerUsage || item.providerUsage || {}
  };
}

function postgresPrepareWebhook(item = {}) {
  return {
    ...item,
    secret: item.secretEncrypted || item.secret || ''
  };
}

function postgresHydrateWebhook(item = {}) {
  const storedSecret = String(item.secret || '');
  if (!storedSecret) return item;
  const encrypted = /^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(storedSecret)
    ? storedSecret
    : encryptConfig({ secret: storedSecret });
  const hydrated = { ...item, secretEncrypted: encrypted };
  delete hydrated.secret;
  return hydrated;
}

function postgresSerializeValue(descriptor, value) {
  if (descriptor.type === 'json') return JSON.stringify(value ?? descriptor.fallback ?? null);
  if (descriptor.type === 'date') return cleanFutureOrPastIso(value, '') || null;
  if (descriptor.type === 'integer') {
    if (value === null || value === '' || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : null;
  }
  if (descriptor.type === 'number') {
    if (value === null || value === '' || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (descriptor.type === 'boolean') return Boolean(value);
  if (descriptor.nullable && (value === null || value === undefined || value === '')) return null;
  return value === null || value === undefined ? '' : String(value);
}

function postgresDeserializeValue(descriptor, value) {
  if (descriptor.type === 'json') return value === null || value === undefined ? structuredClone(descriptor.fallback ?? null) : value;
  if (descriptor.type === 'date') return value ? new Date(value).toISOString() : '';
  if (descriptor.type === 'integer') return value === null || value === undefined ? null : Number(value);
  if (descriptor.type === 'number') return value === null || value === undefined ? null : Number(value);
  if (descriptor.type === 'boolean') return Boolean(value);
  return value === null || value === undefined ? '' : String(value);
}

async function ensurePostgresRuntime(state) {
  if (!state.databaseUrl) throw new Error('DATABASE_URL is not configured.');
  if (state.pgReady) return state.pgReady;
  state.pgReady = (async () => {
    const pool = getPostgresPool(state);
    const result = await pool.query("SELECT to_regclass('public.platform_settings') AS table_name");
    if (!result.rows[0]?.table_name) {
      throw new Error('PostgreSQL baseline migration has not been applied. Run migrations/0001_initial_postgres.sql before using DATABASE_URL.');
    }
    const colResult = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'surveys' AND column_name = 'published_version_id'"
    );
    if (!colResult.rows.length) {
      throw new Error('PostgreSQL migration 0002 has not been applied. Run npm run migrate.');
    }
    const client = await pool.connect();
    try {
      const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [4159283748291029n]);
      if (!lockRes.rows[0]?.locked) {
        console.error("Another Formspear writer instance holds the DB advisory lock; refusing to start a second writer (see docs/REVIEW_REMEDIATION_PLAN.md ITEM-2).");
        client.release(true);
        process.exit(1);
      }
      state.pgLockClient = client;
    } catch (error) {
      client.release(true);
      throw error;
    }
    return pool;
  })();
  return state.pgReady;
}

function getPostgresPool(state) {
  if (state.pgPool) return state.pgPool;
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch {
    throw new Error('The pg package is required for DATABASE_URL runtime persistence. Run npm.cmd install.');
  }
  state.pgPool = new Pool({
    connectionString: state.databaseUrl,
    max: Math.max(1, Number(process.env.PG_POOL_MAX || 5)),
    ssl: postgresSslConfig(state.databaseUrl)
  });
  return state.pgPool;
}

function postgresSslConfig(databaseUrl) {
  const sslMode = cleanText(process.env.PGSSLMODE || '', 40).toLowerCase();
  if (sslMode === 'disable') return false;
  if (sslMode === 'require' || /[?&]sslmode=require\b/i.test(databaseUrl)) {
    return { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' };
  }
  return undefined;
}

async function processDueJobs(state, options = {}) {
  if (state.processingJobs) return { processed: 0, skipped: true };
  state.processingJobs = true;
  let processed = 0;
  let enqueuedExternal = 0;
  try {
    const db = await getDb(state);
    const now = Date.now();
    const scheduledRetention = enqueueDueRetentionSweeps(db, now);
    if (bullMqEnabled(state) && !options.localOnly) {
      enqueuedExternal = await enqueueDueJobsToBullMq(state, db, now, options);
      if (enqueuedExternal || scheduledRetention.mutated) await saveDb(state);
      return {
        processed: 0,
        enqueuedExternal,
        queueMode: 'bullmq',
        scheduledRetentionJobs: scheduledRetention.created,
        queued: db.jobs.filter((job) => ['queued', 'retrying', 'queued_external'].includes(job.status)).length
      };
    }
    const due = db.jobs
      .filter((job) => ['queued', 'retrying'].includes(job.status) && (options.force || new Date(job.nextRunAt || 0).getTime() <= now))
      .sort((a, b) => new Date(a.nextRunAt || 0) - new Date(b.nextRunAt || 0))
      .slice(0, options.limit || 100);

    for (const job of due) {
      await processJobRecord(db, job);
      processed += 1;
    }

    if (processed || scheduledRetention.mutated) await saveDb(state);
    return {
      processed,
      scheduledRetentionJobs: scheduledRetention.created,
      queued: db.jobs.filter((job) => ['queued', 'retrying'].includes(job.status)).length
    };
  } finally {
    state.processingJobs = false;
  }
}

async function processJobRecord(db, job) {
  job.status = 'processing';
  job.attempts += 1;
  job.updatedAt = new Date().toISOString();
  try {
    if (job.workspaceId && !['retention_sweep', 'object_delete'].includes(job.type) && db.workspaces.find((item) => item.id === job.workspaceId)?.suspended) {
      throw new Error('Workspace is suspended.');
    }
    if (job.type === 'webhook_delivery') {
      await runWebhookJob(db, job);
    } else if (job.type === 'email_delivery') {
      await runEmailJob(db, job);
    } else if (job.type === 'integration_delivery') {
      await runIntegrationJob(db, job);
    } else if (job.type === 'monthly_report') {
      await runMonthlyReportJob(db, job);
    } else if (job.type === 'retention_sweep') {
      await runRetentionJob(db, job);
    } else if (job.type === 'object_delete') {
      await deleteObjectStorage(job.payloadJson);
    } else {
      throw new Error(`Unknown job type ${job.type}`);
    }
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.lastError = '';
  } catch (error) {
    scheduleJobRetry(job, error);
  }
  return job;
}

async function enqueueDueJobsToBullMq(state, db, now = Date.now(), options = {}) {
  const queue = getBullMqQueue(state);
  const due = db.jobs
    .filter((job) => ['queued', 'retrying'].includes(job.status) && (options.force || new Date(job.nextRunAt || 0).getTime() <= now))
    .sort((a, b) => new Date(a.nextRunAt || 0) - new Date(b.nextRunAt || 0))
    .slice(0, options.limit || 100);
  let enqueued = 0;
  for (const job of due) {
    const delay = Math.max(0, new Date(job.nextRunAt || 0).getTime() - now);
    await queue.add(job.type, { jobId: job.id }, {
      jobId: job.id,
      delay,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1
    });
    job.status = 'queued_external';
    job.externalQueue = 'bullmq';
    job.externalQueueName = BULLMQ_QUEUE_NAME;
    job.externalQueuedAt = new Date().toISOString();
    job.updatedAt = job.externalQueuedAt;
    enqueued += 1;
  }
  return enqueued;
}

async function processBullMqJob(state, bullJob) {
  const db = await getDb(state);
  const jobId = cleanText(bullJob.data?.jobId || '', 80);
  const job = db.jobs.find((item) => item.id === jobId);
  if (!job) return { skipped: true, reason: 'missing_job_record', jobId };
  if (!['queued', 'retrying', 'queued_external', 'processing'].includes(job.status)) {
    return { skipped: true, reason: `job_status_${job.status}`, jobId };
  }
  await processJobRecord(db, job);
  if (job.status === 'retrying') {
    job.externalQueue = '';
    job.externalQueueName = '';
    job.externalQueuedAt = '';
  }
  await saveDb(state);
  return { jobId, status: job.status, attempts: job.attempts };
}

async function startBullMqWorker(state, options = {}) {
  if (!bullMqEnabled(state)) throw new Error('REDIS_URL is required for the BullMQ worker.');
  if (state.bullMqWorker) return state.bullMqWorker;
  const { Worker } = requireBullMq();
  state.bullMqWorker = new Worker(BULLMQ_QUEUE_NAME, async (bullJob) => processBullMqJob(state, bullJob), {
    connection: getBullMqConnection(state),
    concurrency: Math.max(1, Number(options.concurrency || process.env.BULLMQ_WORKER_CONCURRENCY || 4))
  });
  state.bullMqWorker.on('failed', (job, error) => {
    console.error(`BullMQ job ${job?.id || 'unknown'} failed`, error);
  });
  return state.bullMqWorker;
}

function getBullMqQueue(state) {
  if (state.bullMqQueue) return state.bullMqQueue;
  const { Queue } = requireBullMq();
  state.bullMqQueue = new Queue(BULLMQ_QUEUE_NAME, { connection: getBullMqConnection(state) });
  return state.bullMqQueue;
}

function getBullMqConnection(state) {
  if (state.bullMqConnection) return state.bullMqConnection;
  const { IORedis } = requireBullMq();
  state.bullMqConnection = new IORedis(state.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  return state.bullMqConnection;
}

function requireBullMq() {
  try {
    const bullmq = require('bullmq');
    const IORedis = require('ioredis');
    return { ...bullmq, IORedis };
  } catch {
    throw new Error('The bullmq package is required for REDIS_URL queue transport. Run npm.cmd install.');
  }
}

function bullMqEnabled(state) {
  return Boolean(state.redisUrl);
}

async function closeBullMq(state) {
  if (state.bullMqWorker) await state.bullMqWorker.close();
  if (state.bullMqQueue) await state.bullMqQueue.close();
  if (state.bullMqConnection) await state.bullMqConnection.quit().catch(() => state.bullMqConnection.disconnect());
  state.bullMqWorker = null;
  state.bullMqQueue = null;
  state.bullMqConnection = null;
}

async function runWebhookJob(db, job) {
  const { webhookId, webhookLogId, payloadJson, event = 'response.completed' } = job.payloadJson;
  const hook = db.webhooks.find((item) => item.id === webhookId && item.active);
  const log = db.webhookLogs.find((item) => item.id === webhookLogId);
  if (!hook) throw new Error('Webhook no longer exists or is inactive.');
  if (!(await isSafeOutboundUrl(hook.url))) {
    if (log) {
      log.responseStatus = 'blocked';
      log.error = 'destination blocked by SSRF policy';
    }
    throw new Error('destination blocked by SSRF policy');
  }
  const hookSecret = hook.secretEncrypted ? (decryptConfig(hook.secretEncrypted).secret || '') : (hook.secret || '');
  const body = JSON.stringify({
    event,
    workspaceId: hook.workspaceId,
    data: payloadJson,
    deliveredAt: new Date().toISOString()
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-formspear-event': event,
        'x-formspear-signature': signPayload(body, hookSecret),
        'x-feedbackos-event': event,
        'x-feedbackos-signature': signPayload(body, hookSecret)
      },
      body,
      signal: controller.signal,
      redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) throw new Error('redirect blocked by SSRF policy');
    if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
    if (log) {
      log.responseStatus = String(response.status);
      log.error = '';
      log.deliveredAt = new Date().toISOString();
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function runEmailJob(db, job) {
  const message = job.payloadJson.message || {};
  const context = job.payloadJson.context || {};
  await deliverEmailMessage(db, job.workspaceId, message, { jobId: job.id });
  if (context.campaignId) {
    const campaign = db.emailCampaigns.find((item) => item.id === context.campaignId);
    if (campaign) {
      campaign.sentCount += 1;
      campaign.status = campaign.sentCount >= campaign.contacts.length ? 'sent' : 'sending';
      campaign.updatedAt = new Date().toISOString();
    }
  }
}

async function deliverEmailMessage(db, workspaceId, message, options = {}) {
  const normalized = normalizeEmailMessage(message);
  const log = {
    id: makeId('eml'),
    workspaceId,
    to: normalized.to,
    subject: normalized.subject,
    bodyPreview: cleanText(normalized.body, 500),
    provider: smtpEnabled() ? 'smtp' : 'local_simulated',
    status: smtpEnabled() ? 'pending_provider' : 'sent_simulated',
    error: '',
    jobId: options.jobId || '',
    createdAt: new Date().toISOString()
  };
  try {
    if (smtpEnabled()) {
      await sendSmtpMessage(normalized);
      log.status = 'sent_provider';
    }
  } catch (error) {
    log.status = 'failed_provider';
    log.error = cleanText(error.message || String(error), 500);
    db.emailLogs.push(log);
    throw error;
  }
  db.emailLogs.push(log);
  return log;
}

function normalizeEmailMessage(message) {
  const from = cleanEmail(message.from || process.env.SMTP_FROM || process.env.SMTP_USER || 'notifications@feedbackos.local', true) || 'notifications@feedbackos.local';
  const to = cleanEmail(message.to, true);
  if (!to) throw new Error('Email recipient is required.');
  return {
    from,
    to,
    subject: cleanHeader(message.subject || 'FeedbackOS notification', 180),
    body: String(message.body || '').slice(0, 8000)
  };
}

function smtpEnabled() {
  return envConfigured('SMTP_HOST');
}

function smtpConfig() {
  const secure = parseBoolean(process.env.SMTP_SECURE);
  const port = Number(process.env.SMTP_PORT || (secure ? 465 : 25));
  return {
    host: cleanText(process.env.SMTP_HOST, 250),
    port: Number.isFinite(port) && port > 0 ? port : (secure ? 465 : 25),
    secure,
    user: cleanText(process.env.SMTP_USER || '', 254),
    password: String(process.env.SMTP_PASSWORD || ''),
    timeoutMs: Math.max(1000, Number(process.env.SMTP_TIMEOUT_MS || 10000)),
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false'
  };
}

async function sendSmtpMessage(message) {
  const config = smtpConfig();
  const socket = await openSmtpSocket(config);
  const session = createSmtpSession(socket);
  try {
    await expectSmtp(session.read(), [220]);
    await smtpCommand(session, `EHLO ${smtpClientName()}`, [250]);
    if (config.user || config.password) {
      const auth = Buffer.from(`\u0000${config.user}\u0000${config.password}`).toString('base64');
      await smtpCommand(session, `AUTH PLAIN ${auth}`, [235, 503]);
    }
    await smtpCommand(session, `MAIL FROM:<${message.from}>`, [250]);
    await smtpCommand(session, `RCPT TO:<${message.to}>`, [250, 251]);
    await smtpCommand(session, 'DATA', [354]);
    socket.write(`${smtpMimeMessage(message)}\r\n.\r\n`);
    await expectSmtp(session.read(), [250]);
    await smtpCommand(session, 'QUIT', [221]);
  } finally {
    socket.end();
  }
}

function openSmtpSocket(config) {
  return new Promise((resolve, reject) => {
    const options = { host: config.host, port: config.port };
    const socket = config.secure
      ? tls.connect({ ...options, servername: config.host, rejectUnauthorized: config.rejectUnauthorized }, () => resolve(socket))
      : net.createConnection(options, () => resolve(socket));
    socket.setEncoding('utf8');
    socket.setTimeout(config.timeoutMs, () => socket.destroy(new Error('SMTP connection timed out.')));
    socket.once('error', reject);
  });
}

function createSmtpSession(socket) {
  let buffer = '';
  const waiters = [];
  socket.on('data', (chunk) => {
    buffer += chunk;
    flush();
  });
  socket.on('error', (error) => {
    while (waiters.length) waiters.shift().reject(error);
  });
  function flush() {
    if (!waiters.length) return;
    const response = parseSmtpResponse(buffer);
    if (!response) return;
    buffer = '';
    waiters.shift().resolve(response);
    flush();
  }
  return {
    read() {
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        flush();
      });
    },
    write(command) {
      socket.write(`${command}\r\n`);
    }
  };
}

function parseSmtpResponse(buffer) {
  if (!buffer) return null;
  const complete = /\r?\n$/.test(buffer);
  const lines = buffer.split(/\r?\n/).filter(Boolean);
  if (!complete || !lines.length) return null;
  const first = lines[0].match(/^(\d{3})/);
  if (!first) return null;
  const code = Number(first[1]);
  const done = lines.some((line) => line.startsWith(`${first[1]} `));
  return done ? { code, lines } : null;
}

async function smtpCommand(session, command, expectedCodes) {
  session.write(command);
  return expectSmtp(session.read(), expectedCodes);
}

async function expectSmtp(responsePromise, expectedCodes) {
  const response = await responsePromise;
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP command failed with ${response.code}: ${response.lines.join(' ')}`);
  }
  return response;
}

function smtpMimeMessage(message) {
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@feedbackos.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit'
  ];
  const body = String(message.body || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

function smtpClientName() {
  return cleanHostname(process.env.SMTP_HELO || 'feedbackos.local') || 'feedbackos.local';
}

function cleanHeader(value, max) {
  return cleanText(value, max).replace(/[\r\n]+/g, ' ');
}

async function runIntegrationJob(db, job) {
  const { integrationId, event, payloadJson } = job.payloadJson || {};
  const integration = db.integrations.find((item) => item.id === integrationId && item.status !== 'disabled');
  if (!integration) throw new Error('Integration no longer exists or is disabled.');
  let delivery;
  try {
    delivery = await deliverIntegrationPayload(integration, event, payloadJson);
  } catch (error) {
    db.integrationLogs.push({
      id: makeId('ilog'),
      workspaceId: integration.workspaceId,
      integrationId: integration.id,
      type: integration.type,
      event: cleanText(event || 'response.completed', 80),
      payloadJson,
      provider: integration.type,
      status: 'failed_provider',
      responseStatus: '',
      error: cleanText(error.message || String(error), 500),
      jobId: job.id,
      createdAt: new Date().toISOString()
    });
    throw error;
  }
  db.integrationLogs.push({
    id: makeId('ilog'),
    workspaceId: integration.workspaceId,
    integrationId: integration.id,
    type: integration.type,
    event: cleanText(event || 'response.completed', 80),
    payloadJson,
    provider: delivery.provider,
    status: delivery.status,
    responseStatus: delivery.responseStatus,
    error: '',
    jobId: job.id,
    createdAt: new Date().toISOString()
  });
}

async function deliverIntegrationPayload(integration, event, payloadJson) {
  const config = decryptConfig(integration.configEncrypted);
  const request = buildIntegrationRequest(integration, config, event, payloadJson);
  if (!request.url) {
    return {
      provider: 'local_simulated',
      status: integration.type === 'google_sheets' ? 'synced_simulated' : 'sent_simulated',
      responseStatus: 'simulated'
    };
  }
  if (!(await isSafeOutboundUrl(request.url))) {
    throw new Error('destination blocked by SSRF policy');
  }
  const body = JSON.stringify(request.body);
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(config.timeoutMs || process.env.INTEGRATION_TIMEOUT_MS || 8000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-formspear-event': cleanText(event || 'response.completed', 80),
        'x-formspear-integration': integration.type,
        ...(request.signingSecret ? { 'x-formspear-signature': signPayload(body, request.signingSecret) } : {}),
        'x-feedbackos-event': cleanText(event || 'response.completed', 80),
        'x-feedbackos-integration': integration.type,
        ...(request.signingSecret ? { 'x-feedbackos-signature': signPayload(body, request.signingSecret) } : {}),
        ...request.headers
      },
      body,
      signal: controller.signal,
      redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) throw new Error('redirect blocked by SSRF policy');
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${request.provider} returned HTTP ${response.status}${text ? `: ${cleanText(text, 200)}` : ''}`);
    }
    return {
      provider: request.provider,
      status: integration.type === 'google_sheets' ? 'synced_provider' : 'sent_provider',
      responseStatus: String(response.status)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildIntegrationRequest(integration, config, event, payloadJson) {
  const type = integration.type;
  const url = integrationProviderUrl(type, config);
  const token = cleanText(config.accessToken || config.token || integrationEnv(type, 'TOKEN') || (type === 'whatsapp' ? process.env.WHATSAPP_ACCESS_TOKEN : '') || '', 2000);
  const apiKey = cleanText(config.apiKey || integrationEnv(type, 'API_KEY') || '', 500);
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (apiKey) headers['x-api-key'] = apiKey;
  return {
    provider: url ? type : 'local_simulated',
    url,
    headers,
    signingSecret: cleanText(config.signingSecret || integrationEnv(type, 'SIGNING_SECRET') || '', 500),
    body: integrationRequestBody(integration, config, event, payloadJson)
  };
}

function integrationProviderUrl(type, config) {
  if (type === 'whatsapp') {
    const phoneNumberId = cleanText(config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '', 120);
    const accessToken = cleanText(config.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '', 2000);
    if (phoneNumberId && accessToken && (config.to || process.env.WHATSAPP_TO)) {
      return `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}/messages`;
    }
  }
  return cleanUrl(
    config.webhookUrl ||
    config.url ||
    config.apiUrl ||
    integrationEnv(type, 'WEBHOOK_URL') ||
    integrationEnv(type, 'URL') ||
    integrationEnv(type, 'API_URL')
  );
}

function integrationEnv(type, suffix) {
  const prefix = {
    google_sheets: 'GOOGLE_SHEETS',
    slack: 'SLACK',
    teams: 'TEAMS',
    whatsapp: 'WHATSAPP',
    crm: 'CRM',
    zapier: 'ZAPIER',
    make: 'MAKE'
  }[type] || '';
  return prefix ? process.env[`${prefix}_${suffix}`] : '';
}

function integrationRequestBody(integration, config, event, payloadJson) {
  const base = {
    event: cleanText(event || 'response.completed', 80),
    workspaceId: integration.workspaceId,
    integrationId: integration.id,
    data: payloadJson,
    deliveredAt: new Date().toISOString()
  };
  if (integration.type === 'slack') {
    return {
      text: integrationMessageText(integration, event, payloadJson),
      ...(config.channel ? { channel: cleanText(config.channel, 120) } : {})
    };
  }
  if (integration.type === 'teams') {
    return { text: integrationMessageText(integration, event, payloadJson) };
  }
  if (integration.type === 'whatsapp' && (config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID)) {
    return {
      messaging_product: 'whatsapp',
      to: cleanText(config.to || process.env.WHATSAPP_TO || '', 80),
      type: 'text',
      text: { body: integrationMessageText(integration, event, payloadJson) }
    };
  }
  if (integration.type === 'google_sheets') {
    return {
      ...base,
      sheetId: cleanText(config.sheetId || '', 200),
      spreadsheetId: cleanText(config.spreadsheetId || '', 200)
    };
  }
  return base;
}

function integrationMessageText(integration, event, payloadJson) {
  return cleanText(
    `FeedbackOS ${event || 'response.completed'}: survey ${payloadJson?.surveyId || 'unknown'}, response ${payloadJson?.responseId || 'unknown'}, sentiment ${payloadJson?.sentiment || 'unknown'}, lead score ${payloadJson?.leadScore ?? 'n/a'}.`,
    500
  );
}

async function runMonthlyReportJob(db, job) {
  const month = cleanText(job.payloadJson?.month || new Date().toISOString().slice(0, 7), 7);
  const recipients = normalizeEmailList(job.payloadJson?.recipients || []);
  const creditCheck = checkAiCreditLimit(db, job.workspaceId, 3);
  if (!creditCheck.ok) throw new Error(creditCheck.message);
  const report = await buildMonthlyReportWithProvider(db, job.workspaceId, month);
  if (report.aiGenerated) {
    consumeAiCredits(db, job.workspaceId, 3);
  }
  report.pdfUrl = `/api/ai/monthly-reports/${job.workspaceId}/${report.id}.pdf`;
  report.scheduled = true;
  report.jobId = job.id;
  report.delivery = {
    status: recipients.length ? (smtpEnabled() ? 'sent_provider' : 'sent_simulated') : 'generated_only',
    recipients,
    deliveredAt: new Date().toISOString()
  };
  db.monthlyReports.push(report);
  db.aiJobs.push(createAiJob(job.workspaceId, null, null, 'scheduled_monthly_report', job.payloadJson, report));
  for (const recipient of recipients) {
    await deliverEmailMessage(db, job.workspaceId, {
      to: recipient,
      subject: report.title,
      body: `Monthly FeedbackOS report is ready: ${report.pdfUrl}`
    }, { jobId: job.id });
  }
  job.payloadJson.result = { reportId: report.id, pdfUrl: report.pdfUrl, recipients: recipients.length };
}

async function runRetentionJob(db, job) {
  const workspaceId = job.workspaceId;
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  if (workspace) normalizeRetentionSchedule(workspace);
  const retentionDays = Number(workspace?.retentionDays || 365);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let anonymized = 0;
  let fileUploadsExpired = 0;
  for (const response of db.responses.filter((item) => item.workspaceId === workspaceId && item.status !== 'deleted')) {
    const submitted = new Date(response.submittedAt || response.createdAt).getTime();
    if (submitted < cutoff) {
      eraseResponse(db, response, 'anonymize', 'system');
      response.tagsJson = uniqueTags([...(response.tagsJson || []), 'retention-anonymized']);
      anonymized += 1;
    }
  }
  for (const upload of db.fileUploads.filter((item) => item.workspaceId === workspaceId && item.lifecycleStatus !== 'expired')) {
    const expiresAt = new Date(upload.retentionExpiresAt || fileUploadRetentionExpiresAt(db, workspaceId, { createdAt: upload.createdAt })).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      queueObjectDeletion(db, upload);
      upload.lifecycleStatus = 'expired';
      upload.deletedAt = new Date().toISOString();
      upload.dataUrl = '';
      upload.storageUrl = '';
      fileUploadsExpired += 1;
    }
  }
  if (workspace) {
    workspace.retentionLastRunAt = new Date().toISOString();
    if (!workspace.retentionNextRunAt || new Date(workspace.retentionNextRunAt).getTime() <= Date.now()) {
      workspace.retentionNextRunAt = nextRetentionRunAt();
    }
    workspace.updatedAt = new Date().toISOString();
  }
  job.payloadJson.result = { anonymized, fileUploadsExpired };
}

function scheduleJobRetry(job, error) {
  job.lastError = cleanText(error.message || String(error), 1000);
  job.updatedAt = new Date().toISOString();
  if (job.attempts >= job.maxAttempts) {
    job.status = 'failed';
    job.completedAt = new Date().toISOString();
    return;
  }
  const delaySeconds = Math.min(60 * 30, 2 ** job.attempts * 30);
  job.status = 'retrying';
  job.nextRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
}

async function recordErrorLog(state, req, error) {
  const db = await getDb(state);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const errorLog = {
    id: makeId('err'),
    method: cleanText(req.method || 'GET', 12),
    path: cleanText(url.pathname, 240),
    query: cleanText(url.search || '', 240),
    name: cleanText(error?.name || 'Error', 120),
    message: cleanText(error?.message || String(error), 600),
    stack: cleanText(error?.stack || '', 1600),
    userAgent: cleanText(req.headers['user-agent'] || '', 300),
    createdAt: new Date().toISOString()
  };
  db.errorLogs.push(errorLog);
  if (db.errorLogs.length > LOG_MEMORY_MAX) db.errorLogs.splice(0, db.errorLogs.length - LOG_MEMORY_MAX);
  await emitMonitoringError(errorLog).catch(() => {});
  await saveDb(state);
}

function createEmptyDb() {
  return migrateDb({
    users: [],
    sessions: [],
    twoFactorChallenges: [],
    ssoAuthRequests: [],
    oauthAuthRequests: [],
    emailVerificationTokens: [],
    passwordResetTokens: [],
    workspaces: [],
    workspaceMembers: [],
    surveys: [],
    surveyVersions: [],
    responses: [],
    respondents: [],
    contacts: [],
    workspaceInvites: [],
    apiKeys: [],
    integrations: [],
    integrationLogs: [],
    webhooks: [],
    webhookLogs: [],
    alerts: [],
    aiJobs: [],
    jobs: [],
    emailLogs: [],
    emailCampaigns: [],
    campaignEvents: [],
    fileUploads: [],
    monthlyReports: [],
    invoices: [],
    customTemplates: [],
    subscriptions: [],
    usageMeters: [],
    auditLogs: [],
    notifications: [],
    errorLogs: [],
    aiProviderLogs: []
  });
}

function migrateDb(db) {
  const collections = ['users', 'sessions', 'twoFactorChallenges', 'ssoAuthRequests', 'oauthAuthRequests', 'emailVerificationTokens', 'passwordResetTokens', 'workspaces', 'workspaceMembers', 'surveys', 'surveyVersions', 'responses', 'respondents', 'contacts', 'workspaceInvites', 'apiKeys', 'integrations', 'integrationLogs', 'webhooks', 'webhookLogs', 'alerts', 'aiJobs', 'jobs', 'emailLogs', 'emailCampaigns', 'campaignEvents', 'fileUploads', 'monthlyReports', 'invoices', 'customTemplates', 'subscriptions', 'usageMeters', 'auditLogs', 'notifications', 'errorLogs', 'aiProviderLogs'];
  for (const key of collections) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  db.platformSettings = normalizePlatformSettings(db.platformSettings || {});
  for (const survey of db.surveys) {
    survey.metrics = survey.metrics || { views: 0, starts: 0, completions: 0 };
    survey.settings = normalizeSurveySettings(defaultSurveySettings(), survey.settings || {});
    survey.branding = survey.branding || {};
    survey.schema = normalizeSchema(survey.schema || {});
    survey.accessMode = normalizeSurveyAccessMode(survey.accessMode);
    survey.accessRules = normalizeSurveyAccessRules(db, survey, survey.accessRules || []);
  }
  for (const user of db.users) {
    user.disabled = Boolean(user.disabled);
    user.notificationPreferences = user.notificationPreferences || { emailAlerts: true, weeklyDigest: true };
    user.oauthProviders = user.oauthProviders && typeof user.oauthProviders === 'object' && !Array.isArray(user.oauthProviders) ? user.oauthProviders : {};
  }
  for (const session of db.sessions) {
    session.remembered = Boolean(session.remembered);
  }
  for (const workspace of db.workspaces) {
    workspace.suspended = Boolean(workspace.suspended);
    workspace.aiCreditLimitOverride = normalizeOptionalLimit(workspace.aiCreditLimitOverride);
    workspace.allowExternalAi = workspace.allowExternalAi === undefined ? true : parseBoolean(workspace.allowExternalAi);
    workspace.permissionPolicy = normalizeWorkspacePermissionPolicy(workspace.permissionPolicy);
    workspace.customCss = sanitizeCustomCss(workspace.customCss || '');
    workspace.customFooterText = cleanText(workspace.customFooterText || '', 280);
    normalizeRetentionSchedule(workspace);
    ensureCustomDomainState(workspace);
    workspace.sso = normalizeSsoConfig(workspace.sso || {});
  }
  for (const contact of db.contacts) {
    contact.stage = normalizeContactStage(contact.stage) || 'new';
    contact.ownerId = contactOwnerIsMember(db, contact.workspaceId, contact.ownerId) ? contact.ownerId : '';
    contact.nextFollowUpAt = cleanFutureOrPastIso(contact.nextFollowUpAt, '');
    contact.pipelineUpdatedAt = cleanFutureOrPastIso(contact.pipelineUpdatedAt, contact.updatedAt || contact.createdAt || '');
  }
  for (const response of db.responses) {
    response.tagsJson = Array.isArray(response.tagsJson) ? response.tagsJson : [];
    response.internalNotes = Array.isArray(response.internalNotes) ? response.internalNotes : [];
    response.important = Boolean(response.important);
    response.updatedAt = response.updatedAt || response.createdAt || new Date().toISOString();
  }
  for (const upload of db.fileUploads) {
    upload.sha256 = upload.sha256 || '';
    upload.scanStatus = cleanText(upload.scanStatus || 'not_scanned', 60);
    upload.scanProvider = cleanText(upload.scanProvider || 'legacy', 80);
    upload.scanSignature = cleanText(upload.scanSignature || '', 160);
    upload.scanMessage = cleanText(upload.scanMessage || '', 400);
    upload.scanCheckedAt = cleanFutureOrPastIso(upload.scanCheckedAt, upload.createdAt || '');
    upload.quarantined = Boolean(upload.quarantined || ['infected', 'blocked', 'quarantined'].includes(upload.scanStatus));
    upload.lifecycleStatus = cleanText(upload.lifecycleStatus || (upload.quarantined ? 'quarantined' : 'active'), 60);
    upload.retentionExpiresAt = cleanFutureOrPastIso(upload.retentionExpiresAt, fileUploadRetentionExpiresAt(db, upload.workspaceId, { createdAt: upload.createdAt || new Date().toISOString() }));
    upload.deletedAt = cleanFutureOrPastIso(upload.deletedAt, '');
  }
  for (const subscription of db.subscriptions) {
    subscription.providerCustomerId = cleanText(subscription.providerCustomerId || '', 160);
    subscription.billingPolicy = billingPolicySnapshot(subscription.billingPolicy || {});
  }
  for (const invoice of db.invoices) {
    const hasPolicy = invoice.billingPolicy && typeof invoice.billingPolicy === 'object' && Object.keys(invoice.billingPolicy).length > 0;
    const policy = hasPolicy
      ? billingPolicySnapshot(invoice.billingPolicy)
      : billingPolicySnapshot({ taxMode: invoice.taxMode || 'none', taxPercent: invoice.taxPercent || 0 });
    invoice.billingPolicy = policy;
    invoice.lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    invoice.subtotalInr = Number.isFinite(Number(invoice.subtotalInr)) ? Math.max(0, Math.round(Number(invoice.subtotalInr))) : Math.max(0, Math.round(Number(invoice.amountDueInr || 0)));
    invoice.taxMode = normalizeBillingTaxMode(invoice.taxMode || policy.taxMode);
    invoice.taxPercent = invoice.taxMode === 'none' ? 0 : Math.max(0, Math.min(40, Number(invoice.taxPercent ?? policy.taxPercent ?? 0)));
    invoice.taxInr = Number.isFinite(Number(invoice.taxInr)) ? Math.max(0, Math.round(Number(invoice.taxInr))) : 0;
    invoice.prorationCreditInr = Number.isFinite(Number(invoice.prorationCreditInr)) ? Math.max(0, Math.round(Number(invoice.prorationCreditInr))) : 0;
  }
  return db;
}

function deleteWorkspaceData(db, workspaceId) {
  const id = cleanText(workspaceId || '', 80);
  const surveyIds = new Set(db.surveys.filter((item) => item.workspaceId === id).map((item) => item.id));
  const responseIds = new Set(db.responses.filter((item) => item.workspaceId === id || surveyIds.has(item.surveyId)).map((item) => item.id));
  const respondentIds = new Set(db.respondents.filter((item) => item.workspaceId === id).map((item) => item.id));
  const webhookIds = new Set(db.webhooks.filter((item) => item.workspaceId === id).map((item) => item.id));
  const campaignIds = new Set(db.emailCampaigns.filter((item) => item.workspaceId === id).map((item) => item.id));
  const before = Object.fromEntries(['workspaces', 'workspaceMembers', 'workspaceInvites', 'apiKeys', 'surveys', 'surveyVersions', 'responses', 'respondents', 'contacts', 'integrations', 'integrationLogs', 'webhooks', 'webhookLogs', 'alerts', 'aiJobs', 'jobs', 'emailLogs', 'emailCampaigns', 'campaignEvents', 'fileUploads', 'monthlyReports', 'invoices', 'customTemplates', 'subscriptions', 'usageMeters', 'notifications', 'auditLogs'].map((key) => [key, db[key].length]));

  db.workspaces = db.workspaces.filter((item) => item.id !== id);
  db.workspaceMembers = db.workspaceMembers.filter((item) => item.workspaceId !== id);
  db.workspaceInvites = db.workspaceInvites.filter((item) => item.workspaceId !== id);
  db.apiKeys = db.apiKeys.filter((item) => item.workspaceId !== id);
  db.surveys = db.surveys.filter((item) => item.workspaceId !== id);
  db.surveyVersions = db.surveyVersions.filter((item) => !surveyIds.has(item.surveyId));
  db.responses = db.responses.filter((item) => item.workspaceId !== id && !surveyIds.has(item.surveyId));
  db.respondents = db.respondents.filter((item) => item.workspaceId !== id && !respondentIds.has(item.id));
  db.contacts = db.contacts.filter((item) => item.workspaceId !== id);
  db.integrations = db.integrations.filter((item) => item.workspaceId !== id);
  db.integrationLogs = db.integrationLogs.filter((item) => item.workspaceId !== id);
  db.webhooks = db.webhooks.filter((item) => item.workspaceId !== id);
  db.webhookLogs = db.webhookLogs.filter((item) => !webhookIds.has(item.webhookId));
  db.alerts = db.alerts.filter((item) => item.workspaceId !== id);
  db.aiJobs = db.aiJobs.filter((item) => item.workspaceId !== id);
  db.jobs = db.jobs.filter((item) => item.workspaceId !== id);
  db.emailLogs = db.emailLogs.filter((item) => item.workspaceId !== id);
  db.emailCampaigns = db.emailCampaigns.filter((item) => item.workspaceId !== id);
  db.campaignEvents = db.campaignEvents.filter((item) => !campaignIds.has(item.campaignId));
  db.fileUploads = db.fileUploads.filter((item) => item.workspaceId !== id && !responseIds.has(item.responseId));
  db.monthlyReports = db.monthlyReports.filter((item) => item.workspaceId !== id);
  db.invoices = db.invoices.filter((item) => item.workspaceId !== id);
  db.customTemplates = db.customTemplates.filter((item) => item.workspaceId !== id && !surveyIds.has(item.sourceSurveyId));
  db.subscriptions = db.subscriptions.filter((item) => item.workspaceId !== id);
  db.usageMeters = db.usageMeters.filter((item) => item.workspaceId !== id);
  db.notifications = db.notifications.filter((item) => item.workspaceId !== id);
  db.auditLogs = db.auditLogs.filter((item) => item.workspaceId !== id);

  return Object.fromEntries(Object.entries(before).map(([key, count]) => [`${key}Deleted`, count - db[key].length]));
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalized);
}

function nextRetentionRunAt(from = Date.now()) {
  const base = Number.isFinite(Number(from)) ? Number(from) : Date.now();
  return new Date(base + RETENTION_SCHEDULE_INTERVAL_MS).toISOString();
}

function cleanFutureOrPastIso(value, fallback) {
  const time = new Date(value || '').getTime();
  if (Number.isFinite(time)) return new Date(time).toISOString();
  return fallback;
}

function normalizeRetentionSchedule(workspace) {
  workspace.retentionDays = Number.isFinite(Number(workspace.retentionDays)) ? Math.max(1, Math.min(3650, Number(workspace.retentionDays))) : 365;
  if (workspace.retentionScheduleEnabled === undefined) workspace.retentionScheduleEnabled = true;
  workspace.retentionScheduleEnabled = parseBoolean(workspace.retentionScheduleEnabled);
  workspace.retentionLastRunAt = cleanFutureOrPastIso(workspace.retentionLastRunAt, '');
  workspace.retentionNextRunAt = cleanFutureOrPastIso(workspace.retentionNextRunAt, nextRetentionRunAt(Date.now()));
  return workspace;
}

function enqueueDueRetentionSweeps(db, now = Date.now()) {
  let created = 0;
  let mutated = false;
  for (const workspace of db.workspaces) {
    const before = JSON.stringify({
      retentionDays: workspace.retentionDays,
      retentionScheduleEnabled: workspace.retentionScheduleEnabled,
      retentionLastRunAt: workspace.retentionLastRunAt,
      retentionNextRunAt: workspace.retentionNextRunAt
    });
    normalizeRetentionSchedule(workspace);
    const after = JSON.stringify({
      retentionDays: workspace.retentionDays,
      retentionScheduleEnabled: workspace.retentionScheduleEnabled,
      retentionLastRunAt: workspace.retentionLastRunAt,
      retentionNextRunAt: workspace.retentionNextRunAt
    });
    if (before !== after) mutated = true;
    if (!workspace.retentionScheduleEnabled) continue;
    const dueAt = new Date(workspace.retentionNextRunAt || '').getTime();
    if (!Number.isFinite(dueAt) || dueAt > now) continue;
    const activeJob = db.jobs.some((job) => job.workspaceId === workspace.id && job.type === 'retention_sweep' && ['queued', 'retrying', 'processing'].includes(job.status));
    if (activeJob) continue;
    queueRetentionJob(db, workspace.id, { scheduled: true });
    workspace.retentionNextRunAt = nextRetentionRunAt(now);
    workspace.updatedAt = new Date(now).toISOString();
    created += 1;
    mutated = true;
  }
  return { created, mutated };
}

function normalizeContactStage(value) {
  const safe = cleanText(value || '', 40).toLowerCase();
  return CONTACT_STAGES.includes(safe) ? safe : '';
}

function contactOwnerIsMember(db, workspaceId, ownerId) {
  const safeOwnerId = cleanText(ownerId || '', 80);
  return Boolean(safeOwnerId && db.workspaceMembers.some((member) => member.workspaceId === workspaceId && member.userId === safeOwnerId));
}

function updateContactCrmFields(db, contact, body = {}) {
  let changed = false;
  if (body.stage !== undefined) {
    contact.stage = normalizeContactStage(body.stage) || contact.stage || 'new';
    changed = true;
  }
  if (body.ownerId !== undefined) {
    contact.ownerId = contactOwnerIsMember(db, contact.workspaceId, body.ownerId) ? cleanText(body.ownerId, 80) : '';
    changed = true;
  }
  if (body.nextFollowUpAt !== undefined) {
    contact.nextFollowUpAt = cleanFutureOrPastIso(body.nextFollowUpAt, '');
    changed = true;
  }
  if (!contact.stage) contact.stage = 'new';
  if (contact.ownerId && !contactOwnerIsMember(db, contact.workspaceId, contact.ownerId)) {
    contact.ownerId = '';
    changed = true;
  }
  if (changed) contact.pipelineUpdatedAt = new Date().toISOString();
}

function normalizeSurveyAccessMode(value) {
  return cleanText(value || '', 40).toLowerCase() === 'selected' ? 'selected' : 'workspace';
}

function normalizeWorkspacePermissionPolicy(input = {}) {
  const policy = {};
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const action of WORKSPACE_PERMISSION_ACTIONS) {
    const role = cleanText(source[action.key] || '', 40);
    policy[action.key] = ['owner', 'admin', 'editor', 'analyst', 'viewer'].includes(role) ? role : action.defaultRole;
  }
  return policy;
}

function workspacePermissionRole(workspace, actionKey) {
  const action = WORKSPACE_PERMISSION_ACTIONS.find((item) => item.key === actionKey);
  if (!action) return 'admin';
  const policy = normalizeWorkspacePermissionPolicy(workspace?.permissionPolicy || {});
  return normalizeRole(policy[action.key] || action.defaultRole);
}

function normalizeSurveyAccessRules(db, survey, input) {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set();
  const allowedRoles = new Set(['viewer', 'analyst', 'editor']);
  const output = [];
  for (const row of rows) {
    const userId = cleanText(row?.userId || '', 80);
    const role = normalizeRole(row?.role || 'viewer');
    if (!userId || seen.has(userId) || !allowedRoles.has(role)) continue;
    const member = db.workspaceMembers.find((item) => item.workspaceId === survey.workspaceId && item.userId === userId);
    if (!member) continue;
    output.push({ userId, role });
    seen.add(userId);
  }
  return output;
}

function surveyAccessPolicyChanged(db, survey, body = {}) {
  if (body.accessMode !== undefined && normalizeSurveyAccessMode(body.accessMode) !== normalizeSurveyAccessMode(survey.accessMode)) return true;
  if (body.accessRules === undefined) return false;
  const current = normalizeSurveyAccessRules(db, survey, survey.accessRules || []);
  const next = normalizeSurveyAccessRules(db, survey, body.accessRules);
  return JSON.stringify(current) !== JSON.stringify(next);
}

function customDomainToken(workspace) {
  if (!workspace.customDomain) return '';
  return hashToken(`${workspace.id}:${workspace.customDomain}`).slice(0, 32);
}

function customDomainTxtRecord(workspace) {
  const token = workspace.customDomainVerificationToken || customDomainToken(workspace);
  return token ? `feedbackos-site-verification=${token}` : '';
}

function resetCustomDomainVerification(workspace) {
  if (!workspace.customDomain) {
    workspace.customDomainStatus = 'not_configured';
    workspace.customDomainVerificationToken = '';
    workspace.customDomainVerifiedAt = '';
    workspace.customDomainSslStatus = 'not_configured';
    workspace.customDomainSslProvider = '';
    workspace.customDomainSslCertificateId = '';
    workspace.customDomainSslProvisionedAt = '';
    workspace.customDomainSslLastError = '';
    workspace.customDomainSslUpdatedAt = '';
    workspace.customDomainDnsCheckedAt = '';
    workspace.customDomainObservedTxt = [];
    return;
  }
  workspace.customDomainVerificationToken = customDomainToken(workspace);
  workspace.customDomainStatus = 'pending_dns';
  workspace.customDomainVerifiedAt = '';
  workspace.customDomainSslStatus = 'not_started';
  workspace.customDomainSslProvider = '';
  workspace.customDomainSslCertificateId = '';
  workspace.customDomainSslProvisionedAt = '';
  workspace.customDomainSslLastError = '';
  workspace.customDomainSslUpdatedAt = '';
  workspace.customDomainDnsCheckedAt = '';
  workspace.customDomainObservedTxt = [];
}

function ensureCustomDomainState(workspace) {
  if (!workspace.customDomain) {
    resetCustomDomainVerification(workspace);
    return workspace;
  }
  if (!workspace.customDomainVerificationToken) workspace.customDomainVerificationToken = customDomainToken(workspace);
  workspace.customDomainStatus = workspace.customDomainStatus || (workspace.customDomainVerifiedAt ? 'verified_local' : 'pending_dns');
  workspace.customDomainSslStatus = workspace.customDomainSslStatus || (workspace.customDomainVerifiedAt ? 'pending_provider' : 'not_started');
  workspace.customDomainSslProvider = cleanText(workspace.customDomainSslProvider || '', 80);
  workspace.customDomainSslCertificateId = cleanText(workspace.customDomainSslCertificateId || '', 160);
  workspace.customDomainSslProvisionedAt = cleanFutureOrPastIso(workspace.customDomainSslProvisionedAt, '');
  workspace.customDomainSslLastError = cleanText(workspace.customDomainSslLastError || '', 400);
  workspace.customDomainSslUpdatedAt = cleanFutureOrPastIso(workspace.customDomainSslUpdatedAt, '');
  workspace.customDomainVerifiedAt = cleanFutureOrPastIso(workspace.customDomainVerifiedAt, '');
  workspace.customDomainDnsCheckedAt = cleanFutureOrPastIso(workspace.customDomainDnsCheckedAt, '');
  workspace.customDomainObservedTxt = Array.isArray(workspace.customDomainObservedTxt) ? workspace.customDomainObservedTxt.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 10) : [];
  return workspace;
}

async function resolveCustomDomainTxtRecords(domain) {
  const records = await dns.resolveTxt(domain);
  return [...new Set(records.map((row) => row.join('')).map((item) => cleanText(item, 300)).filter(Boolean))];
}

function customDomainVerificationPayload(workspace) {
  ensureCustomDomainState(workspace);
  return {
    domain: workspace.customDomain,
    status: workspace.customDomainStatus,
    sslStatus: workspace.customDomainSslStatus,
    sslProvider: workspace.customDomainSslProvider,
    sslCertificateId: workspace.customDomainSslCertificateId,
    sslProvisionedAt: workspace.customDomainSslProvisionedAt,
    sslLastError: workspace.customDomainSslLastError,
    sslUpdatedAt: workspace.customDomainSslUpdatedAt,
    verifiedAt: workspace.customDomainVerifiedAt,
    dnsCheckedAt: workspace.customDomainDnsCheckedAt,
    observedTxtRecords: workspace.customDomainObservedTxt,
    expectedTxt: customDomainTxtRecord(workspace)
  };
}

function customDomainSslConfig() {
  return {
    providerUrl: cleanUrl(process.env.CUSTOM_DOMAIN_SSL_PROVIDER_URL || ''),
    token: String(process.env.CUSTOM_DOMAIN_SSL_PROVIDER_TOKEN || ''),
    providerName: cleanText(process.env.CUSTOM_DOMAIN_SSL_PROVIDER_NAME || 'custom_ssl_provider', 80),
    appUrl: (cleanUrl(process.env.APP_URL || '') || 'http://localhost:4173').replace(/\/$/, ''),
    timeoutMs: Math.max(1000, Math.min(60000, Number(process.env.CUSTOM_DOMAIN_SSL_TIMEOUT_MS || 10000)))
  };
}

async function provisionCustomDomainSsl(workspace) {
  const config = customDomainSslConfig();
  if (!config.providerUrl) {
    const error = new Error('Configure CUSTOM_DOMAIN_SSL_PROVIDER_URL before provisioning custom-domain SSL.');
    error.code = 'ssl_provider_not_configured';
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.providerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {})
      },
      body: JSON.stringify({
        workspaceId: workspace.id,
        customDomain: workspace.customDomain,
        appUrl: config.appUrl,
        verificationToken: workspace.customDomainVerificationToken,
        expectedTxt: customDomainTxtRecord(workspace)
      }),
      signal: controller.signal
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(cleanText(payload?.error?.message || payload?.message || `SSL provider failed with HTTP ${response.status}.`, 400));
    }
    return {
      status: normalizeCustomDomainSslStatus(payload.status),
      provider: cleanText(payload.provider || config.providerName, 80),
      certificateId: cleanText(payload.certificateId || payload.certificate_id || '', 160),
      provisionedAt: cleanFutureOrPastIso(payload.provisionedAt || payload.provisioned_at, ''),
      message: cleanText(payload.message || payload.error || '', 400)
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`SSL provider timed out after ${config.timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCustomDomainSslStatus(value) {
  const status = cleanText(value || '', 80).toLowerCase();
  if (['active', 'issued', 'success', 'ready'].includes(status)) return 'active';
  if (['pending', 'pending_validation', 'validating', 'queued'].includes(status)) return 'pending_validation';
  if (['failed', 'error', 'rejected'].includes(status)) return 'failed';
  return 'pending_validation';
}

function applyCustomDomainSslResult(workspace, result) {
  const now = new Date().toISOString();
  workspace.customDomainSslStatus = result.status;
  workspace.customDomainSslProvider = result.provider;
  workspace.customDomainSslCertificateId = result.certificateId;
  workspace.customDomainSslProvisionedAt = result.status === 'active' ? (result.provisionedAt || now) : '';
  workspace.customDomainSslLastError = result.status === 'failed' ? (result.message || 'SSL provider reported failure.') : '';
  workspace.customDomainSslUpdatedAt = now;
}

function normalizeSsoConfig(input = {}) {
  const allowedRoles = new Set(['viewer', 'analyst', 'editor']);
  const defaultRole = normalizeRole(input.defaultRole || 'viewer');
  return {
    enabled: parseBoolean(input.enabled),
    provider: 'saml',
    providerName: cleanText(input.providerName || 'Workspace SSO', 120),
    entityId: cleanText(input.entityId || '', 300),
    ssoUrl: cleanUrl(input.ssoUrl || ''),
    x509Certificate: cleanPemText(input.x509Certificate || '', 8000),
    allowedDomains: normalizeSsoDomains(input.allowedDomains),
    enforce: parseBoolean(input.enforce),
    jitProvisioning: input.jitProvisioning === undefined ? true : parseBoolean(input.jitProvisioning),
    defaultRole: allowedRoles.has(defaultRole) ? defaultRole : 'viewer',
    devMode: parseBoolean(input.devMode),
    updatedAt: cleanFutureOrPastIso(input.updatedAt, new Date().toISOString())
  };
}

function normalizeSsoDomains(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return [...new Set(raw.map((item) => cleanHostname(item)).filter(Boolean))].slice(0, 25);
}

function cleanPemText(value, max = 8000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, max);
}

function ssoEmailDomain(email) {
  return cleanEmail(email, true).split('@')[1] || '';
}

function ssoEmailAllowed(workspace, email) {
  const domain = ssoEmailDomain(email);
  const domains = workspace.sso?.allowedDomains || [];
  return Boolean(domain && (!domains.length || domains.includes(domain)));
}

function findSsoWorkspace(db, workspaceId, email, workspaceSlug = '') {
  const safeWorkspaceId = cleanText(workspaceId || '', 80);
  if (safeWorkspaceId) {
    return db.workspaces.find((workspace) => workspace.id === safeWorkspaceId) || null;
  }
  const safeSlug = cleanText(workspaceSlug || '', 120);
  if (safeSlug) {
    return db.workspaces.find((workspace) => workspace.slug === safeSlug) || null;
  }
  const domain = ssoEmailDomain(email);
  if (!domain) return null;
  return db.workspaces.find((workspace) => workspace.sso?.enabled && ssoEmailAllowed(workspace, email)) || null;
}

function enforcedSsoWorkspaceForEmail(db, email) {
  const domain = ssoEmailDomain(email);
  if (!domain) return null;
  return db.workspaces.find((workspace) => workspace.sso?.enabled && workspace.sso.enforce && ssoEmailAllowed(workspace, email)) || null;
}

function createSsoRequest(workspace, email) {
  return {
    id: makeId('sso'),
    workspaceId: workspace.id,
    email: cleanEmail(email || '', true),
    relayState: `relay_${crypto.randomBytes(18).toString('hex')}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    completedAt: null
  };
}

function ssoStartPayload(url, workspace, request) {
  const origin = `${url.protocol}//${url.host}`;
  const acsUrl = ssoAssertionConsumerServiceUrl(url);
  const issuer = `${origin}/api/auth/sso/metadata/${workspace.id}`;
  const destination = workspace.sso.ssoUrl || acsUrl;
  const xml = [
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${escapeXml(request.id)}" Version="2.0" IssueInstant="${escapeXml(request.createdAt)}" AssertionConsumerServiceURL="${escapeXml(acsUrl)}" Destination="${escapeXml(destination)}">`,
    `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${escapeXml(issuer)}</saml:Issuer>`,
    '</samlp:AuthnRequest>'
  ].join('');
  const samlRequest = Buffer.from(xml).toString('base64');
  const redirectUrl = workspace.sso.ssoUrl
    ? `${workspace.sso.ssoUrl}${workspace.sso.ssoUrl.includes('?') ? '&' : '?'}SAMLRequest=${encodeURIComponent(samlRequest)}&RelayState=${encodeURIComponent(request.relayState)}`
    : '';
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    provider: workspace.sso.provider,
    providerName: workspace.sso.providerName,
    requestId: request.id,
    relayState: request.relayState,
    samlRequest,
    redirectUrl,
    devLoginAvailable: workspace.sso.devMode,
    metadataUrl: `/api/auth/sso/metadata/${workspace.id}`
  };
}

function buildSsoMetadataXml(url, workspace) {
  const origin = `${url.protocol}//${url.host}`;
  const entityId = `${origin}/api/auth/sso/metadata/${workspace.id}`;
  const acsUrl = ssoAssertionConsumerServiceUrl(url);
  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(entityId)}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="false" WantAssertionsSigned="true">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(acsUrl)}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
}

function ssoAssertionConsumerServiceUrl(url) {
  return `${url.protocol}//${url.host}/api/auth/sso/assertion`;
}

function parseSamlResponsePayload(samlResponse) {
  if (!samlResponse) return { ok: false, message: 'SAMLResponse is required.' };
  let xml = '';
  try {
    xml = Buffer.from(samlResponse, 'base64').toString('utf8');
  } catch {
    return { ok: false, message: 'SAMLResponse must be base64 encoded XML.' };
  }
  if (!xml || !/<[^>]+>/.test(xml)) return { ok: false, message: 'SAMLResponse did not decode to XML.' };
  if (/<!doctype|<!entity/i.test(xml)) return { ok: false, message: 'SAMLResponse contains forbidden XML declarations.' };
  const responseAttrs = samlTagAttributes(xml, 'Response');
  const subjectConfirmationAttrs = samlTagAttributes(xml, 'SubjectConfirmationData');
  const conditionsAttrs = samlTagAttributes(xml, 'Conditions');
  const issuer = samlElementText(xml, 'Issuer');
  const nameId = samlElementText(xml, 'NameID');
  const email = samlAttributeValue(xml, ['email', 'Email', 'mail', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress']) || nameId;
  const displayName = samlAttributeValue(xml, ['name', 'displayName', 'fullName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']) || email.split('@')[0] || 'SSO User';
  return {
    ok: true,
    assertion: {
      xml,
      responseId: responseAttrs.ID || responseAttrs.Id || responseAttrs.id || '',
      inResponseTo: responseAttrs.InResponseTo || subjectConfirmationAttrs.InResponseTo || '',
      destination: responseAttrs.Destination || '',
      issuer,
      nameId,
      email: cleanEmail(email, true),
      name: cleanText(displayName, 120),
      audience: samlElementText(xml, 'Audience'),
      recipient: subjectConfirmationAttrs.Recipient || '',
      notBefore: conditionsAttrs.NotBefore || '',
      notOnOrAfter: subjectConfirmationAttrs.NotOnOrAfter || conditionsAttrs.NotOnOrAfter || '',
      signaturePresent: /<(?:[A-Za-z0-9_]+:)?Signature\b/.test(xml)
    }
  };
}

function validateSsoAssertion(assertion, context) {
  const { samlResponse, detachedSignature, url, workspace, request } = context;
  const expectedAcs = ssoAssertionConsumerServiceUrl(url);
  const expectedAudience = `${url.protocol}//${url.host}/api/auth/sso/metadata/${workspace.id}`;
  if (!workspace.sso.x509Certificate) {
    return { ok: false, status: 403, code: 'sso_certificate_required', message: 'Workspace SSO requires a configured signing certificate or public key.' };
  }
  if (!detachedSignature) {
    return { ok: false, status: 403, code: 'invalid_saml_signature', message: 'SAML assertion signature is required.' };
  }
  if (!verifySsoDetachedSignature(workspace.sso.x509Certificate, samlResponse, detachedSignature)) {
    return { ok: false, status: 403, code: 'invalid_saml_signature', message: 'SAML assertion signature is invalid.' };
  }
  if (assertion.inResponseTo !== request.id) {
    return { ok: false, status: 400, code: 'invalid_saml_response', message: 'SAML assertion does not match the pending SSO request.' };
  }
  if (assertion.destination && assertion.destination !== expectedAcs) {
    return { ok: false, status: 403, code: 'invalid_saml_destination', message: 'SAML response destination does not match this service provider.' };
  }
  if (assertion.recipient && assertion.recipient !== expectedAcs) {
    return { ok: false, status: 403, code: 'invalid_saml_recipient', message: 'SAML assertion recipient does not match this service provider.' };
  }
  if (workspace.sso.entityId && assertion.issuer !== workspace.sso.entityId) {
    return { ok: false, status: 403, code: 'invalid_saml_issuer', message: 'SAML issuer does not match workspace SSO settings.' };
  }
  if (assertion.audience && assertion.audience !== expectedAudience) {
    return { ok: false, status: 403, code: 'invalid_saml_audience', message: 'SAML audience does not match this service provider.' };
  }
  const now = Date.now();
  if (assertion.notBefore && new Date(assertion.notBefore).getTime() - 60 * 1000 > now) {
    return { ok: false, status: 403, code: 'saml_assertion_not_yet_valid', message: 'SAML assertion is not yet valid.' };
  }
  if (!assertion.notOnOrAfter || new Date(assertion.notOnOrAfter).getTime() <= now) {
    return { ok: false, status: 403, code: 'saml_assertion_expired', message: 'SAML assertion is expired or missing an expiry.' };
  }
  if (!assertion.email || !ssoEmailAllowed(workspace, assertion.email)) {
    return { ok: false, status: 403, code: 'sso_domain_not_allowed', message: 'This email domain is not allowed for workspace SSO.' };
  }
  if (request.email && request.email !== assertion.email) {
    return { ok: false, status: 403, code: 'sso_subject_mismatch', message: 'SAML assertion subject does not match the requested email.' };
  }
  return { ok: true, email: assertion.email, name: assertion.name || assertion.email.split('@')[0] || 'SSO User' };
}

function verifySsoDetachedSignature(publicKeyOrCertificate, samlResponse, signature) {
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(samlResponse);
    verifier.end();
    return verifier.verify(publicKeyOrCertificate, signature, 'base64');
  } catch {
    return false;
  }
}

function samlTagAttributes(xml, tagName) {
  const match = xml.match(new RegExp(`<(?:(?:[A-Za-z0-9_]+):)?${tagName}\\b([^>]*)>`, 'i'));
  return match ? parseXmlAttributes(match[1]) : {};
}

function parseXmlAttributes(raw) {
  const attrs = {};
  String(raw || '').replace(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g, (_match, key, _quoted, doubleValue, singleValue) => {
    attrs[key.split(':').pop()] = decodeXml(doubleValue ?? singleValue ?? '');
    return '';
  });
  return attrs;
}

function samlElementText(xml, tagName) {
  const match = xml.match(new RegExp(`<(?:(?:[A-Za-z0-9_]+):)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_]+):)?${tagName}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, '').trim()) : '';
}

function samlAttributeValue(xml, names) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const match = xml.match(new RegExp(`<(?:(?:[A-Za-z0-9_]+):)?Attribute\\b[^>]*(?:Name|FriendlyName)=["']${escaped}["'][^>]*>[\\s\\S]*?<(?:(?:[A-Za-z0-9_]+):)?AttributeValue\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_]+):)?AttributeValue>`, 'i'));
    if (match) return decodeXml(match[1].replace(/<[^>]+>/g, '').trim());
  }
  return '';
}

async function createSsoUser(email, name, workspace) {
  const now = new Date().toISOString();
  return {
    id: makeId('usr'),
    name,
    email,
    avatarUrl: '',
    password: await hashPassword(`sso_${crypto.randomBytes(24).toString('hex')}`),
    emailVerifiedAt: now,
    platformRole: 'user',
    timezone: workspace.timezone || 'Asia/Kolkata',
    notificationPreferences: { emailAlerts: true, weeklyDigest: true },
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    authProvider: 'sso',
    createdAt: now,
    updatedAt: now
  };
}

function googleOAuthConfig(url) {
  const appUrl = cleanUrl(process.env.APP_URL || `${url.protocol}//${url.host}`) || `${url.protocol}//${url.host}`;
  const redirectUri = cleanUrl(process.env.GOOGLE_OAUTH_REDIRECT_URI || `${appUrl.replace(/\/$/, '')}/api/auth/oauth/google/callback`);
  const authUrl = cleanUrl(process.env.GOOGLE_OAUTH_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth');
  const tokenUrl = cleanUrl(process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token');
  const userInfoUrl = cleanUrl(process.env.GOOGLE_OAUTH_USERINFO_URL || 'https://www.googleapis.com/oauth2/v3/userinfo');
  const scope = cleanText(process.env.GOOGLE_OAUTH_SCOPE || 'openid email profile', 240);
  const clientId = cleanText(process.env.GOOGLE_OAUTH_CLIENT_ID || '', 300);
  const clientSecret = cleanText(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '', 300);
  return {
    provider: 'google',
    clientId,
    clientSecret,
    authUrl,
    tokenUrl,
    userInfoUrl,
    redirectUri,
    scope,
    configured: Boolean(clientId && clientSecret && authUrl && tokenUrl && userInfoUrl && redirectUri)
  };
}

function googleOAuthPublicConfig(config = googleOAuthConfig(new URL('http://localhost'))) {
  return {
    provider: 'google',
    configured: Boolean(config.configured),
    authUrl: config.authUrl,
    redirectUri: config.redirectUri,
    scope: config.scope
  };
}

async function exchangeGoogleOAuthCode(config, code, request) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    code_verifier: request.codeVerifier || ''
  });
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(cleanText(payload.error_description || payload.error || `OAuth token exchange failed with HTTP ${response.status}.`, 300));
  }
  if (!payload.access_token) throw new Error('OAuth token response did not include an access token.');
  return payload;
}

async function fetchGoogleOAuthProfile(config, tokens) {
  const response = await fetch(config.userInfoUrl, {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(cleanText(profile.error_description || profile.error || `OAuth userinfo failed with HTTP ${response.status}.`, 300));
  }
  const email = cleanEmail(profile.email || '');
  if (!email) throw new Error('OAuth profile did not include an email address.');
  if (profile.email_verified === false || profile.verified_email === false) throw new Error('OAuth email address is not verified.');
  return {
    providerId: cleanText(profile.sub || profile.id || email, 200),
    email,
    name: cleanText(profile.name || profile.given_name || email.split('@')[0], 120),
    avatarUrl: cleanUrl(profile.picture || '')
  };
}

async function completeGoogleOAuthLogin(db, profile, request) {
  let user = db.users.find((item) => item.email === profile.email);
  let created = false;
  let workspaceId = '';
  const now = new Date().toISOString();
  if (!user) {
    if (request.mode !== 'signup' || !request.acceptedTerms) {
      throw new Error('No FeedbackOS account exists for this Google email. Create an account first.');
    }
    user = {
      id: makeId('usr'),
      name: request.name || profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      password: await hashPassword(`oauth_${crypto.randomBytes(24).toString('hex')}`),
      emailVerifiedAt: now,
      platformRole: bootstrapPlatformRole(db, profile.email),
      timezone: request.timezone || 'Asia/Kolkata',
      notificationPreferences: { emailAlerts: true, weeklyDigest: true },
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      authProvider: 'google',
      oauthProviders: { google: { providerId: profile.providerId, linkedAt: now } },
      createdAt: now,
      updatedAt: now
    };
    const workspace = createWorkspace({
      name: request.workspaceName || `${user.name || 'My'} Workspace`,
      ownerId: user.id,
      industry: request.industry || 'General services',
      companySize: request.companySize || '1-10',
      timezone: user.timezone
    });
    db.users.push(user);
    db.workspaces.push(workspace);
    db.workspaceMembers.push({
      id: makeId('mem'),
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner',
      invitedBy: user.id,
      joinedAt: now,
      createdAt: now
    });
    db.subscriptions.push(createSubscription(workspace.id, 'starter'));
    db.usageMeters.push(createUsageMeter(workspace.id));
    db.auditLogs.push(audit(workspace.id, user.id, 'workspace.created', 'workspace', workspace.id, { name: workspace.name, source: 'google_oauth' }));
    workspaceId = workspace.id;
    created = true;
  } else {
    if (user.disabled) throw new Error('This user is disabled.');
    user.name = user.name || profile.name;
    user.avatarUrl = user.avatarUrl || profile.avatarUrl;
    user.emailVerifiedAt = user.emailVerifiedAt || now;
    user.authProvider = user.authProvider || 'google';
    user.oauthProviders = {
      ...(user.oauthProviders || {}),
      google: { providerId: profile.providerId, linkedAt: user.oauthProviders?.google?.linkedAt || now, lastLoginAt: now }
    };
    user.updatedAt = now;
  }
  request.codeVerifier = '';
  return { user, created, workspaceId };
}

function maskEmail(email) {
  const safe = cleanEmail(email, true);
  const [name, domain] = safe.split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}***@${domain}`;
}

function createWorkspace(input) {
  const now = new Date().toISOString();
  return {
    id: makeId('wks'),
    name: input.name,
    slug: uniqueSlug(input.name),
    logoUrl: '',
    brandColor: '#176B5B',
    buttonColor: '#B75D2A',
    timezone: input.timezone || 'Asia/Kolkata',
    defaultLanguage: 'en',
    ownerId: input.ownerId,
    planId: 'starter',
    aiCreditLimitOverride: null,
    allowExternalAi: true,
    requirePublishApproval: false,
    permissionPolicy: normalizeWorkspacePermissionPolicy({}),
    industry: input.industry || 'General services',
    companySize: input.companySize || '1-10',
    customDomain: '',
    customDomainStatus: 'not_configured',
    customDomainVerificationToken: '',
    customDomainVerifiedAt: '',
    customDomainSslStatus: 'not_configured',
    customDomainSslProvider: '',
    customDomainSslCertificateId: '',
    customDomainSslProvisionedAt: '',
    customDomainSslLastError: '',
    customDomainSslUpdatedAt: '',
    customDomainDnsCheckedAt: '',
    customDomainObservedTxt: [],
    sso: normalizeSsoConfig({}),
    customCss: '',
    customFooterText: '',
    hidePlatformBranding: false,
    defaultSenderEmail: '',
    dataRetentionSettings: { retentionDays: 365, anonymousModeDefault: false },
    privacyPolicyUrl: '',
    termsUrl: '',
    retentionDays: 365,
    retentionScheduleEnabled: true,
    retentionLastRunAt: '',
    retentionNextRunAt: nextRetentionRunAt(Date.now()),
    createdAt: now,
    updatedAt: now
  };
}

function createSurvey(input) {
  const now = new Date().toISOString();
  const schema = normalizeSchema(input.schema || {
    title: input.title,
    description: input.description,
    questions: [
      question('csat', 'How satisfied are you?', true, { scale: 5 }),
      question('long_text', 'What can we improve?', false, { placeholder: 'Share feedback.' }),
      question('email', 'Email for follow-up', false, { placeholder: 'you@example.com' })
    ],
    logic: [],
    completion: { type: 'message', message: 'Thank you for your feedback.' }
  });
  schema.title = input.title || schema.title;
  schema.description = input.description || schema.description;
  schema.questions = schema.questions.map((item, index) => ({ ...item, order: index }));
  return {
    id: makeId('srv'),
    workspaceId: input.workspaceId,
    title: schema.title,
    description: schema.description,
    internalName: slugify(schema.title),
    type: input.type || 'feedback_form',
    status: 'draft',
    slug: `${slugify(schema.title)}-${crypto.randomBytes(3).toString('hex')}`,
    language: 'en',
    settings: defaultSurveySettings(),
    branding: {},
    schema,
    createdBy: input.userId,
    publishedAt: null,
    publishedVersionId: null,
    hasUnpublishedChanges: false,
    approvalStatus: 'not_required',
    approvalRequestedBy: '',
    approvalRequestedAt: '',
    approvalReviewedBy: '',
    approvalReviewedAt: '',
    approvalNote: '',
    approvalFingerprint: '',
    accessMode: 'workspace',
    accessRules: [],
    metrics: { views: 0, starts: 0, completions: 0 },
    createdAt: now,
    updatedAt: now
  };
}

function createSurveyVersion(db, survey, userId) {
  const latest = db.surveyVersions.filter((version) => version.surveyId === survey.id).length;
  const version = {
    id: makeId('ver'),
    surveyId: survey.id,
    versionNumber: latest + 1,
    schemaJson: structuredClone(survey.schema),
    logicJson: structuredClone(survey.schema.logic || []),
    createdBy: userId,
    createdAt: new Date().toISOString()
  };
  db.surveyVersions.push(version);
  return version;
}

function updateSurveyFromBody(db, survey, body) {
  survey.title = cleanText(body.title ?? survey.title, 160);
  survey.description = cleanText(body.description ?? survey.description, 600);
  survey.internalName = cleanText(body.internalName ?? survey.internalName, 160);
  survey.type = cleanText(body.type ?? survey.type, 60);
  survey.language = cleanText(body.language ?? survey.language, 20);
  survey.settings = normalizeSurveySettings(survey.settings || defaultSurveySettings(), body.settings || {});
  if (body.accessMode !== undefined) survey.accessMode = normalizeSurveyAccessMode(body.accessMode);
  if (body.accessRules !== undefined) survey.accessRules = normalizeSurveyAccessRules(db, survey, body.accessRules);
  const brandingInput = body.branding || {};
  survey.branding = {
    ...survey.branding,
    ...brandingInput,
    brandColor: cleanColor(brandingInput.brandColor || survey.branding.brandColor || ''),
    buttonColor: cleanColor(brandingInput.buttonColor || survey.branding.buttonColor || ''),
    background: cleanColor(brandingInput.background || survey.branding.background || '') || survey.branding.background || '',
    customCss: sanitizeCustomCss(brandingInput.customCss ?? survey.branding.customCss),
    footerText: cleanText(brandingInput.footerText ?? survey.branding.footerText, 280)
  };
  survey.schema = normalizeSchema({ ...(survey.schema || {}), ...(body.schema || {}) });
  survey.schema.title = survey.title;
  survey.schema.description = survey.description;
}

function normalizeSchema(schema) {
  const normalized = {
    title: cleanText(schema.title || 'Untitled Survey', 160),
    description: cleanText(schema.description || '', 600),
    questions: Array.isArray(schema.questions) ? schema.questions.map(normalizeQuestion) : [],
    logic: Array.isArray(schema.logic) ? schema.logic.map(normalizeLogic).filter(Boolean) : [],
    translations: normalizeTranslations(schema.translations || {}),
    completion: {
      type: schema.completion?.type || 'message',
      message: cleanText(schema.completion?.message || 'Thank you for your response.', 300),
      redirectUrl: cleanUrl(schema.completion?.redirectUrl || '')
    }
  };
  normalized.questions.forEach((item, index) => {
    item.order = index;
  });
  return normalized;
}

function normalizeTranslations(input) {
  const output = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output;
  for (const [language, value] of Object.entries(input)) {
    const code = cleanText(language, 20).toLowerCase();
    if (!code || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    output[code] = {
      title: cleanText(value.title || '', 160),
      description: cleanText(value.description || '', 600),
      completionMessage: cleanText(value.completionMessage || value.completion?.message || '', 300),
      questions: normalizeQuestionTranslations(value.questions || {})
    };
  }
  return output;
}

function normalizeQuestionTranslations(input) {
  const output = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output;
  for (const [questionId, value] of Object.entries(input)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    output[cleanText(questionId, 80)] = {
      title: cleanText(value.title || '', 240),
      description: cleanText(value.description || '', 500),
      placeholder: cleanText(value.placeholder || '', 180),
      consentText: cleanText(value.consentText || '', 240),
      options: Array.isArray(value.options) ? value.options.map((item) => cleanText(item, 140)).filter(Boolean).slice(0, 30) : []
    };
  }
  return output;
}

function normalizeQuestion(input) {
  const type = QUESTION_TYPES.includes(input.type) ? input.type : 'short_text';
  return {
    id: cleanText(input.id, 80) || makeId('q'),
    type,
    title: cleanText(input.title || 'Untitled question', 240),
    description: cleanText(input.description || '', 500),
    required: Boolean(input.required),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
    settings: normalizeQuestionSettings(type, input.settings || {}),
    validation: input.validation && typeof input.validation === 'object' ? input.validation : {}
  };
}

function normalizeQuestionSettings(type, settings) {
  const output = { ...settings };
  output.page = Math.max(1, Math.min(50, Number(settings.page || 1)));
  if (['single_choice', 'multiple_choice', 'dropdown', 'yes_no'].includes(type)) {
    output.options = Array.isArray(settings.options) && settings.options.length
      ? settings.options.map((item) => cleanText(item, 140)).filter(Boolean).slice(0, 30)
      : type === 'yes_no'
        ? ['Yes', 'No']
        : ['Option 1', 'Option 2'];
  }
  if (['rating', 'nps', 'csat', 'ces', 'star_rating', 'emoji_rating'].includes(type)) {
    output.scale = Math.max(2, Math.min(type === 'nps' ? 10 : 7, Number(settings.scale || (type === 'nps' ? 10 : 5))));
    output.lowLabel = cleanText(settings.lowLabel || '', 80);
    output.highLabel = cleanText(settings.highLabel || '', 80);
  }
  if (type === 'file_upload') {
    output.allowedFileTypes = Array.isArray(settings.allowedFileTypes)
      ? settings.allowedFileTypes.map((item) => cleanText(item, 40).toLowerCase()).filter(Boolean).slice(0, 20)
      : String(settings.allowedFileTypes || 'pdf,png,jpg,jpeg,webp,csv,txt')
        .split(',')
        .map((item) => cleanText(item, 40).toLowerCase().replace(/^\./, ''))
        .filter(Boolean)
        .slice(0, 20);
    output.maxSizeMB = Math.max(1, Math.min(20, Number(settings.maxSizeMB || 5)));
  }
  output.placeholder = cleanText(settings.placeholder || '', 180);
  output.consentText = cleanText(settings.consentText || 'I agree.', 240);
  return output;
}

function normalizeLogic(input) {
  if (!input || typeof input !== 'object') return null;
  const questionId = cleanText(input.questionId || input.if?.questionId, 80);
  const operator = cleanText(input.operator || input.if?.operator || 'equals', 40);
  const targetQuestionId = cleanText(input.targetQuestionId || input.then?.targetQuestionId, 80);
  const allowedActions = new Set(['show_question', 'skip_to_question', 'assign_tag', 'trigger_alert', 'set_hidden_field', 'calculate_score', 'end_survey', 'redirect']);
  const actionInput = cleanText(input.action || input.then?.action || 'show_question', 60);
  const action = allowedActions.has(actionInput) ? actionInput : 'show_question';
  const actionValue = cleanText(input.actionValue ?? input.then?.value ?? input.then?.tag ?? input.then?.message ?? '', 500);
  const redirectUrl = cleanUrl(input.redirectUrl || input.then?.redirectUrl || '');
  const scoreDelta = Number.isFinite(Number(input.scoreDelta ?? input.then?.scoreDelta ?? input.then?.score)) ? Number(input.scoreDelta ?? input.then?.scoreDelta ?? input.then?.score) : 0;
  if (!questionId) return null;
  return {
    id: cleanText(input.id, 80) || makeId('logic'),
    questionId,
    operator,
    value: input.value ?? input.if?.value ?? '',
    action,
    targetQuestionId,
    actionValue,
    redirectUrl,
    scoreDelta: Math.max(-100, Math.min(100, scoreDelta))
  };
}

function defaultSurveySettings() {
  return {
    duplicatePrevention: 'allow_multiple',
    anonymousMode: false,
    collectIpHash: true,
    collectUserAgent: true,
    requireConsent: false,
    opensAt: '',
    responseLimit: 0,
    expiresAt: '',
    passwordProtected: false,
    passwordHash: '',
    completionRedirectUrl: '',
    inAppTriggerEvent: '',
    inAppTargetPath: '',
    inAppFrequencyDays: 0,
    inAppAudienceProperty: '',
    inAppAudienceValue: '',
    inAppAllowedOrigins: []
  };
}

function normalizeSurveySettings(existing, patch = {}) {
  const allowedDuplicate = new Set(['allow_multiple', 'one_per_browser', 'one_per_email', 'one_per_user_id', 'one_per_ip_hash']);
  const base = { ...defaultSurveySettings(), ...(existing || {}) };
  const output = { ...base };
  if (patch.duplicatePrevention !== undefined) {
    output.duplicatePrevention = allowedDuplicate.has(patch.duplicatePrevention) ? patch.duplicatePrevention : 'allow_multiple';
  }
  for (const key of ['anonymousMode', 'collectIpHash', 'collectUserAgent', 'requireConsent', 'passwordProtected']) {
    if (patch[key] !== undefined) output[key] = Boolean(patch[key]);
  }
  if (patch.responseLimit !== undefined) output.responseLimit = Math.max(0, Math.min(1000000, Number(patch.responseLimit || 0)));
  for (const key of ['opensAt', 'expiresAt']) {
    if (patch[key] !== undefined) {
      const time = Date.parse(patch[key]);
      output[key] = Number.isFinite(time) ? new Date(time).toISOString() : '';
    }
  }
  for (const key of ['inAppTriggerEvent', 'inAppTargetPath', 'inAppAudienceProperty', 'inAppAudienceValue']) {
    if (patch[key] !== undefined) output[key] = cleanText(patch[key], 160);
  }
  if (patch.inAppFrequencyDays !== undefined) output.inAppFrequencyDays = Math.max(0, Math.min(365, Number(patch.inAppFrequencyDays || 0)));
  if (patch.inAppAllowedOrigins !== undefined) {
    const values = Array.isArray(patch.inAppAllowedOrigins) ? patch.inAppAllowedOrigins : String(patch.inAppAllowedOrigins || '').split(/[\s,]+/);
    output.inAppAllowedOrigins = [...new Set(values.map((value) => {
      try { return new URL(value).origin; } catch { return ''; }
    }).filter(Boolean))].slice(0, 20);
  }
  if (patch.completionRedirectUrl !== undefined) output.completionRedirectUrl = cleanUrl(patch.completionRedirectUrl || '');
  if (patch.password !== undefined && String(patch.password || '').trim()) {
    output.passwordHash = hashToken(String(patch.password));
    delete output.password;
  }
  if (patch.passwordProtected === false) {
    output.passwordHash = '';
    delete output.password;
  }
  return output;
}

function applySurveySlug(db, survey, value) {
  const slug = slugify(value).slice(0, 80);
  if (!slug || slug.length < 3) return { ok: false, message: 'Slug must contain at least three URL-safe characters.' };
  const exists = db.surveys.some((item) => item.id !== survey.id && item.slug === slug);
  if (exists) return { ok: false, message: 'That public slug is already in use.' };
  survey.slug = slug;
  return { ok: true };
}

function validateSurveyForPublish(survey) {
  const errors = [];
  if (process.env.NODE_ENV === 'production' && (!objectStorageConfigured() || !fileScanConfig().providerUrl)) {
    if (survey.schema?.questions?.some((item) => item.type === 'file_upload')) {
      errors.push('File upload questions are not available on this deployment.');
    }
  }
  if (!survey.title) errors.push('Survey title is required.');
  if (!survey.schema.questions.length) errors.push('At least one question is required.');
  if (survey.settings.passwordProtected && !survey.settings.passwordHash) {
    errors.push('Password-protected surveys need a password before publishing.');
  }
  for (const item of survey.schema.questions) {
    if (!item.title && !['hidden', 'section', 'statement'].includes(item.type)) errors.push(`Question ${item.id} needs a title.`);
    if (['single_choice', 'multiple_choice', 'dropdown'].includes(item.type) && (!item.settings.options || item.settings.options.length < 2)) {
      errors.push(`${item.title} needs at least two answer options.`);
    }
  }
  const ids = new Set(survey.schema.questions.map((item) => item.id));
  for (const logic of survey.schema.logic) {
    if (!ids.has(logic.questionId)) {
      errors.push('Logic rules must start from an existing question.');
    }
    if (['show_question', 'skip_to_question', 'set_hidden_field'].includes(logic.action)) {
      if (!ids.has(logic.targetQuestionId)) errors.push('Logic rules must point to existing questions.');
      if (logic.questionId === logic.targetQuestionId) errors.push('Logic rules cannot target the same question.');
    }
    if (logic.action === 'skip_to_question' && ids.has(logic.questionId) && ids.has(logic.targetQuestionId)) {
      const sourceIndex = survey.schema.questions.findIndex((item) => item.id === logic.questionId);
      const targetIndex = survey.schema.questions.findIndex((item) => item.id === logic.targetQuestionId);
      if (targetIndex <= sourceIndex) errors.push('Skip logic must point to a later question.');
    }
    if (logic.action === 'assign_tag' && !logic.actionValue) {
      errors.push('Assign-tag logic needs a tag value.');
    }
    if (logic.action === 'redirect' && !logic.redirectUrl) {
      errors.push('Redirect logic needs a valid URL.');
    }
  }
  if (hasCircularLogic(survey.schema.logic.filter((logic) => ['show_question', 'skip_to_question'].includes(logic.action)))) errors.push('Circular logic paths are blocked.');
  return { ok: errors.length === 0, errors, message: errors[0] || '' };
}

function publishSurveyDraft(db, survey, actorId, options = {}) {
  ensureSurveyApproval(survey);
  const validation = validateSurveyForPublish(survey);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      error: { code: 'publish_validation_failed', message: validation.message, details: validation.errors }
    };
  }
  const workspace = db.workspaces.find((item) => item.id === survey.workspaceId);
  const actorRole = options.actorRole || '';
  const requiresApproval = Boolean(workspace?.requirePublishApproval);
  const fingerprint = surveyApprovalFingerprint(survey);
  if (requiresApproval && !roleAtLeast(actorRole, 'admin')) {
    if (survey.approvalStatus !== 'approved' || survey.approvalFingerprint !== fingerprint) {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'approval_required',
          message: survey.approvalStatus === 'stale'
            ? 'Survey changes must be approved again before publishing.'
            : 'Survey must be approved by a workspace admin before publishing.',
          approval: surveyApprovalPayload(db, survey)
        }
      };
    }
  }
  if (requiresApproval && roleAtLeast(actorRole, 'admin') && (survey.approvalStatus !== 'approved' || survey.approvalFingerprint !== fingerprint)) {
    reviewSurveyApproval(survey, actorId, 'approved', 'Approved by direct admin publish.');
  }
  const version = createSurveyVersion(db, survey, actorId);
  survey.status = 'published';
  survey.publishedAt = survey.publishedAt || new Date().toISOString();
  survey.publishedVersionId = version.id;
  survey.hasUnpublishedChanges = false;
  survey.updatedAt = new Date().toISOString();
  return { ok: true, version };
}

function ensureSurveyApproval(survey) {
  survey.approvalStatus = normalizeApprovalStatus(survey.approvalStatus || 'not_required');
  survey.approvalRequestedBy = cleanText(survey.approvalRequestedBy || '', 120);
  survey.approvalRequestedAt = cleanText(survey.approvalRequestedAt || '', 80);
  survey.approvalReviewedBy = cleanText(survey.approvalReviewedBy || '', 120);
  survey.approvalReviewedAt = cleanText(survey.approvalReviewedAt || '', 80);
  survey.approvalNote = cleanText(survey.approvalNote || '', 500);
  survey.approvalFingerprint = cleanText(survey.approvalFingerprint || '', 128);
  return survey;
}

function requestSurveyApproval(survey, userId, note = '') {
  ensureSurveyApproval(survey);
  const now = new Date().toISOString();
  survey.approvalStatus = 'pending';
  survey.approvalRequestedBy = userId;
  survey.approvalRequestedAt = now;
  survey.approvalReviewedBy = '';
  survey.approvalReviewedAt = '';
  survey.approvalNote = cleanText(note || '', 500);
  survey.approvalFingerprint = surveyApprovalFingerprint(survey);
  survey.updatedAt = now;
  return survey;
}

function reviewSurveyApproval(survey, userId, status, note = '') {
  ensureSurveyApproval(survey);
  const now = new Date().toISOString();
  survey.approvalStatus = status === 'approved' ? 'approved' : 'rejected';
  if (!survey.approvalRequestedAt) {
    survey.approvalRequestedBy = survey.approvalRequestedBy || userId;
    survey.approvalRequestedAt = now;
  }
  survey.approvalReviewedBy = userId;
  survey.approvalReviewedAt = now;
  survey.approvalNote = cleanText(note || '', 500);
  survey.approvalFingerprint = surveyApprovalFingerprint(survey);
  survey.updatedAt = now;
  return survey;
}

function markApprovalStaleIfChanged(survey, beforeFingerprint) {
  ensureSurveyApproval(survey);
  if (survey.approvalStatus !== 'approved') return;
  if (beforeFingerprint && beforeFingerprint !== surveyApprovalFingerprint(survey)) {
    survey.approvalStatus = 'stale';
    survey.approvalNote = 'Approved draft changed after review.';
  }
}

function surveyApprovalPayload(db, survey) {
  ensureSurveyApproval(survey);
  const workspace = db.workspaces.find((item) => item.id === survey.workspaceId);
  const requester = db.users.find((item) => item.id === survey.approvalRequestedBy);
  const reviewer = db.users.find((item) => item.id === survey.approvalReviewedBy);
  return {
    required: Boolean(workspace?.requirePublishApproval),
    status: survey.approvalStatus,
    requestedBy: survey.approvalRequestedBy,
    requestedByName: requester?.name || requester?.email || '',
    requestedAt: survey.approvalRequestedAt,
    reviewedBy: survey.approvalReviewedBy,
    reviewedByName: reviewer?.name || reviewer?.email || '',
    reviewedAt: survey.approvalReviewedAt,
    note: survey.approvalNote,
    stale: survey.approvalStatus === 'stale' || (survey.approvalStatus === 'approved' && survey.approvalFingerprint !== surveyApprovalFingerprint(survey))
  };
}

function surveyApprovalFingerprint(survey) {
  const material = {
    title: survey.title || '',
    description: survey.description || '',
    internalName: survey.internalName || '',
    type: survey.type || '',
    slug: survey.slug || '',
    language: survey.language || '',
    settings: survey.settings || {},
    branding: survey.branding || {},
    schema: survey.schema || {}
  };
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

function normalizeApprovalStatus(status) {
  return ['not_required', 'pending', 'approved', 'rejected', 'stale'].includes(status) ? status : 'not_required';
}

function hasCircularLogic(logicRules) {
  const graph = new Map();
  for (const rule of logicRules) {
    if (!graph.has(rule.questionId)) graph.set(rule.questionId, []);
    graph.get(rule.questionId).push(rule.targetQuestionId);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) || []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  for (const node of graph.keys()) {
    if (visit(node)) return true;
  }
  return false;
}

function validateAnswers(schema, answers) {
  const errors = [];
  const visibleQuestionIds = visibleQuestions(schema, answers).map((item) => item.id);
  for (const item of schema.questions) {
    if (!visibleQuestionIds.includes(item.id)) continue;
    const value = answers[item.id];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (item.required && empty) {
      errors.push(`${item.title} is required.`);
      continue;
    }
    if (empty) continue;
    if (item.type === 'file_upload') {
      const fileCheck = validateFileAnswer(item, value);
      if (!fileCheck.ok) errors.push(fileCheck.message);
      continue;
    }
    if (item.type === 'email' && !isEmail(String(value))) errors.push(`${item.title} must be a valid email.`);
    if (item.type === 'number' && Number.isNaN(Number(value))) errors.push(`${item.title} must be a number.`);
    if (item.type === 'phone' && !/^[0-9+\-() ]{7,20}$/.test(String(value))) errors.push(`${item.title} must be a valid phone number.`);
    if (item.type === 'url' && !cleanUrl(String(value))) errors.push(`${item.title} must be a valid URL.`);
    if (item.type === 'consent' && item.required && value !== true) errors.push(`${item.title} must be accepted.`);
    if (['single_choice', 'dropdown', 'yes_no'].includes(item.type) && item.settings.options && !item.settings.options.includes(String(value))) {
      errors.push(`${item.title} contains an unknown option.`);
    }
    if (item.type === 'multiple_choice' && Array.isArray(value)) {
      const unknown = value.some((choice) => !item.settings.options.includes(String(choice)));
      if (unknown) errors.push(`${item.title} contains an unknown option.`);
    }
  }
  return { ok: errors.length === 0, errors, message: errors[0] || '' };
}

function validateFileAnswer(questionItem, value) {
  const files = Array.isArray(value) ? value : [value];
  const allowed = new Set((questionItem.settings.allowedFileTypes || ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'csv', 'txt']).map((item) => String(item).toLowerCase().replace(/^\./, '')));
  const maxBytes = Math.max(1, Number(questionItem.settings.maxSizeMB || 5)) * 1024 * 1024;
  for (const file of files) {
    if (!file || typeof file !== 'object') return { ok: false, message: `${questionItem.title} must be a file upload.` };
    const name = cleanText(file.name || '', 240);
    const type = cleanText(file.type || '', 120).toLowerCase();
    const ext = cleanText(file.extension || path.extname(name).slice(1), 20).toLowerCase();
    const dataUrl = typeof file.dataUrl === 'string' ? file.dataUrl : '';
    const declaredSize = Number(file.size || 0);
    const actualBytes = dataUrl ? decodeDataUrlBuffer(dataUrl).length : declaredSize;

    if (!name || actualBytes <= 0) return { ok: false, message: `${questionItem.title} has invalid file metadata.` };
    if (actualBytes > maxBytes) return { ok: false, message: `${questionItem.title} exceeds ${questionItem.settings.maxSizeMB || 5} MB.` };

    if (dataUrl && Math.abs(actualBytes - declaredSize) > 1024) {
      return { ok: false, message: `${questionItem.title} has invalid file metadata.` };
    }

    if (allowed.size && !allowed.has(ext) && !allowed.has(type.split('/').pop())) {
      return { ok: false, message: `${questionItem.title} only allows ${[...allowed].join(', ')} files.` };
    }
    if (dataUrl && !dataUrl.startsWith('data:')) return { ok: false, message: `${questionItem.title} has invalid file data.` };
  }
  return { ok: true };
}

function visibleQuestions(schema, answers) {
  const questions = schema.questions || [];
  const visibleByShow = new Set();
  for (const questionItem of questions) {
    if (questionItem.type === 'hidden') continue;
    const showRules = (schema.logic || []).filter((rule) => rule.action === 'show_question' && rule.targetQuestionId === questionItem.id);
    if (!showRules.length || showRules.some((rule) => evaluateCondition(answers[rule.questionId], rule.operator, rule.value))) {
      visibleByShow.add(questionItem.id);
    }
  }
  const output = [];
  let index = 0;
  let guard = 0;
  while (index < questions.length && guard < questions.length * 2) {
    guard += 1;
    const questionItem = questions[index];
    if (!questionItem || !visibleByShow.has(questionItem.id)) {
      index += 1;
      continue;
    }
    output.push(questionItem);
    const skipRule = (schema.logic || []).find((rule) => (
      rule.action === 'skip_to_question'
      && rule.questionId === questionItem.id
      && evaluateCondition(answers[rule.questionId], rule.operator, rule.value)
    ));
    if (skipRule?.targetQuestionId) {
      const targetIndex = questions.findIndex((item) => item.id === skipRule.targetQuestionId);
      if (targetIndex > index) {
        index = targetIndex;
        continue;
      }
    }
    index += 1;
  }
  return output;
}

function evaluateCondition(actual, operator, expected) {
  const actualString = Array.isArray(actual) ? actual.join(', ') : String(actual ?? '');
  const expectedString = String(expected ?? '');
  switch (operator) {
    case 'equals':
      return actualString === expectedString;
    case 'does_not_equal':
      return actualString !== expectedString;
    case 'contains':
      return actualString.toLowerCase().includes(expectedString.toLowerCase());
    case 'does_not_contain':
      return !actualString.toLowerCase().includes(expectedString.toLowerCase());
    case 'greater_than':
      return Number(actual) > Number(expected);
    case 'less_than':
      return Number(actual) < Number(expected);
    case 'is_empty':
      return actualString.length === 0;
    case 'is_not_empty':
      return actualString.length > 0;
    case 'is_one_of':
      return String(expected).split(',').map((item) => item.trim()).includes(actualString);
    case 'is_not_one_of':
      return !String(expected).split(',').map((item) => item.trim()).includes(actualString);
    default:
      return false;
  }
}

function publicSurveyPayload(db, survey, language = '') {
  const workspace = db.workspaces.find((item) => item.id === survey.workspaceId);
  const version = db.surveyVersions.find((item) => item.id === survey.publishedVersionId);
  const plan = findBillingPlan(db, workspace?.planId || 'starter', { includeArchived: true }) || billingPlans(db)[0];
  const requestedLanguage = cleanText(language || '', 20).toLowerCase();
  const baseSchema = version ? version.schemaJson : survey.schema;
  const schema = applySurveyLanguage(baseSchema, requestedLanguage || survey.language);
  const completion = responseCompletion(survey, schema);
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    slug: survey.slug,
    type: survey.type,
    language: schema.language || requestedLanguage || survey.language,
    availableLanguages: Object.keys(baseSchema.translations || {}),
    schema,
    branding: {
      logoUrl: survey.branding.logoUrl || workspace?.logoUrl || '',
      brandColor: survey.branding.brandColor || workspace?.brandColor || '#176B5B',
      buttonColor: survey.branding.buttonColor || workspace?.buttonColor || '#B75D2A',
      background: survey.branding.background || '#F7F3EA',
      customCss: sanitizeCustomCss(survey.branding.customCss || workspace?.customCss || ''),
      footerText: cleanText(survey.branding.footerText || workspace?.customFooterText || '', 280),
      platformBrandingHidden: ['pro', 'agency', 'scale', 'enterprise'].includes(plan.id) && Boolean(workspace?.hidePlatformBranding || survey.branding?.hidePlatformBranding)
    },
    settings: {
      anonymousMode: survey.settings.anonymousMode,
      requireConsent: survey.settings.requireConsent,
      responseLimit: survey.settings.responseLimit,
      opensAt: survey.settings.opensAt,
      expiresAt: survey.settings.expiresAt,
      duplicatePrevention: survey.settings.duplicatePrevention,
      completionRedirectUrl: completion.redirectUrl
    }
  };
}

function publicSurveyAvailability(db, survey) {
  if (!survey || survey.status !== 'published') return { ok: false, status: 404, code: 'not_found', message: 'Survey is not available.' };
  if (db.workspaces.find((item) => item.id === survey.workspaceId)?.suspended) return { ok: false, status: 423, code: 'workspace_suspended', message: 'Survey collection is temporarily suspended.' };
  if (survey.settings.opensAt && new Date(survey.settings.opensAt).getTime() > Date.now()) {
    return { ok: false, status: 425, code: 'survey_not_open', message: 'This survey is scheduled but not open yet.' };
  }
  if (survey.settings.expiresAt && new Date(survey.settings.expiresAt).getTime() <= Date.now()) {
    return { ok: false, status: 410, code: 'survey_expired', message: 'This survey has expired.' };
  }
  const limit = Number(survey.settings.responseLimit || 0);
  if (limit > 0) {
    const completed = db.responses.filter((item) => item.surveyId === survey.id && item.status === 'completed').length;
    if (completed >= limit) return { ok: false, status: 409, code: 'response_limit_reached', message: 'This survey has reached its response limit.' };
  }
  return { ok: true };
}

function resolveInAppSurvey(db, body) {
  const workspaceId = cleanText(body?.workspaceId || '', 120);
  if (!workspaceId) return null;
  const eventName = cleanText(body?.eventName || body?.event || '', 120);
  const currentPath = cleanText(body?.path || body?.url || '', 240);
  const attributes = body?.attributes && typeof body.attributes === 'object' ? body.attributes : {};
  const candidates = db.surveys
    .filter((survey) => survey.workspaceId === workspaceId)
    .filter((survey) => survey.type === 'in_app_survey' || survey.settings.inAppTriggerEvent)
    .filter((survey) => publicSurveyAvailability(db, survey).ok)
    .filter((survey) => {
      const settings = survey.settings || {};
      if (settings.inAppTriggerEvent && settings.inAppTriggerEvent !== eventName) return false;
      if (settings.inAppTargetPath && !currentPath.includes(settings.inAppTargetPath)) return false;
      if (settings.inAppAudienceProperty) {
        const actual = attributes[settings.inAppAudienceProperty];
        if (String(actual ?? '') !== String(settings.inAppAudienceValue ?? '')) return false;
      }
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const survey = candidates[0];
  if (!survey) return null;
  return {
    id: survey.id,
    slug: survey.slug,
    title: survey.title,
    frequencyDays: Math.max(0, Number(survey.settings.inAppFrequencyDays || 0)),
    triggerEvent: survey.settings.inAppTriggerEvent || '',
    targetPath: survey.settings.inAppTargetPath || ''
  };
}

function inAppOriginAllowed(db, workspaceId, origin, requestUrl) {
  const sameOrigin = `${requestUrl.protocol}//${requestUrl.host}`;
  if (!origin || origin === sameOrigin) return true;
  return db.surveys.some((survey) => survey.workspaceId === workspaceId
    && publicSurveyAvailability(db, survey).ok
    && (survey.settings.inAppAllowedOrigins || []).includes(origin));
}

function publicCorsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-formspear-workspace, x-feedbackos-workspace',
    vary: 'Origin'
  };
}

function applySurveyLanguage(schema, language) {
  const translated = structuredClone(schema);
  const code = cleanText(language || '', 20).toLowerCase();
  const translation = code ? schema.translations?.[code] : null;
  if (!translation) {
    translated.language = code || '';
    return translated;
  }
  translated.completion = translated.completion || { type: 'message', message: 'Thank you for your response.' };
  translated.title = translation.title || translated.title;
  translated.description = translation.description || translated.description;
  if (translation.completionMessage) translated.completion.message = translation.completionMessage;
  translated.questions = translated.questions.map((questionItem) => {
    const q = translation.questions?.[questionItem.id];
    if (!q) return questionItem;
    const next = {
      ...questionItem,
      title: q.title || questionItem.title,
      description: q.description || questionItem.description,
      settings: { ...questionItem.settings }
    };
    if (q.placeholder) next.settings.placeholder = q.placeholder;
    if (q.consentText) next.settings.consentText = q.consentText;
    if (q.options?.length && Array.isArray(next.settings.options)) next.settings.options = q.options;
    return next;
  });
  translated.language = code;
  return translated;
}

function generateSurveyTranslation(schema, language) {
  const code = cleanText(language || 'es', 20).toLowerCase();
  const translation = {
    title: translateDraftText(schema.title || '', code),
    description: translateDraftText(schema.description || '', code),
    completionMessage: translateDraftText(schema.completion?.message || 'Thank you for your response.', code),
    questions: {}
  };
  for (const questionItem of schema.questions || []) {
    translation.questions[questionItem.id] = {
      title: translateDraftText(questionItem.title || '', code),
      description: translateDraftText(questionItem.description || '', code)
    };
    if (questionItem.settings?.placeholder) translation.questions[questionItem.id].placeholder = translateDraftText(questionItem.settings.placeholder, code);
    if (questionItem.settings?.consentText) translation.questions[questionItem.id].consentText = translateDraftText(questionItem.settings.consentText, code);
    if (Array.isArray(questionItem.settings?.options)) translation.questions[questionItem.id].options = questionItem.settings.options.map((option) => translateDraftText(option, code));
  }
  return translation;
}

function translateDraftText(text, language) {
  const source = cleanText(text || '', 1000);
  if (!source) return '';
  const dictionaries = {
    es: {
      customer: 'cliente',
      feedback: 'comentarios',
      survey: 'encuesta',
      help: 'ayudar',
      improve: 'mejorar',
      experience: 'experiencia',
      satisfied: 'satisfecho',
      service: 'servicio',
      likely: 'probable',
      recommend: 'recomendar',
      email: 'correo electronico',
      address: 'direccion',
      consent: 'consentimiento',
      agree: 'acepto',
      thank: 'gracias',
      you: 'usted'
    },
    hi: {
      customer: 'grahak',
      feedback: 'pratikriya',
      survey: 'sarvekshan',
      help: 'madad',
      improve: 'sudhar',
      experience: 'anubhav',
      satisfied: 'santusht',
      service: 'seva',
      likely: 'sambhav',
      recommend: 'sifarish',
      email: 'email',
      address: 'pata',
      consent: 'sahmati',
      agree: 'sahmat',
      thank: 'dhanyavad',
      you: 'aap'
    },
    fr: {
      customer: 'client',
      feedback: 'avis',
      survey: 'sondage',
      help: 'aider',
      improve: 'ameliorer',
      experience: 'experience',
      satisfied: 'satisfait',
      service: 'service',
      likely: 'probable',
      recommend: 'recommander',
      email: 'email',
      address: 'adresse',
      consent: 'consentement',
      agree: 'accepte',
      thank: 'merci',
      you: 'vous'
    }
  };
  const dictionary = dictionaries[language] || dictionaries[language.split('-')[0]] || {};
  let output = source;
  for (const [from, to] of Object.entries(dictionary)) {
    output = output.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
  }
  return output === source ? `[${language}] ${source}` : output;
}

function surveyPasswordAllowed(survey, password) {
  if (!survey.settings.passwordProtected) return true;
  const input = String(password || '');
  if (!input) return false;
  return Boolean(survey.settings.passwordHash && survey.settings.passwordHash === hashToken(input));
}

function publicResumeAllowed(response, resumeToken) {
  if (!response.resumeTokenHash) return true;
  if (!resumeToken || hashToken(resumeToken) !== response.resumeTokenHash) return false;
  if (response.resumeExpiresAt && new Date(response.resumeExpiresAt).getTime() < Date.now()) return false;
  return true;
}

function publicResumeLink(req, survey, response, resumeToken) {
  const host = req.headers.host || 'localhost:4173';
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const appUrl = (cleanUrl(process.env.APP_URL || '') || `${protocol}://${host}`).replace(/\/$/, '');
  const params = new URLSearchParams({
    resumeResponseId: response.id,
    resumeToken
  });
  return `${appUrl}/s/${encodeURIComponent(survey.slug)}?${params.toString()}`;
}

function responseCompletion(survey, schema, response = null) {
  const completion = structuredClone(schema.completion || survey.schema.completion || { type: 'message', message: 'Thank you for your response.' });
  const logicCompletion = response?.logicCompletionJson || null;
  if (logicCompletion?.message) completion.message = cleanText(logicCompletion.message, 300);
  if (logicCompletion?.type) completion.type = cleanText(logicCompletion.type, 40);
  const redirectUrl = cleanUrl(logicCompletion?.redirectUrl || survey.settings.completionRedirectUrl || completion.redirectUrl || '');
  return { ...completion, redirectUrl };
}

function findDuplicateResponse(db, survey, schema, answers, metadata, ignoreResponseId = '') {
  const mode = survey.settings.duplicatePrevention || 'allow_multiple';
  if (mode === 'allow_multiple') return null;
  const completed = db.responses.filter((item) => item.surveyId === survey.id && item.id !== ignoreResponseId && item.status === 'completed');
  const email = responseEmail(schema, answers);
  const userId = cleanText(metadata.userId || metadata.externalId || '', 160);
  const browserId = cleanText(metadata.browserId || '', 160);
  const ipHash = metadata.ipHash || '';
  for (const response of completed) {
    if (mode === 'one_per_email' && email && responseEmail(schema, response.answersJson) === email) {
      return { response, message: 'A response from this email has already been submitted.' };
    }
    if (mode === 'one_per_user_id' && userId && [response.metadataJson?.userId, response.metadataJson?.externalId].includes(userId)) {
      return { response, message: 'A response from this user ID has already been submitted.' };
    }
    if (mode === 'one_per_browser' && browserId && response.metadataJson?.browserId === browserId) {
      return { response, message: 'A response from this browser has already been submitted.' };
    }
    if (mode === 'one_per_ip_hash' && ipHash && response.metadataJson?.ipHash === ipHash) {
      return { response, message: 'A response from this IP hash has already been submitted.' };
    }
  }
  return null;
}

function responseEmail(schema, answers) {
  const questionItem = schema.questions.find((q) => q.type === 'email');
  return questionItem ? cleanEmail(answers[questionItem.id], true) : '';
}

function queueRetentionJob(db, workspaceId, payload = {}) {
  const job = {
    id: makeId('job'),
    workspaceId,
    type: 'retention_sweep',
    status: 'queued',
    attempts: 0,
    maxAttempts: JOB_MAX_ATTEMPTS,
    payloadJson: payload,
    lastError: '',
    nextRunAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
  db.jobs.push(job);
  return job;
}

function buildWorkspaceExport(db, workspaceId) {
  const surveyIds = db.surveys.filter((item) => item.workspaceId === workspaceId).map((item) => item.id);
  const webhookIds = db.webhooks.filter((item) => item.workspaceId === workspaceId).map((item) => item.id);
  return {
    exportedAt: new Date().toISOString(),
    workspace: db.workspaces.find((item) => item.id === workspaceId),
    members: db.workspaceMembers.filter((item) => item.workspaceId === workspaceId),
    surveys: db.surveys.filter((item) => item.workspaceId === workspaceId),
    surveyVersions: db.surveyVersions.filter((item) => surveyIds.includes(item.surveyId)),
    responses: db.responses.filter((item) => item.workspaceId === workspaceId && item.status !== 'deleted'),
    respondents: db.respondents.filter((item) => item.workspaceId === workspaceId),
    contacts: db.contacts.filter((item) => item.workspaceId === workspaceId),
    alerts: db.alerts.filter((item) => item.workspaceId === workspaceId),
    integrations: db.integrations.filter((item) => item.workspaceId === workspaceId).map((item) => ({ ...item, configEncrypted: '[encrypted]' })),
    integrationLogs: db.integrationLogs.filter((item) => item.workspaceId === workspaceId),
    webhooks: db.webhooks.filter((item) => item.workspaceId === workspaceId).map(publicWebhook),
    webhookLogs: db.webhookLogs.filter((item) => webhookIds.includes(item.webhookId)),
    fileUploads: db.fileUploads.filter((item) => item.workspaceId === workspaceId).map((item) => ({ ...item, dataUrl: item.dataUrl ? '[stored]' : '' })),
    emailCampaigns: db.emailCampaigns.filter((item) => item.workspaceId === workspaceId),
    monthlyReports: db.monthlyReports.filter((item) => item.workspaceId === workspaceId),
    invoices: db.invoices.filter((item) => item.workspaceId === workspaceId),
    usageMeters: db.usageMeters.filter((item) => item.workspaceId === workspaceId),
    auditLogs: db.auditLogs.filter((item) => item.workspaceId === workspaceId)
  };
}

function handlePrivacyDeletion(db, workspaceId, body, userId) {
  const email = cleanEmail(body.email, true);
  const mode = body.mode === 'delete' ? 'delete' : 'anonymize';
  const respondentIds = new Set();
  for (const respondent of db.respondents.filter((item) => item.workspaceId === workspaceId)) {
    if ((email && respondent.email === email) || (body.respondentId && respondent.id === body.respondentId)) respondentIds.add(respondent.id);
  }
  for (const contact of db.contacts.filter((item) => item.workspaceId === workspaceId)) {
    if (email && contact.email === email) {
      const respondent = db.respondents.find((item) => item.workspaceId === workspaceId && item.email === email);
      if (respondent) respondentIds.add(respondent.id);
    }
  }
  let responsesAffected = 0;
  for (const response of db.responses.filter((item) => item.workspaceId === workspaceId)) {
    if (respondentIds.has(response.respondentId) || (email && answersToText(response.answersJson).toLowerCase().includes(email))) {
      responsesAffected += 1;
      eraseResponse(db, response, mode, userId);
      if (mode !== 'delete') response.tagsJson = uniqueTags([...(response.tagsJson || []), 'privacy-request']);
    }
  }
  const beforeContacts = db.contacts.length;
  const beforeRespondents = db.respondents.length;
  db.contacts = db.contacts.filter((item) => !(item.workspaceId === workspaceId && email && item.email === email));
  db.respondents = db.respondents.filter((item) => !(item.workspaceId === workspaceId && respondentIds.has(item.id)));
  return {
    mode,
    responsesAffected,
    contactsRemoved: beforeContacts - db.contacts.length,
    respondentsRemoved: beforeRespondents - db.respondents.length
  };
}

function redactPersonalAnswers(db, response) {
  const survey = db.surveys.find((item) => item.id === response.surveyId);
  if (!survey) return;
  const questionIds = survey.schema.questions
    .filter((questionItem) => ['email', 'phone'].includes(questionItem.type) || /name|email|phone|contact/i.test(questionItem.title))
    .map((questionItem) => questionItem.id);
  for (const id of questionIds) {
    if (response.answersJson[id] !== undefined) response.answersJson[id] = '[redacted]';
  }
}

function eraseResponse(db, response, mode = 'anonymize', userId = 'system') {
  const now = new Date().toISOString();
  if (mode === 'delete') {
    response.status = 'deleted';
    response.deletedAt = now;
    response.answersJson = {};
    response.internalNotes = [];
  } else {
    redactPersonalAnswers(db, response);
    updateResponseRecord(response, { anonymize: true }, userId);
  }
  response.respondentId = null;
  response.resumeTokenHash = '';
  response.resumeExpiresAt = '';
  response.metadataJson = { anonymizedAt: now };
  response.updatedAt = now;
  for (const upload of db.fileUploads.filter((item) => item.responseId === response.id)) {
    queueObjectDeletion(db, upload, now);
    upload.lifecycleStatus = 'deleted';
    upload.deletedAt = now;
    upload.dataUrl = '';
    upload.storageUrl = '';
  }
  for (const job of db.jobs.filter((item) => item.type !== 'object_delete' && JSON.stringify(item.payloadJson || {}).includes(response.id))) {
    const webhookLog = job.payloadJson?.webhookLogId ? db.webhookLogs.find((item) => item.id === job.payloadJson.webhookLogId) : null;
    if (webhookLog) {
      webhookLog.responseStatus = 'erased';
      webhookLog.error = '';
    }
    job.status = ['completed', 'failed'].includes(job.status) ? job.status : 'cancelled';
    job.payloadJson = { erasedResponseId: response.id };
    job.updatedAt = now;
  }
  for (const log of db.integrationLogs.filter((item) => item.payloadJson?.responseId === response.id)) log.payloadJson = { erased: true };
  for (const job of db.aiJobs.filter((item) => item.responseId === response.id)) {
    job.inputJson = {};
    job.outputJson = {};
  }
  return response;
}

function queueObjectDeletion(db, upload, now = new Date().toISOString()) {
  if (upload.storageProvider !== 's3_compatible' || !upload.storageKey) return;
  if (db.jobs.some((item) => item.type === 'object_delete' && item.payloadJson?.uploadId === upload.id && !['failed', 'completed'].includes(item.status))) return;
  db.jobs.push({
    id: makeId('job'), workspaceId: upload.workspaceId, type: 'object_delete', status: 'queued', attempts: 0,
    maxAttempts: JOB_MAX_ATTEMPTS, nextRunAt: now,
    payloadJson: { uploadId: upload.id, bucket: upload.storageBucket, key: upload.storageKey },
    lastError: '', createdAt: now, updatedAt: now, completedAt: null
  });
}

function filterResponses(responses, url, survey, options = {}) {
  const params = url.searchParams;
  let items = [...responses];
  const from = params.get('from') ? Date.parse(params.get('from')) : null;
  const to = params.get('to') ? Date.parse(params.get('to')) : null;
  const status = cleanText(params.get('status') || '', 40);
  const sentiment = cleanText(params.get('sentiment') || '', 40);
  const source = cleanText(params.get('source') || '', 80).toLowerCase();
  const tag = cleanText(params.get('tag') || '', 80).toLowerCase();
  const query = cleanText(params.get('q') || '', 160).toLowerCase();
  const questionId = cleanText(params.get('questionId') || '', 80);
  const answer = cleanText(params.get('answer') || '', 500).toLowerCase();
  if (from) items = items.filter((item) => responseTime(item) >= from);
  if (to) items = items.filter((item) => responseTime(item) <= to + 24 * 60 * 60 * 1000 - 1);
  if (status) {
    items = items.filter((item) => item.status === status);
  } else if (!options.includeOverLimit) {
    items = items.filter((item) => item.status !== 'over_limit');
  }
  if (sentiment) items = items.filter((item) => item.sentiment === sentiment);
  if (source) items = items.filter((item) => String(item.metadataJson?.source || '').toLowerCase() === source);
  if (tag) items = items.filter((item) => (item.tagsJson || []).some((value) => String(value).toLowerCase() === tag));
  if (questionId && answer) {
    items = items.filter((item) => formatAnswerText(item.answersJson?.[questionId]).toLowerCase().includes(answer));
  }
  if (query) {
    items = items.filter((item) => {
      const answerText = answersToText(item.answersJson).toLowerCase();
      const metaText = [item.metadataJson?.source, item.metadataJson?.browser, item.metadataJson?.os, item.metadataJson?.language].join(' ').toLowerCase();
      const surveyText = survey ? survey.schema.questions.map((q) => q.title).join(' ').toLowerCase() : '';
      return answerText.includes(query) || metaText.includes(query) || surveyText.includes(query) || (item.tagsJson || []).join(' ').toLowerCase().includes(query);
    });
  }
  const sort = cleanText(params.get('sort') || 'submitted_desc', 40);
  items.sort((a, b) => {
    if (sort === 'submitted_asc') return responseTime(a) - responseTime(b);
    if (sort === 'lead_desc') return (b.leadScore || 0) - (a.leadScore || 0);
    if (sort === 'lead_asc') return (a.leadScore || 0) - (b.leadScore || 0);
    return responseTime(b) - responseTime(a);
  });
  const total = items.length;
  const offset = Math.max(0, Number(params.get('offset') || 0));
  const limit = options.noPagination ? total : Math.max(1, Math.min(500, Number(params.get('limit') || 100)));
  if (!options.noPagination) items = items.slice(offset, offset + limit);
  return { responses: items, total, offset: options.noPagination ? 0 : offset, limit };
}

function responseTime(response) {
  return new Date(response.submittedAt || response.createdAt || 0).getTime();
}

function buildAnalyticsComparison(current, previous) {
  return {
    current: current.totals,
    previous: previous.totals,
    deltaCompletions: current.totals.completions - previous.totals.completions,
    deltaCompletionRate: Number(current.totals.completionRate) - Number(previous.totals.completionRate),
    deltaLeadScoreAverage: Number(current.leadScoreAverage || 0) - Number(previous.leadScoreAverage || 0),
    previousSentiment: previous.sentiment
  };
}

function buildWorkspaceBenchmark(db, workspaceId, url) {
  const surveys = db.surveys
    .filter((survey) => survey.workspaceId === workspaceId && survey.status !== 'archived')
    .sort((a, b) => a.title.localeCompare(b.title));
  const benchmarks = surveys.map((survey) => {
    const responses = filterResponses(db.responses.filter((item) => item.surveyId === survey.id && item.status !== 'deleted'), url, survey, { noPagination: true }).responses;
    const analytics = buildAnalytics(survey, responses);
    const npsStat = analytics.questionStats.find((stat) => stat.nps !== undefined);
    return {
      surveyId: survey.id,
      title: survey.title,
      status: survey.status,
      type: survey.type,
      views: analytics.totals.views,
      starts: analytics.totals.starts,
      completions: analytics.totals.completions,
      completionRate: analytics.totals.completionRate,
      dropOffRate: analytics.totals.dropOffRate,
      leadScoreAverage: analytics.leadScoreAverage,
      negativeResponses: analytics.sentiment.negative || 0,
      nps: npsStat ? npsStat.nps : null
    };
  }).sort((a, b) => b.completions - a.completions || b.completionRate - a.completionRate);
  const allResponses = filterResponses(db.responses.filter((item) => item.workspaceId === workspaceId && item.status !== 'deleted'), url, null, { noPagination: true }).responses;
  const completed = allResponses.filter((item) => item.status === 'completed');
  return {
    benchmarks,
    sources: objectEntriesSorted(countBy(completed.map((response) => response.metadataJson?.source || 'direct'))),
    branches: objectEntriesSorted(countBy(completed.map((response) => responseDimensionValue(response, db.surveys.find((survey) => survey.id === response.surveyId), 'branch') || 'unknown'))),
    locations: objectEntriesSorted(countBy(completed.map((response) => responseDimensionValue(response, db.surveys.find((survey) => survey.id === response.surveyId), 'location') || 'unknown'))),
    leaders: {
      responseVolume: benchmarks[0] || null,
      completionRate: [...benchmarks].sort((a, b) => b.completionRate - a.completionRate)[0] || null,
      leadScore: [...benchmarks].sort((a, b) => b.leadScoreAverage - a.leadScoreAverage)[0] || null
    }
  };
}

function defaultAgencyWorkspaceId(db, user) {
  const visible = visibleWorkspaces(db, user);
  const agency = visible.find((workspace) => workspacePlanId(db, workspace) === 'agency');
  return (agency || visible[0] || {}).id || '';
}

function buildAgencyOverview(db, user, agencyWorkspaceId) {
  const visible = visibleWorkspaces(db, user)
    .filter((workspace) => roleAtLeast(workspace.role, 'viewer'));
  const clients = visible
    .map((workspace) => buildAgencyClientSummary(db, workspace))
    .sort((a, b) => b.responses - a.responses || a.name.localeCompare(b.name));
  const agencyWorkspace = visible.find((workspace) => workspace.id === agencyWorkspaceId) || visible[0] || null;
  const totals = clients.reduce((summary, client) => {
    summary.clientWorkspaces += 1;
    summary.surveys += client.surveys;
    summary.publishedSurveys += client.publishedSurveys;
    summary.responses += client.responses;
    summary.responsesThisMonth += client.responsesThisMonth;
    summary.contacts += client.contacts;
    summary.openAlerts += client.openAlerts;
    summary.monthlyReports += client.monthlyReports;
    summary.teamMembers += client.teamMembers;
    summary.aiCreditsUsed += client.aiCreditsUsed;
    summary.storageUsed += client.storageUsed;
    summary.mrr += client.mrr;
    if (client.subscriptionStatus === 'active') summary.activeSubscriptions += 1;
    return summary;
  }, {
    clientWorkspaces: 0,
    surveys: 0,
    publishedSurveys: 0,
    responses: 0,
    responsesThisMonth: 0,
    contacts: 0,
    openAlerts: 0,
    monthlyReports: 0,
    teamMembers: 0,
    aiCreditsUsed: 0,
    storageUsed: 0,
    activeSubscriptions: 0,
    mrr: 0
  });
  return {
    generatedAt: new Date().toISOString(),
    agencyWorkspace: agencyWorkspace ? buildAgencyWorkspaceProfile(db, agencyWorkspace) : null,
    totals,
    planDistribution: objectEntriesSorted(countBy(clients.map((client) => client.planId || 'starter'))),
    clients
  };
}

function buildAgencyWorkspaceProfile(db, workspace) {
  const planId = workspacePlanId(db, workspace);
  const plan = findBillingPlan(db, planId, { includeArchived: true }) || billingPlans(db)[0];
  return {
    id: workspace.id,
    name: workspace.name,
    planId,
    planName: plan.name,
    role: workspace.role || 'viewer',
    customDomain: workspace.customDomain || '',
    customDomainStatus: workspace.customDomainStatus || 'not_configured'
  };
}

function buildAgencyClientSummary(db, workspace) {
  const planId = workspacePlanId(db, workspace);
  const plan = findBillingPlan(db, planId, { includeArchived: true }) || billingPlans(db)[0];
  const subscription = workspace.subscription || db.subscriptions.find((item) => item.workspaceId === workspace.id) || createSubscription(workspace.id, planId);
  const usage = workspace.usage || db.usageMeters.find((item) => item.workspaceId === workspace.id && item.period === new Date().toISOString().slice(0, 7)) || createUsageMeter(workspace.id);
  const surveys = db.surveys.filter((survey) => survey.workspaceId === workspace.id && survey.status !== 'archived');
  const responses = db.responses.filter((response) => response.workspaceId === workspace.id && response.status !== 'deleted');
  const completed = responses.filter((response) => response.status === 'completed');
  const monthKey = new Date().toISOString().slice(0, 7);
  const completedThisMonth = completed.filter((response) => String(response.submittedAt || response.createdAt || '').startsWith(monthKey));
  const responseTimes = completed.map(responseTime).filter((value) => Number.isFinite(value) && value > 0);
  const lastResponseAt = responseTimes.length ? new Date(Math.max(...responseTimes)).toISOString() : '';
  const openNotifications = db.notifications.filter((item) => item.workspaceId === workspace.id && !item.read).length;
  const failedJobs = db.jobs.filter((job) => job.workspaceId === workspace.id && (job.status === 'failed' || job.lastError)).length;
  return {
    workspaceId: workspace.id,
    name: workspace.name,
    role: workspace.role || 'viewer',
    industry: workspace.industry || '',
    planId,
    planName: plan.name,
    subscriptionStatus: subscription.status || 'active',
    mrr: subscription.status === 'active' ? plan.priceMonthlyInr : 0,
    customDomain: workspace.customDomain || '',
    customDomainStatus: workspace.customDomainStatus || 'not_configured',
    surveys: surveys.length,
    publishedSurveys: surveys.filter((survey) => survey.status === 'published').length,
    responses: completed.length,
    totalResponses: responses.length,
    responsesThisMonth: completedThisMonth.length,
    contacts: db.contacts.filter((contact) => contact.workspaceId === workspace.id).length,
    openAlerts: openNotifications,
    activeAlertRules: db.alerts.filter((alert) => alert.workspaceId === workspace.id && alert.active).length,
    monthlyReports: db.monthlyReports.filter((report) => report.workspaceId === workspace.id).length,
    aiCreditsUsed: Number(usage.aiCreditsUsed || 0),
    storageUsed: Number(usage.storageUsed || 0),
    teamMembers: db.workspaceMembers.filter((member) => member.workspaceId === workspace.id).length,
    lastResponseAt,
    health: agencyClientHealth(workspace, openNotifications, failedJobs, lastResponseAt)
  };
}

function agencyClientHealth(workspace, openNotifications, failedJobs, lastResponseAt) {
  if (workspace.suspended) return 'suspended';
  if (failedJobs || openNotifications) return 'needs_attention';
  if (lastResponseAt) return 'active';
  return 'quiet';
}

function buildAnalytics(survey, responses) {
  const completed = responses.filter((item) => item.status === 'completed');
  const completionRate = survey.metrics.views ? Math.round((survey.metrics.completions / survey.metrics.views) * 100) : 0;
  const byDate = {};
  const bySource = {};
  const byDevice = {};
  const byBranch = {};
  const byLocation = {};
  for (const response of completed) {
    const date = (response.submittedAt || response.createdAt).slice(0, 10);
    byDate[date] = (byDate[date] || 0) + 1;
    const source = response.metadataJson.source || 'direct';
    bySource[source] = (bySource[source] || 0) + 1;
    const device = response.metadataJson.deviceType || 'unknown';
    byDevice[device] = (byDevice[device] || 0) + 1;
    const branch = responseDimensionValue(response, survey, 'branch') || 'unknown';
    byBranch[branch] = (byBranch[branch] || 0) + 1;
    const location = responseDimensionValue(response, survey, 'location') || 'unknown';
    byLocation[location] = (byLocation[location] || 0) + 1;
  }
  const questionStats = survey.schema.questions.map((q) => buildQuestionStat(q, completed));
  const funnel = buildFunnelAnalytics(survey, responses, completed);
  const channelConversion = buildChannelConversion(survey, responses);
  const questionDropOff = buildQuestionDropOff(survey, responses);
  return {
    totals: {
      views: survey.metrics.views,
      starts: survey.metrics.starts,
      completions: completed.length,
      completionRate,
      dropOffRate: Math.max(0, 100 - completionRate),
      averageCompletionSeconds: average(completed.map((item) => secondsBetween(item.startedAt, item.submittedAt))).toFixed(0)
    },
    byDate: objectEntriesSorted(byDate),
    bySource: objectEntriesSorted(bySource),
    byDevice: objectEntriesSorted(byDevice),
    byBranch: objectEntriesSorted(byBranch),
    byLocation: objectEntriesSorted(byLocation),
    questionStats,
    funnel,
    channelConversion,
    questionDropOff,
    sentiment: countBy(completed.map((item) => item.sentiment || 'neutral')),
    leadScoreAverage: Math.round(average(completed.map((item) => item.leadScore || 0)))
  };
}

function buildFunnelAnalytics(survey, responses, completed) {
  const views = Math.max(0, Number(survey.metrics.views || 0));
  const starts = Math.max(Number(survey.metrics.starts || 0), responses.filter((response) => ['started', 'partial', 'completed'].includes(response.status)).length);
  const completions = completed.length;
  return {
    steps: [
      { id: 'views', label: 'Views', count: views, rateFromPrevious: 100, conversionFromView: 100 },
      { id: 'starts', label: 'Starts', count: starts, rateFromPrevious: percent(starts, views), conversionFromView: percent(starts, views) },
      { id: 'completions', label: 'Completions', count: completions, rateFromPrevious: percent(completions, starts), conversionFromView: percent(completions, views) }
    ],
    viewToStartRate: percent(starts, views),
    startToCompletionRate: percent(completions, starts),
    viewToCompletionRate: percent(completions, views),
    abandonedAfterView: Math.max(0, views - starts),
    abandonedAfterStart: Math.max(0, starts - completions)
  };
}

function buildChannelConversion(survey, responses) {
  const sourceCounts = {};
  const completedCounts = {};
  for (const response of responses) {
    const source = cleanText(response.metadataJson?.source || 'direct', 120) || 'direct';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    if (response.status === 'completed') completedCounts[source] = (completedCounts[source] || 0) + 1;
  }
  return Object.keys(sourceCounts)
    .sort((a, b) => (completedCounts[b] || 0) - (completedCounts[a] || 0) || a.localeCompare(b))
    .map((source) => ({
      label: source,
      starts: sourceCounts[source],
      completions: completedCounts[source] || 0,
      conversionRate: percent(completedCounts[source] || 0, sourceCounts[source])
    }));
}

function buildQuestionDropOff(survey, responses) {
  const questions = (survey.schema.questions || []).filter((question) => !['hidden', 'section', 'statement'].includes(question.type));
  return questions.map((question, index) => {
    const previous = index > 0 ? questions[index - 1] : null;
    const reached = responses.filter((response) => responseReachedQuestion(response, question)).length;
    const answered = responses.filter((response) => responseAnsweredQuestion(response, question)).length;
    const completedAfterReach = responses.filter((response) => response.status === 'completed' && responseReachedQuestion(response, question)).length;
    const previousReached = previous ? responses.filter((response) => responseReachedQuestion(response, previous)).length : Math.max(Number(survey.metrics.starts || 0), responses.length);
    return {
      id: question.id,
      title: question.title,
      type: question.type,
      order: index,
      reached,
      answered,
      completedAfterReach,
      dropOffFromPrevious: Math.max(0, previousReached - reached),
      dropOffRateFromPrevious: percent(Math.max(0, previousReached - reached), previousReached),
      unansweredAfterReach: Math.max(0, reached - answered),
      answerRate: percent(answered, reached)
    };
  });
}

function responseReachedQuestion(response, question) {
  const path = Array.isArray(response.metadataJson?.pathTaken) ? response.metadataJson.pathTaken : [];
  return path.includes(question.id) || responseAnsweredQuestion(response, question);
}

function responseAnsweredQuestion(response, question) {
  const value = response.answersJson?.[question.id];
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
}

function percent(numerator, denominator) {
  const base = Number(denominator || 0);
  if (base <= 0) return 0;
  return Math.min(100, Math.round((Number(numerator || 0) / base) * 100));
}

function responseDimensionValue(response, survey, dimension) {
  const metadata = response.metadataJson || {};
  const metadataKeys = dimension === 'branch'
    ? ['branch', 'branchId', 'branch_id', 'clinicBranch', 'officeBranch']
    : ['location', 'locationId', 'location_id', 'city', 'region', 'site'];
  for (const key of metadataKeys) {
    const value = cleanText(metadata[key] || '', 120);
    if (value) return value;
  }
  const questions = survey?.schema?.questions || [];
  const pattern = dimension === 'branch' ? /branch|office|clinic/i : /location|city|region|site/i;
  const question = questions.find((item) => pattern.test(item.id || '') || pattern.test(item.title || ''));
  const answer = question ? cleanText(formatAnswerText(response.answersJson?.[question.id]), 120) : '';
  return answer;
}

function buildQuestionStat(q, responses) {
  const values = responses.map((response) => response.answersJson[q.id]).filter((value) => value !== undefined && value !== '' && value !== null);
  if (['single_choice', 'dropdown', 'yes_no'].includes(q.type)) {
    return { id: q.id, title: q.title, type: q.type, count: values.length, distribution: countBy(values.map(String)) };
  }
  if (q.type === 'multiple_choice') {
    return { id: q.id, title: q.title, type: q.type, count: values.length, distribution: countBy(values.flat().map(String)) };
  }
  if (['rating', 'csat', 'ces', 'star_rating', 'emoji_rating'].includes(q.type)) {
    return { id: q.id, title: q.title, type: q.type, count: values.length, average: Number(average(values.map(Number)).toFixed(2)) };
  }
  if (q.type === 'nps') {
    const nums = values.map(Number);
    const promoters = nums.filter((value) => value >= 9).length;
    const detractors = nums.filter((value) => value <= 6).length;
    const nps = nums.length ? Math.round(((promoters / nums.length) - (detractors / nums.length)) * 100) : 0;
    return { id: q.id, title: q.title, type: q.type, count: nums.length, nps, promoters, detractors, passives: nums.length - promoters - detractors };
  }
  return { id: q.id, title: q.title, type: q.type, count: values.length, keywords: topKeywords(values.map(formatAnswerText).join(' '), 8) };
}

function selectResponsesForAi(responses = [], limit = 60) {
  const withText = responses.filter((r) => answersToText(r.answersJson).trim().length > 0);
  const byRecent = [...withText].sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0));
  const maxNegatives = Math.floor(limit * 0.4);
  const negatives = byRecent.filter((r) => r.sentiment === 'negative' || r.sentiment === 'mixed').slice(0, maxNegatives);
  const takenIds = new Set(negatives.map((r) => r.id));
  const maxHighIntent = Math.floor(limit * 0.2);
  const highIntent = byRecent.filter((r) => Number(r.leadScore) >= 80 && !takenIds.has(r.id)).slice(0, maxHighIntent);
  for (const r of highIntent) takenIds.add(r.id);
  const restLimit = Math.max(0, limit - negatives.length - highIntent.length);
  const rest = byRecent.filter((r) => !takenIds.has(r.id)).slice(0, restLimit);
  return {
    selected: [...negatives, ...highIntent, ...rest],
    total: responses.length
  };
}

function buildAiSummary(survey, responses) {
  const allText = [];
  const urgent = [];
  const sentiment = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  for (const response of responses) {
    sentiment[response.sentiment || 'neutral'] = (sentiment[response.sentiment || 'neutral'] || 0) + 1;
    const text = answersToText(response.answersJson);
    allText.push(text);
    if ((response.sentiment === 'negative' || response.leadScore >= 80) && urgent.length < 5) {
      urgent.push({ responseId: response.id, sentiment: response.sentiment, leadScore: response.leadScore, excerpt: cleanText(text, 180) });
    }
  }
  const keywords = topKeywords(allText.join(' '), 12);
  const themeEvidence = buildThemeEvidence(keywords, responses);
  const intent = buildIntentSummary(responses);
  const complaintClusters = buildComplaintClusters(responses);
  const responseClusters = buildResponseClusters(responses, keywords);
  const negativeShare = responses.length ? sentiment.negative / responses.length : 0;
  const positiveShare = responses.length ? sentiment.positive / responses.length : 0;
  return {
    aiGenerated: false,
    coverage: {
      analyzed: responses.length,
      total: responses.length,
      strategy: 'all_responses_keyword'
    },
    method: 'local heuristic summary',
    generatedAt: new Date().toISOString(),
    headline: responses.length
      ? `${survey.title} collected ${responses.length} completed responses with ${sentiment.positive} positive and ${sentiment.negative} negative signals.`
      : 'No completed responses yet. Publish and share the survey to generate insights.',
    keyThemes: keywords.map((item) => item.label),
    themeEvidence,
    positiveThemes: positiveShare >= 0.35 ? ['Customers are reporting usable positive sentiment.', ...keywords.slice(0, 3).map((item) => item.label)] : keywords.slice(0, 3).map((item) => item.label),
    negativeThemes: negativeShare >= 0.2 ? ['Investigate negative comments quickly.', ...keywords.slice(3, 7).map((item) => item.label)] : keywords.slice(3, 6).map((item) => item.label),
    urgentResponses: urgent,
    recommendedActions: recommendActions(sentiment, keywords, responses),
    intentSummary: intent.summary,
    intentClassifications: intent.classifications,
    responseClusters,
    complaintClusters,
    sentiment,
    leadQualitySummary: summarizeLeadQuality(responses)
  };
}

function buildThemeEvidence(keywords, responses) {
  return keywords.slice(0, 8).map((keyword) => {
    const label = cleanText(keyword.label || '', 80).toLowerCase();
    const evidence = responses
      .filter((response) => label && answersToText(response.answersJson).toLowerCase().includes(label))
      .slice(0, 3)
      .map((response) => ({
        responseId: response.id,
        excerpt: evidenceExcerpt(answersToText(response.answersJson), label),
        sentiment: response.sentiment || 'neutral',
        leadScore: Number(response.leadScore || 0)
      }));
    return { theme: keyword.label, responseCount: evidence.length, evidence };
  }).filter((item) => item.evidence.length);
}

function evidenceExcerpt(text, term) {
  const cleaned = cleanText(text, 1000);
  const index = cleaned.toLowerCase().indexOf(String(term || '').toLowerCase());
  if (index < 0) return cleanText(cleaned, 220);
  const start = Math.max(0, index - 80);
  const end = Math.min(cleaned.length, index + String(term).length + 120);
  return `${start ? '…' : ''}${cleaned.slice(start, end)}${end < cleaned.length ? '…' : ''}`;
}

async function buildAiSummaryWithProvider(db, survey, responses, workspace) {
  const fallback = buildAiSummary(survey, responses);
  const sample = selectResponsesForAi(responses, AI_PROVIDER_RESPONSE_LIMIT);
  const selected = sample.selected;
  const provider = await requestAiProviderJson(db, 'survey_summary', {
    survey: {
      id: survey.id,
      title: survey.title,
      type: survey.type,
      questionTitles: (survey.schema.questions || []).map((questionItem) => questionItem.title).slice(0, 30)
    },
    responseCount: responses.length,
    responses: selected.map((response) => ({
      id: response.id,
      sentiment: response.sentiment,
      leadScore: response.leadScore,
      text: cleanText(answersToText(response.answersJson), 500),
      tags: response.tagsJson || []
    }))
  }, 'Return JSON with headline, keyThemes, positiveThemes, negativeThemes, recommendedActions, optional themeEvidence, urgentResponses, intentSummary, intentClassifications, responseClusters, and complaintClusters. Every themeEvidence item must contain a theme and evidence items with responseId values copied exactly from the provided responses. Do not include data outside the provided survey responses.', workspace);
  if (!provider) return fallback;
  const data = provider.data || {};
  return {
    ...fallback,
    aiGenerated: true,
    coverage: {
      analyzed: selected.length,
      total: responses.length,
      strategy: 'stratified_recent_sample'
    },
    method: 'openai-compatible provider',
    provider: provider.provider,
    providerModel: provider.model,
    providerUsage: provider.usage,
    headline: cleanText(data.headline || fallback.headline, 500),
    keyThemes: normalizeStringArray(data.keyThemes, fallback.keyThemes, 12),
    themeEvidence: normalizeThemeEvidence(data.themeEvidence, fallback.themeEvidence, responses),
    positiveThemes: normalizeStringArray(data.positiveThemes, fallback.positiveThemes, 8),
    negativeThemes: normalizeStringArray(data.negativeThemes, fallback.negativeThemes, 8),
    recommendedActions: normalizeStringArray(data.recommendedActions, fallback.recommendedActions, 8),
    intentSummary: normalizeIntentSummary(data.intentSummary, fallback.intentSummary),
    intentClassifications: normalizeIntentClassifications(data.intentClassifications, fallback.intentClassifications),
    responseClusters: normalizeClusterItems(data.responseClusters, fallback.responseClusters, 8),
    complaintClusters: normalizeClusterItems(data.complaintClusters, fallback.complaintClusters, 8),
    urgentResponses: Array.isArray(data.urgentResponses) && data.urgentResponses.length
      ? data.urgentResponses.slice(0, 5).map((item) => ({
        responseId: cleanText(item.responseId || '', 120),
        sentiment: cleanText(item.sentiment || 'neutral', 40),
        leadScore: Number.isFinite(Number(item.leadScore)) ? Number(item.leadScore) : 0,
        excerpt: cleanText(item.excerpt || '', 180)
      }))
      : fallback.urgentResponses
  };
}

function normalizeThemeEvidence(value, fallback, responses) {
  if (!Array.isArray(value) || !value.length) return fallback || [];
  const byId = new Map(responses.map((response) => [response.id, response]));
  return value.slice(0, 8).map((item) => {
    const evidence = (Array.isArray(item?.evidence) ? item.evidence : [])
      .map((entry) => {
        const response = byId.get(cleanText(entry?.responseId || '', 120));
        if (!response) return null;
        return {
          responseId: response.id,
          excerpt: cleanText(entry.excerpt || answersToText(response.answersJson), 220),
          sentiment: response.sentiment || 'neutral',
          leadScore: Number(response.leadScore || 0)
        };
      })
      .filter(Boolean)
      .slice(0, 3);
    return { theme: cleanText(item?.theme || '', 80), responseCount: evidence.length, evidence };
  }).filter((item) => item.theme && item.evidence.length);
}

async function generateSurveySchemaWithProvider(db, input = {}, workspace) {
  const fallback = generateSurveySchemaFromPrompt(input);
  const provider = await requestAiProviderJson(db, 'survey_generation', {
    goal: cleanText(input.goal || input.title || 'Collect feedback', 200),
    audience: cleanText(input.audience || 'customers', 120),
    industry: cleanText(input.industry || 'service business', 120),
    desiredQuestionCount: Math.max(3, Math.min(12, Number(input.questionCount || input.desiredQuestionCount || 5))),
    tone: cleanText(input.tone || 'clear and professional', 120),
    surveyType: cleanText(input.type || input.surveyType || 'feedback_form', 80)
  }, 'Return JSON for a survey schema with title, description, type, questions, logic, and completion. Question objects need id, type, title, required, settings, and validation.', workspace);
  if (!provider) return { schema: fallback, provider: 'local_heuristic', aiGenerated: false };
  try {
    const schema = normalizeSchema({
      title: provider.data.title || fallback.title,
      description: provider.data.description || fallback.description,
      type: provider.data.type || fallback.type,
      questions: Array.isArray(provider.data.questions) && provider.data.questions.length ? provider.data.questions : fallback.questions,
      logic: Array.isArray(provider.data.logic) ? provider.data.logic : fallback.logic,
      completion: provider.data.completion || fallback.completion
    });
    return { schema, provider: provider.provider, providerUsage: provider.usage, aiGenerated: true };
  } catch {
    return { schema: fallback, provider: 'local_heuristic', aiGenerated: false };
  }
}

async function improveQuestionWithProvider(db, input = {}, workspace) {
  const fallback = improveQuestionText(input);
  const provider = await requestAiProviderJson(db, 'question_improvement', {
    original: fallback.original,
    mode: cleanText(input.mode || 'clarity', 80),
    context: cleanText(input.context || input.goal || '', 500)
  }, 'Return JSON with improvedTitle, suggestedType, suggestedOptions, and rationale.', workspace);
  if (!provider) return fallback;
  return {
    ...fallback,
    aiGenerated: true,
    provider: provider.provider,
    providerModel: provider.model,
    providerUsage: provider.usage,
    improvedTitle: cleanText(provider.data.improvedTitle || fallback.improvedTitle, 240),
    suggestedType: normalizeQuestionType(provider.data.suggestedType || fallback.suggestedType),
    suggestedOptions: normalizeStringArray(provider.data.suggestedOptions, fallback.suggestedOptions, 8),
    rationale: cleanText(provider.data.rationale || fallback.rationale, 500)
  };
}

function generateSurveySchemaFromPrompt(input = {}) {
  const goal = cleanText(input.goal || input.title || 'Collect feedback', 160);
  const audience = cleanText(input.audience || 'customers', 100);
  const industry = cleanText(input.industry || 'service business', 100);
  const type = cleanText(input.type || input.surveyType || 'feedback_form', 80);
  const count = Math.max(3, Math.min(12, Number(input.questionCount || input.desiredQuestionCount || 5)));
  const tone = cleanText(input.tone || 'clear and professional', 100);
  const baseQuestions = [
    question('csat', `How satisfied are you with your ${industry} experience?`, true, { scale: 5, lowLabel: 'Very dissatisfied', highLabel: 'Very satisfied' }),
    question('nps', `How likely are you to recommend this to other ${audience}?`, true, { scale: 10, lowLabel: 'Not likely', highLabel: 'Very likely' }),
    question('single_choice', 'What best describes your main reason for responding?', true, { options: ['Positive feedback', 'Problem or complaint', 'Question', 'Feature or service request'] }),
    question('long_text', 'What should we improve next?', false, { placeholder: 'Share details in your own words.' }),
    question('email', 'Email for follow-up', false, { placeholder: 'you@example.com' }),
    question('consent', 'I agree to be contacted about this response.', false, { consentText: 'I agree to follow-up contact.' }),
    question('single_choice', 'How urgent is this?', false, { options: ['Low', 'Medium', 'High', 'Critical'] }),
    question('number', 'What budget or value range should we consider?', false, { placeholder: 'Optional number' }),
    question('date', 'When did this happen?', false, {}),
    question('phone', 'Phone number for faster follow-up', false, { placeholder: '+91...' })
  ].slice(0, count);
  return normalizeSchema({
    title: cleanText(input.title || `${goal} Survey`, 160),
    description: cleanText(input.description || `A ${tone} survey for ${audience} in ${industry}.`, 600),
    questions: baseQuestions,
    logic: [
      {
        questionId: baseQuestions[2]?.id,
        operator: 'equals',
        value: 'Problem or complaint',
        action: 'show_question',
        targetQuestionId: baseQuestions[3]?.id
      }
    ].filter((rule) => rule.questionId && rule.targetQuestionId),
    completion: {
      type: 'message',
      message: cleanText(input.completionMessage || 'Thank you. Your feedback helps us make better decisions.', 300)
    },
    type
  });
}

function improveQuestionText(input = {}) {
  const original = cleanText(input.title || input.question || 'How was your experience?', 240);
  const mode = cleanText(input.mode || 'clarity', 80);
  const neutral = original
    .replace(/\b(amazing|terrible|awful|perfect|best|worst)\b/gi, 'specific')
    .replace(/\s+/g, ' ')
    .trim();
  const improvedTitle = mode === 'shorten'
    ? neutral.split(' ').slice(0, 12).join(' ')
    : mode === 'remove_bias'
      ? `How would you describe ${neutral.replace(/\?$/, '').toLowerCase()}?`
      : neutral.endsWith('?')
        ? neutral
        : `${neutral}?`;
  return {
    aiGenerated: false,
    original,
    improvedTitle,
    suggestedType: inferQuestionType(improvedTitle),
    suggestedOptions: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
    rationale: `Improved for ${mode || 'clarity'} while keeping the question easy to answer.`
  };
}

function createAiJob(workspaceId, surveyId, responseId, jobType, inputJson, outputJson) {
  return {
    id: makeId('ai'),
    workspaceId,
    surveyId,
    responseId,
    jobType,
    status: 'completed',
    inputJson,
    outputJson,
    tokensUsed: Math.max(50, JSON.stringify(inputJson || {}).length + JSON.stringify(outputJson || {}).length),
    error: '',
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  };
}

function buildMonthlyReport(db, workspaceId, month) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const surveys = db.surveys.filter((survey) => survey.workspaceId === workspaceId);
  const responses = db.responses.filter((response) => response.workspaceId === workspaceId && response.status === 'completed' && (response.submittedAt || '').startsWith(month));
  const sentiment = countBy(responses.map((response) => response.sentiment || 'neutral'));
  const topIssues = topKeywords(responses.filter((response) => response.sentiment === 'negative').map((response) => answersToText(response.answersJson)).join(' '), 8);
  const opportunities = topKeywords(responses.map((response) => answersToText(response.answersJson)).join(' '), 8);
  const importantQuotes = responses
    .filter((response) => response.important || response.sentiment === 'negative')
    .slice(0, 8)
    .map((response) => ({
      responseId: response.id,
      sentiment: response.sentiment,
      excerpt: cleanText(answersToText(response.answersJson), 220)
    }));
  return {
    id: makeId('rpt'),
    workspaceId,
    month,
    aiGenerated: false,
    generatedAt: new Date().toISOString(),
    title: `${workspace?.name || 'Workspace'} ${month} feedback report`,
    totalResponses: responses.length,
    surveyCount: surveys.length,
    satisfactionScore: Math.round(average(responses.map((response) => response.leadScore || 0))),
    sentiment,
    trends: buildMonthlyTrends(responses),
    topIssues,
    topOpportunities: opportunities,
    importantQuotes,
    recommendedActions: recommendActions(sentiment, opportunities, responses),
    leadQualitySummary: summarizeLeadQuality(responses)
  };
}

async function buildMonthlyReportWithProvider(db, workspaceId, month) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const report = buildMonthlyReport(db, workspaceId, month);
  const responses = db.responses.filter((response) => response.workspaceId === workspaceId && response.status === 'completed' && (response.submittedAt || '').startsWith(month));
  const provider = await requestAiProviderJson(db, 'monthly_report', {
    workspaceId,
    month,
    totals: {
      totalResponses: report.totalResponses,
      surveyCount: report.surveyCount,
      satisfactionScore: report.satisfactionScore,
      sentiment: report.sentiment
    },
    responseExcerpts: responses.slice(0, AI_PROVIDER_RESPONSE_LIMIT).map((response) => ({
      responseId: response.id,
      sentiment: response.sentiment,
      leadScore: response.leadScore,
      excerpt: cleanText(answersToText(response.answersJson), 500)
    }))
  }, 'Return JSON with topIssues, topOpportunities, recommendedActions, importantQuotes, and optional title. Keep the report scoped only to the provided workspace response excerpts.', workspace);
  if (!provider) return report;
  return {
    ...report,
    aiGenerated: true,
    title: cleanText(provider.data.title || report.title, 200),
    provider: provider.provider,
    providerModel: provider.model,
    providerUsage: provider.usage,
    topIssues: normalizeLabeledItems(provider.data.topIssues, report.topIssues, 8),
    topOpportunities: normalizeLabeledItems(provider.data.topOpportunities, report.topOpportunities, 8),
    recommendedActions: normalizeStringArray(provider.data.recommendedActions, report.recommendedActions, 8),
    importantQuotes: normalizeImportantQuotes(provider.data.importantQuotes, report.importantQuotes)
  };
}

async function requestAiProviderJson(db, task, payload, instruction, workspace) {
  const startedAt = Date.now();
  if (!workspaceAllowsExternalAi(workspace)) {
    recordAiProviderLog(db, { task, workspaceId: workspace?.id || '', status: 'skipped_privacy', startedAt });
    return null;
  }
  if (!envConfigured('OPENAI_API_KEY')) {
    recordAiProviderLog(db, { task, workspaceId: workspace?.id || '', status: 'skipped_unconfigured', startedAt });
    return null;
  }
  const config = aiProviderConfig();
  if (!aiModelAllowed(config.model)) {
    recordAiProviderLog(db, { task, workspaceId: workspace?.id || '', status: 'skipped_model_not_allowed', model: config.model, startedAt });
    return null;
  }
  const policy = aiProviderPolicyStatus();
  if (!policy.accepted) {
    recordAiProviderLog(db, { task, workspaceId: workspace?.id || '', status: 'skipped_policy_review', model: config.model, startedAt });
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are FeedbackOS AI. Return only valid JSON. Do not invent facts beyond the provided tenant-scoped payload.'
          },
          {
            role: 'user',
            content: JSON.stringify({ task, instruction, payload })
          }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content || result?.choices?.[0]?.text || '';
    const data = parseProviderJson(content);
    if (!data || typeof data !== 'object') throw new Error('AI provider did not return a JSON object.');
    const output = {
      provider: 'openai_compatible',
      model: result.model || config.model,
      usage: {
        promptTokens: Number(result.usage?.prompt_tokens || 0),
        completionTokens: Number(result.usage?.completion_tokens || 0),
        totalTokens: Number(result.usage?.total_tokens || 0)
      },
      data
    };
    recordAiProviderLog(db, { task, workspaceId: workspace?.id || '', status: 'success', model: output.model, usage: output.usage, startedAt });
    return output;
  } catch (error) {
    recordAiProviderLog(db, { task, workspaceId: workspace?.id || '', status: 'failed', model: config.model, error, startedAt });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function aiProviderEnabled(workspace) {
  return envConfigured('OPENAI_API_KEY') && workspaceAllowsExternalAi(workspace) && aiProviderPolicyStatus().accepted;
}

function workspaceAllowsExternalAi(workspace) {
  if (!workspace) return true;
  return workspace.allowExternalAi === undefined ? true : parseBoolean(workspace.allowExternalAi);
}

function aiProviderConfig() {
  return {
    apiKey: String(process.env.OPENAI_API_KEY || ''),
    baseUrl: cleanUrl(process.env.OPENAI_BASE_URL || '') || 'https://api.openai.com/v1',
    model: cleanText(process.env.OPENAI_MODEL || 'gpt-4o-mini', 120),
    timeoutMs: Math.max(1000, Number(process.env.OPENAI_TIMEOUT_MS || 15000))
  };
}

function aiModelAllowed(model) {
  const allowed = String(process.env.OPENAI_ALLOWED_MODELS || '')
    .split(',')
    .map((item) => cleanText(item, 120))
    .filter(Boolean);
  return !allowed.length || allowed.includes(model);
}

function aiProviderPolicyStatus() {
  const retentionDays = Number(process.env.AI_PROVIDER_DATA_RETENTION_DAYS || 0);
  return {
    accepted: parseBoolean(process.env.AI_PROVIDER_DPA_ACCEPTED || false),
    dpaUrl: cleanUrl(process.env.AI_PROVIDER_DPA_URL || ''),
    dataRetentionDays: Number.isFinite(retentionDays) && retentionDays >= 0 ? Math.floor(retentionDays) : 0
  };
}

function recordAiProviderLog(db, input = {}) {
  if (!db?.aiProviderLogs) return;
  const durationMs = Math.max(0, Date.now() - Number(input.startedAt || Date.now()));
  db.aiProviderLogs.push({
    id: makeId('ailog'),
    workspaceId: cleanText(input.workspaceId || '', 120),
    task: cleanText(input.task || 'unknown', 80),
    provider: 'openai_compatible',
    model: cleanText(input.model || '', 120),
    status: cleanText(input.status || 'unknown', 60),
    durationMs,
    totalTokens: Number(input.usage?.totalTokens || 0),
    promptTokens: Number(input.usage?.promptTokens || 0),
    completionTokens: Number(input.usage?.completionTokens || 0),
    error: input.error ? cleanText(input.error.message || String(input.error), 300) : '',
    createdAt: new Date().toISOString()
  });
  if (db.aiProviderLogs.length > LOG_MEMORY_MAX) db.aiProviderLogs.splice(0, db.aiProviderLogs.length - LOG_MEMORY_MAX);
}

function parseProviderJson(content) {
  const raw = String(content || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('Provider JSON parse failed.');
  }
}

function normalizeStringArray(value, fallback = [], limit = 8) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, limit);
}

function normalizeLabeledItems(value, fallback = [], limit = 8) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => {
    if (typeof item === 'string') return { label: cleanText(item, 120), value: 1 };
    return {
      label: cleanText(item?.label || item?.theme || item?.issue || item?.name || '', 120),
      value: Number.isFinite(Number(item?.value || item?.count)) ? Number(item.value || item.count) : 1
    };
  }).filter((item) => item.label).slice(0, limit);
}

function normalizeImportantQuotes(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => ({
    responseId: cleanText(item?.responseId || '', 120),
    sentiment: cleanText(item?.sentiment || 'neutral', 40),
    excerpt: cleanText(item?.excerpt || item?.quote || '', 220)
  })).filter((item) => item.excerpt).slice(0, 8);
}

function normalizeIntentSummary(value, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  const summary = {};
  for (const category of INTENT_CATEGORIES) {
    summary[category] = Math.max(0, Number(source[category] || source[toCamelKey(category)] || source[toSnakeKey(category)] || 0));
  }
  return summary;
}

function normalizeIntentClassifications(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => {
    const intent = normalizeIntentCategory(item?.intent || item?.label || item?.category || '');
    return {
      responseId: cleanText(item?.responseId || item?.id || '', 120),
      intent,
      confidence: Number.isFinite(Number(item?.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.6,
      excerpt: cleanText(item?.excerpt || item?.reason || item?.text || '', 180)
    };
  }).filter((item) => item.responseId && item.intent).slice(0, 25);
}

function normalizeClusterItems(value, fallback = [], limit = 8) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => {
    if (typeof item === 'string') {
      return { label: cleanText(item, 120), value: 1, responseIds: [], example: '' };
    }
    return {
      label: cleanText(item?.label || item?.theme || item?.category || item?.issue || item?.intent || '', 120),
      value: Math.max(0, Number(item?.value || item?.count || item?.responses?.length || item?.responseIds?.length || 1)),
      responseIds: normalizeResponseIds(item?.responseIds || item?.responses || []),
      example: cleanText(item?.example || item?.excerpt || item?.quote || '', 180)
    };
  }).filter((item) => item.label && item.value > 0).slice(0, limit);
}

function normalizeResponseIds(value) {
  const source = Array.isArray(value) ? value : [];
  return source.map((item) => cleanText(typeof item === 'string' ? item : item?.responseId || item?.id || '', 120)).filter(Boolean).slice(0, 10);
}

function normalizeIntentCategory(value) {
  const clean = cleanText(value, 80).replace(/[_-]+/g, ' ').toLowerCase();
  return INTENT_CATEGORIES.find((category) => category.toLowerCase() === clean) || 'Low intent';
}

function toCamelKey(value) {
  const words = String(value || '').split(/\s+/);
  return words.map((word, index) => index ? `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}` : word.toLowerCase()).join('');
}

function toSnakeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeQuestionType(value) {
  const safe = cleanText(value, 80).toLowerCase();
  return QUESTION_TYPES.includes(safe) ? safe : 'long_text';
}

function buildMonthlyReportPdf(db, report) {
  const workspace = db.workspaces.find((item) => item.id === report.workspaceId);
  return buildDesignedMonthlyReportPdf(workspace, report);
}

function buildDesignedMonthlyReportPdf(workspace, report) {
  const width = 612;
  const height = 792;
  const margin = 42;
  const brand = normalizePdfColor(workspace?.brandColor || '#176B5B', [0.09, 0.42, 0.36]);
  const accent = normalizePdfColor(workspace?.buttonColor || '#B75D2A', [0.72, 0.36, 0.16]);
  const ink = [0.12, 0.15, 0.17];
  const muted = [0.42, 0.46, 0.48];
  const soft = [0.94, 0.96, 0.95];
  const pages = [];
  let commands = [];
  let cursorY = height - margin;

  function newPage() {
    if (commands.length) pages.push(commands);
    commands = [];
    cursorY = height - margin;
  }
  function ensure(space) {
    if (cursorY - space < 78) {
      addFooter();
      newPage();
      addRunningHeader();
    }
  }
  function rect(x, y, w, h, color) {
    commands.push(`q ${color.join(' ')} rg ${formatPdfNumber(x)} ${formatPdfNumber(y)} ${formatPdfNumber(w)} ${formatPdfNumber(h)} re f Q`);
  }
  function strokeRect(x, y, w, h, color) {
    commands.push(`q ${color.join(' ')} RG 0.7 w ${formatPdfNumber(x)} ${formatPdfNumber(y)} ${formatPdfNumber(w)} ${formatPdfNumber(h)} re S Q`);
  }
  function text(value, x, y, size = 11, options = {}) {
    const font = options.bold ? 'F2' : 'F1';
    const color = options.color || ink;
    commands.push(`BT /${font} ${formatPdfNumber(size)} Tf ${color.join(' ')} rg ${formatPdfNumber(x)} ${formatPdfNumber(y)} Td (${escapePdfText(value)}) Tj ET`);
  }
  function wrapped(value, x, y, maxWidth, size = 10.5, options = {}) {
    const lines = wrapPdfText(value, maxWidth, size, options.maxLines || 8);
    lines.forEach((line, index) => text(line, x, y - (index * (size + 4)), size, options));
    return y - (lines.length * (size + 4));
  }
  function section(title) {
    ensure(58);
    cursorY -= 18;
    text(title, margin, cursorY, 13, { bold: true, color: brand });
    cursorY -= 10;
    rect(margin, cursorY, width - (margin * 2), 1.2, [0.84, 0.88, 0.86]);
    cursorY -= 18;
  }
  function addFooter() {
    const pageNumber = pages.length + 1;
    rect(margin, 52, width - (margin * 2), 0.8, [0.84, 0.88, 0.86]);
    text(`FeedbackOS monthly report - ${report.month}`, margin, 34, 8.5, { color: muted });
    text(`Page ${pageNumber}`, width - margin - 42, 34, 8.5, { color: muted });
  }
  function addRunningHeader() {
    text(cleanText(workspace?.name || 'Workspace', 80), margin, height - 36, 9, { bold: true, color: brand });
    text(report.month || '', width - margin - 42, height - 36, 9, { color: muted });
    cursorY = height - 68;
  }

  rect(0, height - 152, width, 152, brand);
  rect(0, height - 158, width, 6, accent);
  text('FeedbackOS', margin, height - 54, 12, { bold: true, color: [1, 1, 1] });
  wrapped(report.title || 'Monthly feedback report', margin, height - 86, width - (margin * 2), 23, { bold: true, color: [1, 1, 1], maxLines: 2 });
  text(`${workspace?.name || 'Workspace'} - ${report.month}`, margin, height - 130, 11, { color: [0.9, 0.96, 0.94] });
  text(`Generated ${formatReportDate(report.generatedAt)} | AI generated: ${report.aiGenerated ? 'yes' : 'no'}`, width - margin - 230, height - 130, 9.5, { color: [0.9, 0.96, 0.94] });
  cursorY = height - 184;

  const metrics = [
    ['Responses', String(report.totalResponses || 0), 'completed this month'],
    ['Surveys', String(report.surveyCount || 0), 'active feedback sources'],
    ['Satisfaction', String(report.satisfactionScore || 0), 'lead/satisfaction score']
  ];
  const cardWidth = (width - (margin * 2) - 18) / 3;
  metrics.forEach((metricItem, index) => {
    const x = margin + index * (cardWidth + 9);
    rect(x, cursorY - 74, cardWidth, 74, soft);
    strokeRect(x, cursorY - 74, cardWidth, 74, [0.82, 0.87, 0.84]);
    text(metricItem[0], x + 14, cursorY - 22, 9.5, { bold: true, color: muted });
    text(metricItem[1], x + 14, cursorY - 48, 22, { bold: true, color: index === 2 ? accent : brand });
    text(metricItem[2], x + 14, cursorY - 64, 8.5, { color: muted });
  });
  cursorY -= 104;

  section('Executive summary');
  const sentiment = report.sentiment || {};
  const lead = report.leadQualitySummary || {};
  cursorY = drawDistribution(commands, {
    x: margin,
    y: cursorY,
    width: width - (margin * 2),
    title: 'Sentiment mix',
    values: [
      ['positive', sentiment.positive || 0, [0.14, 0.55, 0.32]],
      ['neutral', sentiment.neutral || 0, [0.48, 0.52, 0.56]],
      ['negative', sentiment.negative || 0, [0.72, 0.18, 0.16]],
      ['mixed', sentiment.mixed || 0, accent]
    ],
    text,
    rect,
    muted,
    ink
  }) - 18;
  cursorY = drawDistribution(commands, {
    x: margin,
    y: cursorY,
    width: width - (margin * 2),
    title: 'Lead quality',
    values: [
      ['high', lead.high || 0, [0.14, 0.55, 0.32]],
      ['medium', lead.medium || 0, accent],
      ['low', lead.low || 0, [0.48, 0.52, 0.56]]
    ],
    text,
    rect,
    muted,
    ink
  }) - 8;

  section('Response trend');
  const trends = (report.trends || []).slice(-10);
  if (trends.length) {
    const max = Math.max(...trends.map((item) => Number(item.value || 0)), 1);
    const chartX = margin;
    const chartY = cursorY - 110;
    const barGap = 6;
    const barWidth = Math.max(18, ((width - margin * 2) - ((trends.length - 1) * barGap)) / trends.length);
    trends.forEach((item, index) => {
      const value = Number(item.value || 0);
      const h = Math.max(4, (value / max) * 82);
      const x = chartX + index * (barWidth + barGap);
      rect(x, chartY, barWidth, h, index % 2 ? accent : brand);
      text(String(value), x + 2, chartY + h + 6, 8, { color: muted });
      text(String(item.label || '').slice(5), x, chartY - 12, 7.2, { color: muted });
    });
    cursorY = chartY - 30;
  } else {
    text('No dated responses were available for this report period.', margin, cursorY, 10.5, { color: muted });
    cursorY -= 24;
  }

  section('Recommended actions');
  const actions = (report.recommendedActions || []).slice(0, 6);
  if (actions.length) {
    actions.forEach((action, index) => {
      ensure(44);
      rect(margin, cursorY - 26, 18, 18, index % 2 ? accent : brand);
      text(String(index + 1), margin + 6, cursorY - 21, 9, { bold: true, color: [1, 1, 1] });
      cursorY = wrapped(action, margin + 28, cursorY - 5, width - (margin * 2) - 32, 10.2, { color: ink, maxLines: 2 }) - 8;
    });
  } else {
    text('No recommended actions yet.', margin, cursorY, 10.5, { color: muted });
    cursorY -= 24;
  }

  section('Issues and opportunities');
  const columnWidth = (width - (margin * 2) - 20) / 2;
  const startY = cursorY;
  drawListColumn('Top issues', report.topIssues || [], margin, startY, columnWidth, brand, text, wrapped, rect, muted);
  drawListColumn('Top opportunities', report.topOpportunities || [], margin + columnWidth + 20, startY, columnWidth, accent, text, wrapped, rect, muted);
  cursorY = startY - 152;

  section('Important customer quotes');
  const quotes = (report.importantQuotes || []).slice(0, 5);
  if (quotes.length) {
    quotes.forEach((quote) => {
      ensure(54);
      rect(margin, cursorY - 36, width - (margin * 2), 36, [0.98, 0.98, 0.96]);
      text(cleanText(quote.sentiment || 'response', 40), margin + 12, cursorY - 15, 8.5, { bold: true, color: accent });
      cursorY = wrapped(quote.excerpt || '', margin + 88, cursorY - 13, width - (margin * 2) - 100, 9.5, { color: ink, maxLines: 2 }) - 8;
    });
  } else {
    text('No important quotes were identified in this reporting period.', margin, cursorY, 10.5, { color: muted });
    cursorY -= 24;
  }

  addFooter();
  pages.push(commands);
  return buildPdfFromPages(pages, { width, height });
}

function drawDistribution(commands, options) {
  const total = Math.max(1, options.values.reduce((sum, item) => sum + Number(item[1] || 0), 0));
  options.text(options.title, options.x, options.y, 10.5, { bold: true, color: options.ink });
  let barX = options.x;
  const barY = options.y - 24;
  options.values.forEach((item) => {
    const w = Math.max(0, (Number(item[1] || 0) / total) * options.width);
    if (w > 0) options.rect(barX, barY, w, 13, item[2]);
    barX += w;
  });
  let labelX = options.x;
  options.values.forEach((item) => {
    options.text(`${item[0]} ${item[1]}`, labelX, barY - 18, 8.5, { color: options.muted });
    labelX += Math.max(82, options.width / options.values.length);
  });
  return barY - 34;
}

function drawListColumn(title, items, x, y, width, color, text, wrapped, rect, muted) {
  text(title, x, y, 10.5, { bold: true, color });
  let cursor = y - 18;
  const list = items.slice(0, 5);
  if (!list.length) {
    text('None identified.', x, cursor, 9.5, { color: muted });
    return;
  }
  list.forEach((item, index) => {
    rect(x, cursor - 8, 5, 5, color);
    const label = `${item.label || 'Item'} (${item.value || 0})`;
    text(label, x + 12, cursor - 2, 9.2, { bold: true, color: [0.12, 0.15, 0.17] });
    cursor = wrapped(item.description || item.excerpt || label, x + 12, cursor - 16, width - 14, 8.5, { color: muted, maxLines: 2 }) - 4;
  });
}

function buildPdfFromPages(pages, options = {}) {
  const width = options.width || 612;
  const height = options.height || 792;
  const objects = [];
  const pageObjectNumbers = [];
  function addObject(body) {
    objects.push(body);
    return objects.length;
  }
  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject('');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  for (const pageCommands of pages) {
    const content = pageCommands.join('\n');
    const contentNumber = addObject(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    const pageNumber = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`);
    pageObjectNumbers.push(pageNumber);
  }
  objects[1] = `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function normalizePdfColor(value, fallback) {
  const match = String(value || '').match(/^#?([a-f0-9]{6})$/i);
  if (!match) return fallback;
  return [0, 2, 4].map((offset) => Number((parseInt(match[1].slice(offset, offset + 2), 16) / 255).toFixed(3)));
}

function formatPdfNumber(value) {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '');
}

function wrapPdfText(value, width, size, maxLines = 8) {
  const words = cleanText(value || '', 1000).split(/\s+/).filter(Boolean);
  const maxChars = Math.max(12, Math.floor(width / (size * 0.52)));
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (!lines.length) lines.push('');
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(0, maxChars - 3))}...`;
  }
  return lines;
}

function formatReportDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : '';
}

function buildResponsePdf(db, survey, response) {
  const detail = buildResponseDetail(db, survey, response);
  const questionTitles = new Map((survey.schema.questions || []).map((question) => [question.id, question.title || question.id]));
  const answerLines = Object.entries(detail.answersJson || {}).map(([key, value]) => {
    const label = questionTitles.get(key) || key;
    return `- ${label}: ${formatAnswerText(value)}`;
  });
  const metadata = detail.metadataJson || {};
  const metadataLines = [
    ['Source', metadata.source || 'direct'],
    ['Device', metadata.deviceType || 'unknown'],
    ['Browser', metadata.browser || 'unknown'],
    ['OS', metadata.os || 'unknown'],
    ['Language', metadata.language || 'unknown'],
    ['Branch', responseDimensionValue(detail, survey, 'branch') || 'unknown'],
    ['Location', responseDimensionValue(detail, survey, 'location') || 'unknown'],
    ['Referrer', metadata.referrer || '']
  ].filter(([, value]) => value !== '').map(([label, value]) => `- ${label}: ${value}`);
  const lines = [
    `Response export: ${survey.title}`,
    `Response ID: ${detail.id}`,
    `Survey: ${survey.title}`,
    `Status: ${detail.status}`,
    `Submitted: ${detail.submittedAt || 'not submitted'}`,
    `Started: ${detail.startedAt || 'unknown'}`,
    `Sentiment: ${detail.sentiment || 'unknown'}`,
    `Lead score: ${detail.leadScore || 0}`,
    `Important: ${detail.important ? 'yes' : 'no'}`,
    '',
    'Respondent',
    `Name: ${detail.respondent?.name || detail.contact?.name || 'Unknown'}`,
    `Email: ${detail.respondent?.email || detail.contact?.email || ''}`,
    `Phone: ${detail.respondent?.phone || detail.contact?.phone || ''}`,
    '',
    'AI response summary',
    `AI generated: ${detail.aiSummary?.aiGenerated ? 'yes' : 'no'}`,
    `Recommendation: ${detail.aiSummary?.recommendation || ''}`,
    '',
    'Answers',
    ...(answerLines.length ? answerLines : ['- No answers recorded.']),
    '',
    'Tags',
    ...((detail.tagsJson || []).length ? detail.tagsJson.map((tag) => `- ${tag}`) : ['- None']),
    '',
    'Metadata',
    ...(metadataLines.length ? metadataLines : ['- None']),
    '',
    'Internal notes',
    ...((detail.internalNotes || []).length ? detail.internalNotes.map((note) => `- ${note.text} (${note.createdAt})`) : ['- None']),
    '',
    'Timeline',
    ...((detail.timeline || []).length ? detail.timeline.map((item) => `- ${item.label}: ${item.at}`) : ['- None'])
  ];
  return buildSimplePdf(lines);
}

function buildSimplePdf(lines) {
  const pages = chunkLines(lines.map((line) => cleanText(line, 1000)), 42);
  const objects = [];
  const pageObjectNumbers = [];
  function addObject(body) {
    objects.push(body);
    return objects.length;
  }
  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject(''); // pages placeholder
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const pageLines of pages) {
    const content = buildPdfPageContent(pageLines);
    const contentNumber = addObject(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    const pageNumber = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`);
    pageObjectNumbers.push(pageNumber);
  }
  objects[1] = `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function buildPdfPageContent(lines) {
  const commands = ['BT', '/F1 11 Tf', '50 750 Td', '14 TL'];
  lines.forEach((line, index) => {
    if (index > 0) commands.push('T*');
    commands.push(`(${escapePdfText(line)}) Tj`);
  });
  commands.push('ET');
  return commands.join('\n');
}

function escapePdfText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}

function chunkLines(lines, size) {
  const chunks = [];
  const input = lines.length ? lines : ['No report content.'];
  for (let index = 0; index < input.length; index += size) chunks.push(input.slice(index, index + size));
  return chunks;
}

function buildMonthlyTrends(responses) {
  const byDate = {};
  for (const response of responses) {
    const date = (response.submittedAt || response.createdAt || '').slice(0, 10);
    byDate[date] = (byDate[date] || 0) + 1;
  }
  return objectEntriesSorted(byDate);
}

function recommendActions(sentiment, keywords, responses) {
  const actions = [];
  if (!responses.length) return ['Share the public link or QR card to collect the first response.'];
  if (sentiment.negative > 0) actions.push('Follow up on negative responses within one business day and tag root causes.');
  if (sentiment.positive > sentiment.negative) actions.push('Collect reusable testimonials from high-satisfaction respondents with consent.');
  if (keywords.length) actions.push(`Review the top recurring theme: ${keywords[0].label}.`);
  if (responses.some((item) => item.leadScore >= 80)) actions.push('Route high-intent leads to the sales owner immediately.');
  return actions.slice(0, 5);
}

function summarizeLeadQuality(responses) {
  const high = responses.filter((item) => item.leadScore >= 80).length;
  const medium = responses.filter((item) => item.leadScore >= 50 && item.leadScore < 80).length;
  const low = responses.filter((item) => item.leadScore < 50).length;
  return { high, medium, low };
}

function buildIntentSummary(responses) {
  const classifications = responses.map((response) => {
    const text = answersToText(response.answersJson);
    return {
      responseId: response.id,
      intent: classifyResponseIntent(response, text),
      confidence: intentConfidence(response, text),
      excerpt: cleanText(text, 180)
    };
  });
  const summary = Object.fromEntries(INTENT_CATEGORIES.map((category) => [category, 0]));
  for (const item of classifications) {
    summary[item.intent] = (summary[item.intent] || 0) + 1;
  }
  return { summary, classifications: classifications.slice(0, 25) };
}

function classifyResponseIntent(response, text) {
  const lower = String(text || '').toLowerCase();
  if (/\b(spam|unsubscribe|casino|crypto giveaway|free money|click here)\b/.test(lower)) return 'Spam';
  if (response.sentiment === 'negative' || /\b(complaint|angry|unhappy|bad|poor|delay|delayed|broken|issue|problem|refund)\b/.test(lower)) return 'Complaint';
  if (/\b(help|support|ticket|how do i|question|call me|follow[- ]?up)\b/.test(lower)) return 'Support request';
  if ((response.leadScore || 0) >= 80 || /\b(urgent|immediately|demo|quote|proposal|buy|purchase|this month)\b/.test(lower)) return 'High intent';
  if ((response.leadScore || 0) >= 50 || /\b(interested|considering|budget|pricing|next month)\b/.test(lower)) return 'Medium intent';
  return 'Low intent';
}

function intentConfidence(response, text) {
  const lower = String(text || '').toLowerCase();
  let confidence = 0.55;
  if (response.sentiment === 'negative' || response.sentiment === 'positive') confidence += 0.1;
  if ((response.leadScore || 0) >= 80 || (response.leadScore || 0) < 30) confidence += 0.1;
  if (/\b(complaint|urgent|refund|support|spam|demo|pricing|buy|delay|broken)\b/.test(lower)) confidence += 0.15;
  return Number(Math.min(0.95, confidence).toFixed(2));
}

function buildComplaintClusters(responses) {
  const clusters = COMPLAINT_CATEGORIES.map((category) => ({
    label: category.label,
    keywords: category.keywords,
    value: 0,
    responseIds: [],
    example: ''
  }));
  for (const response of responses) {
    const text = answersToText(response.answersJson);
    const lower = text.toLowerCase();
    if (response.sentiment !== 'negative' && !/\b(complaint|bad|poor|angry|unhappy|delay|broken|issue|problem|refund)\b/.test(lower)) continue;
    const cluster = clusters.find((category) => category.keywords.some((keyword) => lower.includes(keyword))) || clusters[clusters.length - 1];
    cluster.value += 1;
    if (cluster.responseIds.length < 10) cluster.responseIds.push(response.id);
    if (!cluster.example) cluster.example = cleanText(text, 180);
  }
  return clusters
    .filter((cluster) => cluster.value > 0)
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .map(({ label, value, responseIds, example }) => ({ label, value, responseIds, example }));
}

function buildResponseClusters(responses, keywords) {
  return keywords.slice(0, 8).map((keyword) => {
    const matches = responses.filter((response) => answersToText(response.answersJson).toLowerCase().includes(keyword.label));
    return {
      label: keyword.label,
      value: matches.length || keyword.value,
      responseIds: matches.slice(0, 10).map((response) => response.id),
      example: matches[0] ? cleanText(answersToText(matches[0].answersJson), 180) : ''
    };
  }).filter((cluster) => cluster.label && cluster.value > 0);
}

function normalizeCampaignContacts(input) {
  const items = Array.isArray(input)
    ? input
    : String(input || '').split(/\r?\n|,/).map((email) => ({ email }));
  return items
    .map((item) => {
      const email = cleanEmail(typeof item === 'string' ? item : item.email, true);
      return {
        id: cleanText(typeof item === 'object' ? item.id || '' : '', 80) || makeId('rcp'),
        email,
        emailHash: email ? hashToken(email).slice(0, 24) : '',
        name: cleanText(typeof item === 'object' ? item.name || '' : '', 120)
      };
    })
    .filter((item) => item.email)
    .slice(0, 5000);
}

function queueCampaignJobs(db, campaign, survey) {
  if (!survey) return;
  const appUrl = process.env.APP_URL || 'http://localhost:4173';
  const surveyUrl = `${appUrl}/s/${survey.slug}?source=email&campaign=${campaign.id}`;
  const nextRunAt = campaign.scheduledAt || new Date().toISOString();
  let queued = 0;
  for (const contact of campaign.contacts) {
    const existing = db.jobs.some((job) => job.type === 'email_delivery' && job.payloadJson?.context?.campaignId === campaign.id && job.payloadJson?.message?.to === contact.email);
    if (existing) continue;
    const trackedUrl = `${appUrl}/api/public/campaigns/${campaign.id}/click?recipient=${encodeURIComponent(contact.emailHash)}&url=${encodeURIComponent(surveyUrl)}`;
    const openPixel = `${appUrl}/api/public/campaigns/${campaign.id}/open.gif?recipient=${encodeURIComponent(contact.emailHash)}`;
    db.jobs.push({
      id: makeId('job'),
      workspaceId: campaign.workspaceId,
      type: 'email_delivery',
      status: campaign.scheduledAt ? 'queued' : 'queued',
      attempts: 0,
      maxAttempts: JOB_MAX_ATTEMPTS,
      payloadJson: {
        message: {
          to: contact.email,
          subject: campaign.subject,
          body: `${campaign.message}\n\nSurvey link: ${trackedUrl}\nOpen tracking pixel: ${openPixel}`
        },
        context: { campaignId: campaign.id, surveyId: survey.id, contactEmail: contact.email, recipientHash: contact.emailHash, trackedUrl, openPixel }
      },
      lastError: '',
      nextRunAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    });
    queued += 1;
  }
  if (queued) {
    campaign.status = campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now() ? 'scheduled' : 'queued';
    campaign.updatedAt = new Date().toISOString();
  }
}

function recordCampaignEvent(db, campaign, eventType, recipientHash, req) {
  const safeType = eventType === 'click' ? 'click' : 'open';
  const contact = campaign.contacts.find((item) => item.emailHash === recipientHash) || null;
  const existing = db.campaignEvents.find((event) => event.campaignId === campaign.id && event.eventType === safeType && event.recipientHash === recipientHash);
  const event = {
    id: makeId('cevt'),
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    surveyId: campaign.surveyId,
    eventType: safeType,
    recipientHash,
    email: contact ? contact.email : '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    ipHash: hashIp(clientIp(req)),
    createdAt: new Date().toISOString()
  };
  db.campaignEvents.push(event);
  if (!existing) {
    if (safeType === 'open') campaign.openedCount = (campaign.openedCount || 0) + 1;
    if (safeType === 'click') campaign.clickedCount = (campaign.clickedCount || 0) + 1;
  }
  campaign.updatedAt = new Date().toISOString();
  return event;
}

function createInvoice(workspaceId, input = {}) {
  const lineItems = Array.isArray(input.lineItems) && input.lineItems.length
    ? input.lineItems.map((item) => ({
      description: cleanText(item.description || 'Subscription', 180),
      quantity: Math.max(1, Number(item.quantity || 1)),
      unitAmountInr: Math.max(0, Number(item.unitAmountInr || item.amountInr || 0))
    }))
    : [{ description: 'Monthly subscription', quantity: 1, unitAmountInr: Math.max(0, Number(input.amountDueInr || 0)) }];
  const subtotalInr = Math.max(0, Math.round(lineItems.reduce((sum, item) => sum + item.quantity * item.unitAmountInr, 0)));
  const billingPolicy = billingPolicySnapshot(input);
  const tax = calculateTaxBreakdown(subtotalInr, billingPolicy);
  const prorationCreditInr = Math.max(0, Math.round(Number(input.prorationCreditInr || 0)));
  const amountDueInr = Math.max(0, tax.totalInr - prorationCreditInr);
  return {
    id: makeId('inv'),
    workspaceId,
    provider: cleanText(input.provider || 'manual', 60),
    providerInvoiceId: cleanText(input.providerInvoiceId || '', 120),
    status: ['draft', 'open', 'paid', 'void', 'uncollectible'].includes(input.status) ? input.status : 'open',
    currency: cleanText(input.currency || 'INR', 8),
    subtotalInr,
    taxInr: tax.taxInr,
    taxMode: billingPolicy.taxMode,
    taxPercent: billingPolicy.taxPercent,
    prorationCreditInr,
    amountDueInr,
    amountPaidInr: Math.max(0, Number(input.amountPaidInr || 0)),
    lineItems,
    billingPolicy,
    dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function billingPolicySnapshot(input = {}) {
  const taxMode = normalizeBillingTaxMode(input.taxMode ?? process.env.BILLING_TAX_MODE ?? 'none');
  const taxPercentSource = input.taxPercent ?? process.env.BILLING_TAX_PERCENT ?? (taxMode === 'none' ? 0 : 18);
  const taxPercent = taxMode === 'none'
    ? 0
    : Math.max(0, Math.min(40, Number(taxPercentSource || 0)));
  return {
    taxMode,
    taxPercent,
    prorationPolicy: normalizeProrationPolicy(input.prorationPolicy ?? process.env.BILLING_PRORATION_POLICY ?? 'none'),
    stripeAutomaticTax: parseBoolean(input.stripeAutomaticTax ?? process.env.STRIPE_AUTOMATIC_TAX ?? false),
    stripeTaxIdCollection: parseBoolean(input.stripeTaxIdCollection ?? process.env.STRIPE_TAX_ID_COLLECTION ?? false)
  };
}

function normalizeBillingTaxMode(value) {
  const mode = cleanText(value || '', 40).toLowerCase();
  if (mode === 'exclusive' || mode === 'inclusive') return mode;
  return 'none';
}

function normalizeProrationPolicy(value) {
  const policy = cleanText(value || '', 60).toLowerCase();
  if (['none', 'create_prorations', 'always_invoice'].includes(policy)) return policy;
  return 'none';
}

function calculateTaxBreakdown(subtotalInr, policy) {
  const subtotal = Math.max(0, Math.round(Number(subtotalInr || 0)));
  const taxPercent = policy.taxMode === 'none' ? 0 : Math.max(0, Number(policy.taxPercent || 0));
  if (!taxPercent || policy.taxMode === 'none') return { subtotalInr: subtotal, taxInr: 0, totalInr: subtotal };
  if (policy.taxMode === 'inclusive') {
    const taxInr = Math.round(subtotal - subtotal / (1 + taxPercent / 100));
    return { subtotalInr: subtotal, taxInr, totalInr: subtotal };
  }
  const taxInr = Math.round(subtotal * (taxPercent / 100));
  return { subtotalInr: subtotal, taxInr, totalInr: subtotal + taxInr };
}

function billingPlanAmount(plan, policy) {
  return calculateTaxBreakdown(Math.max(0, Number(plan.priceMonthlyInr || 0)), policy);
}

function createPlanChangeProrationInvoice(workspaceId, previousPlan, nextPlan, subscription, input = {}) {
  const policy = billingPolicySnapshot(input);
  if (policy.prorationPolicy === 'none' || !previousPlan || !nextPlan || previousPlan.id === nextPlan.id) return null;
  const periodStart = new Date(subscription.currentPeriodStart || startOfMonth()).getTime();
  const periodEnd = new Date(subscription.currentPeriodEnd || endOfMonth()).getTime();
  const now = Date.now();
  const periodMs = Math.max(1, periodEnd - periodStart);
  const remainingRatio = Math.max(0, Math.min(1, (periodEnd - now) / periodMs));
  const deltaInr = Math.round((nextPlan.priceMonthlyInr - previousPlan.priceMonthlyInr) * remainingRatio);
  if (deltaInr <= 0) {
    return createInvoice(workspaceId, {
      status: 'draft',
      taxMode: 'none',
      prorationCreditInr: Math.abs(deltaInr),
      lineItems: [{ description: `Proration credit ${previousPlan.name} to ${nextPlan.name}`, quantity: 1, unitAmountInr: 0 }]
    });
  }
  return createInvoice(workspaceId, {
    status: policy.prorationPolicy === 'always_invoice' ? 'open' : 'draft',
    taxMode: policy.taxMode,
    taxPercent: policy.taxPercent,
    prorationPolicy: policy.prorationPolicy,
    lineItems: [{ description: `Proration ${previousPlan.name} to ${nextPlan.name}`, quantity: 1, unitAmountInr: deltaInr }]
  });
}

async function createBillingCheckoutSession(workspace, plan, user, input = {}) {
  const provider = chooseBillingProvider(input.provider);
  if (!provider) {
    return {
      ok: true,
      session: localBillingCheckoutSession(workspace, plan, input)
    };
  }
  try {
    const session = provider === 'stripe'
      ? await createStripeCheckoutSession(workspace, plan, user, input)
      : await createRazorpayCheckoutSession(workspace, plan, user, input);
    return { ok: true, session };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function localBillingCheckoutSession(workspace, plan, input = {}) {
  const billingPolicy = billingPolicySnapshot(input);
  const amount = billingPlanAmount(plan, billingPolicy);
  return {
    id: makeId('chk'),
    provider: 'local_manual',
    mode: 'manual',
    status: 'requires_provider',
    workspaceId: workspace.id,
    planId: plan.id,
    amountInr: amount.totalInr,
    subtotalInr: amount.subtotalInr,
    taxInr: amount.taxInr,
    billingPolicy,
    checkoutUrl: '/app#billing',
    message: 'Configure Stripe or Razorpay credentials to create a hosted checkout session.'
  };
}

async function createStripeCheckoutSession(workspace, plan, user, input = {}) {
  const baseUrl = (cleanUrl(process.env.STRIPE_BASE_URL || '') || 'https://api.stripe.com/v1').replace(/\/$/, '');
  const appUrl = (cleanUrl(process.env.APP_URL || '') || 'http://localhost:4173').replace(/\/$/, '');
  const billingPolicy = billingPolicySnapshot(input);
  const amount = billingPlanAmount(plan, billingPolicy);
  const stripeLineAmountInr = billingPolicy.stripeAutomaticTax && billingPolicy.taxMode === 'exclusive'
    ? amount.subtotalInr
    : amount.totalInr;
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', `${appUrl}/app#billing-success`);
  params.set('cancel_url', `${appUrl}/app#billing-cancelled`);
  params.set('client_reference_id', workspace.id);
  params.set('customer_email', user.email || '');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'inr');
  params.set('line_items[0][price_data][unit_amount]', String(Math.max(0, Math.round(stripeLineAmountInr * 100))));
  params.set('line_items[0][price_data][recurring][interval]', 'month');
  params.set('line_items[0][price_data][product_data][name]', `FeedbackOS ${plan.name}`);
  if (billingPolicy.taxMode !== 'none') params.set('line_items[0][price_data][tax_behavior]', billingPolicy.taxMode);
  if (billingPolicy.stripeAutomaticTax) {
    params.set('automatic_tax[enabled]', 'true');
    params.set('billing_address_collection', 'required');
  }
  if (billingPolicy.stripeTaxIdCollection) params.set('tax_id_collection[enabled]', 'true');
  params.set('metadata[workspaceId]', workspace.id);
  params.set('metadata[planId]', plan.id);
  params.set('metadata[userId]', user.id);
  params.set('metadata[taxMode]', billingPolicy.taxMode);
  params.set('metadata[taxPercent]', String(billingPolicy.taxPercent));
  params.set('metadata[prorationPolicy]', billingPolicy.prorationPolicy);
  params.set('subscription_data[metadata][workspaceId]', workspace.id);
  params.set('subscription_data[metadata][planId]', plan.id);
  params.set('subscription_data[metadata][taxMode]', billingPolicy.taxMode);
  params.set('subscription_data[metadata][taxPercent]', String(billingPolicy.taxPercent));
  params.set('subscription_data[metadata][prorationPolicy]', billingPolicy.prorationPolicy);
  const response = await fetch(`${baseUrl}/checkout/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Stripe checkout failed with HTTP ${response.status}.`);
  return {
    id: cleanText(payload.id || makeId('chk'), 120),
    provider: 'stripe',
    mode: 'hosted_checkout',
    status: cleanText(payload.status || 'created', 60),
    workspaceId: workspace.id,
    planId: plan.id,
    amountInr: amount.totalInr,
    subtotalInr: amount.subtotalInr,
    taxInr: amount.taxInr,
    billingPolicy,
    checkoutUrl: cleanUrl(payload.url || ''),
    providerCheckoutId: cleanText(payload.id || '', 120)
  };
}

async function resolveRazorpayPlanId(baseUrl, authHeader, plan, amount) {
  const envKey = `RAZORPAY_PLAN_ID_${String(plan.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  if (process.env[envKey]) return process.env[envKey];
  if (plan.razorpayPlanId) return plan.razorpayPlanId;

  try {
    const res = await fetch(`${baseUrl}/plans`, {
      method: 'POST',
      headers: { authorization: authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        period: 'monthly',
        interval: 1,
        item: {
          name: `${plan.name} Monthly`,
          amount: Math.max(100, Math.round(amount.totalInr * 100)),
          currency: 'INR',
          description: `${plan.name} monthly subscription`
        },
        notes: { planId: plan.id }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (data.id) return data.id;
  } catch {
    // fallback
  }
  return `plan_${plan.id}`;
}

async function createRazorpayCheckoutSession(workspace, plan, user, input = {}) {
  const baseUrl = (cleanUrl(process.env.RAZORPAY_BASE_URL || '') || 'https://api.razorpay.com/v1').replace(/\/$/, '');
  const keyId = String(process.env.RAZORPAY_KEY_ID || '');
  const secret = String(process.env.RAZORPAY_SECRET || '');
  const authHeader = `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}`;
  const billingPolicy = billingPolicySnapshot(input);
  const amount = billingPlanAmount(plan, billingPolicy);

  if (input.mode === 'one_time') {
    const response = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        authorization: authHeader,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        amount: Math.max(0, Math.round(amount.totalInr * 100)),
        currency: 'INR',
        receipt: `${workspace.id}_${plan.id}`.slice(0, 40),
        notes: {
          workspaceId: workspace.id,
          planId: plan.id,
          userId: user.id,
          email: user.email || '',
          taxMode: billingPolicy.taxMode,
          taxPercent: String(billingPolicy.taxPercent),
          prorationPolicy: billingPolicy.prorationPolicy
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.description || `Razorpay order failed with HTTP ${response.status}.`);
    return {
      id: cleanText(payload.id || makeId('chk'), 120),
      provider: 'razorpay',
      mode: 'order',
      status: cleanText(payload.status || 'created', 60),
      workspaceId: workspace.id,
      planId: plan.id,
      amountInr: amount.totalInr,
      subtotalInr: amount.subtotalInr,
      taxInr: amount.taxInr,
      billingPolicy,
      checkoutUrl: '',
      providerCheckoutId: cleanText(payload.id || '', 120),
      providerKeyId: keyId
    };
  }

  const razorpayPlanId = await resolveRazorpayPlanId(baseUrl, authHeader, plan, amount);
  const response = await fetch(`${baseUrl}/subscriptions`, {
    method: 'POST',
    headers: {
      authorization: authHeader,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      plan_id: razorpayPlanId,
      total_count: 120,
      quantity: 1,
      customer_notify: 1,
      notes: {
        workspaceId: workspace.id,
        planId: plan.id,
        userId: user.id,
        email: user.email || '',
        taxMode: billingPolicy.taxMode,
        taxPercent: String(billingPolicy.taxPercent),
        prorationPolicy: billingPolicy.prorationPolicy
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.description || `Razorpay subscription creation failed with HTTP ${response.status}.`);

  return {
    id: cleanText(payload.id || makeId('sub_rzp'), 120),
    provider: 'razorpay',
    mode: 'subscription',
    status: cleanText(payload.status || 'created', 60),
    workspaceId: workspace.id,
    planId: plan.id,
    amountInr: amount.totalInr,
    subtotalInr: amount.subtotalInr,
    taxInr: amount.taxInr,
    billingPolicy,
    checkoutUrl: payload.short_url || '',
    providerCheckoutId: cleanText(payload.id || '', 120),
    providerSubscriptionId: cleanText(payload.id || '', 120),
    providerKeyId: keyId
  };
}

async function createBillingPortalSession(db, workspaceId) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
  if (!subscription || subscription.provider !== 'stripe' || !subscription.providerCustomerId) {
    return {
      ok: true,
      session: {
        id: makeId('bpt'),
        provider: 'local_manual',
        mode: 'manual',
        workspaceId,
        url: '/app#billing',
        message: 'A Stripe-backed customer subscription is required for the billing portal.'
      }
    };
  }
  if (!billingProviderConfigured('stripe')) {
    return { ok: false, message: 'Stripe billing provider is not configured.' };
  }
  const baseUrl = (cleanUrl(process.env.STRIPE_BASE_URL || '') || 'https://api.stripe.com/v1').replace(/\/$/, '');
  const appUrl = (cleanUrl(process.env.APP_URL || '') || 'http://localhost:4173').replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('customer', subscription.providerCustomerId);
  params.set('return_url', `${appUrl}/app#billing`);
  if (envConfigured('STRIPE_PORTAL_CONFIGURATION_ID')) params.set('configuration', process.env.STRIPE_PORTAL_CONFIGURATION_ID);
  const response = await fetch(`${baseUrl}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, message: payload.error?.message || `Stripe portal failed with HTTP ${response.status}.` };
  return {
    ok: true,
    session: {
      id: cleanText(payload.id || makeId('bpt'), 120),
      provider: 'stripe',
      mode: 'customer_portal',
      workspaceId,
      customerId: subscription.providerCustomerId,
      url: cleanUrl(payload.url || ''),
      workspaceName: workspace?.name || ''
    }
  };
}

function chooseBillingProvider(preferred) {
  const normalized = normalizeBillingProvider(preferred);
  if (normalized && billingProviderConfigured(normalized)) return normalized;
  if (billingProviderConfigured('stripe')) return 'stripe';
  if (billingProviderConfigured('razorpay')) return 'razorpay';
  return '';
}

function normalizeBillingProvider(value) {
  const provider = cleanText(value || '', 40).toLowerCase();
  if (provider === 'stripe' || provider === 'razorpay') return provider;
  return '';
}

function billingProviderConfigured(provider) {
  if (provider === 'stripe') return envConfigured('STRIPE_SECRET_KEY');
  if (provider === 'razorpay') return envConfigured('RAZORPAY_KEY_ID') && envConfigured('RAZORPAY_SECRET');
  return false;
}

function anyBillingProviderConfigured() {
  return Boolean(chooseBillingProvider());
}

function manualBillingAllowed(user) {
  if (user?.platformRole === 'super_admin') return true;
  if (process.env.NODE_ENV === 'production') return false;
  return !anyBillingProviderConfigured();
}

function verifyBillingWebhookSignature(provider, rawBody, headers) {
  if (provider === 'stripe') {
    const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '');
    if (!secret) return { ok: false, message: 'STRIPE_WEBHOOK_SECRET is not configured.' };
    const signature = String(headers['stripe-signature'] || '');
    const timestamp = (signature.match(/(?:^|,)t=([^,]+)/) || [])[1] || '';
    const actual = (signature.match(/(?:^|,)v1=([^,]+)/) || [])[1] || '';
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    if (!timingSafeEqualHex(actual, expected)) {
      return { ok: false, message: 'Stripe webhook signature is invalid.' };
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const tsSeconds = parseInt(timestamp, 10);
    if (isNaN(tsSeconds) || Math.abs(nowSeconds - tsSeconds) > 300) {
      return { ok: false, message: 'Stripe webhook signature is invalid.' };
    }
    return { ok: true, mode: 'stripe' };
  }
  const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '');
  if (!secret) return { ok: false, message: 'RAZORPAY_WEBHOOK_SECRET is not configured.' };
  const actual = String(headers['x-razorpay-signature'] || '');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(actual, expected) ? { ok: true, mode: 'razorpay' } : { ok: false, message: 'Razorpay webhook signature is invalid.' };
}

function timingSafeEqualHex(actual, expected) {
  if (!/^[a-f0-9]+$/i.test(actual) || !/^[a-f0-9]+$/i.test(expected)) return false;
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function applyBillingWebhookEvent(db, provider, event) {
  return provider === 'stripe'
    ? applyStripeBillingEvent(db, event)
    : applyRazorpayBillingEvent(db, event);
}

function applyStripeBillingEvent(db, event) {
  const type = cleanText(event.type || '', 120);
  const object = event.data?.object || {};
  const eventCreated = Math.max(0, Number(event.created || 0));
  const existingSubscriptionId = object.subscription || (type.startsWith('customer.subscription.') ? object.id : '');
  const existingSubscription = db.subscriptions.find((item) => item.providerSubscriptionId === existingSubscriptionId);
  if (eventCreated && Number(existingSubscription?.billingPolicy?.providerEventCreated || 0) > eventCreated) {
    return { eventId: event.id || '', eventType: type, action: 'ignored_out_of_order', workspaceId: existingSubscription?.workspaceId || '' };
  }
  if (type === 'checkout.session.completed') {
    const workspaceId = cleanText(object.metadata?.workspaceId || object.client_reference_id || '', 120);
    const planId = cleanText(object.metadata?.planId || '', 40);
    const subscription = applyProviderSubscription(db, workspaceId, planId, 'stripe', object.subscription || object.id, 'active', object.customer || '', object.metadata || {});
    recordProviderEvent(subscription, eventCreated);
    return { eventId: event.id || '', eventType: type, action: 'subscription_activated', workspaceId, subscriptionId: subscription?.id || '' };
  }
  if (type === 'invoice.paid') {
    const workspaceId = findWorkspaceIdByProviderSubscription(db, object.subscription);
    const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
    const planId = subscription?.planId || '';
    if (workspaceId) {
      upsertProviderInvoice(db, workspaceId, 'stripe', object.id, 'paid', Number(object.amount_paid || object.amount_due || 0) / 100, planId);
      if (subscription) {
        subscription.status = 'active';
        subscription.updatedAt = new Date().toISOString();
        recordProviderEvent(subscription, eventCreated);
        const workspace = db.workspaces.find((item) => item.id === workspaceId);
        if (workspace) {
          workspace.planId = subscription.planId;
          workspace.billingWarning = '';
          workspace.updatedAt = subscription.updatedAt;
        }
      }
    }
    return { eventId: event.id || '', eventType: type, action: workspaceId ? 'invoice_paid' : 'ignored', workspaceId };
  }
  if (type === 'invoice.payment_failed') {
    const workspaceId = findWorkspaceIdByProviderSubscription(db, object.subscription);
    if (workspaceId) {
      markProviderPaymentFailed(db, workspaceId, 'stripe', object.id);
      recordProviderEvent(db.subscriptions.find((item) => item.workspaceId === workspaceId), eventCreated);
    }
    return { eventId: event.id || '', eventType: type, action: workspaceId ? 'payment_failed' : 'ignored', workspaceId };
  }
  if (type === 'customer.subscription.deleted') {
    const workspaceId = findWorkspaceIdByProviderSubscription(db, object.id);
    const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
    if (workspaceId && subscription) {
      subscription.status = 'canceled';
      subscription.updatedAt = new Date().toISOString();
      recordProviderEvent(subscription, eventCreated);
      applyGracefulDowngrade(db, workspaceId);
    }
    return { eventId: event.id || '', eventType: type, action: workspaceId ? 'subscription_canceled' : 'ignored', workspaceId };
  }
  if (type === 'customer.subscription.updated') {
    const workspaceId = findWorkspaceIdByProviderSubscription(db, object.id);
    const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
    if (workspaceId && subscription) {
      if (Number.isFinite(object.current_period_start)) {
        subscription.currentPeriodStart = new Date(object.current_period_start * 1000).toISOString();
      }
      if (Number.isFinite(object.current_period_end)) {
        subscription.currentPeriodEnd = new Date(object.current_period_end * 1000).toISOString();
      }
      const status = object.status;
      if (status === 'active' || status === 'trialing') {
        subscription.status = 'active';
      } else if (status === 'past_due' || status === 'unpaid') {
        subscription.status = 'past_due';
      } else if (status === 'canceled' || status === 'incomplete_expired') {
        subscription.status = 'canceled';
        applyGracefulDowngrade(db, workspaceId);
      }
      subscription.updatedAt = new Date().toISOString();
      recordProviderEvent(subscription, eventCreated);
    }
    return { eventId: event.id || '', eventType: type, action: workspaceId ? 'subscription_updated' : 'ignored', workspaceId };
  }
  return { eventId: event.id || '', eventType: type || 'unknown', action: 'ignored', workspaceId: '' };
}

function recordProviderEvent(subscription, eventCreated) {
  if (!subscription || !eventCreated) return;
  subscription.billingPolicy = { ...(subscription.billingPolicy || {}), providerEventCreated: eventCreated };
}

function applyRazorpayBillingEvent(db, event) {
  const type = cleanText(event.event || event.type || '', 120);
  const entity = event.payload?.subscription?.entity || event.payload?.order?.entity || event.payload?.payment?.entity || {};
  const notes = entity.notes || {};
  const subscriptionId = entity.subscription_id || (type.startsWith('subscription.') ? entity.id : '');
  const workspaceId = cleanText(notes.workspaceId || findWorkspaceIdByProviderSubscription(db, subscriptionId), 120);
  const planId = cleanText(notes.planId || '', 40);
  const eventCreated = Math.max(0, Number(event.created_at || entity.created_at || 0));

  const existingSubscription = db.subscriptions.find((item) => item.providerSubscriptionId === (subscriptionId || entity.id));
  if (eventCreated && Number(existingSubscription?.billingPolicy?.providerEventCreated || 0) > eventCreated) {
    return { eventId: event.id || '', eventType: type, action: 'ignored_out_of_order', workspaceId };
  }

  if (['order.paid', 'subscription.activated', 'subscription.charged'].includes(type)) {
    const activeSubId = subscriptionId || entity.id;
    const subscription = applyProviderSubscription(db, workspaceId, planId, 'razorpay', activeSubId, 'active', entity.customer_id || '', notes);
    recordProviderEvent(subscription, eventCreated);
    upsertProviderInvoice(db, workspaceId, 'razorpay', entity.id, 'paid', Number(entity.amount_paid || entity.amount || 0) / 100, planId);
    return { eventId: event.id || entity.id || '', eventType: type, action: 'subscription_activated', workspaceId, subscriptionId: subscription?.id || '' };
  }

  if (['subscription.cancelled', 'subscription.completed'].includes(type)) {
    if (workspaceId) {
      const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
      if (subscription) {
        subscription.status = 'cancelled';
        subscription.cancelledAt = new Date().toISOString();
        subscription.updatedAt = subscription.cancelledAt;
        recordProviderEvent(subscription, eventCreated);
      }
      const workspace = db.workspaces.find((item) => item.id === workspaceId);
      if (workspace) {
        workspace.previousPlanId = workspace.planId;
        workspace.planId = 'starter';
        workspace.updatedAt = new Date().toISOString();
      }
    }
    return { eventId: event.id || entity.id || '', eventType: type, action: 'subscription_cancelled', workspaceId };
  }

  if (type === 'subscription.paused') {
    if (workspaceId) {
      const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
      if (subscription) {
        subscription.status = 'paused';
        subscription.updatedAt = new Date().toISOString();
        recordProviderEvent(subscription, eventCreated);
      }
    }
    return { eventId: event.id || entity.id || '', eventType: type, action: 'subscription_paused', workspaceId };
  }

  if (type === 'subscription.resumed') {
    if (workspaceId) {
      const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
      if (subscription) {
        subscription.status = 'active';
        subscription.updatedAt = new Date().toISOString();
        recordProviderEvent(subscription, eventCreated);
      }
    }
    return { eventId: event.id || entity.id || '', eventType: type, action: 'subscription_resumed', workspaceId };
  }

  if (type === 'payment.failed') {
    if (workspaceId) markProviderPaymentFailed(db, workspaceId, 'razorpay', entity.id);
    return { eventId: event.id || entity.id || '', eventType: type, action: workspaceId ? 'payment_failed' : 'ignored', workspaceId };
  }

  return { eventId: event.id || entity.id || '', eventType: type || 'unknown', action: 'ignored', workspaceId };
}

function applyProviderSubscription(db, workspaceId, planId, provider, providerSubscriptionId, status, providerCustomerId = '', policyInput = {}) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const plan = findBillingPlan(db, planId);
  if (!workspace || !plan) return null;
  const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId) || createSubscription(workspaceId, plan.id);
  subscription.planId = plan.id;
  subscription.provider = provider;
  subscription.providerSubscriptionId = cleanText(providerSubscriptionId || subscription.providerSubscriptionId, 160);
  subscription.providerCustomerId = cleanText(providerCustomerId || subscription.providerCustomerId || '', 160);
  subscription.status = cleanText(status || 'active', 60);
  subscription.currentPeriodStart = startOfMonth();
  subscription.currentPeriodEnd = endOfMonth();
  subscription.billingPolicy = billingPolicySnapshot(policyInput);
  subscription.updatedAt = new Date().toISOString();
  if (!db.subscriptions.includes(subscription)) db.subscriptions.push(subscription);
  workspace.planId = plan.id;
  workspace.billingWarning = '';
  workspace.updatedAt = subscription.updatedAt;
  unlockOverLimitResponses(db, workspaceId);
  return subscription;
}

function unlockOverLimitResponses(db, workspaceId) {
  const limitCheck = checkPlanLimit(db, workspaceId, 'responsesPerMonth');
  if (limitCheck.ok) {
    for (const response of db.responses) {
      if (response.workspaceId === workspaceId && response.status === 'over_limit') {
        response.status = 'completed';
        response.updatedAt = new Date().toISOString();
        const survey = db.surveys.find((s) => s.id === response.surveyId);
        if (survey) survey.metrics.completions += 1;
        updateUsage(db, workspaceId, { responsesCount: 1, storageUsed: response.fileUploadBytes || 0 });
      }
    }
  }
}

function findWorkspaceIdByProviderSubscription(db, providerSubscriptionId) {
  const safeId = cleanText(providerSubscriptionId || '', 160);
  if (!safeId) return '';
  return db.subscriptions.find((item) => item.providerSubscriptionId === safeId)?.workspaceId || '';
}

function upsertProviderInvoice(db, workspaceId, provider, providerInvoiceId, status, amountInr, planId) {
  if (!workspaceId) return null;
  let invoice = db.invoices.find((item) => item.provider === provider && item.providerInvoiceId === providerInvoiceId);
  if (!invoice) {
    const providerPolicy = billingPolicySnapshot({
      taxMode: normalizeBillingTaxMode(process.env.BILLING_TAX_MODE || 'none') === 'none' ? 'none' : 'inclusive',
      taxPercent: process.env.BILLING_TAX_PERCENT
    });
    invoice = createInvoice(workspaceId, {
      provider,
      providerInvoiceId,
      status,
      amountDueInr: amountInr,
      amountPaidInr: status === 'paid' ? amountInr : 0,
      taxMode: providerPolicy.taxMode,
      taxPercent: providerPolicy.taxPercent,
      lineItems: [{ description: `${planId || 'Subscription'} monthly subscription`, quantity: 1, unitAmountInr: amountInr }]
    });
    db.invoices.push(invoice);
  }
  invoice.status = status;
  invoice.amountPaidInr = status === 'paid' ? amountInr : invoice.amountPaidInr;
  invoice.updatedAt = new Date().toISOString();
  return invoice;
}

function markProviderPaymentFailed(db, workspaceId, provider, providerInvoiceId) {
  const subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
  if (subscription) {
    subscription.status = 'past_due';
    subscription.updatedAt = new Date().toISOString();
  }
  if (providerInvoiceId) upsertProviderInvoice(db, workspaceId, provider, providerInvoiceId, 'open', 0, subscription?.planId || '');
  applyGracefulDowngrade(db, workspaceId);
}

async function emitMonitoringError(errorLog) {
  const tasks = [];
  if (envConfigured('SENTRY_DSN')) tasks.push(sendSentryError(errorLog));
  if (envConfigured('POSTHOG_KEY')) tasks.push(sendPostHogEvent('server_error', monitoringProperties(errorLog)));
  if (!tasks.length) return;
  await Promise.allSettled(tasks);
}

async function sendSentryError(errorLog) {
  const config = sentryConfig();
  if (!config) return;
  await monitoringFetch(config.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sentry-auth': `Sentry sentry_version=7, sentry_client=formspear/0.1, sentry_key=${config.publicKey}`
    },
    body: JSON.stringify({
      event_id: errorLog.id.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32),
      timestamp: errorLog.createdAt,
      platform: 'node',
      logger: 'formspear',
      level: 'error',
      transaction: `${errorLog.method} ${errorLog.path}`,
      message: errorLog.message,
      exception: {
        values: [{
          type: errorLog.name,
          value: errorLog.message,
          stacktrace: { frames: errorLog.stack ? [{ function: errorLog.path, context_line: errorLog.stack.slice(0, 500) }] : [] }
        }]
      },
      request: {
        method: errorLog.method,
        url: `${errorLog.path}${errorLog.query || ''}`,
        headers: { 'user-agent': errorLog.userAgent }
      },
      tags: { service: 'formspear' }
    })
  });
}

function sentryConfig() {
  try {
    const dsn = new URL(process.env.SENTRY_DSN || '');
    const projectId = dsn.pathname.replace(/^\/+/, '').split('/').pop();
    if (!dsn.username || !projectId) return null;
    return {
      publicKey: dsn.username,
      url: `${dsn.protocol}//${dsn.host}/api/${projectId}/store/`
    };
  } catch {
    return null;
  }
}

async function sendPostHogEvent(event, properties) {
  const host = (cleanUrl(process.env.POSTHOG_HOST || '') || 'https://app.posthog.com').replace(/\/$/, '');
  await monitoringFetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: String(process.env.POSTHOG_KEY || ''),
      event,
      distinct_id: 'formspear-server',
      properties
    })
  });
}

function monitoringProperties(errorLog) {
  return {
    errorId: errorLog.id,
    path: errorLog.path,
    method: errorLog.method,
    name: errorLog.name,
    message: errorLog.message,
    createdAt: errorLog.createdAt
  };
}

async function monitoringFetch(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(process.env.MONITORING_TIMEOUT_MS || 5000)));
  try {
    await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function applyGracefulDowngrade(db, workspaceId) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return;
  workspace.previousPlanId = workspace.planId;
  workspace.planId = 'starter';
  workspace.billingWarning = 'Payment failed. Workspace moved to Starter limits until billing is resolved.';
  workspace.updatedAt = new Date().toISOString();
}

function inferQuestionType(text) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('email')) return 'email';
  if (lower.includes('phone')) return 'phone';
  if (lower.includes('how likely') || lower.includes('recommend')) return 'nps';
  if (lower.includes('satisfied') || lower.includes('rate')) return 'csat';
  if (lower.includes('when') || lower.includes('date')) return 'date';
  return 'long_text';
}

async function completeResponse(db, survey, schema, response, answers, metadata, options = {}) {
  const wasCompleted = response.status === 'completed';
  const isOverLimit = Boolean(options.overLimit);
  const storedAnswers = await persistFileAnswers(db, survey, schema, response, answers);
  response.answersJson = survey.settings.anonymousMode ? anonymizeResponseAnswers(schema, storedAnswers) : storedAnswers;
  response.metadataJson = survey.settings.anonymousMode ? anonymizeResponseMetadata(metadata) : metadata;
  response.status = isOverLimit ? 'over_limit' : 'completed';
  response.sentiment = classifySentiment(answersToText(response.answersJson));
  response.leadScore = calculateLeadScore(schema, response.answersJson, response.metadataJson);
  const logicEffects = applyResponseLogic(db, survey, schema, response, response.answersJson, !wasCompleted && !isOverLimit);
  if (logicEffects.scoreDelta) response.leadScore = Math.max(0, Math.min(100, response.leadScore + logicEffects.scoreDelta));
  response.logicCompletionJson = logicEffects.completion || null;
  response.submittedAt = response.submittedAt || new Date().toISOString();
  response.updatedAt = new Date().toISOString();
  response.tagsJson = uniqueTags([...(response.tagsJson || []), ...logicEffects.tags, ...defaultTags(response)]);
  if (!wasCompleted && !isOverLimit) {
    survey.metrics.completions += 1;
    const storageBytes = response.fileUploadBytes || 0;
    updateUsage(db, survey.workspaceId, { responsesCount: 1, storageUsed: storageBytes });
    if (!survey.settings.anonymousMode) upsertRespondentAndContact(db, survey, schema, response);
    processAlerts(db, survey, response);
    processWebhooks(db, survey, response);
    processIntegrations(db, survey, response);
  }
}

function anonymizeResponseAnswers(schema, answers) {
  const output = { ...(answers || {}) };
  for (const questionItem of schema.questions || []) {
    if (isPersonalQuestion(questionItem) && output[questionItem.id] !== undefined) {
      output[questionItem.id] = '[anonymous]';
    }
  }
  return output;
}

function isPersonalQuestion(questionItem) {
  return ['email', 'phone'].includes(questionItem.type)
    || /(^|\b)(name|email|phone|mobile|contact|employee id|user id)($|\b)/i.test(questionItem.title || '')
    || /(^|\b)(name|email|phone|mobile|contact|employee_id|user_id)($|\b)/i.test(questionItem.id || '');
}

function anonymizeResponseMetadata(metadata) {
  return {
    ...(metadata || {}),
    ipHash: '',
    userAgent: '',
    browser: '',
    os: '',
    referrer: '',
    browserId: '',
    userId: '',
    externalId: '',
    anonymous: true
  };
}

async function completeResponseForSubmission(res, db, survey, schema, response, answers, metadata, options = {}) {
  const initialFileUploadCount = db.fileUploads.length;
  try {
    await completeResponse(db, survey, schema, response, answers, metadata, options);
    return true;
  } catch (error) {
    db.fileUploads.splice(initialFileUploadCount);
    if (options.removeOnFailure) {
      const index = db.responses.findIndex((item) => item.id === response.id);
      if (index >= 0) db.responses.splice(index, 1);
    } else {
      response.status = 'partial';
      response.updatedAt = new Date().toISOString();
    }
    if (error?.code === 'file_upload_rejected') {
      sendJson(res, 400, { error: { code: error.code, message: error.message, details: error.details || {} } });
      return false;
    }
    throw error;
  }
}

function applyResponseLogic(db, survey, schema, response, answers, allowNotifications = true) {
  const effects = { tags: [], scoreDelta: 0, completion: null };
  for (const rule of schema.logic || []) {
    if (['show_question', 'skip_to_question'].includes(rule.action)) continue;
    if (!evaluateCondition(answers[rule.questionId], rule.operator, rule.value)) continue;
    if (rule.action === 'assign_tag') {
      effects.tags.push(rule.actionValue || 'logic-match');
    }
    if (rule.action === 'set_hidden_field' && rule.targetQuestionId) {
      answers[rule.targetQuestionId] = rule.actionValue;
    }
    if (rule.action === 'calculate_score') {
      effects.scoreDelta += Number(rule.scoreDelta || rule.actionValue || 0);
    }
    if (rule.action === 'trigger_alert' && allowNotifications) {
      const notification = {
        id: makeId('ntf'),
        workspaceId: survey.workspaceId,
        surveyId: survey.id,
        responseId: response.id,
        alertId: '',
        title: `Logic alert: ${survey.title}`,
        message: cleanText(rule.actionValue || `Logic rule matched ${rule.questionId}.`, 240),
        channels: { inApp: true, logic: true },
        read: false,
        createdAt: new Date().toISOString()
      };
      db.notifications.push(notification);
      effects.tags.push('logic-alert');
    }
    if (rule.action === 'end_survey') {
      effects.completion = {
        type: 'message',
        message: rule.actionValue || schema.completion?.message || 'Thank you for your response.',
        redirectUrl: ''
      };
    }
    if (rule.action === 'redirect' && rule.redirectUrl) {
      effects.completion = {
        type: 'redirect',
        message: rule.actionValue || schema.completion?.message || 'Thank you for your response.',
        redirectUrl: rule.redirectUrl
      };
    }
  }
  effects.scoreDelta = Math.max(-100, Math.min(100, effects.scoreDelta));
  effects.tags = uniqueTags(effects.tags);
  return effects;
}

async function persistFileAnswers(db, survey, schema, response, answers) {
  const output = structuredClone(answers);
  let storageBytes = 0;
  const uploadQuestions = schema.questions.filter((questionItem) => questionItem.type === 'file_upload');
  const preparedQuestions = new Map();
  const preparedUploads = [];

  for (const questionItem of uploadQuestions) {
    const value = output[questionItem.id];
    if (!value) continue;
    const files = Array.isArray(value) ? value : [value];
    const entries = [];
    for (const file of files) {
      if (!isFileLike(file)) {
        entries.push({ kind: 'existing', value: file });
        continue;
      }
      if (file.fileId) {
        entries.push({ kind: 'existing', value: file });
        continue;
      }
      const prepared = await prepareFileUpload(db, survey, response, questionItem, file);
      entries.push({ kind: 'upload', prepared });
      preparedUploads.push(prepared);
    }
    preparedQuestions.set(questionItem.id, { isArray: Array.isArray(value), entries });
  }

  for (const prepared of preparedUploads) {
    await storeFileUploadPayload(prepared.upload, prepared.file, prepared.payload);
    db.fileUploads.push(prepared.upload);
    storageBytes += prepared.upload.size;
  }

  for (const [questionId, prepared] of preparedQuestions.entries()) {
    const stored = prepared.entries.map((entry) => (
      entry.kind === 'upload' ? fileUploadAnswerMetadata(entry.prepared.upload) : entry.value
    ));
    output[questionId] = prepared.isArray ? stored : stored[0];
  }
  response.fileUploadBytes = (response.fileUploadBytes || 0) + storageBytes;
  return output;
}

async function prepareFileUpload(db, survey, response, questionItem, file) {
  if (process.env.NODE_ENV === 'production' && (!objectStorageConfigured() || !fileScanConfig().providerUrl)) {
    throw new UploadScanError('File uploads are not enabled for this deployment.', { reason: 'uploads_disabled' });
  }
  const payload = decodeDataUrlBuffer(file.dataUrl || '');
  const createdAt = new Date().toISOString();
  const upload = {
    id: makeId('upl'),
    workspaceId: survey.workspaceId,
    surveyId: survey.id,
    responseId: response.id,
    questionId: questionItem.id,
    name: cleanText(file.name || 'upload', 240),
    type: cleanText(file.type || '', 120),
    extension: cleanText(file.extension || path.extname(file.name || '').slice(1), 20).toLowerCase(),
    size: payload.length,
    sha256: crypto.createHash('sha256').update(payload).digest('hex'),
    storageProvider: '',
    storageBucket: '',
    storageKey: '',
    storageUrl: '',
    dataUrl: '',
    scanStatus: 'pending',
    scanProvider: '',
    scanSignature: '',
    scanMessage: '',
    scanCheckedAt: '',
    quarantined: false,
    lifecycleStatus: 'active',
    retentionExpiresAt: fileUploadRetentionExpiresAt(db, survey.workspaceId, response),
    deletedAt: '',
    createdAt
  };
  const scan = await scanFileUpload(upload, payload);
  applyUploadScanResult(upload, scan);
  if (upload.quarantined) {
    throw new UploadScanError(`${questionItem.title} failed file security scan.`, {
      questionId: questionItem.id,
      fileName: upload.name,
      status: upload.scanStatus,
      provider: upload.scanProvider,
      message: upload.scanMessage
    });
  }
  return { upload, file, payload };
}

async function storeFileUploadPayload(upload, file, payload = null) {
  if (!objectStorageConfigured()) {
    upload.storageProvider = 'local_json';
    upload.dataUrl = typeof file.dataUrl === 'string' ? file.dataUrl : '';
    return upload;
  }
  const uploadPayload = Buffer.isBuffer(payload) ? payload : decodeDataUrlBuffer(file.dataUrl || '');
  const stored = await putObjectStorage(upload, uploadPayload);
  upload.storageProvider = 's3_compatible';
  upload.storageBucket = stored.bucket;
  upload.storageKey = stored.key;
  upload.storageUrl = stored.url;
  upload.dataUrl = '';
  return upload;
}

function fileUploadAnswerMetadata(upload) {
  return {
    fileId: upload.id,
    name: upload.name,
    type: upload.type,
    extension: upload.extension,
    size: upload.size,
    sha256: upload.sha256,
    storageProvider: upload.storageProvider,
    storageKey: upload.storageKey,
    storageUrl: upload.storageUrl,
    scanStatus: upload.scanStatus,
    scanProvider: upload.scanProvider,
    scanCheckedAt: upload.scanCheckedAt,
    lifecycleStatus: upload.lifecycleStatus,
    retentionExpiresAt: upload.retentionExpiresAt
  };
}

async function scanFileUpload(upload, payload) {
  const localScan = localFileScan(upload, payload);
  if (localScan.quarantined) return localScan;
  const config = fileScanConfig();
  if (config.mode === 'off') {
    return { status: 'not_scanned', provider: 'disabled', message: 'File scanning is disabled.', quarantined: false };
  }
  if (!config.providerUrl || config.mode === 'local') {
    return localScan;
  }
  try {
    return await requestFileScanProvider(config, upload, payload);
  } catch (error) {
    const message = cleanText(error.message || String(error), 400);
    if (config.failOpen) {
      return { status: 'scan_failed', provider: 'scan_provider', message, quarantined: false };
    }
    throw new UploadScanError('File security scan could not complete.', {
      fileName: upload.name,
      status: 'scan_failed',
      provider: 'scan_provider',
      message
    });
  }
}

function localFileScan(upload, payload) {
  const blockedExtensions = fileScanBlockedExtensions();
  const extension = cleanText(upload.extension || '', 20).toLowerCase().replace(/^\./, '');
  if (extension && blockedExtensions.has(extension)) {
    return {
      status: 'blocked',
      provider: 'local_policy',
      signature: `blocked_extension:${extension}`,
      message: `${extension} uploads are blocked by file security policy.`,
      quarantined: true
    };
  }
  const content = payload.toString('latin1');
  if (content.includes(EICAR_TEST_SIGNATURE)) {
    return {
      status: 'infected',
      provider: 'local_policy',
      signature: 'EICAR-Test-File',
      message: 'EICAR antivirus test signature detected.',
      quarantined: true
    };
  }
  return {
    status: 'clean',
    provider: 'local_policy',
    signature: '',
    message: 'Local file policy scan passed.',
    quarantined: false
  };
}

async function requestFileScanProvider(config, upload, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.providerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {})
      },
      body: JSON.stringify({
        name: upload.name,
        mimeType: upload.type,
        extension: upload.extension,
        size: upload.size,
        sha256: upload.sha256,
        contentBase64: payload.toString('base64')
      }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || `File scan provider failed with HTTP ${response.status}.`);
    return normalizeProviderScanResult(result);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProviderScanResult(result = {}) {
  const rawStatus = cleanText(result.status || result.verdict || '', 60).toLowerCase();
  const provider = cleanText(result.provider || result.engine || 'scan_provider', 80);
  const signature = cleanText(result.signature || result.threat || result.malware || '', 160);
  const message = cleanText(result.message || result.reason || '', 400);
  if (['clean', 'safe', 'ok', 'pass', 'passed'].includes(rawStatus)) {
    return { status: 'clean', provider, signature, message: message || 'File scan provider passed.', quarantined: false };
  }
  if (['infected', 'malware', 'virus', 'threat'].includes(rawStatus)) {
    return { status: 'infected', provider, signature, message: message || 'File scan provider detected malware.', quarantined: true };
  }
  if (['blocked', 'rejected', 'deny', 'denied'].includes(rawStatus)) {
    return { status: 'blocked', provider, signature, message: message || 'File scan provider blocked the upload.', quarantined: true };
  }
  if (['quarantined', 'quarantine'].includes(rawStatus)) {
    return { status: 'quarantined', provider, signature, message: message || 'File scan provider quarantined the upload.', quarantined: true };
  }
  throw new Error(`File scan provider returned unknown status ${rawStatus || 'empty'}.`);
}

function applyUploadScanResult(upload, scan) {
  upload.scanStatus = cleanText(scan.status || 'scan_failed', 60);
  upload.scanProvider = cleanText(scan.provider || 'unknown', 80);
  upload.scanSignature = cleanText(scan.signature || '', 160);
  upload.scanMessage = cleanText(scan.message || '', 400);
  upload.scanCheckedAt = new Date().toISOString();
  upload.quarantined = Boolean(scan.quarantined || ['infected', 'blocked', 'quarantined'].includes(upload.scanStatus));
  if (upload.quarantined) upload.lifecycleStatus = 'quarantined';
  return upload;
}

function fileScanConfig() {
  const mode = cleanText(process.env.FILE_SCAN_MODE || '', 40).toLowerCase();
  const providerUrl = cleanUrl(process.env.FILE_SCAN_PROVIDER_URL || '');
  const normalizedMode = ['off', 'local', 'provider'].includes(mode) ? mode : (providerUrl ? 'provider' : 'local');
  return {
    mode: normalizedMode,
    providerUrl,
    token: String(process.env.FILE_SCAN_PROVIDER_TOKEN || ''),
    timeoutMs: Math.max(500, Math.min(30000, Number(process.env.FILE_SCAN_TIMEOUT_MS || 5000))),
    failOpen: parseBoolean(process.env.FILE_SCAN_FAIL_OPEN || false)
  };
}

function fileScanBlockedExtensions() {
  const configured = process.env.FILE_SCAN_BLOCKED_EXTENSIONS || 'exe,com,scr,bat,cmd,ps1,sh,vbs,js,jar,msi,dll';
  return new Set(String(configured)
    .split(',')
    .map((item) => cleanText(item, 20).toLowerCase().replace(/^\./, ''))
    .filter(Boolean));
}

function fileUploadRetentionExpiresAt(db, workspaceId, response) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const retentionDays = Number.isFinite(Number(workspace?.retentionDays)) ? Math.max(1, Number(workspace.retentionDays)) : 365;
  const baseTime = new Date(response.submittedAt || response.createdAt || new Date().toISOString()).getTime();
  return new Date(baseTime + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

function objectStorageConfigured() {
  return envConfigured('S3_ACCESS_KEY') && envConfigured('S3_SECRET_KEY') && envConfigured('S3_BUCKET');
}

function objectStorageConfig() {
  const bucket = cleanText(process.env.S3_BUCKET || '', 120);
  const region = cleanText(process.env.S3_REGION || 'auto', 80);
  const endpoint = (cleanUrl(process.env.S3_ENDPOINT || '') || `https://s3.${region === 'auto' ? 'us-east-1' : region}.amazonaws.com`).replace(/\/$/, '');
  return {
    accessKey: String(process.env.S3_ACCESS_KEY || ''),
    secretKey: String(process.env.S3_SECRET_KEY || ''),
    bucket,
    region,
    endpoint,
    publicBaseUrl: (cleanUrl(process.env.S3_PUBLIC_BASE_URL || '') || '').replace(/\/$/, '')
  };
}

async function putObjectStorage(upload, payload) {
  const config = objectStorageConfig();
  const key = [
    upload.workspaceId,
    upload.surveyId,
    upload.responseId,
    `${upload.id}-${slugify(upload.name) || 'upload'}`
  ].join('/');
  const url = new URL(`${config.endpoint}/${encodeURIComponent(config.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const contentType = upload.type || 'application/octet-stream';
  const headers = signS3Request(config, url, payload, contentType, 'PUT');
  const response = await fetch(url, { method: 'PUT', headers, body: payload });
  if (!response.ok) throw new Error(`Object storage upload failed with HTTP ${response.status}.`);
  return {
    bucket: config.bucket,
    key,
    url: config.publicBaseUrl ? `${config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}` : url.toString()
  };
}

async function deleteObjectStorage(input = {}) {
  if (!input.key) return;
  const config = objectStorageConfig();
  const url = new URL(`${config.endpoint}/${encodeURIComponent(input.bucket || config.bucket)}/${String(input.key).split('/').map(encodeURIComponent).join('/')}`);
  const payload = Buffer.alloc(0);
  const response = await fetch(url, { method: 'DELETE', headers: signS3Request(config, url, payload, 'application/octet-stream', 'DELETE') });
  if (!response.ok && response.status !== 404) throw new Error(`Object storage deletion failed with HTTP ${response.status}.`);
}

function signS3Request(config, url, payload, contentType, method) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    ''
  ].join('\n');
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  const signingKey = s3SigningKey(config.secretKey, dateStamp, config.region);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'content-type': contentType,
    'content-length': String(payload.length),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
}

function s3SigningKey(secretKey, dateStamp, region) {
  const dateKey = crypto.createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
  const dateRegionKey = crypto.createHmac('sha256', dateKey).update(region).digest();
  const dateRegionServiceKey = crypto.createHmac('sha256', dateRegionKey).update('s3').digest();
  return crypto.createHmac('sha256', dateRegionServiceKey).update('aws4_request').digest();
}

function presignObjectStorageGet(upload, expiresIn = 900) {
  const config = objectStorageConfig();
  const key = upload.storageKey || '';
  const url = new URL(`${config.endpoint}/${encodeURIComponent(upload.storageBucket || config.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${config.accessKey}/${credentialScope}`);
  url.searchParams.set('X-Amz-Date', amzDate);
  url.searchParams.set('X-Amz-Expires', String(expiresIn));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  const canonicalRequest = [
    'GET',
    url.pathname,
    canonicalQueryString(url.searchParams),
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  const signature = crypto.createHmac('sha256', s3SigningKey(config.secretKey, dateStamp, config.region)).update(stringToSign).digest('hex');
  url.searchParams.set('X-Amz-Signature', signature);
  return url.toString();
}

function canonicalQueryString(searchParams) {
  return [...searchParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsUriEncode(key)}=${awsUriEncode(value)}`)
    .join('&');
}

function awsUriEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function decodeDataUrlBuffer(dataUrl) {
  const raw = String(dataUrl || '');
  const comma = raw.indexOf(',');
  if (comma < 0) return Buffer.alloc(0);
  const metadata = raw.slice(0, comma).toLowerCase();
  const body = raw.slice(comma + 1);
  return metadata.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
}

function buildResponseDetail(db, survey, response) {
  const respondent = response.respondentId ? db.respondents.find((item) => item.id === response.respondentId) || null : null;
  const contact = respondent?.email
    ? db.contacts.find((item) => item.workspaceId === survey.workspaceId && item.email === respondent.email) || null
    : null;
  const timeline = [
    { label: 'Started', at: response.startedAt },
    response.submittedAt ? { label: 'Submitted', at: response.submittedAt } : null,
    response.archivedAt ? { label: 'Archived', at: response.archivedAt } : null,
    response.deletedAt ? { label: 'Deleted', at: response.deletedAt } : null
  ].filter(Boolean);
  const isOverLimit = response.status === 'over_limit';
  const planOk = survey ? checkPlanLimit(db, survey.workspaceId, 'responsesPerMonth').ok : true;
  const locked = isOverLimit && !planOk;
  return {
    ...response,
    locked,
    answersJson: locked ? { _locked: true, message: 'Upgrade your workspace plan to unlock this response.' } : response.answersJson,
    respondent: locked ? null : respondent,
    contact: locked ? null : contact,
    survey: { id: survey.id, title: survey.title, type: survey.type },
    aiSummary: {
      aiGenerated: true,
      sentiment: response.sentiment,
      leadScore: response.leadScore,
      recommendation: response.sentiment === 'negative'
        ? 'Follow up quickly and tag the root cause.'
        : response.leadScore >= 80
          ? 'Route this high-intent response to sales.'
          : 'Review during the next feedback sweep.'
    },
    timeline
  };
}

function updateResponseRecord(response, body, userId) {
  if (Array.isArray(body.tags)) {
    response.tagsJson = uniqueTags(body.tags.map((item) => cleanText(item, 80)).filter(Boolean));
  }
  if (body.addTag) {
    response.tagsJson = uniqueTags([...(response.tagsJson || []), cleanText(body.addTag, 80)]);
  }
  if (body.removeTag) {
    response.tagsJson = (response.tagsJson || []).filter((tag) => tag !== cleanText(body.removeTag, 80));
  }
  if (body.note) {
    response.internalNotes = response.internalNotes || [];
    response.internalNotes.push({
      id: makeId('note'),
      userId,
      text: cleanText(body.note, 2000),
      createdAt: new Date().toISOString()
    });
  }
  if (body.important !== undefined) response.important = Boolean(body.important);
  if (body.status && ['completed', 'partial', 'archived', 'disqualified'].includes(body.status)) {
    response.status = body.status;
    if (body.status === 'archived') response.archivedAt = new Date().toISOString();
  }
  if (body.anonymize) {
    response.respondentId = null;
    response.metadataJson = {
      ...response.metadataJson,
      ipHash: '',
      userAgent: '',
      browser: '',
      os: '',
      anonymizedAt: new Date().toISOString()
    };
    response.tagsJson = uniqueTags([...(response.tagsJson || []), 'anonymized']);
  }
  response.updatedAt = new Date().toISOString();
}

function updateApiContact(db, contact, body) {
  contact.name = cleanText(body.name ?? contact.name, 120);
  if (body.email !== undefined) contact.email = cleanEmail(body.email, true);
  contact.phone = cleanText(body.phone ?? contact.phone, 40);
  contact.company = cleanText(body.company ?? contact.company, 120);
  contact.source = cleanText(body.source ?? contact.source ?? 'api', 80);
  if (Array.isArray(body.tags)) contact.tagsJson = uniqueTags(body.tags.map((item) => cleanText(item, 80)).filter(Boolean));
  if (Number.isFinite(Number(body.leadScore))) contact.leadScore = Math.max(0, Math.min(100, Number(body.leadScore)));
  updateContactCrmFields(db, contact, body);
  contact.updatedAt = new Date().toISOString();
}

function processAlerts(db, survey, response) {
  const alerts = db.alerts.filter((alert) => alert.active && alert.workspaceId === survey.workspaceId && (!alert.surveyId || alert.surveyId === survey.id));
  for (const alert of alerts) {
    if (!alertMatches(alert, response)) continue;
    const notification = {
      id: makeId('ntf'),
      workspaceId: survey.workspaceId,
      surveyId: survey.id,
      responseId: response.id,
      alertId: alert.id,
      title: alert.name,
      message: `Alert matched ${survey.title}: ${response.sentiment} response, lead score ${response.leadScore}.`,
      channels: alert.channelsJson,
      read: false,
      createdAt: new Date().toISOString()
    };
    db.notifications.push(notification);
    if (alert.channelsJson.email) {
      queueEmailJob(db, survey.workspaceId, {
        to: alert.channelsJson.emailTo || workspaceBrand(db, survey.workspaceId).defaultSenderEmail || '',
        subject: `${alert.name}: ${survey.title}`,
        body: notification.message
      }, { alertId: alert.id, responseId: response.id, notificationId: notification.id });
    }
  }
}

function alertMatches(alert, response) {
  const condition = alert.conditionsJson || {};
  if (condition.type === 'negative_sentiment') return response.sentiment === 'negative';
  if (condition.type === 'high_intent_lead') return response.leadScore >= Number(condition.threshold || 75);
  if (condition.type === 'nps_below') {
    const values = Object.values(response.answersJson).map(Number).filter((value) => Number.isFinite(value));
    return values.some((value) => value <= Number(condition.threshold || 6));
  }
  if (condition.questionId) {
    return evaluateCondition(response.answersJson[condition.questionId], condition.operator || 'equals', condition.value);
  }
  return false;
}

function processWebhooks(db, survey, response) {
  const hooks = db.webhooks.filter((hook) => hook.workspaceId === survey.workspaceId && hook.active && hook.events.includes('response.completed'));
  for (const hook of hooks) {
    const payloadJson = { surveyId: survey.id, responseId: response.id, sentiment: response.sentiment, leadScore: response.leadScore };
    const log = {
      id: makeId('whlog'),
      workspaceId: survey.workspaceId,
      webhookId: hook.id,
      event: 'response.completed',
      payloadJson,
      responseStatus: 'queued',
      error: '',
      createdAt: new Date().toISOString()
    };
    db.webhookLogs.push(log);
    queueWebhookJob(db, survey.workspaceId, hook.id, log.id, payloadJson);
  }
}

function processIntegrations(db, survey, response) {
  const integrations = db.integrations.filter((item) => item.workspaceId === survey.workspaceId && item.status === 'configured' && (item.events || ['response.completed']).includes('response.completed'));
  for (const integration of integrations) {
    queueIntegrationJob(db, survey.workspaceId, integration.id, 'response.completed', {
      surveyId: survey.id,
      responseId: response.id,
      sentiment: response.sentiment,
      leadScore: response.leadScore,
      source: response.metadataJson?.source || 'direct'
    });
  }
}

function queueEmailJob(db, workspaceId, message, context = {}) {
  db.jobs.push({
    id: makeId('job'),
    workspaceId,
    type: 'email_delivery',
    status: 'queued',
    attempts: 0,
    maxAttempts: JOB_MAX_ATTEMPTS,
    payloadJson: { message, context },
    lastError: '',
    nextRunAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  });
}

function queueWebhookJob(db, workspaceId, webhookId, webhookLogId, payloadJson, event = 'response.completed') {
  db.jobs.push({
    id: makeId('job'),
    workspaceId,
    type: 'webhook_delivery',
    status: 'queued',
    attempts: 0,
    maxAttempts: JOB_MAX_ATTEMPTS,
    payloadJson: { webhookId, webhookLogId, payloadJson, event },
    lastError: '',
    nextRunAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  });
}

function queueIntegrationJob(db, workspaceId, integrationId, event, payloadJson) {
  db.jobs.push({
    id: makeId('job'),
    workspaceId,
    type: 'integration_delivery',
    status: 'queued',
    attempts: 0,
    maxAttempts: JOB_MAX_ATTEMPTS,
    payloadJson: { integrationId, event, payloadJson },
    lastError: '',
    nextRunAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  });
}

function upsertRespondentAndContact(db, survey, schema, response) {
  const emailQuestion = schema.questions.find((q) => q.type === 'email');
  const nameQuestion = schema.questions.find((q) => /name/i.test(q.title));
  const phoneQuestion = schema.questions.find((q) => q.type === 'phone');
  const email = emailQuestion ? cleanEmail(response.answersJson[emailQuestion.id], true) : '';
  const name = nameQuestion ? cleanText(response.answersJson[nameQuestion.id], 120) : '';
  const phone = phoneQuestion ? cleanText(response.answersJson[phoneQuestion.id], 40) : '';
  if (!email && !phone && !name) return;
  let respondent = db.respondents.find((item) => item.workspaceId === survey.workspaceId && item.email && item.email === email);
  if (!respondent) {
    respondent = {
      id: makeId('respnd'),
      workspaceId: survey.workspaceId,
      externalId: '',
      email,
      phone,
      name,
      attributesJson: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.respondents.push(respondent);
  } else {
    respondent.name = name || respondent.name;
    respondent.phone = phone || respondent.phone;
    respondent.updatedAt = new Date().toISOString();
  }
  response.respondentId = respondent.id;
  let contact = db.contacts.find((item) => item.workspaceId === survey.workspaceId && item.email && item.email === email);
  if (!contact) {
    contact = {
      id: makeId('ctc'),
      workspaceId: survey.workspaceId,
      name,
      email,
      phone,
      company: '',
      source: response.metadataJson.source || 'survey',
      tagsJson: [],
      leadScore: response.leadScore,
      stage: response.leadScore >= 80 ? 'qualified' : 'new',
      ownerId: '',
      nextFollowUpAt: '',
      pipelineUpdatedAt: new Date().toISOString(),
      lastResponseAt: response.submittedAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.contacts.push(contact);
  } else {
    contact.leadScore = Math.max(contact.leadScore || 0, response.leadScore || 0);
    if ((response.leadScore || 0) >= 80 && (!contact.stage || contact.stage === 'new')) {
      contact.stage = 'qualified';
      contact.pipelineUpdatedAt = new Date().toISOString();
    }
    contact.lastResponseAt = response.submittedAt;
    contact.updatedAt = new Date().toISOString();
  }
}

function buildCsv(survey, responses) {
  const questions = exportableQuestions(survey);
  const headers = ['response_id', 'status', 'submitted_at', 'sentiment', 'lead_score', ...questions.map((item) => item.title), 'source', 'device'];
  const rows = responses.map((response) => [
    response.id,
    response.status,
    response.submittedAt || '',
    response.sentiment || '',
    response.leadScore || 0,
    ...questions.map((q) => formatCsvValue(response.answersJson[q.id])),
    response.metadataJson.source || '',
    response.metadataJson.deviceType || ''
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

async function buildXlsxExport(survey, responses) {
  const questions = exportableQuestions(survey);
  const responseHeaders = [
    'response_id',
    'status',
    'submitted_at',
    'sentiment',
    'lead_score',
    'source',
    'device',
    'browser',
    'os',
    'language',
    'country',
    'city',
    'tags',
    'notes',
    'important',
    ...questions.map((question) => question.title)
  ];
  const responseRows = [
    responseHeaders,
    ...responses.map((response) => [
      response.id,
      response.status,
      response.submittedAt || '',
      response.sentiment || '',
      response.leadScore || 0,
      response.metadataJson?.source || '',
      response.metadataJson?.deviceType || '',
      response.metadataJson?.browser || '',
      response.metadataJson?.os || '',
      response.metadataJson?.language || '',
      response.metadataJson?.country || '',
      response.metadataJson?.city || '',
      (response.tagsJson || []).join(', '),
      (response.internalNotes || []).map((note) => `${note.userId || 'user'}: ${note.text || ''}`).join('\n'),
      Boolean(response.important),
      ...questions.map((question) => formatXlsxValue(response.answersJson?.[question.id]))
    ].map(sanitizeXlsxCell))
  ];
  const questionRows = [
    ['question_id', 'title', 'type', 'required', 'page', 'options'],
    ...questions.map((question) => [
      question.id,
      question.title,
      question.type,
      Boolean(question.required),
      question.settings?.page || 1,
      Array.isArray(question.settings?.options) ? question.settings.options.join(', ') : ''
    ].map(sanitizeXlsxCell))
  ];
  return writeExcelFile([
    {
      sheet: 'Responses',
      data: responseRows,
      columns: responseHeaders.map((header) => ({ width: Math.max(14, Math.min(36, String(header).length + 4)) })),
      stickyRowsCount: 1
    },
    {
      sheet: 'Questions',
      data: questionRows,
      columns: [{ width: 22 }, { width: 42 }, { width: 18 }, { width: 12 }, { width: 10 }, { width: 50 }],
      stickyRowsCount: 1
    }
  ]).toBuffer();
}

function exportableQuestions(survey) {
  return (survey.schema?.questions || []).filter((item) => !['section', 'statement', 'hidden'].includes(item.type));
}

function formatCsvValue(value) {
  if (isFileLike(value)) return value.name || value.fileId || 'file upload';
  if (Array.isArray(value)) return value.map(formatAnswerText).join('; ');
  if (value === true) return 'true';
  if (value === false) return 'false';
  return value ?? '';
}

function formatXlsxValue(value) {
  if (isFileLike(value)) return value.name || value.fileId || 'file upload';
  if (Array.isArray(value)) return value.map(formatAnswerText).join('; ');
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value ?? '';
}

function sanitizeXlsxCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  const text = String(value);
  return text.length > 32767 ? `${text.slice(0, 32764)}...` : text;
}

function formatAnswerText(value) {
  if (isFileLike(value)) return value.name || value.fileId || 'file upload';
  if (Array.isArray(value)) return value.map(formatAnswerText).join('; ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

function csvEscape(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && text.length > 0) {
    const firstChar = text[0];
    if (['=', '+', '-', '@', '\t', '\r'].includes(firstChar)) {
      text = `'${text}`;
    }
  }
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildAdminOverview(db) {
  const activeSubscriptions = db.subscriptions.filter((item) => item.status === 'active');
  const recentErrorLogs = db.errorLogs.slice(-25).reverse();
  const recentAiProviderLogs = (db.aiProviderLogs || []).slice(-25).reverse();
  const mrr = activeSubscriptions.reduce((sum, subscription) => {
    const plan = findBillingPlan(db, subscription.planId, { includeArchived: true });
    return sum + (plan?.priceMonthlyInr || 0);
  }, 0);
  return {
    totals: {
      users: db.users.length,
      workspaces: db.workspaces.length,
      activeSubscriptions: activeSubscriptions.length,
      mrr,
      responseVolume: db.responses.length,
      aiUsage: db.aiJobs.reduce((sum, job) => sum + (job.tokensUsed || 0), 0),
      aiProviderCalls: (db.aiProviderLogs || []).filter((log) => log.status === 'success').length,
      aiProviderFailures: (db.aiProviderLogs || []).filter((log) => log.status === 'failed').length,
      failedJobs: db.aiJobs.filter((job) => job.status === 'failed').length + db.jobs.filter((job) => job.status === 'failed').length,
      queuedJobs: db.jobs.filter((job) => ['queued', 'retrying'].includes(job.status)).length,
      completedJobs: db.jobs.filter((job) => job.status === 'completed').length,
      emailDeliveries: db.emailLogs.length,
      errorLogs: db.errorLogs.length + db.webhookLogs.filter((log) => log.error).length + db.jobs.filter((job) => job.lastError).length
    },
    topWorkspaces: db.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      planId: workspace.planId,
      responses: db.responses.filter((response) => response.workspaceId === workspace.id).length,
      aiJobs: db.aiJobs.filter((job) => job.workspaceId === workspace.id).length
    })).sort((a, b) => b.responses - a.responses).slice(0, 8),
    planDistribution: countBy(db.workspaces.map((workspace) => workspace.planId || 'starter')),
    recentErrorLogs,
    recentAiProviderLogs,
    recentAuditLogs: db.auditLogs.slice(-25).reverse()
  };
}

function buildReadinessReport(db, state) {
  const migrationFile = path.join(ROOT, 'migrations', '0001_initial_postgres.sql');
  const localBackupScript = path.join(ROOT, 'scripts', 'backup-data.ps1');
  const localRestoreScript = path.join(ROOT, 'scripts', 'restore-data.ps1');
  const hasMigration = fs.existsSync(migrationFile);
  const hasLocalBackup = fs.existsSync(localBackupScript);
  const hasLocalRestore = fs.existsSync(localRestoreScript);
  const providers = {
    database: providerStatus(['DATABASE_URL']),
    queue: {
      ...providerStatus(['REDIS_URL']),
      mode: envConfigured('REDIS_URL') ? 'bullmq' : 'local_state',
      queueName: BULLMQ_QUEUE_NAME,
      workerCommand: 'npm.cmd run worker'
    },
    email: providerStatus(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']),
    ai: aiProviderReadinessStatus(),
    billing: {
      configured: (envConfigured('STRIPE_SECRET_KEY') && envConfigured('STRIPE_WEBHOOK_SECRET'))
        || (envConfigured('RAZORPAY_KEY_ID') && envConfigured('RAZORPAY_SECRET') && envConfigured('RAZORPAY_WEBHOOK_SECRET')),
      variables: {
        STRIPE_SECRET_KEY: envConfigured('STRIPE_SECRET_KEY'),
        STRIPE_WEBHOOK_SECRET: envConfigured('STRIPE_WEBHOOK_SECRET'),
        RAZORPAY_KEY_ID: envConfigured('RAZORPAY_KEY_ID'),
        RAZORPAY_SECRET: envConfigured('RAZORPAY_SECRET'),
        RAZORPAY_WEBHOOK_SECRET: envConfigured('RAZORPAY_WEBHOOK_SECRET'),
        BILLING_TAX_MODE: envConfigured('BILLING_TAX_MODE'),
        BILLING_TAX_PERCENT: envConfigured('BILLING_TAX_PERCENT'),
        BILLING_PRORATION_POLICY: envConfigured('BILLING_PRORATION_POLICY'),
        STRIPE_AUTOMATIC_TAX: envConfigured('STRIPE_AUTOMATIC_TAX'),
        STRIPE_TAX_ID_COLLECTION: envConfigured('STRIPE_TAX_ID_COLLECTION')
      },
      policy: billingPolicySnapshot()
    },
    storage: storageReadinessStatus(),
    customDomainSsl: customDomainSslReadinessStatus(),
    fileScanning: fileScanReadinessStatus(),
    oauth: googleOAuthReadinessStatus(),
    sso: ssoReadinessStatus(db),
    monitoring: monitoringReadinessStatus()
  };
  const queuedJobs = db.jobs.filter((job) => ['queued', 'retrying'].includes(job.status)).length;
  const failedJobs = db.jobs.filter((job) => job.status === 'failed' || job.lastError).length;
  const checks = [
    readinessCheck('health', 'Health endpoint', 'pass', '/api/health is available.'),
    readinessCheck('migration', 'PostgreSQL migration baseline', hasMigration ? 'pass' : 'fail', hasMigration ? 'Baseline migration file exists.' : 'Missing migrations/0001_initial_postgres.sql.'),
    readinessCheck('database', 'PostgreSQL runtime store', providers.database.configured ? 'pass' : 'fail', providers.database.configured ? `DATABASE_URL is configured; runtime persistence uses relational core tables${postgresCompatibilitySnapshotEnabled() ? ' plus the development compatibility snapshot' : ' without the compatibility snapshot'}.` : 'Set DATABASE_URL and apply the PostgreSQL baseline migration.'),
    readinessCheck('queue', 'Redis/BullMQ queue', providers.queue.configured ? 'pass' : 'fail', providers.queue.configured ? `REDIS_URL is configured; run ${providers.queue.workerCommand} for BullMQ workers on ${providers.queue.queueName}.` : 'Set REDIS_URL and run the BullMQ worker for a durable production queue.'),
    readinessCheck('email', 'SMTP/email provider', providers.email.configured ? 'pass' : 'fail', providers.email.configured ? 'SMTP provider variables are configured.' : 'Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD.'),
    readinessCheck('ai', 'LLM provider', providers.ai.configured ? 'pass' : 'fail', providers.ai.configured ? `OPENAI_API_KEY is configured, model ${providers.ai.model || 'default'} is allowed, and provider DPA acceptance is recorded.` : 'Set OPENAI_API_KEY, use an allowed OpenAI-compatible model, and set AI_PROVIDER_DPA_ACCEPTED after legal review.'),
    readinessCheck('billing', 'Billing provider', providers.billing.configured ? 'pass' : 'fail', providers.billing.configured ? 'Billing provider variables are configured.' : 'Set Stripe or Razorpay credentials plus webhook signing secret.'),
    readinessCheck('billing_policy', 'Billing tax and proration policy', providers.billing.policy.taxMode !== 'none' && providers.billing.policy.prorationPolicy !== 'none' ? 'pass' : 'warn', providers.billing.policy.taxMode !== 'none' && providers.billing.policy.prorationPolicy !== 'none' ? `Billing policy uses ${providers.billing.policy.taxMode} tax at ${providers.billing.policy.taxPercent}% and ${providers.billing.policy.prorationPolicy} proration.` : 'Set BILLING_TAX_MODE, BILLING_TAX_PERCENT, and BILLING_PRORATION_POLICY before paid launch.'),
    readinessCheck('storage', 'Object storage', providers.storage.configured ? 'pass' : 'fail', providers.storage.configured ? 'S3/R2 variables are configured.' : 'Set S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET.'),
    readinessCheck('storage_lifecycle', 'Object storage lifecycle', providers.storage.lifecycleConfigured ? 'pass' : 'warn', providers.storage.lifecycleConfigured ? `S3 lifecycle retention is declared for ${providers.storage.lifecycleDays} day(s).` : 'Set S3_LIFECYCLE_DAYS and mirror workspace retention in the bucket lifecycle policy.'),
    readinessCheck('custom_domain_ssl', 'Custom-domain SSL automation', providers.customDomainSsl.configured ? 'pass' : 'fail', providers.customDomainSsl.configured ? `Custom-domain SSL provider ${providers.customDomainSsl.providerName} is configured.` : 'Set CUSTOM_DOMAIN_SSL_PROVIDER_URL so verified custom domains can receive certificates.'),
    readinessCheck('file_scan', 'File upload security scanning', providers.fileScanning.configured ? 'pass' : 'warn', providers.fileScanning.configured ? 'A file scan provider is configured for upload payload checks.' : 'Configure FILE_SCAN_PROVIDER_URL for production antivirus scanning; local policy scanning remains enabled for development.'),
    readinessCheck('google_oauth', 'Google OAuth', providers.oauth.configured ? 'pass' : 'warn', providers.oauth.configured ? 'Google OAuth client, secret, redirect, token, and userinfo URLs are configured.' : 'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to enable optional Google sign-in.'),
    readinessCheck('sso_assertion', 'SSO assertion validation', providers.sso.configured ? 'pass' : 'warn', providers.sso.configured ? `${providers.sso.strictReadyWorkspaces} SSO workspace(s) have strict assertion validation material.` : 'Enabled SSO workspaces need entity IDs and signing certificates/public keys.'),
    readinessCheck('sso_dev_mode', 'SSO dev mode', providers.sso.devModeWorkspaces ? 'warn' : 'pass', providers.sso.devModeWorkspaces ? `${providers.sso.devModeWorkspaces} SSO workspace(s) still allow local dev-mode login.` : 'No enabled SSO workspace has dev mode enabled.'),
    readinessCheck('monitoring', 'Monitoring and uptime checks', providers.monitoring.configured ? 'pass' : 'fail', providers.monitoring.configured ? `Error telemetry and ${providers.monitoring.uptimeProvider} uptime checks are configured.` : 'Set SENTRY_DSN or POSTHOG_KEY plus UPTIME_CHECK_URL and MONITORING_ALERT_WEBHOOK_URL.'),
    readinessCheck('backup', 'Backup and restore scripts', hasLocalBackup && hasLocalRestore ? 'pass' : 'fail', hasLocalBackup && hasLocalRestore ? 'Local backup and restore scripts exist; configure managed PostgreSQL backups before launch.' : 'Missing local backup or restore script.'),
    readinessCheck('jobs', 'Job queue state', failedJobs ? 'warn' : 'pass', failedJobs ? `${failedJobs} failed/erroring job records need review.` : `${queuedJobs} queued or retrying job records.`)
  ];
  const productionReady = checks.every((check) => check.status === 'pass') && providers.database.configured && providers.queue.configured;
  return {
    generatedAt: new Date().toISOString(),
    mode: state.databaseUrl ? 'postgres_runtime' : 'local_json',
    productionReady,
    summary: {
      pass: checks.filter((check) => check.status === 'pass').length,
      warn: checks.filter((check) => check.status === 'warn').length,
      fail: checks.filter((check) => check.status === 'fail').length
    },
    runtime: {
      node: process.version,
      dataStore: state.databaseUrl ? (postgresCompatibilitySnapshotEnabled() ? 'postgres_relational_core_with_snapshot' : 'postgres_relational_core') : 'local_json',
      dataFile: state.dataFile ? path.relative(ROOT, state.dataFile) : '',
      jobPollIntervalMs: JOB_POLL_INTERVAL_MS,
      queueMode: providers.queue.mode,
      queueName: providers.queue.queueName
    },
    migration: {
      file: path.relative(ROOT, migrationFile),
      present: hasMigration,
      verifier: 'npm.cmd run migrations:check'
    },
    backup: {
      backupScript: path.relative(ROOT, localBackupScript),
      restoreScript: path.relative(ROOT, localRestoreScript),
      backupScriptPresent: hasLocalBackup,
      restoreScriptPresent: hasLocalRestore,
      verifier: 'npm.cmd run backup:smoke'
    },
    providers,
    checks
  };
}

function providerStatus(names) {
  return {
    configured: names.every(envConfigured),
    variables: Object.fromEntries(names.map((name) => [name, envConfigured(name)]))
  };
}

function storageReadinessStatus() {
  const base = providerStatus(['S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET']);
  const lifecycleDays = Number(process.env.S3_LIFECYCLE_DAYS || 0);
  return {
    configured: base.configured,
    lifecycleConfigured: Number.isFinite(lifecycleDays) && lifecycleDays > 0,
    lifecycleDays: Number.isFinite(lifecycleDays) && lifecycleDays > 0 ? Math.floor(lifecycleDays) : 0,
    variables: {
      ...base.variables,
      S3_LIFECYCLE_DAYS: envConfigured('S3_LIFECYCLE_DAYS')
    }
  };
}

function customDomainSslReadinessStatus() {
  const config = customDomainSslConfig();
  return {
    configured: Boolean(config.providerUrl),
    providerName: config.providerName,
    timeoutMs: config.timeoutMs,
    variables: {
      CUSTOM_DOMAIN_SSL_PROVIDER_URL: envConfigured('CUSTOM_DOMAIN_SSL_PROVIDER_URL'),
      CUSTOM_DOMAIN_SSL_PROVIDER_TOKEN: envConfigured('CUSTOM_DOMAIN_SSL_PROVIDER_TOKEN'),
      CUSTOM_DOMAIN_SSL_PROVIDER_NAME: envConfigured('CUSTOM_DOMAIN_SSL_PROVIDER_NAME'),
      CUSTOM_DOMAIN_SSL_TIMEOUT_MS: envConfigured('CUSTOM_DOMAIN_SSL_TIMEOUT_MS')
    }
  };
}

function googleOAuthReadinessStatus() {
  const configured = envConfigured('GOOGLE_OAUTH_CLIENT_ID') && envConfigured('GOOGLE_OAUTH_CLIENT_SECRET');
  return {
    configured,
    variables: {
      GOOGLE_OAUTH_CLIENT_ID: envConfigured('GOOGLE_OAUTH_CLIENT_ID'),
      GOOGLE_OAUTH_CLIENT_SECRET: envConfigured('GOOGLE_OAUTH_CLIENT_SECRET'),
      GOOGLE_OAUTH_REDIRECT_URI: envConfigured('GOOGLE_OAUTH_REDIRECT_URI'),
      GOOGLE_OAUTH_AUTH_URL: envConfigured('GOOGLE_OAUTH_AUTH_URL'),
      GOOGLE_OAUTH_TOKEN_URL: envConfigured('GOOGLE_OAUTH_TOKEN_URL'),
      GOOGLE_OAUTH_USERINFO_URL: envConfigured('GOOGLE_OAUTH_USERINFO_URL')
    }
  };
}

function fileScanReadinessStatus() {
  const config = fileScanConfig();
  return {
    configured: config.mode === 'provider' && Boolean(config.providerUrl),
    mode: config.mode,
    failOpen: config.failOpen,
    blockedExtensions: [...fileScanBlockedExtensions()].sort(),
    variables: {
      FILE_SCAN_MODE: envConfigured('FILE_SCAN_MODE'),
      FILE_SCAN_PROVIDER_URL: envConfigured('FILE_SCAN_PROVIDER_URL'),
      FILE_SCAN_PROVIDER_TOKEN: envConfigured('FILE_SCAN_PROVIDER_TOKEN'),
      FILE_SCAN_TIMEOUT_MS: envConfigured('FILE_SCAN_TIMEOUT_MS'),
      FILE_SCAN_FAIL_OPEN: envConfigured('FILE_SCAN_FAIL_OPEN'),
      FILE_SCAN_BLOCKED_EXTENSIONS: envConfigured('FILE_SCAN_BLOCKED_EXTENSIONS')
    }
  };
}

function monitoringReadinessStatus() {
  const errorTelemetryConfigured = envConfigured('SENTRY_DSN') || envConfigured('POSTHOG_KEY');
  const uptimeProvider = cleanText(process.env.UPTIME_CHECK_PROVIDER || 'external_monitor', 80);
  const uptimeConfigured = envConfigured('UPTIME_CHECK_URL');
  const alertRouteConfigured = envConfigured('MONITORING_ALERT_WEBHOOK_URL');
  return {
    configured: errorTelemetryConfigured && uptimeConfigured && alertRouteConfigured,
    errorTelemetryConfigured,
    uptimeConfigured,
    alertRouteConfigured,
    uptimeProvider,
    variables: {
      SENTRY_DSN: envConfigured('SENTRY_DSN'),
      POSTHOG_KEY: envConfigured('POSTHOG_KEY'),
      POSTHOG_HOST: envConfigured('POSTHOG_HOST'),
      MONITORING_TIMEOUT_MS: envConfigured('MONITORING_TIMEOUT_MS'),
      UPTIME_CHECK_PROVIDER: envConfigured('UPTIME_CHECK_PROVIDER'),
      UPTIME_CHECK_URL: envConfigured('UPTIME_CHECK_URL'),
      MONITORING_ALERT_WEBHOOK_URL: envConfigured('MONITORING_ALERT_WEBHOOK_URL')
    }
  };
}

function ssoReadinessStatus(db) {
  const enabled = (db.workspaces || []).filter((workspace) => workspace.sso?.enabled);
  const strictReady = enabled.filter((workspace) => workspace.sso.entityId && workspace.sso.x509Certificate);
  const devMode = enabled.filter((workspace) => workspace.sso.devMode);
  return {
    configured: strictReady.length === enabled.length,
    enabledWorkspaces: enabled.length,
    strictReadyWorkspaces: strictReady.length,
    devModeWorkspaces: devMode.length,
    enforcedWorkspaces: enabled.filter((workspace) => workspace.sso.enforce).length,
    workspaces: enabled.slice(0, 25).map((workspace) => ({
      workspaceId: workspace.id,
      providerName: workspace.sso.providerName,
      enforce: Boolean(workspace.sso.enforce),
      devMode: Boolean(workspace.sso.devMode),
      hasEntityId: Boolean(workspace.sso.entityId),
      hasSigningCertificate: Boolean(workspace.sso.x509Certificate),
      allowedDomains: workspace.sso.allowedDomains || []
    }))
  };
}

function aiProviderReadinessStatus() {
  const config = aiProviderConfig();
  const allowedModels = String(process.env.OPENAI_ALLOWED_MODELS || '')
    .split(',')
    .map((item) => cleanText(item, 120))
    .filter(Boolean);
  const modelAllowed = aiModelAllowed(config.model);
  const policy = aiProviderPolicyStatus();
  return {
    configured: envConfigured('OPENAI_API_KEY') && modelAllowed && policy.accepted,
    model: config.model,
    allowedModels,
    policy,
    variables: {
      OPENAI_API_KEY: envConfigured('OPENAI_API_KEY'),
      OPENAI_BASE_URL: envConfigured('OPENAI_BASE_URL'),
      OPENAI_MODEL: envConfigured('OPENAI_MODEL'),
      OPENAI_ALLOWED_MODELS: envConfigured('OPENAI_ALLOWED_MODELS'),
      OPENAI_MODEL_ALLOWED: modelAllowed,
      AI_PROVIDER_DPA_ACCEPTED: envConfigured('AI_PROVIDER_DPA_ACCEPTED'),
      AI_PROVIDER_DPA_URL: envConfigured('AI_PROVIDER_DPA_URL'),
      AI_PROVIDER_DATA_RETENTION_DAYS: envConfigured('AI_PROVIDER_DATA_RETENTION_DAYS')
    }
  };
}

function envConfigured(name) {
  const value = String(process.env[name] || '').trim();
  return Boolean(value && !/^replace-|^changeme$|^todo$/i.test(value));
}

function readinessCheck(id, label, status, detail) {
  return { id, label, status, detail };
}

function buildAuditLogResult(db, url, options = {}) {
  const workspaceFilter = options.workspaceId || cleanText(url.searchParams.get('workspaceId') || '', 80);
  const action = cleanText(url.searchParams.get('action') || '', 120).toLowerCase();
  const entityType = cleanText(url.searchParams.get('entityType') || '', 80).toLowerCase();
  const userId = cleanText(url.searchParams.get('userId') || '', 80);
  const query = cleanText(url.searchParams.get('q') || '', 160).toLowerCase();
  const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')).getTime() : 0;
  const to = url.searchParams.get('to') ? new Date(`${url.searchParams.get('to')}T23:59:59.999Z`).getTime() : 0;
  let logs = db.auditLogs.filter((log) => {
    if (workspaceFilter && log.workspaceId !== workspaceFilter) return false;
    if (action && !String(log.action || '').toLowerCase().includes(action)) return false;
    if (entityType && String(log.entityType || '').toLowerCase() !== entityType) return false;
    if (userId && log.userId !== userId) return false;
    const created = new Date(log.createdAt || 0).getTime();
    if (from && created < from) return false;
    if (to && created > to) return false;
    if (query) {
      const text = [log.action, log.entityType, log.entityId, log.userId, log.workspaceId, JSON.stringify(log.metadataJson || {})].join(' ').toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const total = logs.length;
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 100)));
  logs = logs.slice(offset, offset + limit).map((log) => auditLogResponse(db, log));
  return { auditLogs: logs, total, offset, limit, filters: { workspaceId: workspaceFilter, action, entityType, userId, q: query } };
}

function auditLogResponse(db, log) {
  const user = log.userId ? db.users.find((item) => item.id === log.userId) : null;
  const workspace = log.workspaceId ? db.workspaces.find((item) => item.id === log.workspaceId) : null;
  return {
    id: log.id,
    workspaceId: log.workspaceId,
    workspaceName: workspace?.name || '',
    userId: log.userId,
    userEmail: user ? maskEmail(user.email) : '',
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    metadataJson: redactAuditMetadata(log.metadataJson || {}),
    createdAt: log.createdAt
  };
}

function redactAuditMetadata(value) {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|key|certificate/i.test(key)) {
      output[key] = '[redacted]';
    } else if (/email/i.test(key) && typeof item === 'string') {
      output[key] = maskEmail(item);
    } else {
      output[key] = redactAuditMetadata(item);
    }
  }
  return output;
}

function createSession(userId, options = {}) {
  const rememberMe = parseBoolean(options.rememberMe);
  const ttlMs = rememberMe ? REMEMBER_SESSION_TTL_MS : SESSION_TTL_MS;
  const token = `sess_${crypto.randomBytes(24).toString('hex')}`;
  const record = {
    id: hashToken(token),
    userId,
    remembered: rememberMe,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString()
  };
  Object.defineProperty(record, 'token', { value: token, enumerable: false });
  return record;
}

function createTwoFactorChallenge(userId, options = {}) {
  const token = `fo_2fa_${crypto.randomBytes(24).toString('hex')}`;
  const now = new Date().toISOString();
  return {
    token,
    record: {
      id: makeId('tfc'),
      userId,
      tokenHash: hashToken(token),
      rememberMe: parseBoolean(options.rememberMe),
      attempts: 0,
      usedAt: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS).toISOString()
    }
  };
}

function pruneTwoFactorChallenges(db) {
  const now = Date.now();
  db.twoFactorChallenges = db.twoFactorChallenges.filter((challenge) => !challenge.usedAt && new Date(challenge.expiresAt).getTime() > now);
}

function createTwoFactorSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function twoFactorSetupPayload(user, secret) {
  const issuer = 'FeedbackOS';
  const label = encodeURIComponent(`${issuer}:${user.email}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  const payload = {
    secret,
    otpauthUrl: `otpauth://totp/${label}?${query.toString()}`,
    expiresInSeconds: 30
  };
  if (process.env.NODE_ENV !== 'production') {
    payload.currentCode = totpCode(secret);
  }
  return payload;
}

function verifyTwoFactorCode(user, code) {
  if (!user?.twoFactorSecret) return '';
  return verifyTotpCode(user.twoFactorSecret, code) ? 'totp' : '';
}

function verifyTotpCode(secret, code) {
  const safeCode = cleanText(code || '', 20).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(safeCode)) return false;
  const now = Date.now();
  for (const offset of [-1, 0, 1]) {
    if (safeEqualText(totpCode(secret, now + offset * 30000), safeCode)) return true;
  }
  return false;
}

function totpCode(secret, time = Date.now()) {
  const counter = Math.floor(time / 30000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

function createRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => `fo_rc_${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`);
}

function consumeRecoveryCode(user, code) {
  const safeCode = cleanText(code || '', 80);
  if (!safeCode || !Array.isArray(user?.twoFactorRecoveryCodeHashes)) return '';
  const hash = hashToken(safeCode);
  const index = user.twoFactorRecoveryCodeHashes.findIndex((item) => item === hash);
  if (index === -1) return '';
  user.twoFactorRecoveryCodeHashes.splice(index, 1);
  user.updatedAt = new Date().toISOString();
  return 'recovery_code';
}

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    output += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = cleanText(value || '', 128).toUpperCase().replace(/=+$/g, '');
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getSession(req, db) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.fo_session;
  if (!sessionId) return null;
  const session = db.sessions.find((item) => item.id === hashToken(sessionId));
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
}

function requireUser(req, res, db) {
  const session = getSession(req, db);
  if (!session) {
    sendJson(res, 401, { error: { code: 'unauthenticated', message: 'Please sign in.' } });
    return null;
  }
  const user = db.users.find((item) => item.id === session.userId);
  if (!user || user.disabled) {
    sendJson(res, 401, { error: { code: 'unauthenticated', message: 'Please sign in again.' } });
    return null;
  }
  if (emailVerificationRequiredForUser(db, user)) {
    sendJson(res, 403, { error: { code: 'email_verification_required', message: 'Verify your email before continuing.' } });
    return null;
  }
  return { session, user };
}

function sameOriginAllowed(req, url) {
  const method = req.method || 'GET';
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;
  if (String(req.headers.authorization || '').startsWith('Bearer ')) return true;
  if (!String(req.headers.cookie || '').includes('fo_session=')) return true;
  const source = req.headers.origin || req.headers.referer || '';
  if (!source) return true;
  try {
    const sourceUrl = new URL(source);
    return sourceUrl.host === url.host;
  } catch {
    return false;
  }
}

function requireApiKey(req, res, db) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) {
    sendJson(res, 401, { error: { code: 'api_key_required', message: 'Bearer API key is required.' } });
    return null;
  }
  const apiKey = db.apiKeys.find((item) => !item.revokedAt && item.tokenHash === hashToken(token));
  if (!apiKey) {
    sendJson(res, 401, { error: { code: 'invalid_api_key', message: 'API key is invalid or revoked.' } });
    return null;
  }
  if (db.workspaces.find((item) => item.id === apiKey.workspaceId)?.suspended) {
    sendJson(res, 423, { error: { code: 'workspace_suspended', message: 'Workspace access is suspended.' } });
    return null;
  }
  if (!apiRateAllowed(apiKey)) {
    sendJson(res, 429, { error: { code: 'rate_limited', message: 'API key rate limit exceeded.' } });
    return null;
  }
  return { apiKey, workspaceId: apiKey.workspaceId };
}

function requireApiScope(res, apiKey, scope) {
  if (apiKey.scopes.includes(scope) || apiKey.scopes.includes('*')) return true;
  sendJson(res, 403, { error: { code: 'scope_required', message: `API key requires ${scope}.` } });
  return false;
}

function requireWorkspace(res, db, user, workspaceId, minimumRole = 'viewer') {
  if (!workspaceId) {
    sendJson(res, 400, { error: { code: 'workspace_required', message: 'Workspace is required.' } });
    return null;
  }
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    sendJson(res, 404, { error: { code: 'workspace_not_found', message: 'Workspace not found.' } });
    return null;
  }
  if (user.platformRole === 'super_admin') {
    return { role: 'owner', workspace };
  }
  if (workspace.suspended) {
    sendJson(res, 423, { error: { code: 'workspace_suspended', message: 'Workspace access is suspended.' } });
    return null;
  }
  const membership = db.workspaceMembers.find((item) => item.workspaceId === workspaceId && item.userId === user.id);
  if (!membership || !roleAtLeast(membership.role, minimumRole)) {
    sendJson(res, 403, { error: { code: 'forbidden', message: 'You do not have permission for this workspace.' } });
    return null;
  }
  return { ...membership, workspace };
}

function requireWorkspacePermission(res, db, user, workspaceId, actionKey) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const minimumRole = workspacePermissionRole(workspace, actionKey);
  const membership = requireWorkspace(res, db, user, workspaceId, minimumRole);
  if (!membership) return null;
  return { ...membership, permission: { action: actionKey, minimumRole } };
}

function requireSurveyAccess(res, db, user, survey, minimumRole = 'viewer') {
  const role = effectiveSurveyRole(db, user, survey);
  if (!role || !roleAtLeast(role, minimumRole)) {
    sendJson(res, 403, { error: { code: 'forbidden', message: 'You do not have permission for this survey.' } });
    return null;
  }
  return { role, survey };
}

function surveyVisibleToUser(db, user, survey, minimumRole = 'viewer') {
  const role = effectiveSurveyRole(db, user, survey);
  return Boolean(role && roleAtLeast(role, minimumRole));
}

function effectiveSurveyRole(db, user, survey) {
  if (!survey) return '';
  if (user.platformRole === 'super_admin') return 'owner';
  const membership = db.workspaceMembers.find((item) => item.workspaceId === survey.workspaceId && item.userId === user.id);
  if (!membership) return '';
  const workspaceRole = normalizeRole(membership.role);
  const grant = (survey.accessRules || []).find((item) => item.userId === user.id);
  const grantRole = grant?.role || '';
  if (roleAtLeast(workspaceRole, 'admin')) return workspaceRole;
  if (survey.createdBy === user.id && roleAtLeast(workspaceRole, 'editor')) return higherRole(workspaceRole, grantRole);
  if (survey.accessMode === 'selected') return grantRole;
  return higherRole(workspaceRole, grantRole);
}

function higherRole(first, second) {
  const rank = { viewer: 1, analyst: 2, editor: 3, admin: 4, owner: 5 };
  return (rank[second] || 0) > (rank[first] || 0) ? second : first;
}

function roleAtLeast(role, minimumRole) {
  const rank = { viewer: 1, analyst: 2, editor: 3, admin: 4, owner: 5 };
  return (rank[role] || 0) >= (rank[minimumRole] || 1);
}

function normalizeRole(role) {
  const safe = cleanText(role, 40);
  return ['owner', 'admin', 'editor', 'analyst', 'viewer'].includes(safe) ? safe : 'viewer';
}

function normalizeScopes(scopes) {
  const allowed = new Set(['*', 'surveys:read', 'surveys:write', 'responses:read', 'responses:write', 'analytics:read', 'contacts:read', 'contacts:write', 'webhooks:read', 'webhooks:write']);
  const input = Array.isArray(scopes) ? scopes : String(scopes || '').split(',');
  const normalized = input.map((item) => cleanText(item, 80)).filter((item) => allowed.has(item));
  return normalized.length ? [...new Set(normalized)] : ['surveys:read', 'responses:read'];
}

function normalizeIntegrationType(type) {
  const safe = cleanText(type, 60).toLowerCase();
  const allowed = new Set(['google_sheets', 'slack', 'teams', 'whatsapp', 'crm', 'zapier', 'make', 'email']);
  return allowed.has(safe) ? safe : 'google_sheets';
}

function buildSessionPayload(db, user) {
  return {
    user: publicUser(user),
    workspaces: visibleWorkspaces(db, user),
    plans: billingPlans(db),
    features: enabledFeatures()
  };
}

function normalizePlatformSettings(input = {}) {
  return {
    requireEmailVerification: parseBoolean(input.requireEmailVerification),
    plans: Array.isArray(input.plans) ? input.plans.map((plan) => normalizeBillingPlan(plan, null)).filter((plan) => plan.id) : [],
    updatedAt: cleanFutureOrPastIso(input.updatedAt, ''),
    updatedBy: cleanText(input.updatedBy || '', 80)
  };
}

function platformSettings(db) {
  db.platformSettings = normalizePlatformSettings(db.platformSettings || {});
  return db.platformSettings;
}

function emailVerificationRequiredForUser(db, user) {
  return Boolean(platformSettings(db).requireEmailVerification && user && !user.emailVerifiedAt);
}

function bootstrapPlatformRole(db, email) {
  if (process.env.NODE_ENV === 'production') {
    const configured = cleanEmail(process.env.SUPER_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '', true);
    return configured && configured === cleanEmail(email, true) ? 'super_admin' : 'user';
  }
  return db.users.length === 0 ? 'super_admin' : 'user';
}

function postIdentityPolicyError(db, user, options = {}) {
  if (!user || user.disabled) return { code: 'account_disabled', message: 'This account is disabled.' };
  if (emailVerificationRequiredForUser(db, user)) return { code: 'email_verification_required', message: 'Verify your email before signing in.' };
  const enforcedSso = enforcedSsoWorkspaceForEmail(db, user.email);
  if (enforcedSso && db.workspaceMembers.some((member) => member.workspaceId === enforcedSso.id && member.userId === user.id)) {
    return { code: 'sso_required', message: 'This workspace requires SSO sign-in.', workspaceId: enforcedSso.id };
  }
  if (options.federated && user.twoFactorEnabled) {
    return { code: 'two_factor_required', message: 'Use password sign-in to complete application two-factor authentication.' };
  }
  return null;
}

function billingPlans(db, options = {}) {
  const settings = platformSettings(db);
  const byId = new Map(PLANS.map((plan) => [plan.id, normalizeBillingPlan(plan, null)]));
  for (const override of settings.plans || []) {
    const normalized = normalizeBillingPlan(override, byId.get(override.id) || null);
    if (normalized.id) byId.set(normalized.id, normalized);
  }
  const plans = [...byId.values()].sort((a, b) => (a.order || 0) - (b.order || 0) || a.priceMonthlyInr - b.priceMonthlyInr || a.name.localeCompare(b.name));
  return options.includeArchived ? plans : plans.filter((plan) => !plan.archived);
}

function findBillingPlan(db, planId, options = {}) {
  return billingPlans(db, options).find((plan) => plan.id === cleanText(planId || '', 80)) || null;
}

function normalizeBillingPlan(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const id = cleanText(source.id || base.id || '', 80).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  const price = Number(source.priceMonthlyInr ?? base.priceMonthlyInr ?? 0);
  const order = Number(source.order ?? base.order ?? 0);
  return {
    id,
    name: cleanText(source.name || base.name || id || 'Custom plan', 80),
    priceMonthlyInr: Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0,
    setupFeeRange: cleanText(source.setupFeeRange || base.setupFeeRange || 'Custom', 80),
    limits: normalizePlanLimits(source.limits || base.limits || {}),
    features: normalizePlanFeatures(source.features || base.features || []),
    custom: parseBoolean(source.custom ?? base.custom),
    archived: parseBoolean(source.archived ?? base.archived),
    order: Number.isFinite(order) ? Math.round(order) : 0
  };
}

function normalizePlanLimits(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    surveys: normalizePlanLimitNumber(source.surveys, -1),
    responsesPerMonth: normalizePlanLimitNumber(source.responsesPerMonth, 0),
    teamMembers: normalizePlanLimitNumber(source.teamMembers, 1),
    aiCredits: normalizePlanLimitNumber(source.aiCredits, 0)
  };
}

function normalizePlanLimitNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number < 0) return -1;
  return Math.round(number);
}

function normalizePlanFeatures(features) {
  const list = Array.isArray(features) ? features : String(features || '').split(/\r?\n|,/);
  return [...new Set(list.map((item) => cleanText(item, 140)).filter(Boolean))].slice(0, 20);
}

function createEmailVerificationToken(db, user) {
  const token = `fo_verify_${crypto.randomBytes(24).toString('hex')}`;
  db.emailVerificationTokens = db.emailVerificationTokens.filter((item) => item.userId !== user.id || item.usedAt);
  const verification = {
    id: makeId('emv'),
    userId: user.id,
    tokenHash: hashToken(token),
    tokenPreview: `${token.slice(0, 14)}...`,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    usedAt: null,
    createdAt: new Date().toISOString()
  };
  db.emailVerificationTokens.push(verification);
  queueEmailJob(db, null, {
    to: user.email,
    subject: 'Verify your FeedbackOS email',
    body: `Use verification token ${token}. It expires in 24 hours.`
  }, { verificationId: verification.id });
  return { verification, token };
}

function visibleWorkspaces(db, user) {
  if (user.platformRole === 'super_admin') {
    return db.workspaces.map((workspace) => attachWorkspaceMeta(db, workspace, 'owner'));
  }
  const memberships = db.workspaceMembers.filter((item) => item.userId === user.id);
  return memberships
    .map((membership) => {
      const workspace = db.workspaces.find((item) => item.id === membership.workspaceId);
      return workspace ? attachWorkspaceMeta(db, workspace, membership.role) : null;
    })
    .filter(Boolean);
}

function attachWorkspaceMeta(db, workspace, role) {
  const subscription = db.subscriptions.find((item) => item.workspaceId === workspace.id) || createSubscription(workspace.id, workspace.planId || 'starter');
  const usage = db.usageMeters.find((item) => item.workspaceId === workspace.id) || createUsageMeter(workspace.id);
  const aiCredits = checkAiCreditLimit(db, workspace.id, 0);
  return { ...workspace, role, subscription, usage, aiCreditLimit: aiCredits.limit, aiCreditsRemaining: aiCredits.remaining };
}

function workspacePlanId(db, workspace) {
  if (!workspace) return 'starter';
  const subscription = workspace.subscription || db.subscriptions.find((item) => item.workspaceId === workspace.id);
  return cleanText(subscription?.planId || workspace.planId || 'starter', 80);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    emailVerifiedAt: user.emailVerifiedAt,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    authProvider: user.authProvider || 'password',
    oauthProviders: Object.keys(user.oauthProviders || {}),
    platformRole: user.platformRole,
    timezone: user.timezone
  };
}

function createSubscription(workspaceId, planId) {
  return {
    id: makeId('sub'),
    workspaceId,
    planId,
    provider: 'manual',
    providerSubscriptionId: '',
    providerCustomerId: '',
    status: 'active',
    currentPeriodStart: startOfMonth(),
    currentPeriodEnd: endOfMonth(),
    billingPolicy: billingPolicySnapshot(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createUsageMeter(workspaceId) {
  return {
    id: makeId('use'),
    workspaceId,
    period: new Date().toISOString().slice(0, 7),
    responsesCount: 0,
    aiCreditsUsed: 0,
    storageUsed: 0,
    teamMembersCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function updateUsage(db, workspaceId, patch) {
  let meter = db.usageMeters.find((item) => item.workspaceId === workspaceId && item.period === new Date().toISOString().slice(0, 7));
  if (!meter) {
    meter = createUsageMeter(workspaceId);
    db.usageMeters.push(meter);
  }
  for (const [key, value] of Object.entries(patch)) {
    meter[key] = (meter[key] || 0) + value;
  }
  meter.updatedAt = new Date().toISOString();
}

function parseOptionalLimit(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return { ok: false, value: null };
  return { ok: true, value: Math.floor(number) };
}

function normalizeOptionalLimit(value) {
  const parsed = parseOptionalLimit(value);
  return parsed.ok ? parsed.value : null;
}

function workspaceAiCreditLimit(db, workspaceId) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const plan = findBillingPlan(db, workspace?.planId || 'starter', { includeArchived: true }) || billingPlans(db)[0];
  const override = normalizeOptionalLimit(workspace?.aiCreditLimitOverride);
  return override === null ? plan.limits.aiCredits : override;
}

function checkAiCreditLimit(db, workspaceId, credits = 1) {
  const limit = workspaceAiCreditLimit(db, workspaceId);
  const usage = db.usageMeters.find((item) => item.workspaceId === workspaceId && item.period === new Date().toISOString().slice(0, 7));
  const used = usage?.aiCreditsUsed || 0;
  if (limit === -1 || limit === undefined) return { ok: true, used, limit: -1, remaining: -1, requested: credits };
  const remaining = Math.max(0, limit - used);
  const ok = used + credits <= limit;
  return {
    ok,
    used,
    limit,
    remaining,
    requested: credits,
    message: ok ? '' : `AI credit limit reached. ${used}/${limit} credits are already used this month.`
  };
}

function consumeAiCredits(db, workspaceId, credits) {
  const check = checkAiCreditLimit(db, workspaceId, credits);
  if (!check.ok) return check;
  if (credits > 0) updateUsage(db, workspaceId, { aiCreditsUsed: credits });
  return checkAiCreditLimit(db, workspaceId, 0);
}

function sendAiCreditLimitError(res, check) {
  sendJson(res, 402, {
    error: { code: 'ai_credit_limit', message: check.message || 'AI credit limit reached.' },
    usage: {
      used: check.used,
      limit: check.limit,
      remaining: check.remaining,
      requested: check.requested
    }
  });
}

function checkPlanLimit(db, workspaceId, limitName) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const plan = findBillingPlan(db, workspace?.planId || 'starter', { includeArchived: true }) || billingPlans(db)[0];
  const limit = plan.limits[limitName];
  if (limitName === 'aiCredits') return checkAiCreditLimit(db, workspaceId, 1);
  if (limit === -1 || limit === undefined) return { ok: true };
  if (limitName === 'surveys') {
    const count = db.surveys.filter((item) => item.workspaceId === workspaceId && item.status !== 'archived').length;
    return count < limit ? { ok: true } : { ok: false, message: `${plan.name} allows ${limit} active surveys.` };
  }
  if (limitName === 'responsesPerMonth') {
    const usage = db.usageMeters.find((item) => item.workspaceId === workspaceId && item.period === new Date().toISOString().slice(0, 7));
    return (usage?.responsesCount || 0) < limit ? { ok: true } : { ok: false, message: `${plan.name} allows ${limit} responses/month.` };
  }
  if (limitName === 'teamMembers') {
    const count = db.workspaceMembers.filter((item) => item.workspaceId === workspaceId).length;
    return count < limit ? { ok: true } : { ok: false, message: `${plan.name} allows ${limit} team members.` };
  }
  return { ok: true };
}

function captureMetadata(req, bodyMetadata, survey) {
  const anonymous = Boolean(survey.settings.anonymousMode);
  const userAgent = !anonymous && survey.settings.collectUserAgent ? String(req.headers['user-agent'] || '').slice(0, 500) : '';
  const referrer = anonymous ? '' : String(req.headers.referer || bodyMetadata.referrer || '').slice(0, 500);
  return {
    ipHash: !anonymous && survey.settings.collectIpHash ? hashIp(clientIp(req)) : '',
    userAgent,
    deviceType: detectDevice(userAgent),
    browser: detectBrowser(userAgent),
    os: detectOs(userAgent),
    referrer,
    utm: {
      source: cleanText(bodyMetadata.utm?.source || bodyMetadata.utm_source || '', 80),
      medium: cleanText(bodyMetadata.utm?.medium || bodyMetadata.utm_medium || '', 80),
      campaign: cleanText(bodyMetadata.utm?.campaign || bodyMetadata.utm_campaign || '', 120)
    },
    source: cleanText(bodyMetadata.source || bodyMetadata.utm?.source || (referrer ? 'referral' : 'direct'), 80),
    branch: cleanText(bodyMetadata.branch || bodyMetadata.branchId || bodyMetadata.branch_id || '', 120),
    location: cleanText(bodyMetadata.location || bodyMetadata.locationId || bodyMetadata.location_id || bodyMetadata.city || bodyMetadata.region || '', 120),
    language: cleanText(bodyMetadata.language || '', 20),
    browserId: anonymous ? '' : cleanText(bodyMetadata.browserId || '', 160),
    userId: anonymous ? '' : cleanText(bodyMetadata.userId || '', 160),
    externalId: anonymous ? '' : cleanText(bodyMetadata.externalId || '', 160),
    pathTaken: Array.isArray(bodyMetadata.pathTaken) ? bodyMetadata.pathTaken.slice(0, 100) : []
  };
}

function normalizeAnswers(input) {
  const answers = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) continue;
    if (isFileLike(value)) answers[key] = normalizeFileAnswer(value);
    else if (Array.isArray(value) && value.some(isFileLike)) answers[key] = value.map(normalizeFileAnswer).slice(0, 10);
    else if (Array.isArray(value)) answers[key] = value.map((item) => cleanText(item, 500)).slice(0, 50);
    else if (typeof value === 'boolean') answers[key] = value;
    else answers[key] = cleanText(value, 5000);
  }
  return answers;
}

function isFileLike(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && ('name' in value || 'dataUrl' in value || 'size' in value));
}

function normalizeFileAnswer(value) {
  if (!isFileLike(value)) return { name: cleanText(value, 240), type: '', size: 0, extension: '', dataUrl: '' };
  const name = cleanText(value.name || 'upload', 240);
  return {
    name,
    type: cleanText(value.type || '', 120).toLowerCase(),
    size: Math.max(0, Number(value.size || 0)),
    extension: cleanText(value.extension || path.extname(name).slice(1), 20).toLowerCase(),
    dataUrl: typeof value.dataUrl === 'string' ? value.dataUrl.slice(0, MAX_BODY_BYTES) : ''
  };
}

function answersToText(answers) {
  return Object.values(answers || {}).flat().map((value) => {
    if (isFileLike(value)) return value.name || 'file upload';
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '');
  }).join(' ');
}

function classifySentiment(text) {
  const lower = String(text || '').toLowerCase();
  const positive = ['great', 'good', 'excellent', 'happy', 'love', 'fast', 'helpful', 'smooth', 'satisfied', 'recommend', 'easy'];
  const negative = ['bad', 'poor', 'angry', 'hate', 'slow', 'delay', 'complaint', 'broken', 'confusing', 'expensive', 'unhappy', 'issue', 'problem'];
  const score = positive.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0) - negative.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
  if (score > 0 && score < 2 && negative.some((word) => lower.includes(word))) return 'mixed';
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

function calculateLeadScore(schema, answers, metadata) {
  let score = 25;
  const text = answersToText(answers).toLowerCase();
  if (text.includes('immediately') || text.includes('urgent') || text.includes('this month')) score += 25;
  if (text.includes('75,000') || text.includes('unlimited') || text.includes('enterprise')) score += 20;
  if (Object.values(answers).some((value) => isEmail(String(value)))) score += 15;
  if (metadata.source && metadata.source !== 'direct') score += 5;
  const ratingValues = schema.questions
    .filter((q) => ['nps', 'rating', 'csat', 'ces'].includes(q.type))
    .map((q) => Number(answers[q.id]))
    .filter((value) => Number.isFinite(value));
  if (ratingValues.some((value) => value <= 3)) score += 10;
  return Math.max(0, Math.min(100, score));
}

function defaultTags(response) {
  const tags = [];
  if (response.sentiment === 'negative') tags.push('needs-follow-up');
  if (response.leadScore >= 80) tags.push('high-intent');
  if (response.sentiment === 'positive') tags.push('promoter');
  return tags;
}

function uniqueTags(tags) {
  return [...new Set((tags || []).map((tag) => cleanText(tag, 80)).filter(Boolean))].slice(0, 50);
}

function syncTeamMemberUsage(db, workspaceId) {
  let meter = db.usageMeters.find((item) => item.workspaceId === workspaceId && item.period === new Date().toISOString().slice(0, 7));
  if (!meter) {
    meter = createUsageMeter(workspaceId);
    db.usageMeters.push(meter);
  }
  meter.teamMembersCount = db.workspaceMembers.filter((item) => item.workspaceId === workspaceId).length;
  meter.updatedAt = new Date().toISOString();
}

function normalizeAlertCondition(condition) {
  if (typeof condition !== 'object' || !condition) return { type: 'negative_sentiment' };
  return {
    type: cleanText(condition.type || 'negative_sentiment', 80),
    threshold: Number.isFinite(Number(condition.threshold)) ? Number(condition.threshold) : undefined,
    questionId: cleanText(condition.questionId || '', 80),
    operator: cleanText(condition.operator || 'equals', 40),
    value: condition.value ?? ''
  };
}

function normalizeAlertChannels(channels) {
  return {
    email: channels?.email !== false,
    emailTo: cleanEmail(channels?.emailTo || '', true),
    inApp: channels?.inApp !== false,
    webhook: Boolean(channels?.webhook),
    whatsapp: Boolean(channels?.whatsapp)
  };
}

function workspaceBrand(db, workspaceId) {
  return db.workspaces.find((item) => item.id === workspaceId) || { brandColor: '#176B5B', buttonColor: '#B75D2A' };
}

function buildQrCodeSvg(url, title, color) {
  const safeUrl = escapeXml(url);
  const safeTitle = escapeXml(title);
  const foreground = qrForegroundColor(color);
  const qr = createQrCodeMatrix(url);
  const size = qr.size;
  const cell = 8;
  const quiet = 4;
  const padding = quiet * cell;
  let cells = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules[y][x]) {
        cells += `<rect class="qr-module" x="${padding + x * cell}" y="${padding + y * cell}" width="${cell}" height="${cell}" fill="${foreground}"/>`;
      }
    }
  }
  const width = padding * 2 + size * cell;
  const height = width + 92;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="QR code for ${safeTitle}" data-qr-version="${qr.version}" data-error-correction="${qr.errorCorrection}" data-encoded-url="${safeUrl}">
  <rect width="100%" height="100%" rx="18" fill="#fffaf0"/>
  <a href="${safeUrl}">
    <rect x="8" y="8" width="${width - 16}" height="${width - 16}" rx="14" fill="#ffffff" stroke="#ded6c7"/>
    <g shape-rendering="crispEdges">${cells}</g>
  </a>
  <text x="${width / 2}" y="${width + 30}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#20332f">${safeTitle}</text>
  <text x="${width / 2}" y="${width + 54}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#5d6f69">${safeUrl}</text>
  <text x="${width / 2}" y="${width + 76}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#8a5c3a">Scannable QR code for the public survey link</text>
</svg>`;
}

function createQrCodeMatrix(text) {
  const version = 6;
  const errorCorrection = 'L';
  const size = 17 + version * 4;
  const dataCodewords = encodeQrPayload(text, 136);
  const dataBlocks = [dataCodewords.slice(0, 68), dataCodewords.slice(68, 136)];
  const divisor = reedSolomonDivisor(18);
  const eccBlocks = dataBlocks.map((block) => reedSolomonRemainder(block, divisor));
  const interleavedCodewords = [];
  for (let i = 0; i < 68; i += 1) {
    for (const block of dataBlocks) interleavedCodewords.push(block[i]);
  }
  for (let i = 0; i < 18; i += 1) {
    for (const block of eccBlocks) interleavedCodewords.push(block[i]);
  }
  const codewordBits = [];
  for (const codeword of interleavedCodewords) {
    for (let bit = 7; bit >= 0; bit -= 1) codewordBits.push((codeword >>> bit) & 1);
  }

  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = Boolean(dark);
    reserved[y][x] = true;
  };

  const drawFinder = (x, y) => {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark = inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setFunctionModule(xx, yy, dark);
      }
    }
  };

  const drawAlignment = (centerX, centerY) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunctionModule(centerX + dx, centerY + dy, distance !== 1);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);
  drawAlignment(34, 34);
  for (let i = 8; i < size - 8; i += 1) {
    setFunctionModule(i, 6, i % 2 === 0);
    setFunctionModule(6, i, i % 2 === 0);
  }
  drawFormatBits(modules, reserved, size, 0);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let col = 0; col < 2; col += 1) {
        const x = right - col;
        if (reserved[y][x]) continue;
        let dark = bitIndex < codewordBits.length ? codewordBits[bitIndex] === 1 : false;
        if ((x + y) % 2 === 0) dark = !dark;
        modules[y][x] = dark;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  return { version, errorCorrection, size, modules };
}

function encodeQrPayload(text, dataCodewordCapacity) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  if (bytes.length > 134) {
    throw new Error('Survey URL is too long for the built-in QR encoder.');
  }
  const bits = [];
  const appendBits = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  appendBits(0b0100, 4);
  appendBits(bytes.length, 8);
  for (const byte of bytes) appendBits(byte, 8);
  const maxBits = dataCodewordCapacity * 8;
  appendBits(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  }
  for (let pad = 0; codewords.length < dataCodewordCapacity; pad += 1) {
    codewords.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  return codewords;
}

function drawFormatBits(modules, reserved, size, mask) {
  const bits = qrFormatBits(mask);
  const bit = (index) => ((bits >>> index) & 1) === 1;
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));

  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

function qrFormatBits(mask) {
  const data = (1 << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) ? 0x537 : 0);
  }
  return ((data << 10) | (remainder & 0x3ff)) ^ 0x5412;
}

function reedSolomonDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = qrGfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = qrGfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] ^= qrGfMultiply(divisor[i], factor);
    }
  }
  return result;
}

function qrGfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function qrForegroundColor(color) {
  const foreground = cleanColor(color) || '#176B5B';
  const red = parseInt(foreground.slice(1, 3), 16);
  const green = parseInt(foreground.slice(3, 5), 16);
  const blue = parseInt(foreground.slice(5, 7), 16);
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
  return luminance > 190 ? '#111111' : foreground;
}

function publicRateAllowed(req, slug) {
  const key = `${slug}:${clientIp(req)}`;
  const now = Date.now();
  const bucket = publicBuckets.get(key) || { count: 0, resetAt: now + PUBLIC_RATE_LIMIT_WINDOW_MS };
  if (bucket.resetAt < now) {
    bucket.count = 0;
    bucket.resetAt = now + PUBLIC_RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  publicBuckets.set(key, bucket);
  return bucket.count <= PUBLIC_RATE_LIMIT_MAX;
}

const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_MAX = 10;
function authRateAllowed(key) {
  const now = Date.now();
  const bucket = authBuckets.get(key) || { count: 0, resetAt: now + AUTH_RATE_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + AUTH_RATE_WINDOW_MS;
  }
  bucket.count += 1;
  authBuckets.set(key, bucket);
  return bucket.count <= AUTH_RATE_MAX;
}

function apiRateAllowed(apiKey) {
  const now = Date.now();
  const bucket = apiBuckets.get(apiKey.id) || { count: 0, resetAt: now + 60 * 1000 };
  if (bucket.resetAt < now) {
    bucket.count = 0;
    bucket.resetAt = now + 60 * 1000;
  }
  bucket.count += 1;
  apiBuckets.set(apiKey.id, bucket);
  return bucket.count <= apiKey.rateLimitPerMinute;
}

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    return Intl.supportedValuesOf('timeZone').includes(tz);
  } catch {
    return false;
  }
}

function cleanTimezone(tz, fallback = 'Asia/Kolkata') {
  if (!tz) return fallback;
  const cleaned = cleanText(tz, 80);
  return isValidTimezone(cleaned) ? cleaned : fallback;
}

function audit(workspaceId, userId, action, entityType, entityId, metadataJson) {
  return {
    id: makeId('aud'),
    workspaceId,
    userId,
    action,
    entityType,
    entityId,
    metadataJson,
    createdAt: new Date().toISOString()
  };
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function uniqueSlug(text) {
  return `${slugify(text)}-${crypto.randomBytes(3).toString('hex')}`;
}

function slugify(text) {
  return String(text || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'item';
}

function cleanText(value, max = 1000) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanEmail(value, optional = false) {
  const email = cleanText(value, 254).toLowerCase();
  if (!email && optional) return '';
  return isEmail(email) ? email : '';
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function cleanUrl(value) {
  const raw = cleanText(value, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function cleanHostname(value) {
  const raw = cleanText(value, 250).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!raw) return '';
  return /^[a-z0-9.-]+$/i.test(raw) ? raw.toLowerCase() : '';
}

function cleanColor(value) {
  const color = cleanText(value, 20);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
}

function sanitizeCustomCss(value) {
  let css = String(value || '').slice(0, 4000);
  css = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]+;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/behavior\s*:[^;]+;?/gi, '')
    .replace(/-moz-binding\s*:[^;]+;?/gi, '')
    .replace(/[<>]/g, '');
  return css.trim();
}

function parseCookies(header) {
  const cookies = {};
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return cookies;
}

function setSessionCookie(res, sessionId, expires) {
  const parts = [
    `fo_session=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`
  ];
  if (process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true') {
    parts.push('Secure');
  }
  res.setHeader('set-cookie', parts.join('; '));
}

function readRawBody(req) {
  return readBodyBuffer(req, MAX_BODY_BYTES).then((buffer) => buffer.toString('utf8'));
}

async function readJson(req) {
  const body = await readRawBody(req);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function sendJson(res, status, payload) {
  sendJsonWithHeaders(res, status, payload);
}

function sendJsonWithHeaders(res, status, payload, headers = {}) {
  res.writeHead(status, withSecurityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  }));
  res.end(JSON.stringify(payload));
}

async function sendFile(req, res, target, contentType, headerBuilder = withSecurityHeaders) {
  try {
    const asset = await loadAsset(target);
    const type = contentType || mimeType(target);
    const headers = { 'content-type': type, 'cache-control': 'no-cache', etag: asset.etag, vary: 'accept-encoding' };
    const builder = typeof headerBuilder === 'function' ? headerBuilder : withSecurityHeaders;

    if (req.headers['if-none-match'] === asset.etag) {
      const responseHeaders = builder(headers);
      for (const [key, value] of Object.entries(responseHeaders)) if (value === null) delete responseHeaders[key];
      res.writeHead(304, responseHeaders);
      res.end();
      return;
    }

    const encoding = isCompressible(type) ? negotiateEncoding(req.headers['accept-encoding'] || '', asset) : null;
    const body = encoding ? asset[encoding] : asset.raw;
    if (encoding) headers['content-encoding'] = encoding;
    headers['content-length'] = body.length;

    const responseHeaders = builder(headers);
    for (const [key, value] of Object.entries(responseHeaders)) if (value === null) delete responseHeaders[key];
    res.writeHead(200, responseHeaders);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(res, 404, { error: { code: 'not_found', message: 'File not found.' } });
      return;
    }
    throw error;
  }
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  };
  return types[ext] || 'application/octet-stream';
}

function detectDevice(userAgent) {
  if (/mobile|android|iphone/i.test(userAgent)) return 'mobile';
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  return userAgent ? 'desktop' : 'unknown';
}

function detectBrowser(userAgent) {
  if (/edg/i.test(userAgent)) return 'Edge';
  if (/chrome/i.test(userAgent)) return 'Chrome';
  if (/safari/i.test(userAgent)) return 'Safari';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  return userAgent ? 'Other' : 'unknown';
}

function detectOs(userAgent) {
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac os/i.test(userAgent)) return 'macOS';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad/i.test(userAgent)) return 'iOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return userAgent ? 'Other' : 'unknown';
}

function countBy(values) {
  return values.reduce((acc, value) => {
    const key = String(value || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function objectEntriesSorted(object) {
  return Object.entries(object).sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
}

function average(values) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
}

function secondsBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (b - a) / 1000) : 0;
}

function topKeywords(text, limit) {
  const stop = new Set(['the', 'and', 'for', 'you', 'with', 'this', 'that', 'from', 'have', 'were', 'was', 'are', 'our', 'your', 'but', 'not', 'can', 'all', 'very', 'will', 'just', 'what', 'how', 'why']);
  const counts = {};
  for (const word of String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []) {
    if (stop.has(word)) continue;
    counts[word] = (counts[word] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function endOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
}

function nextReportMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 7);
}

function firstDayOfMonthIso(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return new Date().toISOString();
  return new Date(Number(match[1]), Number(match[2]) - 1, 1, 9, 0, 0).toISOString();
}

function normalizeEmailList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return [...new Set(raw.map((item) => cleanEmail(item, true)).filter(Boolean))].slice(0, 50);
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  const server = createServer();
  server.listen(port, () => {
    console.log(`FeedbackOS running at http://localhost:${port}`);
  });
}

module.exports = {
  createServer,
  validateProductionEnvironment,
  processDueJobs,
  startBullMqWorker,
  closeBullMq,
  QUESTION_TYPES,
  PLANS,
  SURVEY_TEMPLATES,
  buildAnalytics,
  buildAiSummary,
  selectResponsesForAi,
  validateSurveyForPublish,
  validateAnswers,
  visibleQuestions,
  encryptConfig,
  savePostgresRelationalCollections,
  POSTGRES_RELATIONAL_COLLECTIONS,
  POSTGRES_EXTRA_PROPERTIES,
  POSTGRES_TRANSIENT_PROPERTIES,
  postgresObjectToRow,
  postgresRowToObject,
  postgresPrepareItem,
  postgresHydrateItem,
  checkAiCreditLimit,
  consumeAiCredits,
  improveQuestionText,
  buildMonthlyReport
};
