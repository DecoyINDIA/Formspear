/*
 * 03 — COMPONENTS OF POSSIBILITY  (Level 4)
 * One pool of 36 modules continuously reconfigures itself into seven of the
 * 23 question types declared in QUESTION_TYPES (src/server.js). Every
 * transition is a physical rearrangement of the same blocks: nothing cuts,
 * nothing is swapped. The last form morphs back into the first, so the loop
 * is seamless. The 23-type index on the right is the real list, in order.
 */
(function () {
  const { E, P, css, lerp, seg, clamp, TAU, mix3 } = FS;
  const { MAT } = KIT;
  const W = 1280, H = 720, FPS = 24, SLOT = 2.0;
  const N = 36;

  const TYPES = ['short_text', 'long_text', 'email', 'phone', 'url', 'number', 'single_choice', 'multiple_choice', 'dropdown', 'yes_no', 'rating', 'nps', 'csat', 'ces', 'star_rating', 'emoji_rating', 'date', 'time', 'consent', 'hidden', 'section', 'statement', 'file_upload'];
  const b = (c, s, m = 'bone', rot) => ({ c, s, m, rot });

  // Each form: u in [0,1] is its own micro-interaction during the hold.
  const FORMS = [
    { id: 'short_text', title: 'SHORT TEXT', line: 'a field, a caret, characters set as solid type', f(u) {
      const word = 'Ada Lovelace', out = [b([0, 0.15, 0], [8.6, 0.3, 1.8], 'bone2')];
      const typed = clamp(u * 1.25) * word.length;
      for (let i = 0; i < word.length; i++) {
        if (word[i] === ' ') continue;
        const k = E.out5(clamp(typed - i)), up = word[i] === word[i].toUpperCase();
        const h = (0.35 + (up ? 0.7 : 0) + ((word.charCodeAt(i) * 7) % 5) * 0.1) * k;
        if (k > 0) out.push(b([-3.7 + i * 0.66, 0.3 + h / 2, 0], [0.48, h, 0.6], i === 0 || i === 4 ? 'emerald' : 'bone'));
      }
      const cx = -3.7 + Math.min(typed, word.length) * 0.66 - 0.2;
      out.push(b([cx, 0.75, 0], [0.12, 0.9, 0.6], 'emerald'));
      return out;
    } },
    { id: 'single_choice', title: 'SINGLE CHOICE', line: 'three options, one selection that travels', f(u) {
      const out = [], sel = E.io5(seg(u, 0.15, 0.45)) + E.io5(seg(u, 0.6, 0.9));
      for (let r = 0; r < 3; r++) {
        const z = -2.2 + r * 2.2;
        out.push(b([-3.0, 0.12, z], [1.4, 0.24, 1.4], 'bone'));
        out.push(b([1.0, 0.08, z], [5.0, 0.16, 0.5], 'steel'));
      }
      out.push(b([-3.0, 0.5 + Math.sin(Math.PI * (sel % 1)) * 0.8, -2.2 + sel * 2.2], [0.7, 0.55, 0.7], 'emerald'));
      return out;
    } },
    { id: 'multiple_choice', title: 'MULTIPLE CHOICE', line: 'independent boxes, each checked on its own beat', f(u) {
      const out = [], on = [seg(u, 0.1, 0.3), 0, seg(u, 0.35, 0.55), seg(u, 0.6, 0.8)];
      for (let r = 0; r < 4; r++) {
        const z = -2.7 + r * 1.8, k = E.out5(on[r]);
        out.push(b([-3.0, 0.12, z], [1.2, 0.24, 1.2], 'bone2'));
        out.push(b([1.0, 0.08, z], [5.0, 0.16, 0.45], 'steel'));
        out.push(b([-3.0, 0.24 + 0.4 * k, z], [0.8 * k + 0.001, 0.8 * k + 0.001, 0.8 * k + 0.001], 'emerald'));
      }
      return out;
    } },
    { id: 'date', title: 'DATE', line: 'a month as a field of cells; a wave finds the day', f(u) {
      const out = [b([0, 0.1, -3.4], [7.4, 0.2, 0.6], 'emerald')], pick = 9 + Math.floor(u * 3.99) * 6;
      for (let d = 0; d < 35; d++) {
        const r = Math.floor(d / 7), c = d % 7, dist = Math.hypot(c - 3, r - 2);
        const wave = Math.max(0, Math.sin(u * 9 - dist * 1.1)) * 0.6, hit = d === pick;
        const h = 0.2 + (hit ? 1.2 : wave);
        out.push(b([(c - 3) * 1.05, h / 2, (r - 2) * 1.05 - 0.4], [0.86, h, 0.86], hit ? 'emerald' : c >= 5 ? 'bone2' : 'bone'));
      }
      return out;
    } },
    { id: 'nps', title: 'NPS', line: 'eleven steps, three bands: 0–6 · 7–8 · 9–10', f(u) {
      const out = [b([0, 0.06, 0], [9.2, 0.12, 2.0], 'dark')], pick = Math.round(lerp(2, 9, E.io3(seg(u, 0.1, 0.85))));
      for (let i = 0; i <= 10; i++) {
        const h = 0.35 + i * 0.26 + (i === pick ? 0.7 : 0);
        out.push(b([(i - 5) * 0.8, 0.12 + h / 2, 0], [0.6, h, 1.1], i === pick ? 'mint' : i <= 6 ? 'steel' : i <= 8 ? 'bone' : 'emerald'));
      }
      return out;
    } },
    { id: 'file_upload', title: 'FILE UPLOAD', line: 'layers assemble; an arrow lifts; the bar fills', f(u) {
      const out = [], mats = ['steel', 'bone2', 'bone', 'mint'];
      for (let i = 0; i < 4; i++) { const k = E.out5(seg(u, i * 0.08, 0.3 + i * 0.08)); out.push(b([(1 - k) * (i % 2 ? 4 : -4), 0.15 + i * 0.36, -0.4], [6.0, 0.24, 3.8], mats[i])); }
      const up = E.io3(seg(u, 0.35, 0.75)), y = 1.9 + up * 1.6;
      out.push(b([0, y, -0.4], [0.5, 1.4, 0.5], 'emerald'));
      out.push(b([-0.42, y + 0.65, -0.4], [1.3, 0.4, 0.5], 'emerald', [0, 0, 0.7]));
      out.push(b([0.42, y + 0.65, -0.4], [1.3, 0.4, 0.5], 'emerald', [0, 0, -0.7]));
      out.push(b([0, 0.06, 2.6], [6.0, 0.12, 0.3], 'dark'));
      const fill = E.io3(seg(u, 0.35, 0.95)) * 6.0;
      out.push(b([-3 + fill / 2, 0.14, 2.6], [fill + 0.001, 0.2, 0.34], 'mint'));
      return out;
    } },
    { id: 'dropdown', title: 'DROPDOWN', line: 'a closed bar unfolds into its options', f(u) {
      const out = [b([0, 0.25, -2.8], [7.0, 0.5, 1.3], 'bone'), b([2.9, 0.6, -2.8], [0.5, 0.25, 0.5], 'emerald', [0, 0.785, 0])];
      const open = E.io3(seg(u, 0.05, 0.4)) * (1 - E.io3(seg(u, 0.82, 1.0)));
      for (let i = 0; i < 4; i++) {
        const k = clamp(open * 4.2 - i), sel = i === 2 && u > 0.5;
        out.push(b([0, 0.15 + (1 - k) * 0.2, -2.8 + (1.35 + i * 1.3) * k], [6.6, 0.3, 1.1 * k + 0.001], sel ? 'emerald' : 'bone2'));
      }
      return out;
    } },
  ];
  const DUR = FORMS.length * SLOT;
  const pad = (arr) => Array.from({ length: N }, (_, i) => arr[i] || null);
  const ZERO = (e) => ({ c: [e.c[0], e.c[1] - 0.4, e.c[2]], s: [0.001, 0.001, 0.001], m: e.m, rot: e.rot });

  function state(t) {
    const k = Math.floor(t / SLOT) % FORMS.length, local = t - k * SLOT;
    const prev = (k + FORMS.length - 1) % FORMS.length;
    const A = pad(FORMS[prev].f(1)), Bf = pad(FORMS[k].f(seg(local, 0.55, SLOT)));
    return { k, local, mods: A.map((a, i) => {
      const bb = Bf[i];
      if (!a && !bb) return null;
      const e = E.io3(seg(local, 0.02 + i * 0.011, 0.6 + i * 0.011));
      const from = a || ZERO(bb), to = bb || ZERO(a);
      const lift = Math.sin(Math.PI * e) * (0.6 + (i % 5) * 0.25);
      const ra = from.rot || [0, 0, 0], rb = to.rot || [0, 0, 0];
      return {
        c: [lerp(from.c[0], to.c[0], e), lerp(from.c[1], to.c[1], e) + lift, lerp(from.c[2], to.c[2], e)],
        s: from.s.map((x, j) => lerp(x, to.s[j], e)), rot: ra.map((x, j) => lerp(x, rb[j], e)),
        base: mix3(MAT[from.m].base, MAT[to.m].base, e), m: to.m, moving: e > 0 && e < 1,
      };
    }) };
  }

  registerScene('components', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 2 * SLOT + 1.6,
    scene: { fogNear: 30, fogFar: 80, fogMax: 0.4 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H, { glow: 0.3 });
      const ph = (t / DUR) * TAU;
      S.setCamera({ target: [0, 0.6, 0], yaw: 0.62 + 0.22 * Math.sin(ph), pitch: 0.6 + 0.05 * Math.sin(ph * 2), dist: 23, fov: 0.58, shift: [10, 46] });
      S.begin();
      KIT.floor(S, -2, t + 2, 14, 1.05, 0.12);
      const st = state(t);
      st.mods.forEach((m) => {
        if (!m || Math.max(...m.s) < 0.02) return;
        const mat = { ...MAT[m.m], base: m.base };
        S.box({ c: m.c, s: m.s, rot: m.rot, mat, emit: m.moving ? P.e100 : null, emitK: m.moving ? 0.12 : 0 });
      });
      S.flush();

      // left: the current type, set large
      const F = FORMS[st.k], inA = E.out5(seg(st.local, 0.15, 0.75)), outA = 1 - E.io3(seg(st.local, SLOT - 0.3, SLOT));
      const a = inA * outA;
      FS.text(ctx, `${String(st.k + 1).padStart(2, '0')} / ${String(FORMS.length).padStart(2, '0')}`, 64, 150, { size: 13, mono: true, color: css(P.e400), alpha: a, spacing: 3 });
      ctx.save(); ctx.beginPath(); ctx.rect(56, 160, 560, 64); ctx.clip();
      FS.text(ctx, F.title, 62, 210 + (1 - inA) * 56, { size: 46, weight: 700, color: css(P.bone), alpha: outA, spacing: 1 });
      ctx.restore();
      FS.text(ctx, F.id, 64, 248, { size: 15, mono: true, color: css(P.e300), alpha: a });
      FS.text(ctx, F.line, 64, 274, { size: 13, mono: true, color: css(P.e100), alpha: a * 0.6 });

      // right: the real 23-type index, in declaration order
      const x0 = 1066, y0 = 112, lh = 21;
      FS.text(ctx, 'QUESTION_TYPES', x0, y0 - 18, { size: 11, mono: true, color: css(P.e300), alpha: 0.8, spacing: 2 });
      TYPES.forEach((id, i) => {
        const fi = FORMS.findIndex((f) => f.id === id), cur = fi === st.k, shown = fi >= 0;
        const y = y0 + 8 + i * lh;
        if (cur) { ctx.fillStyle = css(P.e400, 0.9 * a + 0.1); ctx.fillRect(x0 - 12, y - 10, 3, 13); }
        FS.text(ctx, id, x0, y, { size: 12, mono: true, color: css(cur ? P.bone : shown ? P.e300 : P.e100), alpha: cur ? 1 : shown ? 0.7 : 0.32 });
      });
      FS.text(ctx, '23 declared · 7 shown', x0, y0 + 8 + 23 * lh + 6, { size: 11, mono: true, color: css(P.e100), alpha: 0.5, spacing: 1 });

      // slot ticks
      FORMS.forEach((f, i) => {
        const on = i === st.k, x = 64 + i * 46;
        ctx.fillStyle = css(on ? P.e400 : P.grid, on ? 1 : 0.9); ctx.fillRect(x, 612, 36, 3);
        if (on) { ctx.fillStyle = css(P.e100, 0.9); ctx.fillRect(x, 612, 36 * clamp(st.local / SLOT), 3); }
      });
      FS.vignette(ctx, W, H, 0.45);
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 03 — COMPONENTS OF POSSIBILITY', caption: 'ONE POOL OF 36 MODULES REBUILDS ITSELF INTO EACH TYPE · SEAMLESS LOOP' });
    },
  });
})();
