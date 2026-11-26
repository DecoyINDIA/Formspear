// README art compatibility + budget gate.  node tools/readme-art/verify.mjs
// Checks: every asset the README references exists; every <img> has alt text; animated WebP
// signature + frame count (via ffprobe when available); per-asset and total byte budgets.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const PER_ASSET_KB = Number(process.env.PER_ASSET_KB || 5200);
const TOTAL_KB = Number(process.env.TOTAL_KB || 36000);
let failed = 0, total = 0;
const fail = (m) => { failed++; console.error('FAIL', m); };

const refs = new Set([...readme.matchAll(/(?:src|srcset)="(assets\/[^"]+)"/g)].map((m) => m[1]));
for (const ref of [...refs].sort()) {
  const p = path.join(root, ref);
  if (!fs.existsSync(p)) { fail(`missing asset ${ref}`); continue; }
  const kb = fs.statSync(p).size / 1024; total += kb;
  let info = '';
  if (ref.endsWith('.webp')) {
    const head = fs.readFileSync(p).subarray(0, 4096).toString('latin1');
    const animated = head.includes('ANIM');
    const r = spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets,width,height', '-of', 'csv=p=0', p], { encoding: 'utf8' });
    info = `${animated ? 'animated' : 'static'} ${r.stdout.trim().replace(/,/g, ' ')}`;
    if (!ref.includes('/static/') && !animated) fail(`${ref} is expected to be an animated WebP`);
  }
  if (kb > PER_ASSET_KB) fail(`${ref} is ${kb.toFixed(0)} KB (> ${PER_ASSET_KB} KB budget)`);
  console.log(`ok   ${ref.padEnd(52)} ${kb.toFixed(0).padStart(6)} KB  ${info}`);
}
for (const m of readme.matchAll(/<img\b[^>]*>/g)) if (!/\balt="[^"]{8,}"/.test(m[0])) fail(`img without meaningful alt: ${m[0].slice(0, 80)}`);
console.log(`total referenced: ${total.toFixed(0)} KB (budget ${TOTAL_KB} KB)`);
if (total > TOTAL_KB) fail('total byte budget exceeded');
process.exit(failed ? 1 : 0);
