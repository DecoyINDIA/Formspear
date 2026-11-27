// The Living Lattice — a parametric sculpture regenerated from verified repository data.
//
//   node tools/readme-art/lattice/generate.mjs [--offline]
//
// Data sources (official only): GitHub REST API for repo metadata, contributors,
// releases (+asset download counts), languages and the commit history.
// Mapping (every metric is labelled for what it actually is):
//   1 cube            = 1 commit on the default branch (since repo creation, last 52 weeks)
//   1 tower           = 1 ISO week of commits
//   branch arm        = 1 contributor
//   spire cube        = 1 star            (stars are NOT users)
//   side module       = 1 fork
//   horizontal layer  = 1 release         (none published -> empty socket)
//   footprint ribbon  = language bytes as reported by GitHub
// Nothing is invented: zero is rendered as an empty, labelled socket.
// Snapshots are append-only (assets/readme/metrics/snapshots.jsonl); when the API
// fails or is rate-limited the last snapshot is reused and nothing is fabricated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const REPO = process.env.GITHUB_REPOSITORY || 'DecoyINDIA/Formspear';
const OFFLINE = process.argv.includes('--offline');
const metricsDir = path.join(repoRoot, 'assets', 'readme', 'metrics');
const snapFile = path.join(metricsDir, 'snapshots.jsonl');
const svgOut = path.join(repoRoot, 'assets', 'readme', 'art', 'living-lattice.svg');
const mdOut = path.join(metricsDir, 'latest.md');
const readmePath = path.join(repoRoot, 'README.md');
fs.mkdirSync(metricsDir, { recursive: true });
fs.mkdirSync(path.dirname(svgOut), { recursive: true });

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'formspear-readme-lattice', 'X-GitHub-Api-Version': '2022-11-28' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function gh(p, { raw = false } = {}) {
  const res = await fetch(`https://api.github.com${p}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${p}`);
  return raw ? res : res.json();
}
const lastPage = (res) => { const m = /[?&]page=(\d+)>; rel="last"/.exec(res.headers.get('link') || ''); return m ? Number(m[1]) : null; };

async function collect() {
  const repo = await gh(`/repos/${REPO}`);
  const branch = repo.default_branch;
  const countVia = async (p) => { const r = await gh(`${p}${p.includes('?') ? '&' : '?'}per_page=1`, { raw: true }); const body = await r.json(); return lastPage(r) ?? (Array.isArray(body) ? body.length : 0); };
  const contributors = await countVia(`/repos/${REPO}/contributors`);
  const releases = await gh(`/repos/${REPO}/releases?per_page=100`);
  const tags = await countVia(`/repos/${REPO}/tags`);
  const languages = await gh(`/repos/${REPO}/languages`);
  const since = new Date(Date.now() - 52 * 7 * 864e5).toISOString();
  const dates = [];
  for (let page = 1; page <= 30; page++) {
    const list = await gh(`/repos/${REPO}/commits?sha=${branch}&since=${since}&per_page=100&page=${page}`);
    for (const c of list) dates.push(c.commit.author.date);
    if (list.length < 100) break;
  }
  const totalCommits = await countVia(`/repos/${REPO}/commits?sha=${branch}`);
  const releaseDownloads = releases.reduce((a, r) => a + (r.assets || []).reduce((b, x) => b + (x.download_count || 0), 0), 0);
  return {
    repo: REPO, defaultBranch: branch, createdAt: repo.created_at, pushedAt: repo.pushed_at, license: repo.license?.spdx_id || null,
    stars: repo.stargazers_count, forks: repo.forks_count, watchers: repo.subscribers_count, openIssues: repo.open_issues_count, sizeKb: repo.size,
    contributors, releases: releases.length, releaseDownloads, tags, commitsTotal: totalCommits, languages,
    weekly: weekly(dates),
  };
}

function weekStart(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x.toISOString().slice(0, 10); }
function weekly(dates) {
  const map = new Map();
  for (const d of dates) map.set(weekStart(d), (map.get(weekStart(d)) || 0) + 1);
  if (!map.size) return [];
  const keys = [...map.keys()].sort();
  const out = []; const end = new Date(weekStart(new Date()));
  for (let d = new Date(keys[0]); d <= end; d.setUTCDate(d.getUTCDate() + 7)) { const k = d.toISOString().slice(0, 10); out.push([k, map.get(k) || 0]); }
  return out;
}

const readSnaps = () => (fs.existsSync(snapFile) ? fs.readFileSync(snapFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sig = (s) => JSON.stringify([s.stars, s.forks, s.watchers, s.contributors, s.releases, s.releaseDownloads, s.tags, s.commitsTotal, s.sizeKb, s.weekly]);

let snaps = readSnaps();
let data = null, note = '';
if (!OFFLINE) {
  try { data = await collect(); } catch (e) { note = `API unavailable (${e.message}); reusing last verified snapshot`; console.warn(note); }
}
if (data) {
  const snap = { capturedAt: new Date().toISOString(), ...data };
  const last = snaps[snaps.length - 1];
  if (!last || sig(last) !== sig(snap)) { fs.appendFileSync(snapFile, JSON.stringify(snap) + '\n'); snaps.push(snap); console.log('snapshot appended'); }
  else console.log('metrics unchanged; snapshot history left as-is');
}
const cur = snaps[snaps.length - 1];
if (!cur) { console.error('No verified data available. Nothing generated.'); process.exit(OFFLINE ? 0 : 1); }

/* ---------------------------------------------------------------- SVG --- */
const W = 1200, H = 560;
const iso = (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z * 0.98 * 0.5]; // unit space, fitted later
const pt = (p) => p.map((n) => n.toFixed(2)).join(',');
const poly = (pts) => pts.map(pt).join(' ');
const COL = { top: ['#F2EDE1', '#6EE7B7', '#F7BC5B'], left: ['#B9B3A4', '#0E9F6E', '#C57A06'], right: ['#8E897C', '#047857', '#92590A'] };
const items = []; // painter's-sorted at the end
const add = (key, z, svg) => items.push({ key, z, svg });

function cube(x, y, z, kind, delay, cls = 'c', u = 1) {
  const P8 = (dx, dy, dz) => iso(x + dx * u, y + dy * u, z + dz * u);
  const f = (arr, fill) => `<polygon points="${poly(arr)}" fill="${fill}"/>`;
  const svg = `<g class="${cls}" style="animation-delay:${delay.toFixed(2)}s">${f([P8(0, 0, 1), P8(1, 0, 1), P8(1, 1, 1), P8(0, 1, 1)], COL.top[kind])}${f([P8(0, 1, 1), P8(1, 1, 1), P8(1, 1, 0), P8(0, 1, 0)], COL.left[kind])}${f([P8(1, 0, 1), P8(1, 1, 1), P8(1, 1, 0), P8(1, 0, 0)], COL.right[kind])}</g>`;
  add(x + y + u, z, svg);
}
const tile = (x, y, dashed) => {
  const q = [iso(x, y, 0), iso(x + 1, y, 0), iso(x + 1, y + 1, 0), iso(x, y + 1, 0)];
  const style = dashed ? 'fill="none" stroke="#34D399" stroke-opacity=".9" stroke-width=".05" stroke-dasharray=".14 .14"' : 'fill="#0F2620" stroke="#1E5A47" stroke-width=".03"';
  add(x + y - 5, 0, `<polygon points="${poly(q)}" ${style}/>`);
};

const weeks = cur.weekly;
const nW = Math.max(weeks.length, 1);
const maxC = Math.max(1, ...weeks.map((w) => w[1]));
// each week is a 2x2-footprint tower of half-size cubes: 4 commits per layer, still exactly 1 cube = 1 commit
const per = maxC > 360 ? Math.ceil(maxC / 360) : 1; // commits per drawn cube (1 unless one week is enormous)
const CU = 0.5;
const COLS = 8, GAP = 1.45;
const posOf = (i) => [(i % COLS) * GAP, Math.floor(i / COLS) * GAP];
const rowsN = Math.ceil(nW / COLS);
const plinthW = Math.min(nW, COLS) * GAP;

// footprint ribbon: language share, laid along the front edge of the plinth
const langTotal = Object.values(cur.languages || {}).reduce((a, b) => a + b, 0) || 1;
const LANGCOL = ['#34D399', '#38BDF8', '#F59E0B', '#A78BFA', '#6EE7B7', '#818CF8', '#F472B6'];
let lx = -0.3; const legend = [];
Object.entries(cur.languages || {}).sort((a, b) => b[1] - a[1]).forEach(([name, bytes], i) => {
  const w = (bytes / langTotal) * (plinthW + 0.6);
  const yy = rowsN * GAP + 0.15;
  add(900, 0, `<polygon points="${poly([iso(lx, yy, 0), iso(lx + w, yy, 0), iso(lx + w, yy + 0.38, 0), iso(lx, yy + 0.38, 0)])}" fill="${LANGCOL[i % LANGCOL.length]}" fill-opacity=".95"/>`);
  legend.push({ name, pct: (bytes / langTotal) * 100, col: LANGCOL[i % LANGCOL.length] });
  lx += w;
});

for (let i = 0; i < nW; i++) { const [x, y] = posOf(i); tile(x, y, false); }
// towers: one cube per commit (or per `per` commits when a single week is enormous)
const now = weeks.length - 1;
weeks.forEach(([, n], i) => {
  const [x, y] = posOf(i); const h = Math.ceil(n / per);
  for (let j = 0; j < h; j++) {
    const L = Math.floor(j / 4), q = j % 4;
    cube(x + (q % 2) * CU, y + Math.floor(q / 2) * CU, L * CU, i === now && j === h - 1 ? 2 : (n === maxC ? 1 : (i % 2 ? 1 : 0)), 0.3 + i * 0.05 + L * 0.06, 'c', CU);
  }
});
// contributor arms: one long slab per GitHub account, behind the skyline
const arms = Math.min(cur.contributors, 6);
for (let a = 0; a < arms; a++) for (let c = 0; c < COLS; c++) cube(c * GAP, -1.6 - a * 1.2, 0, 0, 0.15 + c * 0.04, 'arm');
if (arms === 0) tile(0, -1.6, true);
// stars spire + forks: right of the plinth
const sx = plinthW + 0.9;
if (cur.stars > 0) for (let z = 0; z < Math.min(cur.stars, 30); z++) cube(sx, 0, z, 1, 1.2 + z * 0.04); else tile(sx, 0, true);
if (cur.forks > 0) for (let f = 0; f < Math.min(cur.forks, 12); f++) cube(sx, GAP * (f + 1), 0, 0, 1.4 + f * 0.05); else tile(sx, GAP, true);
// releases: horizontal layers above the skyline (none yet -> dashed layer outline)
const topZ = Math.ceil(Math.ceil(maxC / per) / 4) * CU + 1.5;
const layer = (z, dashed) => {
  const q = [iso(-0.3, -0.3, z), iso(plinthW + 0.3, -0.3, z), iso(plinthW + 0.3, rowsN * GAP, z), iso(-0.3, rowsN * GAP, z)];
  add(2000, z, `<polygon points="${poly(q)}" fill="${dashed ? 'none' : '#38BDF8'}" fill-opacity="${dashed ? 0 : 0.22}" stroke="#38BDF8" stroke-opacity="${dashed ? 0.5 : 0.85}" stroke-width=".03" ${dashed ? 'stroke-dasharray=".14 .14"' : ''}/>`);
};
if (cur.releases === 0) layer(topZ, true); else for (let r = 0; r < Math.min(cur.releases, 8); r++) layer(topZ + r * 0.8, false);

items.sort((a, b) => a.key - b.key || a.z - b.z);
const bodyRaw = items.map((i) => i.svg).join('\n');
// auto-fit the unit-space sculpture into the left panel
const nums = [...bodyRaw.matchAll(/points="([^"]+)"/g)].flatMap((m) => m[1].split(' ').map((p) => p.split(',').map(Number)));
const xs = nums.map((p) => p[0]), ys = nums.map((p) => p[1]);
const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
const box = { x: 40, y: 96, w: 700, h: 410 };
const k = Math.min(box.w / (bx1 - bx0), box.h / (by1 - by0));
const tx = box.x + (box.w - (bx1 - bx0) * k) / 2 - bx0 * k, ty = box.y + (box.h - (by1 - by0) * k) / 2 - by0 * k;
const toView = (p) => [p[0] * k + tx, p[1] * k + ty];
const lab = (p, t, dx = 0, dy = 0) => { const [x, y] = toView(p); return `<text x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" class="sub">${t}</text>`; };
const unitPerCube = per === 1 ? '1 CUBE = 1 COMMIT' : `1 CUBE = ${per} COMMITS`;

const px = 790;
const fmt = (n) => Number(n).toLocaleString('en-US');
const rows = [
  ['STARS', cur.stars, 'repository stars · not users'],
  ['FORKS', cur.forks, 'forks of the repository'],
  ['CONTRIBUTORS', cur.contributors, 'GitHub accounts with commits'],
  ['RELEASES', cur.releases, `release-asset downloads: ${fmt(cur.releaseDownloads)} · tags: ${fmt(cur.tags)}`],
  ['COMMITS', cur.commitsTotal, `on ${cur.defaultBranch} · ${fmt(weeks.reduce((a, w) => a + w[1], 0))} in the ${weeks.length} weeks drawn`],
];
const day = cur.capturedAt.slice(0, 10);
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
let panel = `<text x="${px}" y="104" class="k">DATA SNAPSHOT ${day}</text>`;
rows.forEach(([kk, v, sub], i) => {
  const y = 156 + i * 62;
  panel += `<text x="${px}" y="${y}" class="lab">${kk}</text><text x="${px + 380}" y="${y + 6}" class="num" text-anchor="end">${fmt(v)}</text><text x="${px}" y="${y + 18}" class="sub">${esc(sub)}</text><line x1="${px}" x2="${px + 380}" y1="${y + 30}" y2="${y + 30}" stroke="#16382E"/>`;
});
const ly = 500; panel += `<text x="${px}" y="${ly - 16}" class="k">LANGUAGES · GITHUB BYTE SHARE</text>`;
let lxp = px, lyy = ly; legend.slice(0, 6).forEach((l) => {
  const w = 24 + (l.name.length + 6) * 7.3;
  if (lxp + w > px + 395 && lxp > px) { lxp = px; lyy += 20; }
  panel += `<rect x="${lxp}" y="${lyy - 4}" width="9" height="9" fill="${l.col}"/><text x="${lxp + 15}" y="${lyy + 5}" class="sub">${esc(l.name)} ${l.pct < 0.1 ? '&lt;0.1' : l.pct.toFixed(1)}%</text>`; lxp += w;
});

const alt = `Living Lattice. Snapshot ${day}. ${cur.stars} stars, ${cur.forks} forks, ${cur.contributors} contributor(s), ${cur.releases} releases, ${cur.commitsTotal} commits. ${unitPerCube.toLowerCase()}, one tower per week over the last ${weeks.length} weeks.`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">The Living Lattice — a sculpture regenerated from repository data</title>
<desc id="d">${esc(alt)}</desc>
<defs><radialGradient id="g" cx="36%" cy="55%" r="65%"><stop offset="0" stop-color="#1E5A47" stop-opacity=".55"/><stop offset="1" stop-color="#08110F" stop-opacity="0"/></radialGradient>
<style>
text{font-family:'Cascadia Mono',Consolas,'Courier New',monospace}
.k{font-size:11px;letter-spacing:2.2px;fill:#6EE7B7}
.lab{font-size:12px;letter-spacing:3px;fill:#ECFDF5;opacity:.75}
.num{font-family:Bahnschrift,'Segoe UI','Arial Narrow',Arial,sans-serif;font-size:40px;font-weight:700;fill:#F6F1E8}
.sub{font-size:12px;fill:#6EE7B7;opacity:.85}
.c,.arm{animation:rise 9s cubic-bezier(.2,.8,.2,1) infinite both}
@keyframes rise{0%{opacity:0;transform:translateY(.9px)}9%{opacity:1;transform:translateY(0)}92%{opacity:1;transform:translateY(0)}100%{opacity:1}}
@media (prefers-reduced-motion:reduce){.c,.arm{animation:none}}
</style></defs>
<rect width="${W}" height="${H}" fill="#08110F"/><rect width="${W}" height="${H}" fill="url(#g)"/>
<text x="46" y="52" class="k">FIG. 11 — THE LIVING LATTICE</text>
<text x="46" y="72" class="sub">${unitPerCube} · 4 PER LAYER · 1 TOWER = 1 WEEK · EMPTY SOCKET = ZERO, NOT HIDDEN</text>
<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(3)})">
${bodyRaw}
</g>
${lab(iso(sx + 1, 0.5, 0), `STARS · ${fmt(cur.stars)}`, 16, -6)}${lab(iso(sx + 1, GAP + 1, 0), `FORKS · ${fmt(cur.forks)}`, 16, 14)}${lab(iso(0, -1.6, 0), 'CONTRIBUTORS', -120, -10)}${lab(iso(-0.3, rowsN * GAP + 0.6, 0), 'LANGUAGE FOOTPRINT', -58, -16)}${cur.releases === 0 ? lab(iso(plinthW + 0.3, -0.3, topZ), 'RELEASES · 0', 10, 4) : ''}
${panel}
</svg>
`;
fs.writeFileSync(svgOut, svg);

/* ---------------------------------------------------- accessible table --- */
const md = [
  `| Metric | Value | What it measures |`, `| :-- | --: | :-- |`,
  `| Stars | **${fmt(cur.stars)}** | Repository stars (not users) |`,
  `| Forks | **${fmt(cur.forks)}** | Forks of the repository |`,
  `| Contributors | **${fmt(cur.contributors)}** | GitHub accounts with commits |`,
  `| Releases | **${fmt(cur.releases)}** | Published GitHub releases (${fmt(cur.releaseDownloads)} release-asset downloads, ${fmt(cur.tags)} tags) |`,
  `| Commits | **${fmt(cur.commitsTotal)}** | Commits on \`${cur.defaultBranch}\` |`,
  `| Weeks drawn | **${weeks.length}** | One tower per ISO week since the first commit in the window |`,
  `| Snapshot | ${cur.capturedAt.slice(0, 10)} | Official GitHub API; history in \`assets/readme/metrics/snapshots.jsonl\` |`,
].join('\n');
fs.writeFileSync(mdOut, md + '\n');
if (fs.existsSync(readmePath)) {
  let r = fs.readFileSync(readmePath, 'utf8');
  const re = /(<!-- LATTICE:START -->)[\s\S]*?(<!-- LATTICE:END -->)/;
  if (re.test(r)) { r = r.replace(re, `$1\n${md}\n$2`); fs.writeFileSync(readmePath, r); }
}
console.log(`lattice written: ${path.relative(repoRoot, svgOut)} (${weeks.length} weeks, ${cur.commitsTotal} commits)${note ? ' — ' + note : ''}`);
