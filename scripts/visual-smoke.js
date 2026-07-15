const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { execFile } = require('node:child_process');
const { createServer } = require('../src/server');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'visual-smoke');
const PROFILE_DIR = path.join(ARTIFACT_DIR, '.profiles');
const BROWSER_TIMEOUT_MS = Number(process.env.VISUAL_SMOKE_BROWSER_TIMEOUT_MS || 30000);
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error('No Chromium-family browser found. Set BROWSER_PATH to msedge.exe or chrome.exe.');
  }
  await fs.promises.mkdir(PROFILE_DIR, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formspear-visual-smoke-'));
  const server = createServer({ dataFile: path.join(dataDir, 'db.json'), disableWorker: true });
  let browser = null;
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const seeded = await seedSurvey(baseUrl);
    const shots = [
      { name: 'desktop-app-shell', url: `${baseUrl}/`, width: 1280, height: 720, mobile: false },
      { name: 'desktop-dashboard', url: `${baseUrl}/#dashboard`, width: 1440, height: 900, mobile: false, cookie: seeded.cookie, expectedText: 'First insight path' },
      { name: 'desktop-builder', url: `${baseUrl}/#builder`, width: 1440, height: 900, mobile: false, cookie: seeded.cookie, expectedText: 'Survey builder', verifyBuilder: true },
      { name: 'mobile-public-survey', url: `${baseUrl}/s/${seeded.slug}`, width: 390, height: 844, mobile: true }
    ];
    browser = await launchBrowser(browserPath);
    const manifest = {
      generatedAt: new Date().toISOString(),
      browserPath,
      baseUrl,
      shots: []
    };
    for (const shot of shots) {
      const output = path.join(ARTIFACT_DIR, `${shot.name}.png`);
      const result = await captureScreenshot(browser, shot, output);
      const stat = await fs.promises.stat(output);
      if (stat.size < 5000) throw new Error(`${shot.name} screenshot is unexpectedly small (${stat.size} bytes).`);
      if (result.consoleErrors.length) throw new Error(`${shot.name} emitted console errors: ${result.consoleErrors.join(' | ')}`);
      if (result.viewport.overflowX) throw new Error(`${shot.name} has horizontal overflow: scrollWidth ${result.viewport.scrollWidth}, viewport ${result.viewport.innerWidth}, offenders ${JSON.stringify(result.viewport.offenders)}.`);
      if (result.accessibility.issues.length) throw new Error(`${shot.name} has accessibility issues: ${result.accessibility.issues.join(' | ')}`);
      manifest.shots.push({
        ...shot,
        file: path.relative(ROOT, output).replace(/\\/g, '/'),
        bytes: stat.size,
        viewport: result.viewport,
        accessibility: result.accessibility,
        consoleErrors: result.consoleErrors.length
      });
    }
    const manifestPath = path.join(ARTIFACT_DIR, 'manifest.json');
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Visual smoke passed: ${manifest.shots.map((shot) => shot.file).join(', ')}`);
  } finally {
    if (browser) await browser.close();
    await close(server);
  }
}

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    server.close(done);
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    setTimeout(done, 2000);
  });
}

async function seedSurvey(baseUrl) {
  const signup = await postJson(`${baseUrl}/api/auth/signup`, {
    name: 'Visual Smoke',
    email: `visual-${Date.now()}@example.test`,
    password: 'FeedbackOS123',
    workspaceName: 'Visual Smoke Workspace',
    acceptTerms: true
  });
  const cookie = signup.cookie;
  const workspaceId = signup.payload.workspaces[0].id;
  const created = await postJson(`${baseUrl}/api/surveys`, { workspaceId, title: 'Visual Smoke Survey' }, cookie);
  const surveyId = created.payload.survey.id;
  const slug = 'visual-smoke-survey';
  await putJson(`${baseUrl}/api/surveys/${surveyId}`, {
    slug,
    schema: {
      title: 'Visual Smoke Survey',
      description: 'A short survey used for browser regression checks.',
      questions: [
        { id: 'email', type: 'email', title: 'Email address', required: true, settings: { placeholder: 'you@example.test' }, validation: {} },
        { id: 'rating', type: 'csat', title: 'How satisfied are you?', required: true, settings: { scale: 5 }, validation: {} },
        { id: 'comment', type: 'long_text', title: 'What should we improve?', required: false, settings: { placeholder: 'Optional notes' }, validation: {} }
      ],
      logic: [],
      completion: { type: 'message', message: 'Thanks for the visual smoke response.' }
    }
  }, cookie);
  await postJson(`${baseUrl}/api/surveys/${surveyId}/publish`, {}, cookie);
  return { workspaceId, surveyId, slug, cookie };
}

async function postJson(url, body, cookie = '') {
  return requestJson(url, 'POST', body, cookie);
}

async function putJson(url, body, cookie = '') {
  return requestJson(url, 'PUT', body, cookie);
}

async function requestJson(url, method, body, cookie = '') {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${url} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return {
    payload,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie
  };
}

async function launchBrowser(browserPath) {
  const userDataDir = fs.mkdtempSync(path.join(PROFILE_DIR, 'browser-profile-'));
  const diskCacheDir = fs.mkdtempSync(path.join(PROFILE_DIR, 'browser-cache-'));
  const mediaCacheDir = fs.mkdtempSync(path.join(PROFILE_DIR, 'browser-media-'));
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-dev-shm-usage',
    '--disable-3d-apis',
    '--disable-webgpu',
    '--disable-software-rasterizer',
    '--use-gl=disabled',
    '--disable-features=CalculateNativeWinOcclusion,Vulkan,UseSkiaRenderer,SkiaGraphite,DawnGraphite,WebGPU',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-service-autorun',
    '--password-store=basic',
    '--run-all-compositor-stages-before-draw',
    '--use-mock-keychain',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    `--disk-cache-dir=${diskCacheDir}`,
    `--media-cache-dir=${mediaCacheDir}`,
    '--remote-debugging-port=0',
    'about:blank'
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browserPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid).finally(() => {
        reject(new Error(`${path.basename(browserPath)} did not expose a DevTools endpoint within ${BROWSER_TIMEOUT_MS}ms.`));
      });
    }, BROWSER_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      const wsEndpoint = match[1];
      const parsed = new URL(wsEndpoint);
      resolve({
        child,
        wsEndpoint,
        httpBase: `http://${parsed.host}`,
        async close() {
          child.stdout?.destroy();
          child.stderr?.destroy();
          await killProcessTree(child.pid);
          try {
            child.kill('SIGKILL');
          } catch (_) {
            // Process may already be gone.
          }
          child.unref();
          await waitForChildExit(child, 1000);
          await cleanupBrowserDirs(userDataDir, diskCacheDir, mediaCacheDir);
        }
      });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupBrowserDirs(userDataDir, diskCacheDir, mediaCacheDir).finally(() => reject(error));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupBrowserDirs(userDataDir, diskCacheDir, mediaCacheDir).finally(() => {
        reject(new Error(`${path.basename(browserPath)} exited before DevTools was ready with code ${code}: ${(stderr || stdout).slice(-1600)}`));
      });
    });
  });
}

async function captureScreenshot(browser, shot, output) {
  const target = await createPageTarget(browser.httpBase, 'about:blank');
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  const consoleErrors = [];
  client.on('Runtime.exceptionThrown', (params) => {
    consoleErrors.push(params.exceptionDetails?.text || params.exceptionDetails?.exception?.description || 'Runtime exception');
  });
  client.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      consoleErrors.push((params.args || []).map((arg) => arg.value || arg.description || '').join(' ').trim() || 'console.error');
    }
  });
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    if (shot.cookie) {
      const separator = shot.cookie.indexOf('=');
      await client.send('Network.setCookie', {
        name: shot.cookie.slice(0, separator),
        value: shot.cookie.slice(separator + 1),
        url: shot.url.split('#')[0]
      });
    }
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: 1,
      mobile: Boolean(shot.mobile)
    });
    if (shot.mobile) {
      await client.send('Emulation.setUserAgentOverride', { userAgent: MOBILE_USER_AGENT });
    }
    const loadEvent = client.waitFor('Page.loadEventFired', BROWSER_TIMEOUT_MS);
    await client.send('Page.navigate', { url: shot.url });
    await loadEvent;
    await delay(500);
    if (shot.expectedText) {
      const content = await client.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
      if (!String(content.result.value || '').includes(shot.expectedText)) throw new Error(`${shot.name} did not render expected text: ${shot.expectedText}`);
    }
    if (shot.verifyBuilder) await verifyBuilderInteractions(client);
    const viewport = await evaluateViewport(client);
    const accessibility = await evaluateAccessibility(client);
    if (viewport.innerWidth !== shot.width) {
      throw new Error(`${shot.name} viewport width mismatch: expected ${shot.width}, got ${viewport.innerWidth}.`);
    }
    const image = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    });
    await fs.promises.writeFile(output, image.data, 'base64');
    return { viewport, accessibility, consoleErrors };
  } finally {
    await client.close();
    await closePageTarget(browser.httpBase, target.id);
  }
}

async function verifyBuilderInteractions(client) {
  const original = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('[data-edit="survey.title"]');
      if (!input) throw new Error('Builder title input is missing.');
      const originalValue = input.value;
      input.focus();
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      input.value = originalValue + ' autosave check';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return originalValue;
    })()`,
    returnByValue: true
  });
  await delay(1400);
  const saved = await client.send('Runtime.evaluate', {
    expression: `(() => ({
      status: document.querySelector('[data-builder-autosave-status]')?.textContent || '',
      undoDisabled: Boolean(document.querySelector('[data-action="builder-undo"]')?.disabled)
    }))()`,
    returnByValue: true
  });
  if (saved.result.value.status !== 'All changes saved' || saved.result.value.undoDisabled) {
    throw new Error(`Builder autosave did not complete: ${JSON.stringify(saved.result.value)}`);
  }
  await client.send('Runtime.evaluate', { expression: `document.querySelector('[data-action="builder-undo"]').click()` });
  await delay(1400);
  const undone = await client.send('Runtime.evaluate', {
    expression: `(() => ({
      title: document.querySelector('[data-edit="survey.title"]')?.value || '',
      status: document.querySelector('[data-builder-autosave-status]')?.textContent || ''
    }))()`,
    returnByValue: true
  });
  if (undone.result.value.title !== original.result.value || undone.result.value.status !== 'All changes saved') {
    throw new Error(`Builder undo/autosave verification failed: ${JSON.stringify(undone.result.value)}`);
  }
}

async function createPageTarget(httpBase, targetUrl) {
  const encoded = encodeURIComponent(targetUrl);
  let response = await fetch(`${httpBase}/json/new?${encoded}`, { method: 'PUT' });
  if (!response.ok) response = await fetch(`${httpBase}/json/new?${encoded}`);
  if (!response.ok) throw new Error(`Could not create browser target: ${response.status} ${await response.text()}`);
  return response.json();
}

async function closePageTarget(httpBase, targetId) {
  if (!targetId) return;
  await fetch(`${httpBase}/json/close/${encodeURIComponent(targetId)}`).catch(() => {});
}

async function evaluateViewport(client) {
  const expression = `(() => {
    const root = document.documentElement;
    const body = document.body || root;
    const elements = Array.from(document.body ? document.body.querySelectorAll('*') : []);
    const maxRight = elements.reduce((max, element) => {
      const rect = element.getBoundingClientRect();
      return Number.isFinite(rect.right) ? Math.max(max, rect.right) : max;
    }, 0);
    const scrollWidth = Math.max(root.scrollWidth || 0, body.scrollWidth || 0, Math.ceil(maxRight));
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollWidth,
      overflowX: scrollWidth > window.innerWidth + 1,
      offenders: elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: String(element.className || '').slice(0, 80), right: Math.round(rect.right), width: Math.round(rect.width), text: String(element.textContent || '').trim().slice(0, 60) };
      }).filter((item) => item.right > window.innerWidth + 1).sort((a, b) => b.right - a.right).slice(0, 5)
    };
  })()`;
  const evaluated = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.text || 'Viewport evaluation failed.');
  }
  return evaluated.result.value;
}

async function evaluateAccessibility(client) {
  const expression = `(() => {
    const issues = [];
    if (!document.documentElement.lang) issues.push('document language is missing');
    if (!document.querySelector('h1')) issues.push('page has no h1');
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    for (const control of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
      if (!visible(control)) continue;
      const idLabel = control.id && document.querySelector('label[for="' + CSS.escape(control.id) + '"]');
      const wrappedLabel = control.closest('label');
      const named = control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') || control.title;
      if (!idLabel && !wrappedLabel && !named) issues.push('unlabelled ' + control.tagName.toLowerCase() + (control.name ? '[name="' + control.name + '"]' : '') + ' ' + String(control.outerHTML || '').slice(0, 140));
    }
    for (const button of document.querySelectorAll('button')) {
      if (visible(button) && !(button.textContent || '').trim() && !button.getAttribute('aria-label')) issues.push('button has no accessible name');
    }
    for (const image of document.querySelectorAll('img')) {
      if (!image.hasAttribute('alt')) issues.push('image is missing alt text');
    }
    return { issues, labelledControls: document.querySelectorAll('label').length, headings: document.querySelectorAll('h1,h2,h3').length };
  })()`;
  const evaluated = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text || 'Accessibility evaluation failed.');
  return evaluated.result.value;
}

function killProcessTree(pid) {
  if (!pid) return Promise.resolve();
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const task = execFile('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { timeout: 5000 }, done);
      task.on('error', done);
      setTimeout(done, 6000);
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch (_) {
      // Process may have already exited.
    }
    resolve();
  });
}

function cleanupBrowserDirs(...dirs) {
  return Promise.all(dirs.map((dir) => fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})));
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
    socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed.')));
    socket.addEventListener('error', () => this.rejectPending(new Error('CDP socket error.')));
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error('Timed out connecting to browser target.')), BROWSER_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpClient(socket));
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not connect to browser target.'));
      }, { once: true });
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      const handler = (params) => {
        clearTimeout(timer);
        const handlers = this.handlers.get(method) || [];
        this.handlers.set(method, handlers.filter((item) => item !== handler));
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, BROWSER_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      this.socket.send(payload);
    });
  }

  handleMessage(data) {
    const message = JSON.parse(data);
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed.'));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method && this.handlers.has(message.method)) {
      for (const handler of this.handlers.get(message.method)) handler(message.params || {});
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close() {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.socket.addEventListener('close', resolve, { once: true });
      this.socket.close();
      setTimeout(resolve, 500);
    });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
