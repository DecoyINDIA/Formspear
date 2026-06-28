const app = document.getElementById('app');

const state = {
  session: null,
  workspaces: [],
  workspaceId: '',
  plans: [],
  templates: [],
  adminTemplates: [],
  adminWorkspaces: [],
  adminReadiness: null,
  surveys: [],
  alerts: [],
  integrations: [],
  integrationLogs: [],
  webhooks: [],
  webhookLogs: [],
  members: [],
  invites: [],
  ssoConfig: null,
  ssoMetadataUrl: '',
  apiKeys: [],
  contacts: [],
  campaigns: [],
  monthlyReports: [],
  billingOverview: null,
  agencyOverview: null,
  agencyOverviewLoadedFor: '',
  generatedQuestion: null,
  resetToken: '',
  notifications: [],
  selectedSurveyId: '',
  selectedResponseDetail: null,
  revealedApiToken: '',
  revealedInviteToken: '',
  view: 'dashboard',
  editingSurvey: null,
  selectedQuestionId: '',
  responses: [],
  responseMeta: null,
  responseFilters: {},
  responsesLoadedFor: '',
  analytics: null,
  analyticsBenchmark: null,
  analyticsFilters: {},
  analyticsLoadedFor: '',
  analyticsBenchmarkLoadedFor: '',
  aiSummary: null,
  publicSurvey: null,
  publicAnswers: {},
  publicPage: 0,
  publicStartedAt: null,
  publicPartialResponseId: '',
  publicResumeToken: '',
  publicAutosaveTimer: null,
  publicAutosaveStatus: '',
  publicResumeEmailStatus: '',
  publicSubmitted: false,
  publicPassword: '',
  twoFactorChallenge: null,
  emailVerification: null,
  authMode: 'signup'
};

const CONTACT_STAGES = ['new', 'qualified', 'contacted', 'proposal', 'won', 'lost', 'nurture'];

const icons = {
  dashboard: '◇',
  surveys: '▤',
  builder: '✎',
  responses: '☷',
  analytics: '↗',
  ai: '✦',
  alerts: '!',
  integrations: '⌁',
  contacts: '◎',
  team: '◌',
  api: '{}',
  campaigns: '✉',
  reports: '▣',
  profile: '◍',
  branding: '●',
  billing: '₹',
  admin: '⚙'
};

icons.agency = '#';

const questionTypes = [
  ['short_text', 'Short text'],
  ['long_text', 'Long text'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['url', 'URL'],
  ['time', 'Time'],
  ['single_choice', 'Single choice'],
  ['multiple_choice', 'Multiple choice'],
  ['dropdown', 'Dropdown'],
  ['yes_no', 'Yes/No'],
  ['rating', 'Rating'],
  ['nps', 'NPS'],
  ['csat', 'CSAT'],
  ['ces', 'CES'],
  ['star_rating', 'Star rating'],
  ['date', 'Date'],
  ['number', 'Number'],
  ['file_upload', 'File upload'],
  ['consent', 'Consent'],
  ['statement', 'Statement']
];

init();

async function init() {
  const publicMatch = location.pathname.match(/^\/s\/([^/]+)/);
  if (publicMatch) {
    await initPublic(publicMatch[1]);
    return;
  }

  state.view = location.hash.replace('#', '') || 'dashboard';
  window.addEventListener('hashchange', () => {
    state.view = location.hash.replace('#', '') || 'dashboard';
    render();
  });

  try {
    state.session = await api('/api/session');
    state.workspaces = state.session.workspaces;
    state.plans = state.session.plans;
    state.workspaceId = localStorage.getItem('formspear.workspaceId') || state.workspaces[0]?.id || '';
    await loadWorkspaceData();
    render();
  } catch {
    renderAuth();
  }
}

async function initPublic(slug) {
  app.innerHTML = `<div class="public-shell"><div class="public-form"><p class="muted">Loading survey...</p></div></div>`;
  try {
    const publicParams = new URLSearchParams();
    if (state.publicPassword) publicParams.set('password', state.publicPassword);
    const lang = new URLSearchParams(location.search).get('lang');
    if (lang) publicParams.set('lang', lang);
    const query = publicParams.toString() ? `?${publicParams.toString()}` : '';
    const payload = await api(`/api/public/surveys/${encodeURIComponent(slug)}${query}`);
    state.publicSurvey = payload.survey;
    state.publicAnswers = {};
    state.publicPage = 0;
    state.publicStartedAt = new Date().toISOString();
    state.publicPartialResponseId = '';
    state.publicResumeToken = '';
    state.publicAutosaveStatus = '';
    state.publicResumeEmailStatus = '';
    state.publicSubmitted = false;
    if (state.publicAutosaveTimer) clearTimeout(state.publicAutosaveTimer);
    state.publicAutosaveTimer = null;
    await restorePublicPartial();
    renderPublicSurvey();
  } catch (error) {
    if (error.code === 'password_required') {
      renderPublicPassword(slug);
      return;
    }
    app.innerHTML = `<div class="public-shell"><div class="public-form"><h1>Survey unavailable</h1><p class="muted">${escapeHtml(error.message || 'This survey is not available.')}</p></div></div>`;
  }
}

async function loadWorkspaceData() {
  if (!state.workspaceId) return;
  const [templates, surveys, alerts, integrations, notifications, members, sso, apiKeys, contacts, campaigns, reports, billing] = await Promise.all([
    api(`/api/templates?workspaceId=${encodeURIComponent(state.workspaceId)}`),
    api(`/api/surveys?workspaceId=${encodeURIComponent(state.workspaceId)}`),
    api(`/api/alerts?workspaceId=${encodeURIComponent(state.workspaceId)}`),
    api(`/api/integrations?workspaceId=${encodeURIComponent(state.workspaceId)}`),
    api(`/api/notifications?workspaceId=${encodeURIComponent(state.workspaceId)}`),
    api(`/api/workspaces/${state.workspaceId}/members`).catch(() => ({ members: [], invites: [] })),
    api(`/api/workspaces/${state.workspaceId}/sso`).catch(() => ({ sso: null, metadataUrl: '' })),
    api(`/api/workspaces/${state.workspaceId}/api-keys`).catch(() => ({ apiKeys: [] })),
    api(`/api/contacts?workspaceId=${encodeURIComponent(state.workspaceId)}`).catch(() => ({ contacts: [] })),
    api(`/api/campaigns?workspaceId=${encodeURIComponent(state.workspaceId)}`).catch(() => ({ campaigns: [] })),
    api(`/api/ai/monthly-reports/${state.workspaceId}`).catch(() => ({ reports: [] })),
    api(`/api/billing?workspaceId=${encodeURIComponent(state.workspaceId)}`).catch(() => ({ subscription: null, invoices: [], usage: [], plans: [] }))
  ]);
  state.templates = templates.templates;
  state.surveys = surveys.surveys;
  state.alerts = alerts.alerts;
  state.integrations = integrations.integrations;
  state.integrationLogs = integrations.integrationLogs || [];
  state.webhooks = integrations.webhooks;
  state.webhookLogs = integrations.webhookLogs;
  state.notifications = notifications.notifications;
  state.members = members.members;
  state.invites = members.invites;
  state.ssoConfig = sso.sso;
  state.ssoMetadataUrl = sso.metadataUrl || '';
  state.apiKeys = apiKeys.apiKeys;
  state.contacts = contacts.contacts;
  state.campaigns = campaigns.campaigns;
  state.monthlyReports = reports.reports;
  state.billingOverview = billing;
  if (!state.selectedSurveyId || !state.surveys.some((survey) => survey.id === state.selectedSurveyId)) {
    state.selectedSurveyId = state.surveys[0]?.id || '';
  }
  state.editingSurvey = null;
  state.responses = [];
  state.analytics = null;
  state.analyticsBenchmark = null;
  state.responseMeta = null;
  state.responsesLoadedFor = '';
  state.analyticsLoadedFor = '';
  state.analyticsBenchmarkLoadedFor = '';
  state.agencyOverview = null;
  state.agencyOverviewLoadedFor = '';
  state.selectedResponseDetail = null;
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth-shell">
      <aside class="auth-aside">
        <div>
          <div class="logo-row"><span class="mark">F</span><span>FeedbackOS</span></div>
          <h1>Turn forms and surveys into business intelligence.</h1>
          <p>Launch branded feedback systems, collect responses, catch complaints early, and package insights for clients without building the same stack again.</p>
        </div>
        <div class="grid">
          <div class="card compact"><strong>Built for the PRD</strong><p>Workspaces, builder, public links, responses, analytics, alerts, AI-style reports, billing plans, and admin operations.</p></div>
        </div>
      </aside>
      <main class="auth-card-wrap">
        <section class="auth-card">
          <div class="button-row">
            <button class="btn ${state.authMode === 'signup' ? 'primary' : ''}" data-action="auth-mode" data-mode="signup">Create account</button>
            <button class="btn ${state.authMode === 'login' ? 'primary' : ''}" data-action="auth-mode" data-mode="login">Sign in</button>
          </div>
          ${state.authMode === 'signup' ? renderSignupForm() : renderLoginForm()}
        </section>
      </main>
    </div>
  `;
}

function renderSignupForm() {
  return `
    <form data-form="signup">
      <h2>Create your first workspace</h2>
      <p>First account becomes the platform super admin for this local install.</p>
      <div class="field"><label>Name</label><input name="name" required value="FeedbackOS Admin" /></div>
      <div class="field"><label>Email</label><input name="email" type="email" required value="admin@feedbackos.local" /></div>
      <div class="field"><label>Password</label><input name="password" type="password" required value="FeedbackOS123" /></div>
      <div class="field"><label>Workspace name</label><input name="workspaceName" required value="Demo Feedback Workspace" /></div>
      <div class="grid two">
        <div class="field"><label>Industry</label><select name="industry"><option>Clinics</option><option>Coaching Center</option><option>Real Estate</option><option>SaaS</option><option>Agency</option></select></div>
        <div class="field"><label>Company size</label><select name="companySize"><option>1-10</option><option>11-50</option><option>51-200</option><option>200+</option></select></div>
      </div>
      <label class="choice"><input name="acceptTerms" type="checkbox" required checked /> I accept the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</label>
      <button class="btn" type="button" data-action="oauth-google" data-mode="signup">Continue with Google</button>
      <button class="btn primary" type="submit">Start FeedbackOS</button>
    </form>
  `;
}

function renderLoginForm() {
  if (state.emailVerification) return renderEmailVerificationForm();
  if (state.twoFactorChallenge) return renderTwoFactorForm();
  return `
    <form data-form="login">
      <h2>Sign in</h2>
      <p>Use the account you created for this local workspace.</p>
      <div class="field"><label>Email</label><input name="email" type="email" required value="admin@feedbackos.local" /></div>
      <div class="field"><label>Password</label><input name="password" type="password" required value="FeedbackOS123" /></div>
      <label class="choice"><input name="rememberMe" type="checkbox" /> Remember this device</label>
      <button class="btn" type="button" data-action="oauth-google" data-mode="login">Continue with Google</button>
      <button class="btn primary" type="submit">Sign in</button>
    </form>
    <form data-form="sso-start">
      <h2>Single sign-on</h2>
      <p>Start workspace SSO. Local dev-mode SSO completes inside this app.</p>
      <div class="field"><label>Work email</label><input name="email" type="email" placeholder="you@company.com" /></div>
      <div class="field"><label>Name for local dev SSO</label><input name="name" placeholder="SSO User" /></div>
      <button class="btn" type="submit">Continue with SSO</button>
    </form>
  `;
}

function renderEmailVerificationForm() {
  return `
    <form data-form="email-verification">
      <h2>Verify email</h2>
      <p>Enter the verification token for ${escapeHtml(state.emailVerification.email || 'your account')}.</p>
      <div class="field"><label>Verification token</label><input name="token" required value="${escapeAttr(state.emailVerification.verificationToken || '')}" /></div>
      <button class="btn primary" type="submit">Verify email</button>
      <button class="btn" type="button" data-action="resend-email-verification">Resend token</button>
      <button class="btn" type="button" data-action="cancel-email-verification">Back to sign in</button>
    </form>
  `;
}

function renderTwoFactorForm() {
  return `
    <form data-form="two-factor">
      <h2>Two-factor code</h2>
      <p>Enter your authenticator code or a recovery code for ${escapeHtml(state.twoFactorChallenge.email || 'this account')}.</p>
      <div class="field"><label>Code</label><input name="code" required autofocus /></div>
      <button class="btn primary" type="submit">Verify code</button>
      <button class="btn" type="button" data-action="cancel-two-factor">Back to sign in</button>
    </form>
  `;
}

function render() {
  if (!state.session) {
    renderAuth();
    return;
  }
  const workspace = currentWorkspace();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="logo-row"><span class="mark">F</span><span>FeedbackOS</span></div>
        <nav class="nav">${navItems().map((item) => `<button class="${state.view === item.id ? 'active' : ''}" data-action="nav" data-view="${item.id}"><span>${icons[item.id] || '·'}</span>${item.label}</button>`).join('')}</nav>
        <div class="card compact">
          <strong>${escapeHtml(workspace?.subscription?.planId || 'starter')}</strong>
          <p class="muted">${escapeHtml(workspace?.name || '')}</p>
          <button class="btn ghost" data-action="logout">Sign out</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <strong>${escapeHtml(workspace?.name || 'Workspace')}</strong>
            <div class="muted">${escapeHtml(state.session.user.name)} · ${escapeHtml(state.session.user.platformRole)}</div>
          </div>
          <div class="workspace-row">
            <select data-action="workspace-select" aria-label="Workspace">
              ${state.workspaces.map((item) => `<option value="${item.id}" ${item.id === state.workspaceId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
            </select>
            <button class="btn" data-action="new-workspace">New workspace</button>
          </div>
        </header>
        <section class="content">${renderView()}</section>
      </main>
    </div>
  `;
}

function navItems() {
  const items = [
    ['dashboard', 'Dashboard'],
    ...(canUseAgencyView() ? [['agency', 'Agency']] : []),
    ['surveys', 'Surveys'],
    ['builder', 'Builder'],
    ['responses', 'Responses'],
    ['analytics', 'Analytics'],
    ['ai', 'AI Insights'],
    ['alerts', 'Alerts'],
    ['integrations', 'Integrations'],
    ['campaigns', 'Campaigns'],
    ['contacts', 'Contacts'],
    ['team', 'Team'],
    ['api', 'API'],
    ['reports', 'Reports'],
    ['branding', 'Branding'],
    ['billing', 'Billing'],
    ['profile', 'Profile']
  ];
  if (state.session?.user.platformRole === 'super_admin') items.push(['admin', 'Admin']);
  return items.map(([id, label]) => ({ id, label }));
}

function renderView() {
  const map = {
    dashboard: renderDashboard,
    agency: renderAgency,
    surveys: renderSurveys,
    builder: renderBuilder,
    responses: renderResponses,
    analytics: renderAnalytics,
    ai: renderAi,
    alerts: renderAlerts,
    integrations: renderIntegrations,
    campaigns: renderCampaigns,
    contacts: renderContacts,
    team: renderTeam,
    api: renderApiKeys,
    reports: renderReports,
    branding: renderBranding,
    billing: renderBilling,
    profile: renderProfile,
    admin: renderAdmin
  };
  return (map[state.view] || renderDashboard)();
}

function renderDashboard() {
  const workspace = currentWorkspace();
  const published = state.surveys.filter((survey) => survey.status === 'published').length;
  const responses = state.surveys.reduce((sum, survey) => sum + (survey.metrics?.completions || 0), 0);
  const usage = workspace?.usage || {};
  return `
    <div class="page-title">
      <div><h1>Command center</h1><p>Track workspaces, surveys, responses, alerts, and monetization readiness.</p></div>
      <button class="btn primary" data-action="quick-create">Create survey</button>
    </div>
    <div class="grid metrics">
      ${metric('Published surveys', published, `${state.surveys.length} total`)}
      ${metric('Responses', responses, `${usage.responsesCount || 0} this month`)}
      ${metric('AI credits used', usage.aiCreditsUsed || 0, 'local summaries')}
      ${metric('Open alerts', state.notifications.filter((item) => !item.read).length, 'in-app notifications')}
    </div>
    <div class="grid two">
      <section class="section">
        <h2>Recent surveys</h2>
        ${state.surveys.length ? `<div class="survey-list">${state.surveys.slice(0, 4).map(renderSurveyCard).join('')}</div>` : empty('No surveys yet. Create from a template to start collecting feedback.')}
      </section>
      <section class="section">
        <h2>Notifications</h2>
        ${state.notifications.length ? state.notifications.slice(0, 6).map((item) => `<div class="card compact"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><span class="pill">${dateLabel(item.createdAt)}</span></div>`).join('') : empty('No alert notifications yet.')}
      </section>
    </div>
    <section class="section">
      <h2>Launch checklist</h2>
      <div class="grid three">
        ${checkCard('Authentication', true, 'Local email/password sessions are active.')}
        ${checkCard('Workspace isolation', Boolean(workspace), 'All workspace APIs enforce membership.')}
        ${checkCard('Public survey', published > 0, published ? 'A published survey is ready to share.' : 'Publish a survey to unlock the public link.')}
        ${checkCard('Responses', responses > 0, responses ? 'Responses are flowing into analytics.' : 'Submit a test response from a public link.')}
        ${checkCard('Alerts', state.alerts.length > 0, state.alerts.length ? 'Alert rules are configured.' : 'Create at least one alert rule.')}
        ${checkCard('Billing plan', Boolean(workspace?.subscription), 'A workspace subscription record exists.')}
      </div>
    </section>
  `;
}

function renderAgency() {
  if (!canUseAgencyView()) return empty('Agency overview requires the Agency plan.');
  if (state.agencyOverviewLoadedFor !== agencyOverviewWorkspaceId()) queueLoadAgencyOverview();
  const overview = state.agencyOverview;
  const totals = overview?.totals || {};
  return `
    <div class="page-title">
      <div><h1>Agency</h1><p>Central client-workspace portfolio for surveys, responses, alerts, reports, usage, and billing health.</p></div>
      <button class="btn primary" data-action="new-workspace">New client workspace</button>
    </div>
    ${overview?.error ? `<div class="empty">${escapeHtml(overview.error)}</div>` : overview ? `
      <div class="grid metrics">
        ${metric('Client workspaces', totals.clientWorkspaces || 0, `${totals.activeSubscriptions || 0} active subscriptions`)}
        ${metric('Responses', totals.responses || 0, `${totals.responsesThisMonth || 0} this month`)}
        ${metric('MRR', `INR ${formatNumber(totals.mrr || 0)}`, 'current active plans')}
        ${metric('Open alerts', totals.openAlerts || 0, `${totals.monthlyReports || 0} reports generated`)}
      </div>
      <div class="grid three">
        <div class="card"><h3>Plan mix</h3>${renderBars(overview.planDistribution || [])}</div>
        <div class="card"><h3>Agency workspace</h3><p><strong>${escapeHtml(overview.agencyWorkspace?.name || 'Workspace')}</strong></p><p class="muted">${escapeHtml(overview.agencyWorkspace?.planName || '')} · ${escapeHtml(overview.agencyWorkspace?.role || '')}</p></div>
        <div class="card"><h3>Portfolio usage</h3><p>${formatNumber(totals.aiCreditsUsed || 0)} AI credits</p><p class="muted">${formatNumber(totals.teamMembers || 0)} team seats across clients</p></div>
      </div>
      <section class="section">
        <h2>Client workspaces</h2>
        ${renderAgencyClients(overview.clients || [])}
      </section>
    ` : empty('Loading agency overview...')}
  `;
}

function renderAgencyClients(clients) {
  if (!clients.length) return empty('No client workspaces yet.');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Client</th><th>Plan</th><th>Surveys</th><th>Responses</th><th>Contacts</th><th>Reports</th><th>Alerts</th><th>Last response</th><th>Health</th><th></th></tr></thead>
    <tbody>${clients.map((client) => `<tr>
      <td><strong>${escapeHtml(client.name)}</strong><br><span class="muted">${escapeHtml(client.industry || 'General')}</span></td>
      <td>${escapeHtml(client.planName)}<br><span class="muted">${escapeHtml(client.subscriptionStatus)}</span></td>
      <td>${client.publishedSurveys}/${client.surveys}</td>
      <td>${client.responses}<br><span class="muted">${client.responsesThisMonth} this month</span></td>
      <td>${client.contacts}</td>
      <td>${client.monthlyReports}</td>
      <td>${client.openAlerts}</td>
      <td>${client.lastResponseAt ? dateLabel(client.lastResponseAt) : 'None'}</td>
      <td><span class="pill ${agencyHealthClass(client.health)}">${escapeHtml(client.health.replaceAll('_', ' '))}</span></td>
      <td><button class="btn" data-action="open-client-workspace" data-workspace-id="${escapeAttr(client.workspaceId)}">Open</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function agencyHealthClass(health) {
  if (health === 'active') return 'good';
  if (health === 'needs_attention' || health === 'suspended') return 'warn';
  return '';
}

function renderSurveys() {
  return `
    <div class="page-title">
      <div><h1>Surveys</h1><p>Create, publish, pause, and share forms across feedback, lead, employee, and product use cases.</p></div>
      <div class="toolbar"><button class="btn primary" data-action="quick-create">New blank survey</button></div>
    </div>
    <section class="section">
      <h2>Template marketplace</h2>
      <div class="grid three">
        ${state.templates.map(renderTemplateCard).join('')}
      </div>
    </section>
    <section class="section">
      <h2>Workspace surveys</h2>
      ${state.surveys.length ? `<div class="survey-list">${state.surveys.map(renderSurveyCard).join('')}</div>` : empty('No surveys in this workspace.')}
    </section>
  `;
}

function renderTemplateCard(template) {
  const source = template.workspaceId ? 'workspace' : (template.source || 'global');
  return `<div class="card">
    <div class="pill-row">
      <span class="pill">${escapeHtml(source)}</span>
      <span class="pill">${escapeHtml(template.category || template.type || 'general')}</span>
      ${template.status && template.status !== 'published' ? `<span class="pill">${escapeHtml(template.status)}</span>` : ''}
    </div>
    <h3>${escapeHtml(template.name)}</h3>
    <p class="muted">${escapeHtml(template.description || 'Reusable survey template.')}</p>
    <p class="muted">${escapeHtml((template.tags || []).join(', '))}</p>
    <button class="btn accent" data-action="create-template" data-template-id="${escapeAttr(template.id)}">Use template</button>
  </div>`;
}

function renderSurveyCard(survey) {
  const publicUrl = `${location.origin}/s/${survey.slug}`;
  return `
    <article class="card survey-card ${survey.id === state.selectedSurveyId ? 'selected' : ''}">
      <div>
        <div class="pill-row"><span class="status ${survey.status}">${escapeHtml(survey.status)}</span><span class="pill">${escapeHtml(survey.type.replaceAll('_', ' '))}</span></div>
        <h3>${escapeHtml(survey.title)}</h3>
        <p>${escapeHtml(survey.description || 'No description yet.')}</p>
      </div>
      <div class="metric-row">
        <span class="pill">${survey.schema.questions.length} questions</span>
        <span class="pill">${survey.metrics?.completions || 0} responses</span>
      </div>
      <div class="button-row">
        <button class="btn" data-action="select-survey" data-survey-id="${survey.id}">Select</button>
        <button class="btn" data-action="edit-survey" data-survey-id="${survey.id}">Edit</button>
        <button class="btn" data-action="save-as-template" data-survey-id="${survey.id}">Save as template</button>
        ${survey.status === 'published' ? `<button class="btn" data-action="copy-link" data-link="${publicUrl}">Copy link</button>` : `<button class="btn primary" data-action="publish-survey" data-survey-id="${survey.id}">Publish</button>`}
      </div>
    </article>
  `;
}

function renderBuilder() {
  const survey = ensureEditingSurvey();
  if (!survey) return empty('Create or select a survey to open the builder.');
  const question = selectedQuestion(survey);
  return `
    <div class="page-title">
      <div><h1>Survey builder</h1><p>Left question list, center editor, right settings and distribution, matching the PRD layout.</p></div>
      <div class="toolbar">
        ${renderApprovalToolbar(survey)}
        <button class="btn" data-action="save-survey">Save draft</button>
        <button class="btn primary" data-action="publish-survey" data-survey-id="${survey.id}">Publish</button>
      </div>
    </div>
    <div class="builder">
      <aside class="builder-panel">
        <h3>Questions</h3>
        <div class="question-list">
          ${survey.schema.questions.map((item, index) => `<button class="question-row ${item.id === state.selectedQuestionId ? 'active' : ''}" data-action="select-question" data-question-id="${item.id}">
            <strong>${index + 1}. ${escapeHtml(item.title || typeLabel(item.type))}</strong>
            <small>${typeLabel(item.type)} ${item.required ? '· required' : ''}</small>
          </button>`).join('')}
        </div>
        <h3>Add type</h3>
        <div class="type-grid">${questionTypes.map(([type, label]) => `<button class="btn" data-action="add-question" data-type="${type}">${label}</button>`).join('')}</div>
      </aside>
      <section class="builder-panel">
        <div class="grid two">
          <div class="field"><label>Survey title</label><input data-edit="survey.title" value="${escapeAttr(survey.title)}" /></div>
          <div class="field"><label>Survey type</label><select data-edit="survey.type">${surveyTypes().map((type) => `<option value="${type}" ${survey.type === type ? 'selected' : ''}>${type.replaceAll('_', ' ')}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Description</label><textarea data-edit="survey.description">${escapeHtml(survey.description)}</textarea></div>
        ${question ? renderQuestionEditor(question) : empty('Add a question to begin.')}
        <h3>Live preview</h3>
        <div class="preview">${renderSurveyPreview(survey)}</div>
      </section>
      <aside class="builder-panel">
        <h3>Settings</h3>
        <div class="field"><label>Public slug</label><input data-edit="survey.slug" value="${escapeAttr(survey.slug || '')}" /></div>
        <div class="field"><label>Completion message</label><textarea data-edit="completion.message">${escapeHtml(survey.schema.completion.message)}</textarea></div>
        <div class="field"><label>Completion redirect URL</label><input data-edit="settings.completionRedirectUrl" value="${escapeAttr(survey.settings.completionRedirectUrl || survey.schema.completion.redirectUrl || '')}" /></div>
        <div class="field"><label>Language</label><input data-edit="survey.language" value="${escapeAttr(survey.language || 'en')}" /></div>
        <div class="field"><label>Brand color</label><input data-edit="branding.brandColor" value="${escapeAttr(survey.branding.brandColor || currentWorkspace()?.brandColor || '#176B5B')}" /></div>
        <div class="field"><label>Button color</label><input data-edit="branding.buttonColor" value="${escapeAttr(survey.branding.buttonColor || currentWorkspace()?.buttonColor || '#B75D2A')}" /></div>
        <div class="grid two">
          <div class="field"><label>Response limit</label><input type="number" min="0" data-edit="settings.responseLimit" value="${Number(survey.settings.responseLimit || 0)}" /></div>
          <div class="field"><label>Opens at</label><input type="datetime-local" data-edit="settings.opensAt" value="${dateTimeLocalValue(survey.settings.opensAt)}" /></div>
          <div class="field"><label>Expires at</label><input type="datetime-local" data-edit="settings.expiresAt" value="${dateTimeLocalValue(survey.settings.expiresAt)}" /></div>
        </div>
        <div class="field"><label>Duplicate prevention</label><select data-edit="settings.duplicatePrevention">
          ${['allow_multiple', 'one_per_browser', 'one_per_email', 'one_per_user_id', 'one_per_ip_hash'].map((item) => `<option value="${item}" ${survey.settings.duplicatePrevention === item ? 'selected' : ''}>${item.replaceAll('_', ' ')}</option>`).join('')}
        </select></div>
        <label class="choice"><input type="checkbox" data-edit="settings.anonymousMode" ${survey.settings.anonymousMode ? 'checked' : ''}/> Anonymous mode</label>
        <label class="choice"><input type="checkbox" data-edit="settings.collectIpHash" ${survey.settings.collectIpHash ? 'checked' : ''}/> Collect IP hash</label>
        <label class="choice"><input type="checkbox" data-edit="settings.collectUserAgent" ${survey.settings.collectUserAgent ? 'checked' : ''}/> Collect user agent</label>
        <label class="choice"><input type="checkbox" data-edit="settings.requireConsent" ${survey.settings.requireConsent ? 'checked' : ''}/> Require consent</label>
        <label class="choice"><input type="checkbox" data-edit="settings.passwordProtected" ${survey.settings.passwordProtected ? 'checked' : ''}/> Password protect public link</label>
        <div class="field"><label>Set/replace password</label><input type="password" data-edit="settings.password" placeholder="${survey.settings.passwordHash ? 'Password already set' : 'Required if protected'}" /></div>
        ${renderSurveyApproval(survey)}
        ${renderSurveyAccess(survey)}
        <h3>Distribution</h3>
        <div class="code">${survey.status === 'published' ? `${location.origin}/s/${survey.slug}` : 'Publish to generate a live public link.'}</div>
        ${survey.status === 'published' ? `<img class="qr-img" src="/api/surveys/${survey.id}/qr.svg" alt="Survey share code" />` : ''}
        ${survey.status === 'published' ? `<div class="field"><label>Website embed</label><div class="code">&lt;script async src="${location.origin}/embed.js" data-feedbackos-slug="${survey.slug}" data-feedbackos-mode="inline"&gt;&lt;/script&gt;</div></div>
        <div class="field"><label>In-app SDK</label><div class="code">&lt;script async src="${location.origin}/sdk.js"&gt;&lt;/script&gt;<br>FeedbackOS.identify("user_123", { plan: "pro" });<br>FeedbackOS.trigger("${escapeHtml(survey.settings.inAppTriggerEvent || 'onboarding_complete')}")</div></div>` : ''}
        <h3>In-app targeting</h3>
        <div class="grid two">
          <div class="field"><label>Trigger event</label><input data-edit="settings.inAppTriggerEvent" value="${escapeAttr(survey.settings.inAppTriggerEvent || '')}" placeholder="onboarding_complete" /></div>
          <div class="field"><label>Page/screen contains</label><input data-edit="settings.inAppTargetPath" value="${escapeAttr(survey.settings.inAppTargetPath || '')}" placeholder="/app/onboarding" /></div>
          <div class="field"><label>User property</label><input data-edit="settings.inAppAudienceProperty" value="${escapeAttr(survey.settings.inAppAudienceProperty || '')}" placeholder="plan" /></div>
          <div class="field"><label>User property value</label><input data-edit="settings.inAppAudienceValue" value="${escapeAttr(survey.settings.inAppAudienceValue || '')}" placeholder="pro" /></div>
          <div class="field"><label>Frequency days</label><input type="number" min="0" max="365" data-edit="settings.inAppFrequencyDays" value="${Number(survey.settings.inAppFrequencyDays || 0)}" /></div>
        </div>
        <h3>Language variants</h3>
        <div class="grid two">
          <div class="field"><label>Generate language</label><input id="translation-language" value="es" /></div>
          <button class="btn" data-action="generate-translation" data-survey-id="${survey.id}">Generate draft</button>
        </div>
        <div class="field"><label>Translations JSON</label><textarea data-edit="schema.translations" placeholder='{"hi":{"title":"...","questions":{"q_id":{"title":"..."}}}}'>${escapeHtml(JSON.stringify(survey.schema.translations || {}, null, 2))}</textarea></div>
        ${renderLogicBuilder(survey)}
      </aside>
    </div>
  `;
}

function renderApprovalToolbar(survey) {
  const workspace = currentWorkspace();
  if (!workspace?.requirePublishApproval) return '';
  const status = survey.approvalStatus || 'not_required';
  const canReview = canReviewSurveyApprovals();
  const actions = [];
  if (!canReview && status !== 'approved') actions.push(`<button class="btn" data-action="request-approval" data-survey-id="${survey.id}">Request approval</button>`);
  if (canReview && status !== 'approved') actions.push(`<button class="btn" data-action="approve-survey" data-survey-id="${survey.id}">Approve</button>`);
  if (canReview && ['pending', 'stale'].includes(status)) actions.push(`<button class="btn danger" data-action="reject-survey" data-survey-id="${survey.id}">Reject</button>`);
  return `<span class="pill">${escapeHtml(status.replaceAll('_', ' '))}</span>${actions.join('')}`;
}

function renderSurveyApproval(survey) {
  const workspace = currentWorkspace();
  const required = Boolean(workspace?.requirePublishApproval);
  const status = survey.approvalStatus || 'not_required';
  const requested = survey.approvalRequestedAt ? `Requested ${dateLabel(survey.approvalRequestedAt)}` : 'No request yet.';
  const reviewed = survey.approvalReviewedAt ? `Reviewed ${dateLabel(survey.approvalReviewedAt)}` : '';
  const note = survey.approvalNote ? `<p class="muted">${escapeHtml(survey.approvalNote)}</p>` : '';
  return `
    <h3>Approval</h3>
    <div class="metric-row">
      <span class="pill ${status === 'approved' ? 'good' : ''}">${escapeHtml(status.replaceAll('_', ' '))}</span>
      <span class="pill">${required ? 'required' : 'optional'}</span>
    </div>
    <p class="muted">${escapeHtml(requested)} ${escapeHtml(reviewed)}</p>
    ${note}
    <div class="button-row">
      <button class="btn" data-action="request-approval" data-survey-id="${survey.id}">Request approval</button>
      ${canReviewSurveyApprovals() ? `<button class="btn" data-action="approve-survey" data-survey-id="${survey.id}">Approve</button><button class="btn danger" data-action="reject-survey" data-survey-id="${survey.id}">Reject</button>` : ''}
    </div>
  `;
}

function renderSurveyAccess(survey) {
  const rules = survey.accessRules || [];
  const grantableMembers = state.members.filter((member) => !rules.some((rule) => rule.userId === member.userId));
  return `
    <h3>Access</h3>
    <div class="field"><label>Survey access</label><select data-edit="survey.accessMode">
      <option value="workspace" ${survey.accessMode !== 'selected' ? 'selected' : ''}>Workspace members</option>
      <option value="selected" ${survey.accessMode === 'selected' ? 'selected' : ''}>Selected users only</option>
    </select></div>
    <div class="grid two">
      <div class="field"><label>Grant user</label><select id="survey-access-user">${grantableMembers.map((member) => `<option value="${escapeAttr(member.userId)}">${escapeHtml(member.user?.name || member.user?.email || member.userId)}</option>`).join('')}</select></div>
      <div class="field"><label>Grant role</label><select id="survey-access-role">${['viewer', 'analyst', 'editor'].map((role) => `<option value="${role}">${role}</option>`).join('')}</select></div>
    </div>
    <button class="btn" data-action="add-access-rule">Add access</button>
    <div class="pill-row">${rules.length ? rules.map((rule) => {
      const member = state.members.find((item) => item.userId === rule.userId);
      const label = member?.user?.name || member?.user?.email || rule.userId;
      return `<span class="pill">${escapeHtml(label)}: ${escapeHtml(rule.role)} <button class="link-button" data-action="delete-access-rule" data-user-id="${escapeAttr(rule.userId)}">remove</button></span>`;
    }).join('') : '<span class="muted">No survey-specific grants.</span>'}</div>
  `;
}

function renderQuestionEditor(question) {
  return `
    <div class="card">
      <div class="question-header">
        <h3>Question editor</h3>
        <span class="pill">${typeLabel(question.type)}</span>
      </div>
      <div class="field"><label>Question title</label><input data-edit="question.title" value="${escapeAttr(question.title)}" /></div>
      <div class="field"><label>Description/help text</label><textarea data-edit="question.description">${escapeHtml(question.description || '')}</textarea></div>
      <div class="grid two">
        <div class="field"><label>Placeholder</label><input data-edit="question.settings.placeholder" value="${escapeAttr(question.settings.placeholder || '')}" /></div>
        <div class="field"><label>Internal field key</label><input data-edit="question.id" value="${escapeAttr(question.id)}" /></div>
        <div class="field"><label>Page</label><input type="number" min="1" max="50" data-edit="question.settings.page" value="${Number(question.settings.page || 1)}" /></div>
      </div>
      ${choiceQuestion(question) ? `<div class="field"><label>Options, one per line</label><textarea data-edit="question.settings.options">${escapeHtml((question.settings.options || []).join('\n'))}</textarea></div>` : ''}
      ${scaleQuestion(question) ? `<div class="grid three">
        <div class="field"><label>Scale</label><input type="number" min="2" max="10" data-edit="question.settings.scale" value="${Number(question.settings.scale || 5)}" /></div>
        <div class="field"><label>Low label</label><input data-edit="question.settings.lowLabel" value="${escapeAttr(question.settings.lowLabel || '')}" /></div>
        <div class="field"><label>High label</label><input data-edit="question.settings.highLabel" value="${escapeAttr(question.settings.highLabel || '')}" /></div>
      </div>` : ''}
      ${question.type === 'file_upload' ? `<div class="grid two">
        <div class="field"><label>Allowed extensions</label><input data-edit="question.settings.allowedFileTypes" value="${escapeAttr((question.settings.allowedFileTypes || ['pdf', 'png', 'jpg']).join(', '))}" /></div>
        <div class="field"><label>Max size MB</label><input type="number" min="1" max="20" data-edit="question.settings.maxSizeMB" value="${Number(question.settings.maxSizeMB || 5)}" /></div>
      </div>` : ''}
      ${question.type === 'consent' ? `<div class="field"><label>Consent text</label><input data-edit="question.settings.consentText" value="${escapeAttr(question.settings.consentText || 'I agree.')}" /></div>` : ''}
      <label class="choice"><input type="checkbox" data-edit="question.required" ${question.required ? 'checked' : ''}/> Required</label>
      <div class="button-row">
        <button class="btn" data-action="duplicate-question">Duplicate</button>
        <button class="btn" data-action="move-question" data-direction="-1">Move up</button>
        <button class="btn" data-action="move-question" data-direction="1">Move down</button>
        <button class="btn danger" data-action="delete-question">Delete</button>
      </div>
    </div>
  `;
}

function renderLogicBuilder(survey) {
  const questionOptions = survey.schema.questions
    .filter((question) => !['section', 'statement'].includes(question.type))
    .map((question) => `<option value="${question.id}">${escapeHtml(question.title)}</option>`)
    .join('');
  const actionOptions = [
    ['show_question', 'Show question'],
    ['skip_to_question', 'Skip to question'],
    ['assign_tag', 'Assign tag'],
    ['trigger_alert', 'Trigger alert'],
    ['set_hidden_field', 'Set hidden field'],
    ['calculate_score', 'Adjust lead score'],
    ['end_survey', 'End with message'],
    ['redirect', 'Redirect']
  ];
  return `
    <h3>Conditional logic</h3>
    <div class="field"><label>If question</label><select id="logic-question">${questionOptions}</select></div>
    <div class="field"><label>Operator</label><select id="logic-operator">
      ${['equals', 'does_not_equal', 'contains', 'does_not_contain', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'].map((operator) => `<option value="${operator}">${operator.replaceAll('_', ' ')}</option>`).join('')}
    </select></div>
    <div class="field"><label>Value</label><input id="logic-value" placeholder="Answer value" /></div>
    <div class="field"><label>Action</label><select id="logic-action">${actionOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></div>
    <div class="field"><label>Target question or hidden field</label><select id="logic-target"><option value="">None</option>${questionOptions}</select></div>
    <div class="field"><label>Action value</label><input id="logic-action-value" placeholder="Tag, hidden value, alert text, or completion message" /></div>
    <div class="grid two">
      <div class="field"><label>Score delta</label><input id="logic-score-delta" type="number" value="0" /></div>
      <div class="field"><label>Redirect URL</label><input id="logic-redirect-url" placeholder="https://example.com/thanks" /></div>
    </div>
    <button class="btn" data-action="add-logic">Add logic</button>
    <div class="grid">
      ${(survey.schema.logic || []).map((rule) => `<div class="card compact">
        <strong>${escapeHtml(questionTitle(survey, rule.questionId))}</strong>
        <p class="muted">${escapeHtml(logicRuleSummary(survey, rule))}</p>
        <button class="btn danger" data-action="delete-logic" data-logic-id="${rule.id}">Remove</button>
      </div>`).join('') || '<p class="muted">No logic rules yet.</p>'}
    </div>
  `;
}

function renderSurveyPreview(survey) {
  return `
    <h2>${escapeHtml(survey.title)}</h2>
    <p class="muted">${escapeHtml(survey.description)}</p>
    ${survey.schema.questions.map((question) => `<div class="public-question">
      <strong>${escapeHtml(question.title)} ${question.required ? '<span class="pill danger">Required</span>' : ''}</strong>
      ${question.description ? `<p class="muted">${escapeHtml(question.description)}</p>` : ''}
      ${renderInputPreview(question)}
    </div>`).join('')}
  `;
}

function renderInputPreview(question) {
  if (choiceQuestion(question)) return `<div class="choice-list">${(question.settings.options || []).map((option) => `<label class="choice"><input type="${question.type === 'multiple_choice' ? 'checkbox' : 'radio'}" disabled /> ${escapeHtml(option)}</label>`).join('')}</div>`;
  if (scaleQuestion(question)) return `<div class="scale">${Array.from({ length: Number(question.settings.scale || 5) }, (_, index) => `<label>${index + 1}</label>`).join('')}</div>`;
  if (question.type === 'long_text') return '<textarea disabled placeholder="Long answer"></textarea>';
  if (question.type === 'file_upload') return `<input type="file" disabled /><p class="muted">Allows ${(question.settings.allowedFileTypes || []).join(', ') || 'configured'} up to ${Number(question.settings.maxSizeMB || 5)} MB.</p>`;
  if (question.type === 'consent') return `<label class="choice"><input type="checkbox" disabled /> ${escapeHtml(question.settings.consentText || 'I agree.')}</label>`;
  if (question.type === 'statement' || question.type === 'section') return '<p class="muted">Instruction block</p>';
  return `<input disabled placeholder="${escapeAttr(question.settings.placeholder || 'Answer')}" />`;
}

function renderResponses() {
  const survey = selectedSurvey();
  if (!survey) return empty('Select a survey to view responses.');
  const rows = state.responses.length ? state.responses : [];
  if (state.responsesLoadedFor !== responseFilterKey(survey.id)) queueLoadResponses(survey.id);
  const filters = state.responseFilters || {};
  const meta = state.responseMeta || {};
  return `
    <div class="page-title">
      <div><h1>Responses</h1><p>${escapeHtml(survey.title)} response table, export, tags, sentiment, lead score, and metadata.</p></div>
      <div class="toolbar">
        <a class="btn" href="/api/surveys/${survey.id}/export.csv">Export CSV</a>
        <a class="btn" href="/api/surveys/${survey.id}/export.xlsx">Export XLSX</a>
        <a class="btn" href="/api/surveys/${survey.id}/export.json">Export JSON</a>
        ${survey.status === 'published' ? `<a class="btn primary" href="/s/${survey.slug}" target="_blank" rel="noreferrer">Open public form</a>` : ''}
      </div>
    </div>
    <form class="card compact" data-form="response-filters">
      <div class="grid four">
        <div class="field"><label>Search</label><input name="q" value="${escapeAttr(filters.q || '')}" placeholder="answers, tags, metadata" /></div>
        <div class="field"><label>Status</label><select name="status"><option value="">Any</option>${['completed', 'partial', 'started', 'archived', 'disqualified'].map((item) => `<option value="${item}" ${filters.status === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div>
        <div class="field"><label>Sentiment</label><select name="sentiment"><option value="">Any</option>${['positive', 'neutral', 'negative', 'mixed'].map((item) => `<option value="${item}" ${filters.sentiment === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div>
        <div class="field"><label>Source</label><input name="source" value="${escapeAttr(filters.source || '')}" placeholder="qr, email, website" /></div>
        <div class="field"><label>Tag</label><input name="tag" value="${escapeAttr(filters.tag || '')}" /></div>
        <div class="field"><label>From</label><input name="from" type="date" value="${escapeAttr(filters.from || '')}" /></div>
        <div class="field"><label>To</label><input name="to" type="date" value="${escapeAttr(filters.to || '')}" /></div>
        <div class="field"><label>Sort</label><select name="sort">${['submitted_desc', 'submitted_asc', 'lead_desc', 'lead_asc'].map((item) => `<option value="${item}" ${(filters.sort || 'submitted_desc') === item ? 'selected' : ''}>${item.replaceAll('_', ' ')}</option>`).join('')}</select></div>
      </div>
      <button class="btn primary" type="submit">Apply filters</button>
      <button class="btn" type="button" data-action="clear-response-filters">Clear</button>
      <span class="muted">${meta.total !== undefined ? `${meta.total} matching responses` : 'Loading matches...'}</span>
    </form>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Submitted</th><th>Sentiment</th><th>Lead</th><th>Answers</th><th>Metadata</th><th>Actions</th></tr></thead>
      <tbody>${rows.map((response) => `<tr>
        <td>${dateLabel(response.submittedAt)}</td>
        <td><span class="pill ${response.sentiment === 'negative' ? 'danger' : response.sentiment === 'positive' ? 'good' : ''}">${escapeHtml(response.sentiment)}</span></td>
        <td>${response.leadScore}</td>
        <td>${renderAnswerSummary(survey, response)}</td>
        <td><span class="pill">${escapeHtml(response.metadataJson?.deviceType || 'unknown')}</span> <span class="pill">${escapeHtml(response.metadataJson?.source || 'direct')}</span></td>
        <td><button class="btn" data-action="open-response" data-response-id="${response.id}">Open</button></td>
      </tr>`).join('')}</tbody>
    </table></div>` : empty('No responses yet. Submit a test response from the public form.')}
    ${state.selectedResponseDetail ? renderResponseDetail(state.selectedResponseDetail) : ''}
  `;
}

function renderAnswerSummary(survey, response) {
  return survey.schema.questions
    .filter((question) => response.answersJson[question.id] !== undefined)
    .slice(0, 4)
    .map((question) => `<div><strong>${escapeHtml(question.title)}:</strong> ${escapeHtml(formatAnswer(response.answersJson[question.id]))}</div>`)
    .join('');
}

function renderResponseDetail(response) {
  return `
    <section class="section">
      <h2>Response detail</h2>
      <div class="grid two">
        <div class="card">
          <span class="pill ${response.important ? 'warn' : ''}">${response.important ? 'important' : response.status}</span>
          <h3>${escapeHtml(response.survey.title)}</h3>
          <p class="muted">Sentiment ${escapeHtml(response.sentiment)} · lead score ${response.leadScore}</p>
          <div class="button-row">
            <button class="btn" data-action="toggle-important" data-response-id="${response.id}" data-important="${response.important ? 'false' : 'true'}">${response.important ? 'Unmark' : 'Mark important'}</button>
            <button class="btn" data-action="tag-response" data-response-id="${response.id}">Add tag</button>
            <button class="btn" data-action="note-response" data-response-id="${response.id}">Add note</button>
            <button class="btn" data-action="archive-response" data-response-id="${response.id}">Archive</button>
            <a class="btn" href="/api/surveys/${response.survey.id}/responses/${response.id}/export.pdf" target="_blank" rel="noreferrer">Export PDF</a>
            <button class="btn danger" data-action="anonymize-response" data-response-id="${response.id}">Anonymize</button>
          </div>
          <h3>Tags</h3>
          <div class="pill-row">${(response.tagsJson || []).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join('') || '<span class="muted">No tags</span>'}</div>
        </div>
        <div class="card">
          <h3>AI response summary</h3>
          <p><strong>${escapeHtml(response.aiSummary.recommendation)}</strong></p>
          <p class="muted">AI-generated · ${escapeHtml(response.aiSummary.sentiment)} · ${response.aiSummary.leadScore}</p>
          <h3>Respondent</h3>
          <p>${escapeHtml(response.respondent?.name || response.contact?.name || 'Unknown')}<br>${escapeHtml(response.respondent?.email || response.contact?.email || '')}</p>
        </div>
      </div>
      <div class="grid two">
        <div class="card"><h3>Answers</h3>${Object.entries(response.answersJson || {}).map(([key, value]) => `<p><strong>${escapeHtml(key)}</strong><br>${escapeHtml(formatAnswer(value))}</p>`).join('')}</div>
        <div class="card"><h3>Timeline</h3>${(response.timeline || []).map((item) => `<p><strong>${escapeHtml(item.label)}</strong><br>${dateLabel(item.at)}</p>`).join('')}<h3>Notes</h3>${(response.internalNotes || []).map((note) => `<p>${escapeHtml(note.text)}<br><span class="muted">${dateLabel(note.createdAt)}</span></p>`).join('') || '<p class="muted">No notes yet.</p>'}</div>
      </div>
    </section>
  `;
}

function renderAnalytics() {
  const survey = selectedSurvey();
  if (!survey) return empty('Select a survey to view analytics.');
  if (state.analyticsLoadedFor !== analyticsFilterKey(survey.id)) queueLoadAnalytics(survey.id);
  if (state.analyticsBenchmarkLoadedFor !== analyticsBenchmarkFilterKey()) queueLoadAnalyticsBenchmark();
  const analytics = state.analytics;
  const benchmark = state.analyticsBenchmark;
  const filters = state.analyticsFilters || {};
  return `
    <div class="page-title"><div><h1>Analytics</h1><p>Views, starts, completions, NPS/CSAT, sentiment, source, device, branch, location, and question-level distribution.</p></div></div>
    <form class="card compact" data-form="analytics-filters">
      <div class="grid four">
        <div class="field"><label>From</label><input name="from" type="date" value="${escapeAttr(filters.from || '')}" /></div>
        <div class="field"><label>To</label><input name="to" type="date" value="${escapeAttr(filters.to || '')}" /></div>
        <div class="field"><label>Compare from</label><input name="compareFrom" type="date" value="${escapeAttr(filters.compareFrom || '')}" /></div>
        <div class="field"><label>Compare to</label><input name="compareTo" type="date" value="${escapeAttr(filters.compareTo || '')}" /></div>
      </div>
      <button class="btn primary" type="submit">Apply range</button>
      <button class="btn" type="button" data-action="clear-analytics-filters">Clear</button>
    </form>
    ${analytics ? `
      <div class="grid metrics">
        ${metric('Views', analytics.totals.views, 'public page')}
        ${metric('Completions', analytics.totals.completions, `${analytics.totals.completionRate}% completion`)}
        ${metric('Drop-off', `${analytics.totals.dropOffRate}%`, 'view to complete')}
        ${metric('Avg lead score', analytics.leadScoreAverage, '0-100')}
      </div>
      ${analytics.comparison ? `<div class="grid three">
        ${metric('Completion delta', analytics.comparison.deltaCompletions, 'current vs comparison')}
        ${metric('Rate delta', `${analytics.comparison.deltaCompletionRate}%`, 'completion rate')}
        ${metric('Lead delta', analytics.comparison.deltaLeadScoreAverage, 'average score')}
      </div>` : ''}
      <div class="grid two">
        <div class="card"><h3>Responses by date</h3>${renderBars(analytics.byDate)}</div>
        <div class="card"><h3>Sentiment</h3>${renderBars(objectToBars(analytics.sentiment))}</div>
      </div>
      <div class="grid four">
        <div class="card"><h3>Source</h3>${renderBars(analytics.bySource)}</div>
        <div class="card"><h3>Device</h3>${renderBars(analytics.byDevice)}</div>
        <div class="card"><h3>Branch</h3>${renderBars(analytics.byBranch)}</div>
        <div class="card"><h3>Location</h3>${renderBars(analytics.byLocation)}</div>
      </div>
      <section class="section">
        <h2>Funnel analytics</h2>
        ${renderFunnelAnalytics(analytics)}
      </section>
      <section class="section">
        <h2>Question analytics</h2>
        <div class="grid two">${analytics.questionStats.map(renderQuestionStat).join('')}</div>
      </section>
      <section class="section">
        <h2>Question drop-off</h2>
        ${renderQuestionDropOff(analytics.questionDropOff || [])}
      </section>
      <section class="section">
        <h2>Survey benchmark</h2>
        ${benchmark ? renderAnalyticsBenchmark(benchmark) : empty('Loading benchmark...')}
      </section>
    ` : empty('Loading analytics...')}
  `;
}

function renderFunnelAnalytics(analytics) {
  const funnel = analytics.funnel || {};
  return `<div class="grid two">
    <div class="card">
      <h3>View to response funnel</h3>
      ${renderBars((funnel.steps || []).map((step) => ({ label: step.label, value: step.count })))}
    </div>
    <div class="card">
      <h3>Conversion rates</h3>
      <div class="grid three">
        ${metric('View to start', `${funnel.viewToStartRate || 0}%`, `${funnel.abandonedAfterView || 0} left before start`)}
        ${metric('Start to complete', `${funnel.startToCompletionRate || 0}%`, `${funnel.abandonedAfterStart || 0} unfinished`)}
        ${metric('View to complete', `${funnel.viewToCompletionRate || 0}%`, 'overall')}
      </div>
    </div>
    <div class="card">
      <h3>Channel conversion</h3>
      ${renderChannelConversion(analytics.channelConversion || [])}
    </div>
  </div>`;
}

function renderChannelConversion(rows) {
  if (!rows.length) return '<p class="muted">No channel data yet.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Source</th><th>Starts</th><th>Completions</th><th>Conversion</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.starts}</td><td>${row.completions}</td><td>${row.conversionRate}%</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderQuestionDropOff(rows) {
  if (!rows.length) return empty('No question path data yet.');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Question</th><th>Reached</th><th>Answered</th><th>Answer rate</th><th>Drop from previous</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td>${escapeHtml(row.title)}</td>
      <td>${row.reached}</td>
      <td>${row.answered}</td>
      <td>${row.answerRate}%</td>
      <td>${row.dropOffFromPrevious} (${row.dropOffRateFromPrevious}%)</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderAnalyticsBenchmark(benchmark) {
  if (!benchmark.benchmarks?.length) return empty('No surveys to compare yet.');
  return `
    <div class="grid three">
      ${metric('Response leader', benchmark.leaders.responseVolume?.title || 'None', `${benchmark.leaders.responseVolume?.completions || 0} completions`)}
      ${metric('Best rate', benchmark.leaders.completionRate?.title || 'None', `${benchmark.leaders.completionRate?.completionRate || 0}% completion`)}
      ${metric('Best lead score', benchmark.leaders.leadScore?.title || 'None', `${benchmark.leaders.leadScore?.leadScoreAverage || 0}/100`)}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Survey</th><th>Status</th><th>Completions</th><th>Rate</th><th>Avg lead</th><th>NPS</th><th>Negative</th></tr></thead>
      <tbody>${benchmark.benchmarks.map((row) => `<tr>
        <td>${escapeHtml(row.title)}</td>
        <td><span class="pill">${escapeHtml(row.status)}</span></td>
        <td>${row.completions}</td>
        <td>${row.completionRate}%</td>
        <td>${row.leadScoreAverage}</td>
        <td>${row.nps === null ? '-' : row.nps}</td>
        <td>${row.negativeResponses}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="grid three">
      <div class="card"><h3>Source benchmark</h3>${renderBars(benchmark.sources || [])}</div>
      <div class="card"><h3>Branch benchmark</h3>${renderBars(benchmark.branches || [])}</div>
      <div class="card"><h3>Location benchmark</h3>${renderBars(benchmark.locations || [])}</div>
    </div>
  `;
}

function renderQuestionStat(stat) {
  const body = stat.distribution ? renderBars(objectToBars(stat.distribution)) : stat.nps !== undefined ? `<p><strong>NPS ${stat.nps}</strong></p><p class="muted">${stat.promoters} promoters, ${stat.passives} passives, ${stat.detractors} detractors</p>` : stat.average !== undefined ? `<p><strong>Average ${stat.average}</strong></p><p class="muted">${stat.count} responses</p>` : `<p class="muted">${stat.count} text responses</p>${renderBars(stat.keywords || [])}`;
  return `<div class="card"><h3>${escapeHtml(stat.title)}</h3><span class="pill">${escapeHtml(stat.type)}</span>${body}</div>`;
}

function renderAi() {
  const survey = selectedSurvey();
  if (!survey) return empty('Select a survey to generate AI insights.');
  const summary = state.aiSummary;
  return `
    <div class="page-title">
      <div><h1>AI Insights</h1><p>Marked AI-generated, workspace-scoped, rate-metered summaries and recommendations.</p></div>
      <button class="btn primary" data-action="generate-ai">Generate summary</button>
    </div>
    <div class="grid two">
      <form class="card" data-form="ai-survey">
        <h3>Generate survey</h3>
        <div class="field"><label>Goal</label><input name="goal" value="Collect customer feedback" /></div>
        <div class="field"><label>Audience</label><input name="audience" value="customers" /></div>
        <div class="field"><label>Industry</label><input name="industry" value="service business" /></div>
        <div class="field"><label>Question count</label><input name="questionCount" type="number" value="5" /></div>
        <button class="btn primary" type="submit">Create AI survey</button>
      </form>
      <form class="card" data-form="ai-question">
        <h3>Improve question</h3>
        <div class="field"><label>Question</label><input name="question" value="Did you love our amazing service?" /></div>
        <div class="field"><label>Mode</label><select name="mode"><option value="clarity">Clarity</option><option value="remove_bias">Remove bias</option><option value="shorten">Shorten</option></select></div>
        <button class="btn primary" type="submit">Improve</button>
        ${state.generatedQuestion ? `<div class="field"><label>Suggestion</label><div class="code">${escapeHtml(state.generatedQuestion.improvedTitle)} · ${escapeHtml(state.generatedQuestion.suggestedType)}</div></div>` : ''}
      </form>
    </div>
    ${summary ? `<div class="grid two">
      <div class="card"><span class="pill good">AI-generated</span><h3>${escapeHtml(summary.headline)}</h3><p class="muted">${escapeHtml(summary.method)} · ${dateLabel(summary.generatedAt)}</p></div>
      <div class="card"><h3>Recommended actions</h3><ul>${summary.recommendedActions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
      <div class="card"><h3>Key themes</h3><div class="pill-row">${summary.keyThemes.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join('')}</div></div>
      <div class="card"><h3>Lead quality</h3>${renderBars(objectToBars(summary.leadQualitySummary))}</div>
      <div class="card"><h3>Intent mix</h3>${renderBars(objectToBars(summary.intentSummary || {}))}</div>
      <div class="card"><h3>Complaint clusters</h3>${renderBars(summary.complaintClusters || [])}</div>
      <div class="card"><h3>Response clusters</h3>${renderBars(summary.responseClusters || [])}</div>
      <div class="card"><h3>Negative themes</h3><ul>${summary.negativeThemes.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
      <div class="card"><h3>Urgent responses</h3>${summary.urgentResponses.length ? summary.urgentResponses.map((item) => `<p><strong>${escapeHtml(item.sentiment)}</strong> · lead ${item.leadScore}<br>${escapeHtml(item.excerpt)}</p>`).join('') : '<p class="muted">No urgent responses detected.</p>'}</div>
    </div>` : empty('Generate an AI-style summary after collecting responses.')}
  `;
}

function renderAlerts() {
  const surveyOptions = state.surveys.map((survey) => `<option value="${survey.id}">${escapeHtml(survey.title)}</option>`).join('');
  return `
    <div class="page-title"><div><h1>Alerts</h1><p>Email/in-app/webhook rule profiles for negative feedback, low NPS, high-intent leads, and complaints.</p></div></div>
    <div class="grid two">
      <form class="card" data-form="alert">
        <h3>Create alert rule</h3>
        <div class="field"><label>Name</label><input name="name" value="Negative feedback alert" /></div>
        <div class="field"><label>Survey</label><select name="surveyId"><option value="">All surveys</option>${surveyOptions}</select></div>
        <div class="field"><label>Condition</label><select name="type"><option value="negative_sentiment">Negative sentiment</option><option value="high_intent_lead">High-intent lead</option><option value="nps_below">NPS below threshold</option></select></div>
        <div class="field"><label>Threshold</label><input name="threshold" type="number" value="75" /></div>
        <button class="btn primary" type="submit">Create alert</button>
      </form>
      <section class="section">
        <h2>Configured alerts</h2>
        ${state.alerts.length ? state.alerts.map((alert) => `<div class="card compact"><strong>${escapeHtml(alert.name)}</strong><p class="muted">${escapeHtml(alert.conditionsJson.type)} · ${alert.active ? 'active' : 'paused'}</p><span class="pill">${alert.channelsJson.email ? 'email' : ''} ${alert.channelsJson.inApp ? 'in-app' : ''}</span></div>`).join('') : empty('No alert rules yet.')}
      </section>
    </div>
  `;
}

function renderIntegrations() {
  return `
    <div class="page-title"><div><h1>Integrations</h1><p>Configure webhooks and integration profiles. Secrets are encrypted at rest in the local store.</p></div></div>
    <div class="grid two">
      <form class="card" data-form="webhook">
        <h3>Webhook</h3>
        <div class="field"><label>Webhook URL</label><input name="url" placeholder="https://example.com/feedbackos" /></div>
        <button class="btn primary" type="submit">Add webhook</button>
      </form>
      <form class="card" data-form="integration">
        <h3>Integration profile</h3>
        <div class="field"><label>Type</label><select name="type">
          ${['google_sheets', 'slack', 'teams', 'whatsapp', 'crm', 'zapier', 'make'].map((type) => `<option value="${type}">${type.replaceAll('_', ' ')}</option>`).join('')}
        </select></div>
        <div class="field"><label>Name</label><input name="name" value="Operations alert channel" /></div>
        <div class="field"><label>Config JSON</label><textarea name="configJson">{"destination":"#feedback","owner":"ops"}</textarea></div>
        <button class="btn primary" type="submit">Save profile</button>
      </form>
    </div>
    <div class="grid two">
      <section class="section"><h2>Profiles</h2>${state.integrations.length ? state.integrations.map((item) => `<div class="card compact"><strong>${escapeHtml(item.name)}</strong><p class="muted">${escapeHtml(item.type)} · ${escapeHtml(item.status)}</p></div>`).join('') : empty('No integration profiles.')}</section>
      <section class="section"><h2>Webhooks</h2>${state.webhooks.length ? state.webhooks.map((item) => `<div class="card compact"><strong>${escapeHtml(item.url)}</strong><p class="muted">${item.events.join(', ')}</p></div>`).join('') : empty('No webhooks configured.')}</section>
    </div>
    <section class="section"><h2>Integration logs</h2>${state.integrationLogs.length ? state.integrationLogs.map((item) => `<div class="card compact"><strong>${escapeHtml(item.type)} ${escapeHtml(item.event)}</strong><p class="muted">${escapeHtml(item.status)} · ${escapeHtml(item.responseStatus || '')} · ${dateLabel(item.createdAt)}</p></div>`).join('') : empty('Profile deliveries will appear here after responses are completed.')}</section>
    <section class="section"><h2>Webhook logs</h2>${state.webhookLogs.length ? state.webhookLogs.map((item) => `<div class="card compact"><strong>${escapeHtml(item.event)}</strong><p class="muted">${escapeHtml(item.responseStatus)} · ${dateLabel(item.createdAt)}</p></div>`).join('') : empty('Webhook deliveries will appear here.')}</section>
  `;
}

function renderCampaigns() {
  const surveyOptions = state.surveys.map((survey) => `<option value="${survey.id}">${escapeHtml(survey.title)}</option>`).join('');
  return `
    <div class="page-title"><div><h1>Campaigns</h1><p>Email invite campaigns with scheduling, recipient lists, send counts, and survey tracking.</p></div></div>
    <div class="grid two">
      <form class="card" data-form="campaign">
        <h3>Create invite campaign</h3>
        <div class="field"><label>Name</label><input name="name" value="Customer feedback invite" /></div>
        <div class="field"><label>Survey</label><select name="surveyId">${surveyOptions}</select></div>
        <div class="field"><label>Subject</label><input name="subject" value="Can you share feedback?" /></div>
        <div class="field"><label>Message</label><textarea name="message">Please take a minute to share your feedback.</textarea></div>
        <div class="field"><label>Recipients, one email per line</label><textarea name="contacts" placeholder="customer@example.com"></textarea></div>
        <div class="field"><label>Schedule time</label><input name="scheduledAt" type="datetime-local" /></div>
        <button class="btn primary" type="submit">Create campaign</button>
      </form>
      <section class="section">
        <h2>Campaigns</h2>
        ${state.campaigns.length ? state.campaigns.map((campaign) => `<div class="card compact">
          <strong>${escapeHtml(campaign.name)}</strong>
          <p class="muted">${escapeHtml(campaign.status)} · ${campaign.sentCount}/${campaign.contacts.length} sent · ${campaign.openedCount || 0} opened · ${campaign.clickedCount || 0} clicked · ${campaign.scheduledAt ? dateLabel(campaign.scheduledAt) : 'send now'}</p>
          ${(campaign.events || []).slice(0, 3).map((event) => `<span class="pill">${escapeHtml(event.eventType)} ${dateLabel(event.createdAt)}</span>`).join('')}
          <button class="btn" data-action="send-campaign-now" data-campaign-id="${campaign.id}">Send now</button>
        </div>`).join('') : empty('No campaigns yet.')}
      </section>
    </div>
  `;
}

function renderContacts() {
  return `
    <div class="page-title"><div><h1>Contacts</h1><p>Profiles built from respondent emails, phones, lead scores, tags, owner assignment, and follow-up activity.</p></div></div>
    ${state.contacts.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Lead</th><th>Stage</th><th>Owner</th><th>Follow-up</th><th>Tags</th><th>Last response</th><th></th></tr></thead>
      <tbody>${state.contacts.map((contact) => `<tr>
        <td>${escapeHtml(contact.name || 'Unknown')}</td>
        <td>${escapeHtml(contact.email || '')}</td>
        <td>${escapeHtml(contact.phone || '')}</td>
        <td>${contact.leadScore || 0}</td>
        <td>${contactStageSelect(contact)}</td>
        <td>${contactOwnerSelect(contact)}</td>
        <td><input data-contact-id="${escapeAttr(contact.id)}" data-contact-field="nextFollowUpAt" type="datetime-local" value="${escapeAttr(dateTimeLocalValue(contact.nextFollowUpAt))}" /></td>
        <td>${(contact.tagsJson || []).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}</td>
        <td>${dateLabel(contact.lastResponseAt)}</td>
        <td><button class="btn" data-action="save-contact" data-contact-id="${escapeAttr(contact.id)}">Save</button></td>
      </tr>`).join('')}</tbody>
    </table></div>` : empty('Contacts appear after responses include name, email, or phone fields.')}
  `;
}

function contactStageSelect(contact) {
  const current = contact.stage || 'new';
  return `<select data-contact-id="${escapeAttr(contact.id)}" data-contact-field="stage">${CONTACT_STAGES.map((stage) => `<option value="${stage}" ${current === stage ? 'selected' : ''}>${escapeHtml(stage)}</option>`).join('')}</select>`;
}

function contactOwnerSelect(contact) {
  return `<select data-contact-id="${escapeAttr(contact.id)}" data-contact-field="ownerId"><option value="">Unassigned</option>${state.members.map((member) => {
    const label = member.user?.name || member.user?.email || member.userId;
    return `<option value="${escapeAttr(member.userId)}" ${contact.ownerId === member.userId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}</select>`;
}

function renderReports() {
  return `
    <div class="page-title">
      <div><h1>Reports</h1><p>AI-marked monthly summaries with trends, top issues, opportunities, quotes, and lead quality.</p></div>
      <button class="btn primary" data-action="generate-monthly-report">Generate monthly report</button>
    </div>
    <form class="card" data-form="schedule-report">
      <h3>Schedule monthly report</h3>
      <div class="grid three">
        <div class="field"><label>Month</label><input name="month" type="month" value="${new Date().toISOString().slice(0, 7)}" /></div>
        <div class="field"><label>Run at</label><input name="nextRunAt" type="datetime-local" /></div>
        <div class="field"><label>Recipients</label><input name="recipients" placeholder="owner@example.com, ops@example.com" /></div>
      </div>
      <button class="btn" type="submit">Schedule report</button>
    </form>
    ${state.monthlyReports.length ? `<div class="grid two">${state.monthlyReports.map((report) => `<div class="card">
      <span class="pill good">AI-generated</span>
      <h3>${escapeHtml(report.title)}</h3>
      <p class="muted">${escapeHtml(report.month)} · ${report.totalResponses} responses · satisfaction ${report.satisfactionScore}</p>
      ${report.pdfUrl ? `<a class="btn" href="${escapeAttr(report.pdfUrl)}" target="_blank" rel="noreferrer">Download PDF</a>` : ''}
      <h3>Recommended actions</h3>
      <ul>${(report.recommendedActions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <h3>Top issues</h3>
      <div class="pill-row">${(report.topIssues || []).map((item) => `<span class="pill">${escapeHtml(item.label)}</span>`).join('')}</div>
    </div>`).join('')}</div>` : empty('No monthly reports yet.')}
  `;
}

function renderTeam() {
  return `
    <div class="page-title"><div><h1>Team</h1><p>Invite users into this workspace with role-specific permissions.</p></div></div>
    <div class="grid two">
      <form class="card" data-form="invite">
        <h3>Invite teammate</h3>
        <div class="field"><label>Email</label><input name="email" type="email" placeholder="teammate@example.com" required /></div>
        <div class="field"><label>Role</label><select name="role">${['admin', 'editor', 'analyst', 'viewer'].map((role) => `<option value="${role}">${role}</option>`).join('')}</select></div>
        <button class="btn primary" type="submit">Create invite</button>
        ${state.revealedInviteToken ? `<div class="field"><label>Invite token</label><div class="code">${escapeHtml(state.revealedInviteToken)}</div></div>` : ''}
      </form>
      <section class="section">
        <h2>Members</h2>
        ${state.members.length ? state.members.map((member) => `<div class="card compact"><strong>${escapeHtml(member.user?.name || member.user?.email || member.userId)}</strong><p class="muted">${escapeHtml(member.user?.email || '')} · ${escapeHtml(member.role)}</p></div>`).join('') : empty('No members loaded.')}
      </section>
    </div>
    ${renderMemberManagement()}
    ${renderPermissionPolicy()}
    ${renderSsoSettings()}
    <section class="section">
      <h2>Pending invites</h2>
      ${state.invites.length ? state.invites.map((invite) => `<div class="card compact"><strong>${escapeHtml(invite.email)}</strong><p class="muted">${escapeHtml(invite.role)} · expires ${dateLabel(invite.expiresAt)} · ${escapeHtml(invite.tokenPreview || '')}</p></div>`).join('') : empty('No pending invites.')}
    </section>
  `;
}

function renderMemberManagement() {
  const manageableMembers = state.members.filter((member) => member.role !== 'owner');
  return `
    <section class="section">
      <h2>Member management</h2>
      ${manageableMembers.length ? manageableMembers.map(renderMemberManagementRow).join('') : empty('Only the workspace owner is loaded.')}
    </section>
  `;
}

function renderMemberManagementRow(member) {
  const label = member.user?.name || member.user?.email || member.userId;
  return `<div class="card compact">
    <strong>${escapeHtml(label)}</strong>
    <p class="muted">${escapeHtml(member.user?.email || '')} - joined ${dateLabel(member.joinedAt)}</p>
    <div class="button-row">
      <select data-member-role="${escapeAttr(member.id)}">${['admin', 'editor', 'analyst', 'viewer'].map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${role}</option>`).join('')}</select>
      <button class="btn" data-action="save-member-role" data-member-id="${escapeAttr(member.id)}">Save role</button>
      <button class="btn danger" data-action="remove-member" data-member-id="${escapeAttr(member.id)}">Remove</button>
    </div>
  </div>`;
}

function renderPermissionPolicy() {
  const policy = currentWorkspace().permissionPolicy || {};
  const actions = [
    ['responseExport', 'Response exports', 'analyst'],
    ['workspaceExport', 'Workspace export', 'admin'],
    ['privacyOperations', 'Privacy operations', 'admin'],
    ['retentionOperations', 'Retention operations', 'admin'],
    ['auditLogs', 'Audit logs', 'admin'],
    ['integrationManagement', 'Integration management', 'admin'],
    ['billingManagement', 'Billing management', 'owner'],
    ['aiReports', 'AI reports', 'analyst']
  ];
  return `
    <form class="card" data-form="permission-policy">
      <h3>Permission policy</h3>
      <div class="grid two">
        ${actions.map(([key, label, fallback]) => `
          <div class="field">
            <label>${escapeHtml(label)}</label>
            <select name="${escapeAttr(key)}">${['owner', 'admin', 'editor', 'analyst', 'viewer'].map((role) => `<option value="${role}" ${(policy[key] || fallback) === role ? 'selected' : ''}>${role}</option>`).join('')}</select>
          </div>
        `).join('')}
      </div>
      <button class="btn primary" type="submit">Save permission policy</button>
    </form>
  `;
}

function renderSsoSettings() {
  const sso = state.ssoConfig || {};
  return `
    <form class="card" data-form="sso">
      <h3>Single sign-on</h3>
      <div class="grid two">
        <div class="field"><label>Provider name</label><input name="providerName" value="${escapeAttr(sso.providerName || 'Workspace SSO')}" /></div>
        <div class="field"><label>Allowed email domains</label><input name="allowedDomains" value="${escapeAttr((sso.allowedDomains || []).join(', '))}" placeholder="company.com, client.com" /></div>
        <div class="field"><label>IdP entity ID</label><input name="entityId" value="${escapeAttr(sso.entityId || '')}" /></div>
        <div class="field"><label>IdP SSO URL</label><input name="ssoUrl" value="${escapeAttr(sso.ssoUrl || '')}" placeholder="https://idp.example.com/sso" /></div>
        <div class="field"><label>Default JIT role</label><select name="defaultRole">${['viewer', 'analyst', 'editor'].map((role) => `<option value="${role}" ${sso.defaultRole === role ? 'selected' : ''}>${role}</option>`).join('')}</select></div>
        <div class="field"><label>SP metadata URL</label><div class="code">${escapeHtml(state.ssoMetadataUrl || 'Save SSO settings to create metadata.')}</div></div>
      </div>
      <div class="grid four">
        <label class="choice"><input name="enabled" type="checkbox" ${sso.enabled ? 'checked' : ''}/> Enabled</label>
        <label class="choice"><input name="enforce" type="checkbox" ${sso.enforce ? 'checked' : ''}/> Require SSO</label>
        <label class="choice"><input name="jitProvisioning" type="checkbox" ${sso.jitProvisioning !== false ? 'checked' : ''}/> JIT users</label>
        <label class="choice"><input name="devMode" type="checkbox" ${sso.devMode ? 'checked' : ''}/> Local dev login</label>
      </div>
      <div class="field"><label>IdP X.509 certificate</label><textarea name="x509Certificate" placeholder="-----BEGIN CERTIFICATE-----">${escapeHtml(sso.x509Certificate || '')}</textarea></div>
      <button class="btn primary" type="submit">Save SSO</button>
    </form>
  `;
}

function renderApiKeys() {
  return `
    <div class="page-title"><div><h1>API</h1><p>Workspace-scoped API keys for surveys, responses, analytics, contacts, and webhook logs.</p></div></div>
    <div class="grid two">
      <form class="card" data-form="api-key">
        <h3>Create API key</h3>
        <div class="field"><label>Name</label><input name="name" value="Production API key" /></div>
        <div class="field"><label>Scopes</label><input name="scopes" value="surveys:read,surveys:write,responses:read,responses:write,analytics:read,contacts:read,contacts:write,webhooks:read,webhooks:write" /></div>
        <div class="field"><label>Rate limit per minute</label><input name="rateLimitPerMinute" type="number" value="120" /></div>
        <button class="btn primary" type="submit">Create key</button>
        ${state.revealedApiToken ? `<div class="field"><label>New token</label><div class="code">${escapeHtml(state.revealedApiToken)}</div></div>` : ''}
      </form>
      <section class="section">
        <h2>Active keys</h2>
        ${state.apiKeys.length ? state.apiKeys.map((key) => `<div class="card compact">
          <strong>${escapeHtml(key.name)}</strong>
          <p class="muted">${escapeHtml(key.tokenPreview)} · ${key.scopes.map(escapeHtml).join(', ')} · last used ${dateLabel(key.lastUsedAt)}</p>
          <button class="btn" data-action="rotate-api-key" data-key-id="${key.id}">Rotate</button>
          <button class="btn danger" data-action="revoke-api-key" data-key-id="${key.id}">Revoke</button>
        </div>`).join('') : empty('No API keys yet.')}
      </section>
    </div>
    <section class="section">
      <h2>Quick examples</h2>
      <div class="code">GET ${location.origin}/api/v1/surveys<br>Authorization: Bearer YOUR_TOKEN</div>
      <div class="code">POST ${location.origin}/api/v1/surveys/SURVEY_ID/responses</div>
    </section>
  `;
}

function renderBranding() {
  const workspace = currentWorkspace();
  return `
    <div class="page-title"><div><h1>Branding</h1><p>Logo, colors, custom domain profile, sender identity, policy links, AI privacy, and retention settings.</p></div></div>
    <form class="card" data-form="branding">
      <div class="grid two">
        <div class="field"><label>Workspace name</label><input name="name" value="${escapeAttr(workspace.name)}" /></div>
        <div class="field"><label>Logo URL</label><input name="logoUrl" value="${escapeAttr(workspace.logoUrl || '')}" /></div>
        <div class="field"><label>Brand color</label><input name="brandColor" value="${escapeAttr(workspace.brandColor || '#176B5B')}" /></div>
        <div class="field"><label>Button color</label><input name="buttonColor" value="${escapeAttr(workspace.buttonColor || '#B75D2A')}" /></div>
        <div class="field"><label>Custom domain</label><input name="customDomain" value="${escapeAttr(workspace.customDomain || '')}" /></div>
        <div class="field"><label>Default sender email</label><input name="defaultSenderEmail" value="${escapeAttr(workspace.defaultSenderEmail || '')}" /></div>
        <div class="field"><label>Privacy policy URL</label><input name="privacyPolicyUrl" value="${escapeAttr(workspace.privacyPolicyUrl || '')}" /></div>
        <div class="field"><label>Terms URL</label><input name="termsUrl" value="${escapeAttr(workspace.termsUrl || '')}" /></div>
        <div class="field"><label>Retention days</label><input name="retentionDays" type="number" value="${Number(workspace.retentionDays || 365)}" /></div>
        <div class="field"><label>Next retention run</label><input name="retentionNextRunAt" type="datetime-local" value="${escapeAttr(dateTimeLocalValue(workspace.retentionNextRunAt))}" /></div>
        <div class="field"><label>Custom footer text</label><input name="customFooterText" value="${escapeAttr(workspace.customFooterText || '')}" /></div>
      </div>
      <label class="choice"><input name="allowExternalAi" type="checkbox" ${workspace.allowExternalAi !== false ? 'checked' : ''}/> Allow configured external AI provider</label>
      <label class="choice"><input name="retentionScheduleEnabled" type="checkbox" ${workspace.retentionScheduleEnabled !== false ? 'checked' : ''}/> Run retention automatically every day</label>
      <label class="choice"><input name="requirePublishApproval" type="checkbox" ${workspace.requirePublishApproval ? 'checked' : ''}/> Require admin approval before editor or API publishing</label>
      ${workspace.customDomain ? renderCustomDomainVerification(workspace) : ''}
      <div class="field"><label>Public survey CSS</label><textarea name="customCss" placeholder=".public-form { border: 4px solid var(--brand); }">${escapeHtml(workspace.customCss || '')}</textarea></div>
      <button class="btn primary" type="submit">Save branding</button>
    </form>
    <section class="section">
      <div class="page-title"><div><h2>Privacy operations</h2><p>Workspace export, deletion request handling, and retention sweep controls.</p></div></div>
      <div class="grid two">
        <form class="card" data-form="privacy-delete">
          <h3>Data deletion request</h3>
          <div class="field"><label>Respondent email</label><input name="email" type="email" placeholder="person@example.com" /></div>
          <div class="field"><label>Mode</label><select name="mode"><option value="anonymize">Anonymize responses</option><option value="delete">Mark responses deleted</option></select></div>
          <button class="btn danger" type="submit">Process request</button>
        </form>
        <div class="card">
          <h3>Export and retention</h3>
          <p class="muted">Download a redacted workspace export or run the configured retention sweep now.</p>
          <p class="muted">Last run ${dateLabel(workspace.retentionLastRunAt)}. Next run ${workspace.retentionScheduleEnabled === false ? 'disabled' : dateLabel(workspace.retentionNextRunAt)}.</p>
          <div class="button-row">
            <a class="btn" href="/api/workspaces/${workspace.id}/export.json">Export workspace JSON</a>
            <a class="btn" href="/api/workspaces/${workspace.id}/audit-logs/export.json">Export audit logs</a>
            <button class="btn" data-action="run-retention">Run retention sweep</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCustomDomainVerification(workspace) {
  const expectedTxt = `feedbackos-site-verification=${workspace.customDomainVerificationToken || ''}`;
  return `
    <div class="field">
      <label>Custom domain verification</label>
      <div class="code">${escapeHtml(expectedTxt)}</div>
      <p class="muted">Status ${escapeHtml(workspace.customDomainStatus || 'pending_dns')} | SSL ${escapeHtml(workspace.customDomainSslStatus || 'not_started')} | verified ${dateLabel(workspace.customDomainVerifiedAt)} | DNS checked ${dateLabel(workspace.customDomainDnsCheckedAt)}</p>
      ${workspace.customDomainSslProvider ? `<p class="muted">SSL provider ${escapeHtml(workspace.customDomainSslProvider)} | certificate ${escapeHtml(workspace.customDomainSslCertificateId || 'pending')} | updated ${dateLabel(workspace.customDomainSslUpdatedAt)}</p>` : ''}
      ${workspace.customDomainSslLastError ? `<p class="muted">SSL error: ${escapeHtml(workspace.customDomainSslLastError)}</p>` : ''}
      ${(workspace.customDomainObservedTxt || []).length ? `<p class="muted">Observed TXT: ${escapeHtml((workspace.customDomainObservedTxt || []).join(', '))}</p>` : ''}
    </div>
    <div class="grid two">
      <div class="field"><label>Observed TXT record</label><input id="custom-domain-proof" value="${escapeAttr(expectedTxt)}" /></div>
      <div class="button-row">
        <button class="btn" data-action="verify-custom-domain" type="button">Verify pasted TXT</button>
        <button class="btn" data-action="verify-custom-domain-dns" type="button">Check live DNS</button>
        <button class="btn" data-action="provision-custom-domain-ssl" type="button">Provision SSL</button>
      </div>
    </div>
  `;
}

function renderBilling() {
  const workspace = currentWorkspace();
  const billing = state.billingOverview || { invoices: [], usage: [] };
  return `
    <div class="page-title"><div><h1>Billing</h1><p>Plan limits, subscription state, usage meters, and paid feature gates.</p></div></div>
    <div class="grid metrics">
      ${metric('Responses this month', workspace.usage?.responsesCount || 0, 'metered')}
      ${metric('AI credits used', workspace.usage?.aiCreditsUsed || 0, 'metered')}
      ${metric('Team members', workspace.usage?.teamMembersCount || 1, 'metered')}
      ${metric('Current plan', workspace.subscription?.planId || 'starter', workspace.subscription?.status || 'active')}
    </div>
    <div class="grid four">
      ${state.plans.map((plan) => `<div class="card">
        <span class="pill ${workspace.subscription?.planId === plan.id ? 'good' : ''}">${workspace.subscription?.planId === plan.id ? 'current' : 'available'}</span>
        <h3>${escapeHtml(plan.name)}</h3>
        <p><strong>INR ${formatNumber(plan.priceMonthlyInr)}/mo</strong></p>
        <p class="muted">Setup: ${escapeHtml(plan.setupFeeRange)}</p>
        <ul>${plan.features.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <button class="btn primary" data-action="change-plan" data-plan-id="${plan.id}">Use ${escapeHtml(plan.name)}</button>
      </div>`).join('')}
    </div>
    <div class="grid two">
      <form class="card" data-form="invoice">
        <h3>Create manual invoice</h3>
        <div class="field"><label>Description</label><input name="description" value="Monthly subscription" /></div>
        <div class="field"><label>Amount INR</label><input name="amountDueInr" type="number" value="${state.plans.find((plan) => plan.id === workspace.subscription?.planId)?.priceMonthlyInr || 2999}" /></div>
        <button class="btn primary" type="submit">Create invoice</button>
        <button class="btn danger" type="button" data-action="mark-payment-failed">Mark payment failed</button>
      </form>
      <section class="section">
        <h2>Invoices</h2>
        ${billing.invoices?.length ? billing.invoices.map((invoice) => `<div class="card compact"><strong>${escapeHtml(invoice.status)}</strong><p class="muted">INR ${formatNumber(invoice.amountDueInr)} · due ${dateLabel(invoice.dueAt)}</p></div>`).join('') : empty('No invoices yet.')}
      </section>
    </div>
  `;
}

function renderAdmin() {
  queueLoadAdmin();
  const overview = state.adminOverview;
  const adminTemplates = state.adminTemplates || [];
  const adminSettings = state.adminSettings || {};
  return `
    <div class="page-title"><div><h1>Admin</h1><p>Platform metrics, plan distribution, usage, error logs, and audit trail.</p></div></div>
    ${overview ? `
      <div class="grid metrics">
        ${metric('Users', overview.totals.users, 'platform')}
        ${metric('Workspaces', overview.totals.workspaces, 'tenants')}
        ${metric('MRR', `INR ${formatNumber(overview.totals.mrr)}`, 'manual subscription records')}
        ${metric('Responses', overview.totals.responseVolume, 'all workspaces')}
        ${metric('Errors', overview.totals.errorLogs, 'server and job logs')}
      </div>
      <div class="grid two">
        <div class="card"><h3>Plan distribution</h3>${renderBars(objectToBars(overview.planDistribution))}</div>
        <div class="card"><h3>Top workspaces</h3>${overview.topWorkspaces.map((item) => `<p><strong>${escapeHtml(item.name)}</strong> · ${item.responses} responses · ${escapeHtml(item.planId)}</p>`).join('')}</div>
      </div>
      <section class="section"><h2>Error logs</h2>${(overview.recentErrorLogs || []).length ? overview.recentErrorLogs.map((item) => `<div class="card compact"><strong>${escapeHtml(item.name)} on ${escapeHtml(item.method)} ${escapeHtml(item.path)}</strong><p class="muted">${escapeHtml(item.message)} · ${dateLabel(item.createdAt)}</p></div>`).join('') : empty('No server errors recorded.')}</section>
      <section class="section"><div class="page-title"><div><h2>Audit logs</h2><p>Recent platform events with exportable compliance history.</p></div><div class="button-row"><a class="btn" href="/api/admin/audit-logs?limit=100">Open logs</a><a class="btn" href="/api/admin/audit-logs/export.json">Export JSON</a></div></div>${overview.recentAuditLogs.map((item) => `<div class="card compact"><strong>${escapeHtml(item.action)}</strong><p class="muted">${escapeHtml(item.entityType)} · ${escapeHtml(item.entityId || '')} · ${dateLabel(item.createdAt)}</p></div>`).join('')}</section>
      ${renderReadiness(state.adminReadiness)}
      ${renderAdminSettings(adminSettings, state.adminWorkspaces || [])}
      ${renderAdminTemplateManagement(adminTemplates)}
    ` : empty('Loading admin overview...')}
  `;
}

function renderReadiness(readiness) {
  if (!readiness) return '';
  const visibleChecks = (readiness.checks || []).filter((check) => check.status !== 'pass').slice(0, 8);
  return `<section class="section">
    <div class="page-title"><div><h2>Operations readiness</h2><p>${readiness.productionReady ? 'Production checks are passing.' : 'Production cutover blockers are visible below.'}</p></div><a class="btn" href="/api/admin/readiness" target="_blank" rel="noreferrer">Open JSON</a></div>
    <div class="grid metrics">
      ${metric('Ready', readiness.productionReady ? 'Yes' : 'No', readiness.mode || 'local')}
      ${metric('Passing', readiness.summary?.pass || 0, 'checks')}
      ${metric('Warnings', readiness.summary?.warn || 0, 'checks')}
      ${metric('Blocked', readiness.summary?.fail || 0, 'checks')}
    </div>
    ${visibleChecks.length ? `<div class="grid two">${visibleChecks.map((check) => `<div class="card compact"><span class="pill ${check.status === 'fail' ? 'danger' : 'warn'}">${escapeHtml(check.status)}</span><strong>${escapeHtml(check.label)}</strong><p class="muted">${escapeHtml(check.detail)}</p></div>`).join('')}</div>` : '<p class="muted">No open readiness issues.</p>'}
  </section>`;
}

function renderAdminSettings(settings, workspaces = []) {
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === state.workspaceId) || workspaces[0] || null;
  const selectedId = selectedWorkspace?.id || '';
  return `<form class="card" data-form="admin-settings">
    <h3>Platform settings</h3>
    <label class="choice"><input name="requireEmailVerification" type="checkbox" ${settings.requireEmailVerification ? 'checked' : ''}/> Require email verification before password sign-in</label>
    <div class="grid two">
      <div class="field"><label>AI limit workspace</label><select name="aiWorkspaceId">${workspaces.map((workspace) => `<option value="${escapeAttr(workspace.id)}" ${workspace.id === selectedId ? 'selected' : ''}>${escapeHtml(workspace.name)} (${escapeHtml(workspace.planId || 'starter')})</option>`).join('')}</select></div>
      <div class="field"><label>AI credit override</label><input name="aiCreditLimitOverride" type="number" min="0" value="${selectedWorkspace?.aiCreditLimitOverride ?? ''}" placeholder="Blank uses plan limit" /></div>
    </div>
    <p class="muted">${selectedWorkspace ? `Used ${selectedWorkspace.usage?.aiCreditsUsed || 0} of ${selectedWorkspace.aiCreditLimit === -1 ? 'unlimited' : selectedWorkspace.aiCreditLimit} AI credits this month.` : 'No workspaces yet.'}</p>
    <p class="muted">Updated ${dateLabel(settings.updatedAt)}.</p>
    <button class="btn primary" type="submit">Save settings</button>
  </form>`;
}

function renderAdminTemplateManagement(adminTemplates) {
  return `<section class="section">
    <h2>Template management</h2>
    <div class="grid two">
      <form class="card" data-form="admin-template">
        <h3>Create global template</h3>
        <div class="field"><label>Name</label><input name="name" value="Clinic complaint follow-up" /></div>
        <div class="field"><label>Description</label><input name="description" value="Capture complaints, satisfaction, and follow-up permission." /></div>
        <div class="grid two">
          <div class="field"><label>Type</label><input name="type" value="feedback_form" /></div>
          <div class="field"><label>Category</label><input name="category" value="clinic" /></div>
          <div class="field"><label>Industry</label><input name="industry" value="Healthcare" /></div>
          <div class="field"><label>Status</label><select name="status"><option value="published">published</option><option value="draft">draft</option></select></div>
        </div>
        <div class="field"><label>Use case</label><input name="useCase" value="Complaint alert system" /></div>
        <div class="field"><label>Tags</label><input name="tags" value="clinic, complaint, csat" /></div>
        <button class="btn primary" type="submit">Create template</button>
      </form>
      <section class="section">
        <h2>Custom templates</h2>
        ${adminTemplates.length ? adminTemplates.map(renderAdminTemplateRow).join('') : empty('No custom templates yet.')}
      </section>
    </div>
  </section>`;
}

function renderAdminTemplateRow(template) {
  return `<div class="card compact">
    <div class="pill-row">
      <span class="pill">${escapeHtml(template.status || 'draft')}</span>
      <span class="pill">${template.workspaceId ? 'workspace' : 'global'}</span>
      <span class="pill">${formatNumber(template.usageCount || 0)} uses</span>
    </div>
    <div class="grid two">
      <div class="field"><label>Name</label><input data-admin-template-id="${escapeAttr(template.id)}" data-admin-template-field="name" value="${escapeAttr(template.name)}" /></div>
      <div class="field"><label>Category</label><input data-admin-template-id="${escapeAttr(template.id)}" data-admin-template-field="category" value="${escapeAttr(template.category || '')}" /></div>
      <div class="field"><label>Industry</label><input data-admin-template-id="${escapeAttr(template.id)}" data-admin-template-field="industry" value="${escapeAttr(template.industry || '')}" /></div>
      <div class="field"><label>Tags</label><input data-admin-template-id="${escapeAttr(template.id)}" data-admin-template-field="tags" value="${escapeAttr((template.tags || []).join(', '))}" /></div>
    </div>
    <div class="field"><label>Description</label><input data-admin-template-id="${escapeAttr(template.id)}" data-admin-template-field="description" value="${escapeAttr(template.description || '')}" /></div>
    <div class="button-row">
      <button class="btn" data-action="save-admin-template" data-template-id="${escapeAttr(template.id)}">Save</button>
      ${template.status === 'published'
        ? `<button class="btn" data-action="set-admin-template-status" data-template-id="${escapeAttr(template.id)}" data-status="draft">Unpublish</button>`
        : `<button class="btn primary" data-action="set-admin-template-status" data-template-id="${escapeAttr(template.id)}" data-status="published">Publish</button>`}
      <button class="btn danger" data-action="set-admin-template-status" data-template-id="${escapeAttr(template.id)}" data-status="archived">Archive</button>
    </div>
  </div>`;
}

function renderTwoFactorSettings(user) {
  const setup = state.twoFactorSetup;
  return `<section class="section">
    <h2>Two-factor authentication</h2>
    <div class="grid two">
      <div class="card">
        <h3>Status</h3>
        <p class="muted">${user.twoFactorEnabled ? 'Enabled for password sign-in.' : 'Not enabled.'}</p>
        <div class="button-row">
          <button class="btn" data-action="start-two-factor-setup">Create setup secret</button>
          ${user.twoFactorEnabled ? '<button class="btn danger" data-action="disable-two-factor">Disable 2FA</button>' : ''}
        </div>
      </div>
      <form class="card" data-form="two-factor-enable">
        <h3>Enable 2FA</h3>
        ${setup ? `<div class="field"><label>Secret</label><div class="code">${escapeHtml(setup.secret)}</div></div>
          <div class="field"><label>Current local code</label><div class="code">${escapeHtml(setup.currentCode)}</div></div>
          <div class="field"><label>Authenticator URL</label><div class="code">${escapeHtml(setup.otpauthUrl)}</div></div>` : '<p class="muted">Create a setup secret first.</p>'}
        <div class="field"><label>Verification code</label><input name="code" /></div>
        <button class="btn primary" type="submit">Enable 2FA</button>
        ${state.twoFactorRecoveryCodes?.length ? `<div class="field"><label>Recovery codes</label><div class="code">${state.twoFactorRecoveryCodes.map(escapeHtml).join('<br>')}</div></div>` : ''}
      </form>
    </div>
  </section>`;
}

function renderProfile() {
  const user = state.session.user;
  return `
    <div class="page-title"><div><h1>Profile</h1><p>Account settings, password change, notification preferences, and active sessions.</p></div></div>
    <div class="grid two">
      <form class="card" data-form="profile">
        <h3>Profile</h3>
        <div class="field"><label>Name</label><input name="name" value="${escapeAttr(user.name)}" /></div>
        <div class="field"><label>Avatar URL</label><input name="avatarUrl" value="${escapeAttr(user.avatarUrl || '')}" /></div>
        <div class="field"><label>Timezone</label><input name="timezone" value="${escapeAttr(user.timezone || 'Asia/Kolkata')}" /></div>
        <label class="choice"><input name="emailAlerts" type="checkbox" checked /> Email alerts</label>
        <button class="btn primary" type="submit">Save profile</button>
      </form>
      <form class="card" data-form="password">
        <h3>Password</h3>
        <div class="field"><label>Current password</label><input name="currentPassword" type="password" /></div>
        <div class="field"><label>New password</label><input name="newPassword" type="password" /></div>
        <button class="btn primary" type="submit">Change password</button>
      </form>
    </div>
    ${renderTwoFactorSettings(user)}
    <section class="section">
      <h2>Password reset</h2>
      <form class="card" data-form="password-reset">
        <div class="field"><label>Email</label><input name="email" type="email" value="${escapeAttr(user.email)}" /></div>
        <button class="btn" type="submit">Create reset token</button>
        ${state.resetToken ? `<div class="field"><label>Reset token</label><div class="code">${escapeHtml(state.resetToken)}</div></div>` : ''}
      </form>
    </section>
  `;
}

function renderPublicPassword(slug) {
  app.innerHTML = `
    <div class="public-shell">
      <form class="public-form" data-form="public-password" data-slug="${escapeAttr(slug)}">
        <span class="mark">F</span>
        <h1>Password required</h1>
        <p class="muted">Enter the survey password to continue.</p>
        <div class="field"><label>Survey password</label><input name="password" type="password" required autofocus /></div>
        <button class="btn primary" type="submit">Open survey</button>
      </form>
    </div>
  `;
}

function renderPublicSurvey() {
  const survey = state.publicSurvey;
  const brand = survey.branding || {};
  const pages = publicSurveyPages(survey);
  state.publicPage = Math.max(0, Math.min(state.publicPage || 0, pages.length - 1));
  const currentPage = pages[state.publicPage] || { number: 1, questions: survey.schema.questions };
  const isLastPage = state.publicPage === pages.length - 1;
  document.documentElement.style.setProperty('--brand', brand.brandColor || '#176B5B');
  document.documentElement.style.setProperty('--brand-2', brand.buttonColor || '#B75D2A');
  app.innerHTML = `
    ${publicBrandStyle(brand)}
    <div class="public-shell" style="background:${escapeAttr(brand.background || '#F7F3EA')}">
      <form class="public-form" data-form="public-response">
        ${brand.logoUrl ? `<img src="${escapeAttr(brand.logoUrl)}" alt="" style="max-height:54px;max-width:180px">` : '<span class="mark">F</span>'}
        <h1>${escapeHtml(survey.schema.title)}</h1>
        <p class="muted">${escapeHtml(survey.schema.description)}</p>
        ${pages.length > 1 ? `<div class="public-progress"><span>Page ${state.publicPage + 1} of ${pages.length}</span><progress value="${state.publicPage + 1}" max="${pages.length}"></progress></div>` : ''}
        ${currentPage.questions.map(renderPublicQuestion).join('')}
        <div class="public-actions">
          ${state.publicPage > 0 ? '<button class="btn" type="button" data-action="public-prev-page">Back</button>' : ''}
          ${isLastPage ? '<button class="btn primary" type="submit">Submit response</button>' : '<button class="btn primary" type="button" data-action="public-next-page">Next</button>'}
          <span class="muted" data-public-autosave-status>${publicAutosaveLabel()}</span>
          ${brand.platformBrandingHidden ? '' : '<span class="muted">Powered by FeedbackOS</span>'}
        </div>
        ${renderPublicResumeEmailControl()}
        ${publicBrandFooter(brand)}
      </form>
    </div>
  `;
}

function renderPublicResumeEmailControl() {
  return `<div class="card compact public-resume-email">
    <div class="field">
      <label>Resume on another device</label>
      <div class="inline-row">
        <input data-public-resume-email type="email" placeholder="you@example.com" />
        <button class="btn" type="button" data-action="send-public-resume">Email link</button>
      </div>
    </div>
    <p class="muted" data-public-resume-email-status>${escapeHtml(state.publicResumeEmailStatus || 'Draft links expire after 14 days.')}</p>
  </div>`;
}

function publicSurveyPages(survey) {
  const groups = new Map();
  for (const question of publicVisibleQuestions(survey.schema, state.publicAnswers)) {
    const page = Math.max(1, Number(question.settings?.page || 1));
    if (!groups.has(page)) groups.set(page, []);
    groups.get(page).push(question);
  }
  const pages = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, questions]) => ({ number, questions }));
  return pages.length ? pages : [{ number: 1, questions: [] }];
}

function publicVisibleQuestions(schema, answers) {
  const questions = schema.questions || [];
  const visibleByShow = new Set();
  for (const question of questions) {
    if (question.type === 'hidden') continue;
    if (publicQuestionVisible(schema, question, answers)) visibleByShow.add(question.id);
  }
  const output = [];
  let index = 0;
  let guard = 0;
  while (index < questions.length && guard < questions.length * 2) {
    guard += 1;
    const question = questions[index];
    if (!question || !visibleByShow.has(question.id)) {
      index += 1;
      continue;
    }
    output.push(question);
    const skipRule = (schema.logic || []).find((rule) => (
      rule.action === 'skip_to_question'
      && rule.questionId === question.id
      && evaluatePublicCondition(answers[rule.questionId], rule.operator, rule.value)
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

function publicQuestionVisible(schema, question, answers) {
  if (question.type === 'hidden') return false;
  const showRules = (schema.logic || []).filter((rule) => rule.action === 'show_question' && rule.targetQuestionId === question.id);
  if (!showRules.length) return true;
  return showRules.some((rule) => evaluatePublicCondition(answers[rule.questionId], rule.operator, rule.value));
}

function evaluatePublicCondition(actual, operator, expected) {
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
      return expectedString.split(',').map((item) => item.trim()).includes(actualString);
    case 'is_not_one_of':
      return !expectedString.split(',').map((item) => item.trim()).includes(actualString);
    default:
      return false;
  }
}

function publicBrandStyle(brand) {
  const css = escapeStyleText(brand?.customCss || '');
  return css ? `<style data-public-custom-css>${css}</style>` : '';
}

function publicBrandFooter(brand) {
  return brand?.footerText ? `<p class="public-footer">${escapeHtml(brand.footerText)}</p>` : '';
}

function renderPublicQuestion(question) {
  return `
    <section class="public-question" data-public-question="${question.id}">
      <label><strong>${escapeHtml(question.title)} ${question.required ? '<span class="pill danger">Required</span>' : ''}</strong></label>
      ${question.description ? `<p class="muted">${escapeHtml(question.description)}</p>` : ''}
      ${renderPublicInput(question)}
    </section>
  `;
}

function renderPublicInput(question) {
  const name = `answer-${question.id}`;
  const answer = state.publicAnswers[question.id];
  if (question.type === 'long_text') return `<textarea data-public-answer="${question.id}" placeholder="${escapeAttr(question.settings.placeholder || '')}">${escapeHtml(answer || '')}</textarea>`;
  if (['short_text', 'email', 'phone', 'url', 'number', 'date', 'time'].includes(question.type)) {
    const type = question.type === 'short_text' ? 'text' : question.type === 'phone' ? 'tel' : question.type;
    return `<input type="${type}" data-public-answer="${question.id}" placeholder="${escapeAttr(question.settings.placeholder || '')}" value="${escapeAttr(answer || '')}" />`;
  }
  if (['single_choice', 'dropdown', 'yes_no'].includes(question.type)) {
    if (question.type === 'dropdown') return `<select data-public-answer="${question.id}"><option value="">Select one</option>${(question.settings.options || []).map((option) => `<option ${answer === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`;
    return `<div class="choice-list">${(question.settings.options || []).map((option) => `<label class="choice"><input type="radio" name="${name}" data-public-answer="${question.id}" value="${escapeAttr(option)}" ${answer === option ? 'checked' : ''}/> ${escapeHtml(option)}</label>`).join('')}</div>`;
  }
  if (question.type === 'multiple_choice') return `<div class="choice-list">${(question.settings.options || []).map((option) => `<label class="choice"><input type="checkbox" data-public-answer="${question.id}" value="${escapeAttr(option)}" ${Array.isArray(answer) && answer.includes(option) ? 'checked' : ''}/> ${escapeHtml(option)}</label>`).join('')}</div>`;
  if (scaleQuestion(question)) {
    const scale = Number(question.settings.scale || (question.type === 'nps' ? 10 : 5));
    return `<div class="scale">${Array.from({ length: scale }, (_, index) => `<span><input id="${question.id}-${index}" type="radio" name="${name}" data-public-answer="${question.id}" value="${index + 1}" ${String(answer || '') === String(index + 1) ? 'checked' : ''}/><label for="${question.id}-${index}">${index + 1}</label></span>`).join('')}</div>`;
  }
  if (question.type === 'file_upload') {
    const allowed = (question.settings.allowedFileTypes || []).map((item) => `.${String(item).replace(/^\./, '')}`).join(',');
    return `<input type="file" data-public-answer="${question.id}" accept="${escapeAttr(allowed)}" />`;
  }
  if (question.type === 'consent') return `<label class="choice"><input type="checkbox" data-public-answer="${question.id}" ${answer === true ? 'checked' : ''}/> ${escapeHtml(question.settings.consentText || 'I agree.')}</label>`;
  if (question.type === 'statement' || question.type === 'section') return '<p class="muted">Please continue.</p>';
  return `<input data-public-answer="${question.id}" />`;
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  try {
    if (action === 'auth-mode') {
      state.authMode = target.dataset.mode;
      state.twoFactorChallenge = null;
      state.emailVerification = null;
      renderAuth();
    }
    if (action === 'cancel-email-verification') {
      state.emailVerification = null;
      renderAuth();
    }
    if (action === 'resend-email-verification') await resendEmailVerification();
    if (action === 'oauth-google') await startGoogleOAuth(target);
    if (action === 'cancel-two-factor') {
      state.twoFactorChallenge = null;
      renderAuth();
    }
    if (action === 'nav') {
      state.view = target.dataset.view;
      location.hash = state.view;
      await maybeLoadForView();
      render();
    }
    if (action === 'logout') {
      await api('/api/auth/logout', { method: 'POST', body: {} });
      state.session = null;
      renderAuth();
    }
    if (action === 'quick-create') await createSurvey();
    if (action === 'create-template') await createSurvey(target.dataset.templateId);
    if (action === 'save-as-template') await saveSurveyAsTemplate(target.dataset.surveyId);
    if (action === 'select-survey') {
      state.selectedSurveyId = target.dataset.surveyId;
      state.editingSurvey = null;
      state.responses = [];
      state.analytics = null;
      state.responseMeta = null;
      state.responsesLoadedFor = '';
      state.analyticsLoadedFor = '';
      render();
    }
    if (action === 'edit-survey') {
      state.selectedSurveyId = target.dataset.surveyId;
      state.view = 'builder';
      location.hash = 'builder';
      render();
    }
    if (action === 'copy-link') {
      await navigator.clipboard?.writeText(target.dataset.link);
      toast('Public link copied.');
    }
    if (action === 'publish-survey') await publishSurvey(target.dataset.surveyId || state.editingSurvey?.id);
    if (action === 'request-approval') await requestSurveyApproval(target.dataset.surveyId || state.editingSurvey?.id);
    if (action === 'approve-survey') await reviewSurveyApproval(target.dataset.surveyId || state.editingSurvey?.id, 'approve');
    if (action === 'reject-survey') await reviewSurveyApproval(target.dataset.surveyId || state.editingSurvey?.id, 'reject');
    if (action === 'save-survey') await saveSurvey();
    if (action === 'generate-translation') await generateTranslationDraft(target.dataset.surveyId || state.editingSurvey?.id);
    if (action === 'select-question') {
      state.selectedQuestionId = target.dataset.questionId;
      render();
    }
    if (action === 'add-question') {
      addQuestion(target.dataset.type);
      render();
    }
    if (action === 'delete-question') {
      deleteQuestion();
      render();
    }
    if (action === 'duplicate-question') {
      duplicateQuestion();
      render();
    }
    if (action === 'move-question') {
      moveQuestion(Number(target.dataset.direction));
      render();
    }
    if (action === 'add-logic') {
      addLogicRule();
      render();
    }
    if (action === 'delete-logic') {
      deleteLogicRule(target.dataset.logicId);
      render();
    }
    if (action === 'add-access-rule') {
      addAccessRule();
      render();
    }
    if (action === 'delete-access-rule') {
      deleteAccessRule(target.dataset.userId);
      render();
    }
    if (action === 'generate-ai') await generateAi();
    if (action === 'change-plan') await changePlan(target.dataset.planId);
    if (action === 'new-workspace') await newWorkspace();
    if (action === 'open-client-workspace') await openClientWorkspace(target.dataset.workspaceId);
    if (action === 'open-response') await openResponse(target.dataset.responseId);
    if (action === 'toggle-important') await patchResponse(target.dataset.responseId, { important: target.dataset.important === 'true' });
    if (action === 'tag-response') {
      const tag = prompt('Tag name');
      if (tag) await patchResponse(target.dataset.responseId, { addTag: tag });
    }
    if (action === 'note-response') {
      const note = prompt('Internal note');
      if (note) await patchResponse(target.dataset.responseId, { note });
    }
    if (action === 'archive-response') await patchResponse(target.dataset.responseId, { status: 'archived' });
    if (action === 'anonymize-response') await patchResponse(target.dataset.responseId, { anonymize: true });
    if (action === 'clear-response-filters') {
      state.responseFilters = {};
      state.responsesLoadedFor = '';
      await queueLoadResponses(selectedSurvey()?.id);
      render();
    }
    if (action === 'clear-analytics-filters') {
      state.analyticsFilters = {};
      state.analyticsLoadedFor = '';
      state.analyticsBenchmarkLoadedFor = '';
      await queueLoadAnalytics(selectedSurvey()?.id);
      await queueLoadAnalyticsBenchmark();
      render();
    }
    if (action === 'rotate-api-key') await rotateApiKey(target.dataset.keyId);
    if (action === 'revoke-api-key') await revokeApiKey(target.dataset.keyId);
    if (action === 'send-campaign-now') await sendCampaignNow(target.dataset.campaignId);
    if (action === 'save-contact') await saveContact(target.dataset.contactId);
    if (action === 'save-member-role') await saveMemberRole(target.dataset.memberId);
    if (action === 'remove-member') await removeMember(target.dataset.memberId);
    if (action === 'save-admin-template') await saveAdminTemplate(target.dataset.templateId);
    if (action === 'set-admin-template-status') await setAdminTemplateStatus(target.dataset.templateId, target.dataset.status);
    if (action === 'start-two-factor-setup') await startTwoFactorSetup();
    if (action === 'disable-two-factor') await disableTwoFactor();
    if (action === 'generate-monthly-report') await generateMonthlyReport();
    if (action === 'mark-payment-failed') await markPaymentFailed();
    if (action === 'run-retention') await runRetention();
    if (action === 'verify-custom-domain') await verifyCustomDomain();
    if (action === 'verify-custom-domain-dns') await verifyCustomDomain({ liveDns: true });
    if (action === 'provision-custom-domain-ssl') await provisionCustomDomainSsl();
    if (action === 'send-public-resume') await sendPublicResumeLink();
    if (action === 'public-next-page') await nextPublicPage();
    if (action === 'public-prev-page') await previousPublicPage();
  } catch (error) {
    toast(error.message || 'Action failed.');
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-action="workspace-select"]')) {
    state.workspaceId = event.target.value;
    localStorage.setItem('formspear.workspaceId', state.workspaceId);
    await loadWorkspaceData();
    render();
    return;
  }
  handleEditInput(event);
  handlePublicInput(event);
});

document.addEventListener('input', (event) => {
  handleEditInput(event);
  handlePublicInput(event);
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const type = form.dataset.form;
  try {
    if (type === 'signup') await submitSignup(form);
    if (type === 'login') await submitLogin(form);
    if (type === 'email-verification') await submitEmailVerification(form);
    if (type === 'two-factor') await submitTwoFactor(form);
    if (type === 'sso-start') await submitSsoStart(form);
    if (type === 'public-password') await submitPublicPassword(form);
    if (type === 'public-response') await submitPublicResponse(form);
    if (type === 'response-filters') await submitResponseFilters(form);
    if (type === 'analytics-filters') await submitAnalyticsFilters(form);
    if (type === 'alert') await submitAlert(form);
    if (type === 'webhook') await submitWebhook(form);
    if (type === 'integration') await submitIntegration(form);
    if (type === 'branding') await submitBranding(form);
    if (type === 'privacy-delete') await submitPrivacyDelete(form);
    if (type === 'invite') await submitInvite(form);
    if (type === 'permission-policy') await submitPermissionPolicy(form);
    if (type === 'sso') await submitSsoSettings(form);
    if (type === 'api-key') await submitApiKey(form);
    if (type === 'campaign') await submitCampaign(form);
    if (type === 'invoice') await submitInvoice(form);
    if (type === 'admin-template') await submitAdminTemplate(form);
    if (type === 'admin-settings') await submitAdminSettings(form);
    if (type === 'profile') await submitProfile(form);
    if (type === 'password') await submitPassword(form);
    if (type === 'two-factor-enable') await submitTwoFactorEnable(form);
    if (type === 'password-reset') await submitPasswordReset(form);
    if (type === 'ai-survey') await submitAiSurvey(form);
    if (type === 'ai-question') await submitAiQuestion(form);
    if (type === 'schedule-report') await scheduleMonthlyReport(form);
  } catch (error) {
    toast(error.message || 'Could not submit form.');
  }
});

async function submitSignup(form) {
  const payload = await api('/api/auth/signup', { method: 'POST', body: formValues(form) });
  if (payload.emailVerificationRequired) {
    state.authMode = 'login';
    state.emailVerification = {
      email: payload.user?.email || formValues(form).email,
      verificationToken: payload.verificationToken || ''
    };
    toast('Verify your email before signing in.');
    renderAuth();
    return;
  }
  state.session = payload;
  state.workspaces = state.session.workspaces;
  state.plans = state.session.plans;
  state.workspaceId = state.workspaces[0]?.id || '';
  await loadWorkspaceData();
  render();
}

async function startGoogleOAuth(target) {
  const form = target.closest('form');
  const values = form ? formValues(form) : {};
  values.mode = target.dataset.mode || state.authMode || 'login';
  try {
    const payload = await api('/api/auth/oauth/google/start', { method: 'POST', body: values });
    if (payload.oauth?.authorizationUrl) {
      location.href = payload.oauth.authorizationUrl;
      return;
    }
    toast('Google OAuth is not configured.');
  } catch (error) {
    toast(error.message || 'Google OAuth is not configured.');
  }
}

async function submitLogin(form) {
  let payload;
  try {
    payload = await api('/api/auth/login', { method: 'POST', body: formValues(form) });
  } catch (error) {
    if (error.code === 'email_verification_required') {
      state.emailVerification = {
        email: error.payload?.email || formValues(form).email,
        verificationToken: error.payload?.verificationToken || ''
      };
      toast('Verify your email before signing in.');
      renderAuth();
      return;
    }
    throw error;
  }
  if (payload.verificationToken) {
    state.emailVerification = {
      email: payload.email || formValues(form).email,
      verificationToken: payload.verificationToken || ''
    };
    toast('Verify your email before signing in.');
    renderAuth();
    return;
  }
  if (payload.requiresTwoFactor) {
    state.twoFactorChallenge = {
      challengeId: payload.challengeId,
      challengeToken: payload.challengeToken,
      expiresAt: payload.expiresAt,
      email: payload.user?.email || ''
    };
    toast('Enter your two-factor code.');
    renderAuth();
    return;
  }
  state.session = payload;
  state.workspaces = state.session.workspaces;
  state.plans = state.session.plans;
  state.workspaceId = state.workspaces[0]?.id || '';
  await loadWorkspaceData();
  render();
}

async function submitEmailVerification(form) {
  const values = formValues(form);
  await api('/api/auth/email-verification/confirm', { method: 'POST', body: { token: values.token } });
  const email = state.emailVerification?.email || '';
  state.emailVerification = null;
  state.authMode = 'login';
  toast(`Email verified${email ? ` for ${email}` : ''}. Sign in to continue.`);
  renderAuth();
}

async function resendEmailVerification() {
  const email = state.emailVerification?.email || '';
  if (!email) return;
  const payload = await api('/api/auth/email-verification/request', { method: 'POST', body: { email } });
  state.emailVerification.verificationToken = payload.verificationToken || state.emailVerification.verificationToken || '';
  toast('Verification token sent.');
  renderAuth();
}

async function submitTwoFactor(form) {
  const values = formValues(form);
  const challenge = state.twoFactorChallenge;
  if (!challenge) return;
  state.session = await api('/api/auth/2fa/verify', {
    method: 'POST',
    body: {
      challengeId: challenge.challengeId,
      challengeToken: challenge.challengeToken,
      code: values.code
    }
  });
  state.twoFactorChallenge = null;
  state.workspaces = state.session.workspaces;
  state.plans = state.session.plans;
  state.workspaceId = state.workspaces[0]?.id || '';
  await loadWorkspaceData();
  render();
}

async function submitSsoStart(form) {
  const values = formValues(form);
  const started = await api('/api/auth/sso/start', { method: 'POST', body: { email: values.email } });
  if (started.sso.devLoginAvailable) {
    state.session = await api('/api/auth/sso/dev-login', {
      method: 'POST',
      body: {
        requestId: started.sso.requestId,
        relayState: started.sso.relayState,
        email: values.email,
        name: values.name
      }
    });
    state.workspaces = state.session.workspaces;
    state.plans = state.session.plans;
    state.workspaceId = state.workspaces[0]?.id || '';
    await loadWorkspaceData();
    toast('Signed in with local SSO.');
    render();
    return;
  }
  if (started.sso.redirectUrl) {
    location.href = started.sso.redirectUrl;
    return;
  }
  toast(`SSO request created for ${started.sso.providerName}.`);
}

async function submitPublicPassword(form) {
  state.publicPassword = formValues(form).password || '';
  await initPublic(form.dataset.slug);
}

async function createSurvey(templateId = '') {
  const payload = await api('/api/surveys', {
    method: 'POST',
    body: {
      workspaceId: state.workspaceId,
      templateId,
      title: templateId ? undefined : 'New Feedback Survey',
      description: templateId ? undefined : 'Collect structured feedback and follow-up signals.'
    }
  });
  await loadWorkspaceData();
  state.selectedSurveyId = payload.survey.id;
  state.view = 'builder';
  location.hash = 'builder';
  toast('Survey created.');
  render();
}

async function saveSurveyAsTemplate(surveyId) {
  const survey = state.surveys.find((item) => item.id === surveyId) || selectedSurvey();
  if (!survey) return;
  const name = prompt('Template name', `${survey.title} template`);
  if (!name) return;
  const tags = prompt('Template tags', [survey.type, currentWorkspace()?.industry].filter(Boolean).join(', ')) || '';
  await api(`/api/surveys/${survey.id}/template`, {
    method: 'POST',
    body: {
      name,
      description: survey.description,
      category: survey.type,
      industry: currentWorkspace()?.industry || '',
      tags,
      status: 'draft'
    }
  });
  await loadWorkspaceData();
  toast('Template saved as workspace draft.');
  render();
}

async function publishSurvey(id) {
  await saveSurvey(false);
  const surveyId = id || state.selectedSurveyId;
  await api(`/api/surveys/${surveyId}/publish`, { method: 'POST', body: {} });
  await loadWorkspaceData();
  state.selectedSurveyId = surveyId;
  toast('Survey published.');
  render();
}

async function requestSurveyApproval(id) {
  await saveSurvey(false);
  const surveyId = id || state.selectedSurveyId;
  const note = prompt('Approval note') || '';
  const payload = await api(`/api/surveys/${surveyId}/approval/request`, { method: 'POST', body: { note } });
  state.selectedSurveyId = surveyId;
  state.editingSurvey = structuredClone(payload.survey);
  await loadWorkspaceData();
  toast('Approval requested.');
  render();
}

async function reviewSurveyApproval(id, decision) {
  await saveSurvey(false);
  const surveyId = id || state.selectedSurveyId;
  const note = prompt(decision === 'approve' ? 'Approval note' : 'Rejection note') || '';
  const payload = await api(`/api/surveys/${surveyId}/approval/${decision}`, { method: 'POST', body: { note } });
  state.selectedSurveyId = surveyId;
  state.editingSurvey = structuredClone(payload.survey);
  await loadWorkspaceData();
  toast(decision === 'approve' ? 'Survey approved.' : 'Approval rejected.');
  render();
}

async function saveSurvey(showToast = true) {
  const survey = state.editingSurvey;
  if (!survey) return;
  const payload = await api(`/api/surveys/${survey.id}`, {
    method: 'PUT',
      body: {
        title: survey.title,
        slug: survey.slug,
        description: survey.description,
        type: survey.type,
        language: survey.language,
        accessMode: survey.accessMode || 'workspace',
        accessRules: survey.accessRules || [],
        settings: survey.settings,
      branding: survey.branding,
      schema: survey.schema
    }
  });
  state.selectedSurveyId = payload.survey.id;
  await loadWorkspaceData();
  state.selectedSurveyId = payload.survey.id;
  state.editingSurvey = structuredClone(payload.survey);
  state.selectedQuestionId = state.editingSurvey.schema.questions[0]?.id || '';
  if (showToast) toast('Draft saved.');
}

async function generateTranslationDraft(surveyId) {
  if (!surveyId) return;
  const language = document.getElementById('translation-language')?.value || 'es';
  const payload = await api(`/api/surveys/${surveyId}/translations/generate`, {
    method: 'POST',
    body: { language }
  });
  state.editingSurvey = structuredClone(payload.survey);
  const index = state.surveys.findIndex((survey) => survey.id === payload.survey.id);
  if (index >= 0) state.surveys[index] = payload.survey;
  toast(`Generated ${payload.language} translation draft.`);
  render();
}

async function queueLoadResponses(surveyId) {
  if (!surveyId) return;
  const key = responseFilterKey(surveyId);
  if (state.loadingResponses === key) return;
  state.loadingResponses = key;
  const payload = await api(`/api/surveys/${surveyId}/responses${queryString(state.responseFilters)}`);
  state.responses = payload.responses;
  state.responseMeta = { total: payload.total, offset: payload.offset, limit: payload.limit };
  state.responsesLoadedFor = key;
  state.loadingResponses = '';
  if (state.view === 'responses') render();
}

async function queueLoadAnalytics(surveyId) {
  if (!surveyId) return;
  const key = analyticsFilterKey(surveyId);
  if (state.loadingAnalytics === key) return;
  state.loadingAnalytics = key;
  const payload = await api(`/api/surveys/${surveyId}/analytics${queryString(state.analyticsFilters)}`);
  state.analytics = payload.analytics;
  state.analyticsLoadedFor = key;
  state.loadingAnalytics = '';
  if (state.view === 'analytics') render();
}

async function queueLoadAnalyticsBenchmark() {
  if (!state.workspaceId) return;
  const key = analyticsBenchmarkFilterKey();
  if (state.loadingAnalyticsBenchmark === key) return;
  state.loadingAnalyticsBenchmark = key;
  const payload = await api(`/api/analytics/benchmark${queryString({ workspaceId: state.workspaceId, ...state.analyticsFilters })}`);
  state.analyticsBenchmark = payload;
  state.analyticsBenchmarkLoadedFor = key;
  state.loadingAnalyticsBenchmark = '';
  if (state.view === 'analytics') render();
}

async function queueLoadAgencyOverview() {
  const key = agencyOverviewWorkspaceId();
  if (!key) return;
  if (state.loadingAgencyOverview === key) return;
  state.loadingAgencyOverview = key;
  try {
    state.agencyOverview = await api(`/api/agency/overview?workspaceId=${encodeURIComponent(key)}`);
  } catch (error) {
    state.agencyOverview = { error: error.message || 'Agency overview is unavailable.', totals: {}, clients: [] };
  }
  state.agencyOverviewLoadedFor = key;
  state.loadingAgencyOverview = '';
  if (state.view === 'agency') render();
}

async function queueLoadAdmin() {
  if ((state.adminOverview && state.adminTemplatesLoaded) || state.loadingAdmin) return;
  state.loadingAdmin = true;
  const [overview, templates, settings, workspaces, readiness] = await Promise.all([
    api('/api/admin/overview'),
    api('/api/admin/templates').catch(() => ({ templates: [] })),
    api('/api/admin/settings').catch(() => ({ settings: {} })),
    api('/api/admin/workspaces').catch(() => ({ workspaces: [] })),
    api('/api/admin/readiness').catch(() => null)
  ]);
  state.adminOverview = overview;
  state.adminTemplates = templates.templates || [];
  state.adminSettings = settings.settings || {};
  state.adminWorkspaces = workspaces.workspaces || [];
  state.adminReadiness = readiness;
  state.adminTemplatesLoaded = true;
  state.loadingAdmin = false;
  if (state.view === 'admin') render();
}

async function reloadAdmin() {
  state.adminOverview = null;
  state.adminTemplatesLoaded = false;
  state.loadingAdmin = false;
  await queueLoadAdmin();
}

async function submitAdminTemplate(form) {
  const values = formValues(form);
  await api('/api/admin/templates', {
    method: 'POST',
    body: {
      ...values,
      tags: values.tags || ''
    }
  });
  await reloadAdmin();
  await loadWorkspaceData();
  toast('Template created.');
  render();
}

async function submitAdminSettings(form) {
  const values = formValues(form);
  await api('/api/admin/settings', {
    method: 'PUT',
    body: {
      requireEmailVerification: Boolean(form.querySelector('[name="requireEmailVerification"]')?.checked)
    }
  });
  if (values.aiWorkspaceId) {
    await api(`/api/admin/workspaces/${values.aiWorkspaceId}`, {
      method: 'PUT',
      body: {
        aiCreditLimitOverride: values.aiCreditLimitOverride === '' ? null : Number(values.aiCreditLimitOverride)
      }
    });
  }
  await reloadAdmin();
  toast('Platform settings saved.');
  render();
}

async function saveAdminTemplate(templateId) {
  const inputs = [...document.querySelectorAll('[data-admin-template-id]')]
    .filter((input) => input.dataset.adminTemplateId === templateId);
  const body = {};
  for (const input of inputs) {
    body[input.dataset.adminTemplateField] = input.value;
  }
  await api(`/api/admin/templates/${templateId}`, { method: 'PUT', body });
  await reloadAdmin();
  await loadWorkspaceData();
  toast('Template updated.');
  render();
}

async function setAdminTemplateStatus(templateId, status) {
  await api(`/api/admin/templates/${templateId}`, { method: 'PUT', body: { status } });
  await reloadAdmin();
  await loadWorkspaceData();
  toast(`Template ${status}.`);
  render();
}

async function maybeLoadForView() {
  const survey = selectedSurvey();
  if (state.view === 'responses' && survey) await queueLoadResponses(survey.id);
  if (state.view === 'analytics' && survey) {
    await queueLoadAnalytics(survey.id);
    await queueLoadAnalyticsBenchmark();
  }
  if (state.view === 'agency') await queueLoadAgencyOverview();
}

async function generateAi() {
  const survey = selectedSurvey();
  const payload = await api(`/api/surveys/${survey.id}/ai-summary`, { method: 'POST', body: {} });
  state.aiSummary = payload.summary;
  await refreshSession();
  toast('AI summary generated.');
  render();
}

async function openResponse(responseId) {
  const survey = selectedSurvey();
  const payload = await api(`/api/surveys/${survey.id}/responses/${responseId}`);
  state.selectedResponseDetail = payload.response;
  render();
}

async function patchResponse(responseId, body) {
  const survey = selectedSurvey();
  const payload = await api(`/api/surveys/${survey.id}/responses/${responseId}`, { method: 'PATCH', body });
  state.selectedResponseDetail = payload.response;
  await queueLoadResponses(survey.id);
  render();
}

async function changePlan(planId) {
  const payload = await api(`/api/billing/${state.workspaceId}/checkout`, { method: 'POST', body: { planId } });
  if (payload.checkout?.provider === 'local_manual') {
    await api(`/api/workspaces/${state.workspaceId}/subscription`, { method: 'POST', body: { planId } });
  } else if (payload.checkout?.checkoutUrl) {
    window.location.href = payload.checkout.checkoutUrl;
    return;
  }
  await refreshSession();
  await loadWorkspaceData();
  toast(payload.checkout?.provider === 'local_manual' ? 'Plan updated locally.' : 'Checkout session created.');
  render();
}

async function newWorkspace() {
  const name = prompt('Workspace name');
  if (!name) return;
  await api('/api/workspaces', { method: 'POST', body: { name, industry: 'Client workspace', companySize: '1-10' } });
  await refreshSession();
  state.workspaceId = state.workspaces.at(-1)?.id || state.workspaceId;
  await loadWorkspaceData();
  render();
}

async function openClientWorkspace(workspaceId) {
  if (!workspaceId || !state.workspaces.some((workspace) => workspace.id === workspaceId)) return;
  state.workspaceId = workspaceId;
  localStorage.setItem('formspear.workspaceId', state.workspaceId);
  state.view = 'dashboard';
  location.hash = 'dashboard';
  await loadWorkspaceData();
  render();
}

async function submitInvite(form) {
  const values = formValues(form);
  const payload = await api(`/api/workspaces/${state.workspaceId}/invites`, { method: 'POST', body: values });
  state.revealedInviteToken = payload.token;
  await loadWorkspaceData();
  state.revealedInviteToken = payload.token;
  toast('Invite token created.');
  render();
}

async function submitSsoSettings(form) {
  const values = formValues(form);
  const body = {
    providerName: values.providerName,
    allowedDomains: values.allowedDomains,
    entityId: values.entityId,
    ssoUrl: values.ssoUrl,
    x509Certificate: values.x509Certificate,
    defaultRole: values.defaultRole,
    enabled: Boolean(form.querySelector('[name="enabled"]')?.checked),
    enforce: Boolean(form.querySelector('[name="enforce"]')?.checked),
    jitProvisioning: Boolean(form.querySelector('[name="jitProvisioning"]')?.checked),
    devMode: Boolean(form.querySelector('[name="devMode"]')?.checked)
  };
  const payload = await api(`/api/workspaces/${state.workspaceId}/sso`, { method: 'PUT', body });
  state.ssoConfig = payload.sso;
  state.ssoMetadataUrl = payload.metadataUrl || '';
  await refreshSession();
  await loadWorkspaceData();
  toast('SSO settings saved.');
  render();
}

async function submitPermissionPolicy(form) {
  const permissionPolicy = formValues(form);
  await api(`/api/workspaces/${state.workspaceId}`, { method: 'PUT', body: { permissionPolicy } });
  await refreshSession();
  await loadWorkspaceData();
  toast('Permission policy saved.');
  render();
}

async function saveMemberRole(memberId) {
  const input = document.querySelector(`[data-member-role="${memberId}"]`);
  const role = input?.value || 'viewer';
  await api(`/api/workspaces/${state.workspaceId}/members/${memberId}`, { method: 'PUT', body: { role } });
  await refreshSession();
  await loadWorkspaceData();
  toast('Member role updated.');
  render();
}

async function removeMember(memberId) {
  if (!confirm('Remove this member from the workspace?')) return;
  await api(`/api/workspaces/${state.workspaceId}/members/${memberId}`, { method: 'DELETE', body: {} });
  await refreshSession();
  await loadWorkspaceData();
  toast('Member removed.');
  render();
}

async function submitApiKey(form) {
  const values = formValues(form);
  const payload = await api(`/api/workspaces/${state.workspaceId}/api-keys`, {
    method: 'POST',
    body: {
      name: values.name,
      scopes: String(values.scopes || '').split(',').map((item) => item.trim()).filter(Boolean),
      rateLimitPerMinute: Number(values.rateLimitPerMinute || 120)
    }
  });
  state.revealedApiToken = payload.token;
  await loadWorkspaceData();
  state.revealedApiToken = payload.token;
  toast('API token created. Copy it now; it will not be shown again.');
  render();
}

async function revokeApiKey(keyId) {
  await api(`/api/workspaces/${state.workspaceId}/api-keys/${keyId}`, { method: 'DELETE', body: {} });
  await loadWorkspaceData();
  toast('API key revoked.');
  render();
}

async function rotateApiKey(keyId) {
  const payload = await api(`/api/workspaces/${state.workspaceId}/api-keys/${keyId}/rotate`, { method: 'POST', body: {} });
  state.revealedApiToken = payload.token;
  await loadWorkspaceData();
  state.revealedApiToken = payload.token;
  toast('API key rotated. Copy the new token now.');
  render();
}

async function submitCampaign(form) {
  const values = formValues(form);
  const payload = await api('/api/campaigns', {
    method: 'POST',
    body: {
      workspaceId: state.workspaceId,
      surveyId: values.surveyId,
      name: values.name,
      subject: values.subject,
      message: values.message,
      contacts: values.contacts,
      scheduledAt: values.scheduledAt || ''
    }
  });
  await loadWorkspaceData();
  toast(`Campaign ${payload.campaign.status}.`);
  render();
}

async function sendCampaignNow(campaignId) {
  await api(`/api/campaigns/${campaignId}/send-now`, { method: 'POST', body: {} });
  await loadWorkspaceData();
  toast('Campaign queued.');
  render();
}

async function generateMonthlyReport() {
  const month = new Date().toISOString().slice(0, 7);
  await api('/api/ai/monthly-report', { method: 'POST', body: { workspaceId: state.workspaceId, month } });
  await loadWorkspaceData();
  toast('Monthly report generated.');
  render();
}

async function scheduleMonthlyReport(form) {
  const values = formValues(form);
  await api('/api/ai/monthly-report/schedule', {
    method: 'POST',
    body: {
      workspaceId: state.workspaceId,
      month: values.month || new Date().toISOString().slice(0, 7),
      nextRunAt: values.nextRunAt || '',
      recipients: values.recipients || ''
    }
  });
  await loadWorkspaceData();
  toast('Monthly report scheduled.');
  render();
}

async function submitInvoice(form) {
  const values = formValues(form);
  await api(`/api/billing/${state.workspaceId}/invoices`, {
    method: 'POST',
    body: {
      amountDueInr: Number(values.amountDueInr || 0),
      lineItems: [{ description: values.description, quantity: 1, unitAmountInr: Number(values.amountDueInr || 0) }]
    }
  });
  await loadWorkspaceData();
  toast('Invoice created.');
  render();
}

async function markPaymentFailed() {
  await api(`/api/billing/${state.workspaceId}/payment-failed`, { method: 'POST', body: {} });
  await refreshSession();
  await loadWorkspaceData();
  toast('Payment failure recorded and workspace limits downgraded.');
  render();
}

async function submitProfile(form) {
  const values = formValues(form);
  await api('/api/profile', {
    method: 'PUT',
    body: {
      name: values.name,
      avatarUrl: values.avatarUrl,
      timezone: values.timezone,
      notificationPreferences: { emailAlerts: Boolean(values.emailAlerts) }
    }
  });
  await refreshSession();
  toast('Profile saved.');
  render();
}

async function submitPassword(form) {
  const values = formValues(form);
  await api('/api/profile/password', {
    method: 'POST',
    body: { currentPassword: values.currentPassword, newPassword: values.newPassword }
  });
  toast('Password changed.');
  form.reset();
}

async function startTwoFactorSetup() {
  const payload = await api('/api/profile/2fa/setup', { method: 'POST', body: {} });
  state.twoFactorSetup = payload.setup;
  state.twoFactorRecoveryCodes = [];
  toast('Two-factor setup secret created.');
  render();
}

async function submitTwoFactorEnable(form) {
  const payload = await api('/api/profile/2fa/enable', { method: 'POST', body: formValues(form) });
  state.session.user = payload.user;
  state.twoFactorRecoveryCodes = payload.recoveryCodes || [];
  await refreshSession();
  toast('Two-factor authentication enabled.');
  render();
}

async function disableTwoFactor() {
  const code = prompt('Enter your password, authenticator code, or recovery code');
  if (!code) return;
  const payload = await api('/api/profile/2fa/disable', { method: 'POST', body: { password: code, code, recoveryCode: code } });
  state.session.user = payload.user;
  state.twoFactorSetup = null;
  state.twoFactorRecoveryCodes = [];
  await refreshSession();
  toast('Two-factor authentication disabled.');
  render();
}

async function submitPasswordReset(form) {
  const values = formValues(form);
  const payload = await api('/api/auth/password-reset/request', { method: 'POST', body: { email: values.email } });
  state.resetToken = payload.resetToken || '';
  toast('Password reset token created.');
  render();
}

async function submitAiSurvey(form) {
  const values = formValues(form);
  const payload = await api('/api/ai/generate-survey', {
    method: 'POST',
    body: { workspaceId: state.workspaceId, ...values, questionCount: Number(values.questionCount || 5) }
  });
  await loadWorkspaceData();
  state.selectedSurveyId = payload.survey.id;
  state.view = 'builder';
  location.hash = 'builder';
  toast('AI survey created.');
  render();
}

async function submitAiQuestion(form) {
  const values = formValues(form);
  const payload = await api('/api/ai/improve-question', {
    method: 'POST',
    body: { workspaceId: state.workspaceId, surveyId: state.selectedSurveyId, ...values }
  });
  state.generatedQuestion = payload.improved;
  toast('Question improved.');
  render();
}

async function submitAlert(form) {
  const values = formValues(form);
  await api('/api/alerts', {
    method: 'POST',
    body: {
      workspaceId: state.workspaceId,
      surveyId: values.surveyId,
      name: values.name,
      condition: { type: values.type, threshold: Number(values.threshold || 0) },
      channels: { email: true, inApp: true }
    }
  });
  await loadWorkspaceData();
  toast('Alert created.');
  render();
}

async function submitWebhook(form) {
  const values = formValues(form);
  await api('/api/integrations', { method: 'POST', body: { workspaceId: state.workspaceId, type: 'webhook', url: values.url, events: ['response.completed'] } });
  await loadWorkspaceData();
  toast('Webhook saved.');
  render();
}

async function submitIntegration(form) {
  const values = formValues(form);
  let config = {};
  try {
    config = values.configJson ? JSON.parse(values.configJson) : {};
  } catch {
    toast('Config JSON is invalid.');
    return;
  }
  await api('/api/integrations', {
    method: 'POST',
    body: { workspaceId: state.workspaceId, type: values.type, name: values.name, config, events: ['response.completed'] }
  });
  await loadWorkspaceData();
  toast('Integration profile saved.');
  render();
}

async function submitBranding(form) {
  const values = formValues(form);
  values.allowExternalAi = Boolean(form.querySelector('[name="allowExternalAi"]')?.checked);
  values.retentionScheduleEnabled = Boolean(form.querySelector('[name="retentionScheduleEnabled"]')?.checked);
  values.requirePublishApproval = Boolean(form.querySelector('[name="requirePublishApproval"]')?.checked);
  await api(`/api/workspaces/${state.workspaceId}`, { method: 'PUT', body: values });
  await refreshSession();
  await loadWorkspaceData();
  toast('Branding saved.');
  render();
}

async function submitResponseFilters(form) {
  state.responseFilters = compactValues(formValues(form));
  state.responsesLoadedFor = '';
  await queueLoadResponses(selectedSurvey()?.id);
  render();
}

async function submitAnalyticsFilters(form) {
  state.analyticsFilters = compactValues(formValues(form));
  state.analyticsLoadedFor = '';
  state.analyticsBenchmarkLoadedFor = '';
  await queueLoadAnalytics(selectedSurvey()?.id);
  await queueLoadAnalyticsBenchmark();
  render();
}

async function submitPrivacyDelete(form) {
  const values = formValues(form);
  const result = await api(`/api/workspaces/${state.workspaceId}/privacy/delete`, { method: 'POST', body: values });
  await loadWorkspaceData();
  toast(`Privacy request processed: ${result.responsesAffected} responses affected.`);
  render();
}

async function runRetention() {
  const result = await api(`/api/workspaces/${state.workspaceId}/retention/run`, { method: 'POST', body: {} });
  await loadWorkspaceData();
  toast(`Retention sweep ${result.job.status}.`);
  render();
}

async function saveContact(contactId) {
  const body = {};
  for (const field of ['stage', 'ownerId', 'nextFollowUpAt']) {
    const input = document.querySelector(`[data-contact-id="${contactId}"][data-contact-field="${field}"]`);
    if (input) body[field] = input.value;
  }
  await api(`/api/contacts/${contactId}`, { method: 'PUT', body });
  await loadWorkspaceData();
  toast('Contact pipeline updated.');
  render();
}

async function verifyCustomDomain(options = {}) {
  const txtRecord = document.getElementById('custom-domain-proof')?.value || '';
  const result = await api(`/api/workspaces/${state.workspaceId}/custom-domain/verify`, { method: 'POST', body: options.liveDns ? {} : { txtRecord } });
  await refreshSession();
  await loadWorkspaceData();
  toast(`Custom domain ${result.customDomain.status}.`);
  render();
}

async function provisionCustomDomainSsl() {
  const result = await api(`/api/workspaces/${state.workspaceId}/custom-domain/provision-ssl`, { method: 'POST', body: {} });
  await refreshSession();
  await loadWorkspaceData();
  toast(`Custom domain SSL ${result.customDomain.sslStatus}.`);
  render();
}

function publicAutosaveLabel() {
  if (state.publicAutosaveStatus === 'saving') return 'Saving draft...';
  if (state.publicAutosaveStatus === 'saved') return 'Draft saved';
  if (state.publicAutosaveStatus === 'unsaved') return 'Draft not saved';
  if (state.publicAutosaveStatus === 'completing') return 'Submitting...';
  return '';
}

function setPublicAutosaveStatus(status) {
  state.publicAutosaveStatus = status;
  const target = document.querySelector('[data-public-autosave-status]');
  if (target) target.textContent = publicAutosaveLabel();
}

function setPublicResumeEmailStatus(status) {
  state.publicResumeEmailStatus = status;
  const target = document.querySelector('[data-public-resume-email-status]');
  if (target) target.textContent = status || 'Draft links expire after 14 days.';
}

function publicResponseMetadata() {
  return {
    ...readUtm(),
    pathTaken: publicPathTaken()
  };
}

function publicPathTaken() {
  if (!state.publicSurvey) return [];
  const pages = publicSurveyPages(state.publicSurvey);
  const reachedPages = pages.slice(0, (state.publicPage || 0) + 1);
  return reachedPages.flatMap((page) => page.questions.map((question) => question.id));
}

function publicResumeKey(slug = state.publicSurvey?.slug || '') {
  return slug ? `formspear.partial.${slug}` : '';
}

function readPublicResume(slug = state.publicSurvey?.slug || '') {
  const key = publicResumeKey(slug);
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function storePublicResume(slug, responseId, resumeToken) {
  const key = publicResumeKey(slug);
  if (!key || !responseId || !resumeToken) return;
  localStorage.setItem(key, JSON.stringify({ responseId, resumeToken, savedAt: new Date().toISOString() }));
}

function clearPublicResume(slug = state.publicSurvey?.slug || '') {
  const key = publicResumeKey(slug);
  if (key) localStorage.removeItem(key);
}

async function restorePublicPartial() {
  const survey = state.publicSurvey;
  const urlResume = publicResumeFromUrl();
  const saved = urlResume || readPublicResume(survey?.slug || '');
  if (!survey || !saved?.responseId || !saved?.resumeToken) return;
  const params = new URLSearchParams({ resumeToken: saved.resumeToken });
  if (state.publicPassword) params.set('password', state.publicPassword);
  try {
    const payload = await api(`/api/public/surveys/${encodeURIComponent(survey.slug)}/responses/${encodeURIComponent(saved.responseId)}?${params.toString()}`);
    state.publicPartialResponseId = payload.responseId;
    state.publicResumeToken = saved.resumeToken;
    state.publicAnswers = payload.answers || {};
    state.publicStartedAt = payload.startedAt || state.publicStartedAt;
    state.publicAutosaveStatus = 'saved';
    storePublicResume(survey.slug, payload.responseId, saved.resumeToken);
  } catch {
    clearPublicResume(survey.slug);
  }
}

function publicResumeFromUrl() {
  const params = new URLSearchParams(location.search);
  const responseId = params.get('resumeResponseId') || '';
  const resumeToken = params.get('resumeToken') || '';
  return responseId && resumeToken ? { responseId, resumeToken } : null;
}

async function ensurePublicPartialResponse() {
  if (state.publicPartialResponseId) return state.publicPartialResponseId;
  const survey = state.publicSurvey;
  if (!survey) return '';
  const payload = await api(`/api/public/surveys/${encodeURIComponent(survey.slug)}/responses/start`, {
    method: 'POST',
    body: {
      answers: state.publicAnswers,
      startedAt: state.publicStartedAt,
      password: state.publicPassword,
      metadata: publicResponseMetadata()
    }
  });
  state.publicPartialResponseId = payload.responseId;
  state.publicResumeToken = payload.resumeToken || '';
  storePublicResume(survey.slug, state.publicPartialResponseId, state.publicResumeToken);
  return state.publicPartialResponseId;
}

async function savePublicPartial({ complete = false } = {}) {
  if (!state.publicSurvey || (state.publicSubmitted && !complete)) return null;
  if (state.publicAutosaveTimer) clearTimeout(state.publicAutosaveTimer);
  state.publicAutosaveTimer = null;
  const responseId = await ensurePublicPartialResponse();
  if (!responseId) return null;
  const payload = await api(`/api/public/surveys/${encodeURIComponent(state.publicSurvey.slug)}/responses/${encodeURIComponent(responseId)}`, {
    method: 'PATCH',
    body: {
      answers: state.publicAnswers,
      replaceAnswers: true,
      complete,
      password: state.publicPassword,
      resumeToken: state.publicResumeToken,
      metadata: publicResponseMetadata()
    }
  });
  if (!complete) setPublicAutosaveStatus('saved');
  if (complete) clearPublicResume(state.publicSurvey.slug);
  return payload;
}

function schedulePublicAutosave() {
  if (!state.publicSurvey || state.publicSubmitted) return;
  setPublicAutosaveStatus('saving');
  if (state.publicAutosaveTimer) clearTimeout(state.publicAutosaveTimer);
  state.publicAutosaveTimer = setTimeout(() => {
    state.publicAutosaveTimer = null;
    savePublicPartial().catch(() => setPublicAutosaveStatus('unsaved'));
  }, 650);
}

async function flushPublicAutosave() {
  if (!state.publicSurvey || state.publicSubmitted) return null;
  setPublicAutosaveStatus('saving');
  try {
    return await savePublicPartial();
  } catch (error) {
    setPublicAutosaveStatus('unsaved');
    throw error;
  }
}

async function sendPublicResumeLink() {
  const survey = state.publicSurvey;
  const email = document.querySelector('[data-public-resume-email]')?.value || '';
  if (!survey || state.publicSubmitted) return;
  if (!email.trim()) {
    setPublicResumeEmailStatus('Enter an email address first.');
    return;
  }
  setPublicResumeEmailStatus('Saving draft and sending link...');
  await flushPublicAutosave();
  const responseId = state.publicPartialResponseId;
  if (!responseId || !state.publicResumeToken) {
    setPublicResumeEmailStatus('Could not create a resumable draft yet.');
    return;
  }
  const payload = await api(`/api/public/surveys/${encodeURIComponent(survey.slug)}/responses/${encodeURIComponent(responseId)}/send-resume`, {
    method: 'POST',
    body: {
      email,
      resumeToken: state.publicResumeToken,
      password: state.publicPassword
    }
  });
  setPublicResumeEmailStatus(`Resume link sent. It expires ${dateLabel(payload.resumeExpiresAt)}.`);
}

async function submitPublicResponse() {
  const survey = state.publicSurvey;
  const brand = survey.branding || {};
  setPublicAutosaveStatus('completing');
  let payload;
  try {
    payload = await savePublicPartial({ complete: true });
  } catch (error) {
    setPublicAutosaveStatus('unsaved');
    throw error;
  }
  state.publicSubmitted = true;
  app.innerHTML = `${publicBrandStyle(brand)}<div class="public-shell" style="background:${escapeAttr(brand.background || '#F7F3EA')}"><div class="public-form"><h1>${escapeHtml(payload.completion?.message || 'Thank you for your response.')}</h1><p class="muted">Response ID: ${escapeHtml(payload.responseId)}</p>${publicBrandFooter(brand)}</div></div>`;
  if (payload.completion?.redirectUrl) {
    setTimeout(() => {
      location.href = payload.completion.redirectUrl;
    }, 900);
  }
}

function handleEditInput(event) {
  const field = event.target.dataset.edit;
  if (!field || !state.editingSurvey) return;
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  const survey = state.editingSurvey;
  if (field === 'survey.title') {
    survey.title = value;
    survey.schema.title = value;
  }
  if (field === 'survey.slug') survey.slug = value;
  if (field === 'survey.language') survey.language = value;
  if (field === 'survey.description') {
    survey.description = value;
    survey.schema.description = value;
  }
  if (field === 'survey.type') survey.type = value;
  if (field === 'survey.accessMode') survey.accessMode = value;
  if (field === 'completion.message') survey.schema.completion.message = value;
  if (field === 'schema.translations') {
    try {
      survey.schema.translations = value.trim() ? JSON.parse(value) : {};
    } catch {
      return;
    }
  }
  if (field.startsWith('settings.')) {
    const path = field.replace('settings.', '');
    const nextValue = ['responseLimit', 'inAppFrequencyDays'].includes(path) ? Number(value || 0) : value;
    setPath(survey.settings, path, nextValue);
    if (path === 'completionRedirectUrl') survey.schema.completion.redirectUrl = value;
  }
  if (field.startsWith('branding.')) setPath(survey.branding, field.replace('branding.', ''), value);
  if (field.startsWith('question.')) {
    const question = selectedQuestion(survey);
    if (!question) return;
    const path = field.replace('question.', '');
    if (path === 'settings.options') setPath(question, path, String(value).split('\n').map((item) => item.trim()).filter(Boolean));
    else if (path === 'settings.allowedFileTypes') setPath(question, path, String(value).split(',').map((item) => item.trim().replace(/^\./, '')).filter(Boolean));
    else if (path === 'settings.scale') setPath(question, path, Number(value));
    else if (path === 'settings.page') setPath(question, path, Math.max(1, Number(value || 1)));
    else if (path === 'settings.maxSizeMB') setPath(question, path, Number(value || 5));
    else setPath(question, path, value);
  }
}

async function handlePublicInput(event) {
  const questionId = event.target.dataset.publicAnswer;
  if (!questionId) return;
  const question = state.publicSurvey.schema.questions.find((item) => item.id === questionId);
  if (!question) return;
  const shouldRefreshVisibility = publicLogicDependsOn(questionId) && event.type === 'change';
  if (question.type === 'multiple_choice') {
    state.publicAnswers[questionId] = Array.from(document.querySelectorAll(`[data-public-answer="${questionId}"]:checked`)).map((item) => item.value);
  } else if (question.type === 'consent') {
    state.publicAnswers[questionId] = event.target.checked;
  } else if (question.type === 'file_upload') {
    const file = event.target.files?.[0];
    if (!file) {
      state.publicAnswers[questionId] = '';
      pruneHiddenPublicAnswers();
      schedulePublicAutosave();
      if (shouldRefreshVisibility) renderPublicSurvey();
      return;
    }
    const maxBytes = Number(question.settings.maxSizeMB || 5) * 1024 * 1024;
    if (file.size > maxBytes) {
      toast(`File must be ${question.settings.maxSizeMB || 5} MB or smaller.`);
      event.target.value = '';
      state.publicAnswers[questionId] = '';
      pruneHiddenPublicAnswers();
      schedulePublicAutosave();
      if (shouldRefreshVisibility) renderPublicSurvey();
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    state.publicAnswers[questionId] = {
      name: file.name,
      type: file.type,
      size: file.size,
      extension: file.name.split('.').pop() || '',
      dataUrl
    };
  } else if (event.target.type === 'radio') {
    state.publicAnswers[questionId] = event.target.value;
  } else {
    state.publicAnswers[questionId] = event.target.value;
  }
  pruneHiddenPublicAnswers();
  schedulePublicAutosave();
  if (shouldRefreshVisibility) renderPublicSurvey();
}

function publicLogicDependsOn(questionId) {
  return Boolean(state.publicSurvey?.schema.logic?.some((rule) => rule.questionId === questionId));
}

function pruneHiddenPublicAnswers() {
  if (!state.publicSurvey) return;
  const visibleIds = new Set(publicVisibleQuestions(state.publicSurvey.schema, state.publicAnswers).map((question) => question.id));
  for (const questionId of Object.keys(state.publicAnswers)) {
    if (!visibleIds.has(questionId)) delete state.publicAnswers[questionId];
  }
}

async function nextPublicPage() {
  const pages = publicSurveyPages(state.publicSurvey);
  const missing = missingRequiredOnPublicPage(pages[state.publicPage]?.questions || []);
  if (missing) {
    toast(`${missing.title} is required.`);
    return;
  }
  await flushPublicAutosave();
  state.publicPage = Math.min((state.publicPage || 0) + 1, pages.length - 1);
  renderPublicSurvey();
}

async function previousPublicPage() {
  await flushPublicAutosave();
  state.publicPage = Math.max((state.publicPage || 0) - 1, 0);
  renderPublicSurvey();
}

function missingRequiredOnPublicPage(questions) {
  return questions.find((question) => {
    if (!question.required) return false;
    const value = state.publicAnswers[question.id];
    return value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);
  });
}

function ensureEditingSurvey() {
  if (!state.selectedSurveyId && state.surveys[0]) state.selectedSurveyId = state.surveys[0].id;
  if (!state.editingSurvey || state.editingSurvey.id !== state.selectedSurveyId) {
    const survey = selectedSurvey();
    state.editingSurvey = survey ? structuredClone(survey) : null;
    state.selectedQuestionId = state.editingSurvey?.schema.questions[0]?.id || '';
  }
  return state.editingSurvey;
}

function selectedSurvey() {
  return state.surveys.find((survey) => survey.id === state.selectedSurveyId) || state.surveys[0] || null;
}

function selectedQuestion(survey = state.editingSurvey) {
  return survey?.schema.questions.find((item) => item.id === state.selectedQuestionId) || survey?.schema.questions[0] || null;
}

function addQuestion(type) {
  const survey = ensureEditingSurvey();
  const q = {
    id: `q_${Math.random().toString(16).slice(2, 8)}`,
    type,
    title: typeLabel(type),
    description: '',
    required: false,
    order: survey.schema.questions.length,
    settings: defaultQuestionSettings(type),
    validation: {}
  };
  survey.schema.questions.push(q);
  state.selectedQuestionId = q.id;
}

function deleteQuestion() {
  const survey = ensureEditingSurvey();
  survey.schema.questions = survey.schema.questions.filter((item) => item.id !== state.selectedQuestionId);
  state.selectedQuestionId = survey.schema.questions[0]?.id || '';
}

function duplicateQuestion() {
  const survey = ensureEditingSurvey();
  const q = selectedQuestion(survey);
  if (!q) return;
  const copy = structuredClone(q);
  copy.id = `q_${Math.random().toString(16).slice(2, 8)}`;
  copy.title = `${copy.title} copy`;
  survey.schema.questions.splice(survey.schema.questions.findIndex((item) => item.id === q.id) + 1, 0, copy);
  state.selectedQuestionId = copy.id;
}

function moveQuestion(direction) {
  const survey = ensureEditingSurvey();
  const index = survey.schema.questions.findIndex((item) => item.id === state.selectedQuestionId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= survey.schema.questions.length) return;
  const [item] = survey.schema.questions.splice(index, 1);
  survey.schema.questions.splice(next, 0, item);
}

function addLogicRule() {
  const survey = ensureEditingSurvey();
  const questionId = document.getElementById('logic-question')?.value;
  const targetQuestionId = document.getElementById('logic-target')?.value;
  const operator = document.getElementById('logic-operator')?.value || 'equals';
  const value = document.getElementById('logic-value')?.value || '';
  const action = document.getElementById('logic-action')?.value || 'show_question';
  const actionValue = document.getElementById('logic-action-value')?.value || '';
  const scoreDelta = Number(document.getElementById('logic-score-delta')?.value || 0);
  const redirectUrl = document.getElementById('logic-redirect-url')?.value || '';
  if (!questionId) {
    toast('Choose a question for the logic rule.');
    return;
  }
  if (['show_question', 'skip_to_question', 'set_hidden_field'].includes(action) && (!targetQuestionId || questionId === targetQuestionId)) {
    toast('Choose a different target question or hidden field.');
    return;
  }
  if (action === 'skip_to_question') {
    const sourceIndex = survey.schema.questions.findIndex((question) => question.id === questionId);
    const targetIndex = survey.schema.questions.findIndex((question) => question.id === targetQuestionId);
    if (targetIndex <= sourceIndex) {
      toast('Skip logic must point to a later question.');
      return;
    }
  }
  if (action === 'assign_tag' && !actionValue.trim()) {
    toast('Enter a tag value for this logic rule.');
    return;
  }
  if (action === 'redirect' && !redirectUrl.trim()) {
    toast('Enter a redirect URL for this logic rule.');
    return;
  }
  survey.schema.logic = survey.schema.logic || [];
  survey.schema.logic.push({
    id: `logic_${Math.random().toString(16).slice(2, 8)}`,
    questionId,
    operator,
    value,
    action,
    targetQuestionId,
    actionValue,
    scoreDelta: Math.max(-100, Math.min(100, Number.isFinite(scoreDelta) ? scoreDelta : 0)),
    redirectUrl
  });
}

function deleteLogicRule(id) {
  const survey = ensureEditingSurvey();
  survey.schema.logic = (survey.schema.logic || []).filter((rule) => rule.id !== id);
}

function addAccessRule() {
  const survey = ensureEditingSurvey();
  const userId = document.getElementById('survey-access-user')?.value || '';
  const role = document.getElementById('survey-access-role')?.value || 'viewer';
  if (!userId) {
    toast('Choose a workspace member to grant access.');
    return;
  }
  survey.accessRules = (survey.accessRules || []).filter((rule) => rule.userId !== userId);
  survey.accessRules.push({ userId, role });
}

function deleteAccessRule(userId) {
  const survey = ensureEditingSurvey();
  survey.accessRules = (survey.accessRules || []).filter((rule) => rule.userId !== userId);
}

function defaultQuestionSettings(type) {
  if (['single_choice', 'multiple_choice', 'dropdown'].includes(type)) return { options: ['Option 1', 'Option 2'], placeholder: '' };
  if (type === 'yes_no') return { options: ['Yes', 'No'] };
  if (type === 'nps') return { scale: 10, lowLabel: 'Not likely', highLabel: 'Very likely' };
  if (scaleQuestion({ type })) return { scale: 5, lowLabel: '', highLabel: '' };
  if (type === 'file_upload') return { allowedFileTypes: ['pdf', 'png', 'jpg', 'jpeg'], maxSizeMB: 5, placeholder: '' };
  if (type === 'consent') return { consentText: 'I agree to be contacted about this response.' };
  return { placeholder: '' };
}

function currentWorkspace() {
  return state.workspaces.find((workspace) => workspace.id === state.workspaceId) || state.workspaces[0] || null;
}

function canUseAgencyView() {
  if (state.session?.user.platformRole === 'super_admin') return true;
  return state.workspaces.some((workspace) => workspacePlanId(workspace) === 'agency');
}

function agencyOverviewWorkspaceId() {
  if (state.session?.user.platformRole === 'super_admin') return state.workspaceId || currentWorkspace()?.id || '';
  const selected = currentWorkspace();
  if (workspacePlanId(selected) === 'agency') return selected.id;
  return state.workspaces.find((workspace) => workspacePlanId(workspace) === 'agency')?.id || selected?.id || '';
}

function workspacePlanId(workspace) {
  return workspace?.subscription?.planId || workspace?.planId || 'starter';
}

function canReviewSurveyApprovals() {
  const role = currentWorkspace()?.role || '';
  return state.session?.user.platformRole === 'super_admin' || ['owner', 'admin'].includes(role);
}

async function refreshSession() {
  state.session = await api('/api/session');
  state.workspaces = state.session.workspaces;
  state.plans = state.session.plans;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = payload?.error?.message || response.statusText || 'Request failed';
    const error = new Error(message);
    error.code = payload?.error?.code || '';
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function compactValues(values) {
  return Object.fromEntries(Object.entries(values || {}).filter(([, value]) => String(value || '').trim() !== ''));
}

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values || {})) {
    if (String(value || '').trim() !== '') params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function responseFilterKey(surveyId) {
  return `${surveyId || ''}:${JSON.stringify(state.responseFilters || {})}`;
}

function analyticsFilterKey(surveyId) {
  return `${surveyId || ''}:${JSON.stringify(state.analyticsFilters || {})}`;
}

function analyticsBenchmarkFilterKey() {
  return `${state.workspaceId || ''}:${JSON.stringify(state.analyticsFilters || {})}`;
}

function setPath(object, path, value) {
  const parts = path.split('.');
  let target = object;
  for (const part of parts.slice(0, -1)) {
    target[part] = target[part] || {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
}

function metric(label, value, note) {
  return `<div class="card metric"><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note || '')}</small></div>`;
}

function checkCard(title, ok, detail) {
  return `<div class="card"><span class="pill ${ok ? 'good' : 'warn'}">${ok ? 'ready' : 'todo'}</span><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(detail)}</p></div>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function renderBars(items) {
  if (!items || !items.length) return '<p class="muted">No data yet.</p>';
  const max = Math.max(...items.map((item) => Number(item.value || 0)), 1);
  return `<div class="bar-row">${items.map((item) => `<div class="bar"><span>${escapeHtml(item.label)}</span><div class="bar-track"><div class="bar-fill" style="--value:${Math.round((Number(item.value || 0) / max) * 100)}%"></div></div><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>`;
}

function objectToBars(object) {
  return Object.entries(object || {}).map(([label, value]) => ({ label, value }));
}

function choiceQuestion(question) {
  return ['single_choice', 'multiple_choice', 'dropdown', 'yes_no'].includes(question.type);
}

function scaleQuestion(question) {
  return ['rating', 'nps', 'csat', 'ces', 'star_rating', 'emoji_rating'].includes(question.type);
}

function typeLabel(type) {
  return (questionTypes.find((item) => item[0] === type)?.[1] || type || '').replaceAll('_', ' ');
}

function questionTitle(survey, id) {
  return survey.schema.questions.find((question) => question.id === id)?.title || id;
}

function logicRuleSummary(survey, rule) {
  const condition = `${questionTitle(survey, rule.questionId)} ${String(rule.operator || 'equals').replaceAll('_', ' ')} "${rule.value || ''}"`;
  if (rule.action === 'show_question') return `${condition} shows ${questionTitle(survey, rule.targetQuestionId)}`;
  if (rule.action === 'skip_to_question') return `${condition} skips to ${questionTitle(survey, rule.targetQuestionId)}`;
  if (rule.action === 'set_hidden_field') return `${condition} sets ${questionTitle(survey, rule.targetQuestionId)} to "${rule.actionValue || ''}"`;
  if (rule.action === 'assign_tag') return `${condition} adds tag "${rule.actionValue || ''}"`;
  if (rule.action === 'calculate_score') return `${condition} adjusts lead score by ${Number(rule.scoreDelta || 0)}`;
  if (rule.action === 'trigger_alert') return `${condition} triggers alert "${rule.actionValue || 'Logic alert'}"`;
  if (rule.action === 'redirect') return `${condition} redirects to ${rule.redirectUrl || ''}`;
  if (rule.action === 'end_survey') return `${condition} ends survey with "${rule.actionValue || 'completion message'}"`;
  return condition;
}

function surveyTypes() {
  return ['link_survey', 'website_embed', 'in_app_survey', 'lead_capture', 'feedback_form', 'employee_pulse', 'nps_survey', 'csat_survey', 'product_feedback', 'complaint_form'];
}

function formatAnswer(value) {
  if (Array.isArray(value)) return value.map(formatAnswer).join(', ');
  if (value && typeof value === 'object') return value.name || value.fileId || JSON.stringify(value);
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return value ?? '';
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-IN').format(value || 0);
}

function dateLabel(value) {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function dateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function readUtm() {
  const params = new URLSearchParams(location.search);
  return {
    source: params.get('source') || params.get('utm_source') || 'direct',
    utm: {
      source: params.get('utm_source') || '',
      medium: params.get('utm_medium') || '',
      campaign: params.get('utm_campaign') || ''
    },
    branch: params.get('branch') || params.get('branch_id') || '',
    location: params.get('location') || params.get('city') || params.get('region') || '',
    browserId: publicBrowserId(),
    language: navigator.language
  };
}

function publicBrowserId() {
  const key = 'formspear.browserId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `br_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function toast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}

function escapeStyleText(value) {
  return String(value ?? '').replace(/<\/?style/gi, '').replace(/[<>]/g, '');
}
