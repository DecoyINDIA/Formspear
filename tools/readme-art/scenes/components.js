/*
 * 05 — COMPONENTS OF POSSIBILITY  (Level 4)
 * Six studies of verified question types (QUESTION_TYPES in src/server.js).
 * Each study has its own construction logic and motion; none shares a template.
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { MAT, ngon } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;
  const TW = 376, TH = 272, GX = 24, GY = 20, X0 = (W - (3 * TW + 2 * GX)) / 2, Y0 = 84;

  const cam = (cx, cy, o = {}) => ({ target: [0, o.ty ?? 0.5, 0], yaw: o.yaw ?? 0.6, pitch: o.pitch ?? 0.5, dist: (o.dist ?? 11) * 2.15, fov: 0.55, shift: [cx - W / 2, cy - H / 2 + (o.sy ?? 0)] });
  const cyc = (t, period, off = 0) => (((t + off) % period) + period) % period / period;

  const STUDIES = [
    { id: 'short_text', title: 'SHORT TEXT', sub: 'kinetic typographic construction',
      draw(ctx, S, t, c) {
        const word = 'Ada Lovelace', p = cyc(t, 5);
        const n = Math.floor(clamp(p / 0.6) * word.length);
        S.begin(); S.setCamera(cam(c[0], c[1] + 30, { pitch: 0.7, dist: 11 }));
        S.box({ c: [0, 0.12, 0], s: [7.6, 0.24, 1.2], mat: MAT.bone2 });
        for (let i = 0; i < word.length; i++) {
          const k = E.out5(seg(p * 6, 0.2 + i * 0.1, 0.55 + i * 0.1)), ch = word[i];
          if (ch === ' ') continue;
          const h = 0.25 + (ch.toUpperCase() === ch ? 0.5 : 0) + ((ch.charCodeAt(0) * 7) % 5) * 0.08;
          S.box({ c: [-3.4 + i * 0.6 + 0.3, 0.24 + h * k / 2 + 0.01, 0], s: [0.42, h * k + 0.001, 0.5], mat: i % 4 === 0 ? MAT.emerald : MAT.bone });
        }
        const caret = (Math.floor(t * 2.4) % 2) * (p < 0.92 ? 1 : 0);
        S.box({ c: [-3.4 + n * 0.6 + 0.4, 0.55, 0], s: [0.1, 0.8, 0.5], mat: MAT.emerald, alpha: caret ? undefined : 0.001 });
        S.flush();
        FS.text(ctx, word.slice(0, n), c[0] - 150, c[1] + 62, { size: 22, weight: 600, color: css(P.bone), alpha: 0.9 });
      } },
    { id: 'choice', title: 'SINGLE & MULTIPLE CHOICE', sub: 'geometric branching',
      draw(ctx, S, t, c) {
        const p = cyc(t, 7) * 6; const sel = Math.floor(p / 2) % 3;
        S.begin(); S.setCamera(cam(c[0], c[1] + 8, { pitch: 0.75, dist: 11 }));
        S.box({ c: [0, 0.05, 0], s: [8.0, 0.1, 5.2], mat: MAT.steel });
        for (let r = 0; r < 3; r++) {
          const on = r === sel, k = E.out5(seg(p % 2, 0, 0.5));
          S.prism({ poly: ngon(18, 0.55), y0: 0.1, y1: 0.28, c: [-2.4, 0, -1.7 + r * 1.7], mat: MAT.bone });
          if (on) S.prism({ poly: ngon(18, 0.28), y0: 0.28, y1: 0.28 + 0.34 * k, c: [-2.4, 0, -1.7 + r * 1.7], mat: MAT.emerald });
          const tick = on ? 1 : 0;
          S.line({ pts: [[-1.6, 0.14, -1.7 + r * 1.7], [-0.8, 0.14, -1.7 + r * 1.7]], color: P.e600, alpha: 0.6, w: 1 });
          // multiple-choice cubes branch from each option
          for (let j = 0; j < 3; j++) {
            const chk = ((r + j + Math.floor(p)) % 3) === 0;
            S.box({ c: [0.2 + j * 1.3, 0.2 + (chk ? 0.28 : 0), -1.7 + r * 1.7], s: [0.75, 0.3 + (chk ? 0.56 : 0), 0.75], mat: chk ? MAT.emerald : MAT.bone2 });
          }
          void tick;
        }
        S.flush();
      } },
    { id: 'date', title: 'DATE', sub: 'temporal geometry',
      draw(ctx, S, t, c) {
        const p = cyc(t, 6) * 6;
        S.begin(); S.setCamera(cam(c[0], c[1] + 14, { pitch: 0.7, dist: 12 }));
        S.box({ c: [0, 0.06, 0], s: [8.6, 0.12, 6.2], mat: MAT.steel });
        const pick = 10 + Math.floor(p / 2) * 3;
        for (let d = 0; d < 28; d++) {
          const r = Math.floor(d / 7), cc = d % 7, dist = Math.hypot(cc - 3, r - 1.5);
          const wave = Math.max(0, Math.sin(p * 2.2 - dist * 0.9)) * 0.45;
          const on = d === pick % 28;
          S.box({ c: [(cc - 3) * 1.1, 0.14 + (on ? 0.45 : wave * 0.5), (r - 1.5) * 1.1], s: [0.86, 0.2 + (on ? 0.9 : wave), 0.86], mat: on ? MAT.emerald : (cc >= 5 ? MAT.bone2 : MAT.bone) });
        }
        S.flush();
      } },
    { id: 'file_upload', title: 'FILE UPLOAD', sub: 'layered object assembly',
      draw(ctx, S, t, c) {
        const p = cyc(t, 6);
        S.begin(); S.setCamera(cam(c[0], c[1] + 6, { pitch: 0.5, dist: 12, ty: 1.4 }));
        for (let i = 0; i < 4; i++) {
          const k = E.out5(seg(p, 0.05 + i * 0.12, 0.4 + i * 0.12));
          S.box({ c: [(1 - k) * (i % 2 ? 6 : -6), 0.2 + i * 0.42 + (1 - k) * 0.5, 0], s: [4.6, 0.26, 3.2], mat: [MAT.steel, MAT.bone2, MAT.bone, MAT.mint][i], alpha: k < 0.99 ? Math.max(0.05, k) : undefined });
        }
        const up = E.io3(seg(p, 0.55, 0.9));
        S.prism({ poly: [[-0.7, 0.7], [0.7, 0.7], [0, -0.8]], y0: 0, y1: 0.4, c: [0, 2.6 + up * 1.4 * 0 - (1 - up) * 0 + Math.sin(up * Math.PI) * 0.8, 0], mat: MAT.emerald, emit: P.e100, emitK: 0.25 * up });
        S.line({ pts: [[-3, 0.15, 2.2], [-3 + 6 * seg(p, 0.55, 0.95), 0.15, 2.2]], color: P.e300, alpha: 0.9, w: 2, glow: true });
        S.line({ pts: [[-3, 0.15, 2.2], [3, 0.15, 2.2]], color: P.e700, alpha: 0.5, w: 1 });
        S.flush();
      } },
    { id: 'nps', title: 'NPS', sub: 'banded structure · 0–6 · 7–8 · 9–10',
      draw(ctx, S, t, c) {
        const p = cyc(t, 6);
        S.begin(); S.setCamera(cam(c[0], c[1] + 18, { pitch: 0.4, dist: 14, yaw: 0.35, ty: 1.2 }));
        S.box({ c: [0, 0.05, 0], s: [9.4, 0.1, 2.0], mat: MAT.steel });
        const band = Math.floor(seg(p, 0.45, 0.9) * 3);
        for (let i = 0; i <= 10; i++) {
          const k = E.out5(seg(p, i * 0.035, 0.3 + i * 0.035));
          const h = (0.3 + i * 0.24) * k, grp = i <= 6 ? 0 : i <= 8 ? 1 : 2;
          const lit = p > 0.45 && grp === Math.min(band, 2) && p < 0.95;
          S.box({ c: [(i - 5) * 0.84, h / 2 + 0.1, 0], s: [0.62, h + 0.001, 0.9], mat: [MAT.steel, MAT.bone, MAT.emerald][grp], emit: lit ? P.e100 : null, emitK: lit ? 0.35 : 0 });
        }
        S.flush();
      } },
    { id: 'dropdown', title: 'DROPDOWN · SECTION', sub: 'architectural expansion',
      draw(ctx, S, t, c) {
        const p = cyc(t, 6);
        S.begin(); S.setCamera(cam(c[0], c[1] + 4, { pitch: 0.55, dist: 12, ty: 1.4 }));
        const k = E.io3(seg(p, 0.1, 0.5)) * (1 - E.io3(seg(p, 0.78, 0.95)));
        S.box({ c: [0, 0.2, 0], s: [5.6, 0.4, 1.4], mat: MAT.bone });
        S.prism({ poly: [[-0.35, -0.2], [0.35, -0.2], [0, 0.25]], y0: 0.4, y1: 0.55, c: [2.2, 0, 0], rot: [0, 0, 0], mat: MAT.emerald });
        for (let i = 0; i < 4; i++) {
          const kk = clamp(k * 4 - i);
          S.box({ c: [0, 0.4 - (0.5 + i * 0.62) * kk, 0.0 + 0.0], s: [5.2, 0.5 * kk + 0.001, 1.2], mat: i === 2 ? MAT.emerald : MAT.bone2, alpha: kk < 0.98 ? Math.max(0.02, kk) : undefined, shadow: false });
        }
        S.flush();
      } },
  ];

  registerScene('components', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 4.3,
    scene: { fogNear: 40, fogFar: 90, fogMax: 0.2 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H);
      STUDIES.forEach((st, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const x = X0 + col * (TW + GX), y = Y0 + row * (TH + GY);
        const a = E.smooth(seg(t, 0.2 + i * 0.12, 0.8 + i * 0.12));
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, TW, TH); ctx.clip();
        ctx.globalAlpha = a;
        const g = ctx.createLinearGradient(x, y, x, y + TH); g.addColorStop(0, 'rgba(14,32,27,0.9)'); g.addColorStop(1, 'rgba(7,16,13,0.95)');
        ctx.fillStyle = g; ctx.fillRect(x, y, TW, TH);
        const cx = x + TW / 2, cy = y + TH / 2 - 8;
        st.draw(ctx, S, t + i * 0.7, [cx, cy]);
        ctx.restore();
        ctx.strokeStyle = css(P.e600, 0.55 * a); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, TW - 1, TH - 1);
        FS.text(ctx, String(i + 1).padStart(2, '0'), x + 14, y + 24, { size: 11, mono: true, color: css(P.e400), alpha: a, spacing: 2 });
        FS.text(ctx, st.title, x + 40, y + 24, { size: 14, mono: true, weight: 600, color: css(P.e100), alpha: a * 0.95, spacing: 2 });
        FS.text(ctx, st.sub, x + 14, y + TH - 14, { size: 13, mono: true, color: css(P.e300), alpha: a * 0.85, spacing: 1 });
      });
      KIT.loopFade(ctx, W, H, t, DUR);
      FS.vignette(ctx, W, H, 0.45);
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 03 — COMPONENTS OF POSSIBILITY', caption: 'SIX OF THE 23 VERIFIED QUESTION TYPES IN src/server.js · EACH A SEPARATE CONSTRUCTION' });
    },
  });
})();
