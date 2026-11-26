// Deterministic frame capture: headless Chrome -> PNG frames -> ffmpeg -> animated WebP + static poster.
// Usage:
//   node render.mjs                      render every scene in scenes/_loader.js
//   node render.mjs hero form-architect  render selected scenes
//   node render.mjs hero --preview 0.5,3,6.2   write preview PNGs to out/preview (no encode)
//   node render.mjs hero --q 70 --width 960
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const preview = flag('preview', null);
const sheet = flag('sheet', null); // --sheet 6 -> storyboard contact sheet (jpg) in docs/readme-art/storyboards
// Delivery budget: tuned so every README animation stays GitHub-friendly. Override with --q/--fps/--width.
const ENC = { default: { fps: 20, q: 42 }, hero: { fps: 20, q: 32 }, 'information-structure': { fps: 20, q: 36 }, 'perfect-structure': { fps: 20, q: 38 }, components: { fps: 20, q: 40 } };
const quality = flag('q', null);
const outWidth = Number(flag('width', 880));
const fpsOverride = flag('fps', null);
const enc = (id) => ({ ...ENC.default, ...(ENC[id] || {}) });
const outDir = path.join(repo, 'assets', 'readme', 'art');
const staticDir = path.join(outDir, 'static');
fs.mkdirSync(path.join(here, 'out', 'preview'), { recursive: true });
fs.mkdirSync(staticDir, { recursive: true });

const chromeCandidates = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const executablePath = chromeCandidates.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error('No Chromium-family browser found. Set BROWSER_PATH.');

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files', '--force-color-profile=srgb', '--disable-lcd-text'] });
const loaderSrc = fs.readFileSync(path.join(here, 'scenes', '_loader.js'), 'utf8');
const allIds = [...loaderSrc.match(/const SCENES = \[([^\]]*)\]/)[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
const targets = ids.length ? ids : allIds;

function ff(argv, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: ['pipe', 'inherit', 'inherit'] });
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg exit ' + c))));
    p.on('error', reject);
    input(p.stdin);
  });
}
const b64 = (d) => Buffer.from(d.split(',')[1], 'base64');

for (const id of targets) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(`[${id}] page error:`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[${id}]`, m.text()); });
  await page.goto(pathToFileURL(path.join(here, 'stage.html')).href + `?scene=${id}`);
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  const def = await page.evaluate('window.__def');
  def.fps = Number(fpsOverride || enc(id).fps);
  const t0 = Date.now();

  if (sheet) {
    // storyboard contact sheet: N evenly spaced frames tiled 3 across -> docs/readme-art/storyboards/<id>.jpg
    const n = Number(sheet), dir = path.join(here, 'out', 'sheet');
    const sbDir = path.join(repo, 'docs', 'readme-art', 'storyboards');
    fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(sbDir, { recursive: true });
    for (let i = 0; i < n; i++) {
      await page.evaluate((x) => window.renderAt(x), ((i + 0.55) / n) * def.dur);
      fs.writeFileSync(path.join(dir, `${id}_${i + 1}.png`), b64(await page.evaluate('window.canvasPng()')));
    }
    await ff(['-framerate', '1', '-i', path.join(dir, `${id}_%d.png`), '-vf', `scale=640:-2:flags=lanczos,tile=3x${Math.ceil(n / 3)}:padding=6:color=0x06100d`, '-frames:v', '1', '-q:v', '4', path.join(sbDir, `${id}.jpg`)], (s) => s.end());
    console.log(`[${id}] storyboard sheet written`);
    await page.close(); continue;
  }

  if (preview) {
    for (const t of preview.split(',').map(Number)) {
      await page.evaluate((tt) => window.renderAt(tt), t);
      fs.writeFileSync(path.join(here, 'out', 'preview', `${id}_${t.toFixed(2)}.png`), b64(await page.evaluate('window.canvasPng()')));
    }
    console.log(`[${id}] preview frames written`);
    await page.close(); continue;
  }

  // poster (static alternative for reduced-motion users)
  await page.evaluate((tt) => window.renderAt(tt), def.poster);
  const posterPng = b64(await page.evaluate('window.canvasPng()'));
  await ff(['-f', 'image2pipe', '-i', '-', '-vf', `scale=${outWidth}:-2:flags=lanczos`, '-c:v', 'libwebp', '-q:v', '90', path.join(staticDir, `${id}.webp`)], (s) => { s.end(posterPng); });

  const total = Math.round(def.dur * def.fps);
  const outW = Math.min(outWidth, def.w);
  const dest = path.join(outDir, `${id}.webp`);
  await ff(['-f', 'image2pipe', '-framerate', String(def.fps), '-c:v', 'png', '-i', '-', '-vf', `scale=${outW}:-2:flags=lanczos`, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String(quality || enc(id).q), '-compression_level', '6', '-preset', 'drawing', '-loop', '0', dest], async (stdin) => {
    for (let i = 0; i < total; i++) {
      await page.evaluate((tt) => window.renderAt(tt), i / def.fps);
      const buf = b64(await page.evaluate('window.canvasPng()'));
      if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
    }
    stdin.end();
  });
  const kb = (fs.statSync(dest).size / 1024).toFixed(0);
  console.log(`[${id}] ${total} frames @ ${def.fps}fps -> ${path.relative(repo, dest)} (${kb} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.close();
}
await browser.close();
