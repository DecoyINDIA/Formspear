const app = document.getElementById('app');

const state = {
  publicSurvey: null,
  publicAnswers: {},
  publicPage: 0,
  publicStartedAt: '',
  publicPartialResponseId: '',
  publicResumeToken: '',
  publicAutosaveStatus: '',
  publicResumeEmailStatus: '',
  publicSubmitted: false,
  publicPassword: '',
  publicAutosaveTimer: null
};

async function initPublic(slug) {
  app.innerHTML = '<div class="public-shell"><div class="public-form"><p class="muted">Loading survey...</p></div></div>';
  try {
    const lang = new URLSearchParams(location.search).get('lang');
    let payload;
    if (state.publicPassword) {
      payload = await api(`/api/public/surveys/${encodeURIComponent(slug)}`, {
        method: 'POST',
        body: { password: state.publicPassword, lang }
      });
    } else {
      const publicParams = new URLSearchParams();
      if (lang) publicParams.set('lang', lang);
      const query = publicParams.toString() ? `?${publicParams.toString()}` : '';
      payload = await api(`/api/public/surveys/${encodeURIComponent(slug)}${query}`);
    }
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
          ${brand.platformBrandingHidden ? '' : '<span class="muted">Powered by Formspear</span>'}
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
      <label for="public-resume-email">Resume on another device</label>
      <div class="inline-row">
        <input id="public-resume-email" data-public-resume-email type="email" autocomplete="email" placeholder="you@example.com" />
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
      <div id="public-question-label-${escapeAttr(question.id)}"><strong>${escapeHtml(question.title)} ${question.required ? '<span class="pill danger">Required</span>' : ''}</strong></div>
      ${question.description ? `<p class="muted">${escapeHtml(question.description)}</p>` : ''}
      ${renderPublicInput(question)}
    </section>
  `;
}

function renderPublicInput(question) {
  const name = `answer-${question.id}`;
  const labelledBy = `public-question-label-${question.id}`;
  const answer = state.publicAnswers[question.id];
  if (question.type === 'long_text') return `<textarea aria-labelledby="${escapeAttr(labelledBy)}" data-public-answer="${question.id}" placeholder="${escapeAttr(question.settings.placeholder || '')}">${escapeHtml(answer || '')}</textarea>`;
  if (['short_text', 'email', 'phone', 'url', 'number', 'date', 'time'].includes(question.type)) {
    const type = question.type === 'short_text' ? 'text' : question.type === 'phone' ? 'tel' : question.type;
    return `<input type="${type}" aria-labelledby="${escapeAttr(labelledBy)}" data-public-answer="${question.id}" placeholder="${escapeAttr(question.settings.placeholder || '')}" value="${escapeAttr(answer || '')}" />`;
  }
  if (['single_choice', 'dropdown', 'yes_no'].includes(question.type)) {
    if (question.type === 'dropdown') return `<select aria-labelledby="${escapeAttr(labelledBy)}" data-public-answer="${question.id}"><option value="">Select one</option>${(question.settings.options || []).map((option) => `<option ${answer === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`;
    return `<div class="choice-list">${(question.settings.options || []).map((option) => `<label class="choice"><input type="radio" name="${name}" data-public-answer="${question.id}" value="${escapeAttr(option)}" ${answer === option ? 'checked' : ''}/> ${escapeHtml(option)}</label>`).join('')}</div>`;
  }
  if (question.type === 'multiple_choice') return `<div class="choice-list">${(question.settings.options || []).map((option) => `<label class="choice"><input type="checkbox" data-public-answer="${question.id}" value="${escapeAttr(option)}" ${Array.isArray(answer) && answer.includes(option) ? 'checked' : ''}/> ${escapeHtml(option)}</label>`).join('')}</div>`;
  if (scaleQuestion(question)) {
    const scale = Number(question.settings.scale || (question.type === 'nps' ? 10 : 5));
    return `<div class="scale">${Array.from({ length: scale }, (_, index) => `<span><input id="${question.id}-${index}" type="radio" name="${name}" data-public-answer="${question.id}" value="${index + 1}" ${String(answer || '') === String(index + 1) ? 'checked' : ''}/><label for="${question.id}-${index}">${index + 1}</label></span>`).join('')}</div>`;
  }
  if (question.type === 'file_upload') {
    const allowed = (question.settings.allowedFileTypes || []).map((item) => `.${String(item).replace(/^\./, '')}`).join(',');
    return `<input type="file" aria-labelledby="${escapeAttr(labelledBy)}" data-public-answer="${question.id}" accept="${escapeAttr(allowed)}" />`;
  }
  if (question.type === 'consent') return `<label class="choice"><input type="checkbox" data-public-answer="${question.id}" ${answer === true ? 'checked' : ''}/> ${escapeHtml(question.settings.consentText || 'I agree.')}</label>`;
  if (question.type === 'statement' || question.type === 'section') return '<p class="muted">Please continue.</p>';
  return `<input aria-labelledby="${escapeAttr(labelledBy)}" data-public-answer="${question.id}" />`;
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

async function submitPublicPassword(form) {
  state.publicPassword = formValues(form).password || '';
  await initPublic(form.dataset.slug);
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
  try {
    let payload;
    if (state.publicPassword) {
      payload = await api(`/api/public/surveys/${encodeURIComponent(survey.slug)}/responses/${encodeURIComponent(saved.responseId)}`, {
        method: 'POST',
        body: { password: state.publicPassword, resumeToken: saved.resumeToken }
      });
    } else {
      const params = new URLSearchParams({ resumeToken: saved.resumeToken });
      payload = await api(`/api/public/surveys/${encodeURIComponent(survey.slug)}/responses/${encodeURIComponent(saved.responseId)}?${params.toString()}`);
    }
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

function scaleQuestion(question) {
  return ['rating', 'nps', 'csat', 'ces', 'star_rating', 'emoji_rating'].includes(question.type);
}

function dateLabel(value) {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
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

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  try {
    if (action === 'send-public-resume') await sendPublicResumeLink();
    if (action === 'public-next-page') await nextPublicPage();
    if (action === 'public-prev-page') await previousPublicPage();
  } catch (error) {
    toast(error.message || 'Action failed.');
  }
});

document.addEventListener('change', (event) => {
  handlePublicInput(event);
});

document.addEventListener('input', (event) => {
  handlePublicInput(event);
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const type = form.dataset.form;
  try {
    if (type === 'public-password') await submitPublicPassword(form);
    if (type === 'public-response') await submitPublicResponse();
  } catch (error) {
    toast(error.message || 'Submission failed.');
  }
});

async function init() {
  const match = location.pathname.match(/^\/s\/([^/]+)/);
  if (match) {
    await initPublic(match[1]);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
