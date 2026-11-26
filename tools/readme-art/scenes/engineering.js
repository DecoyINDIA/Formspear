/*
 * 10 — ENGINEERING BENEATH THE SURFACE  (Level 4)
 * Exploded architecture of the files and boundaries that exist in the repo
 * (public/, src/server.js, src/routes/*, src/lib/*, migrations/, optional
 * Redis/BullMQ, external providers referenced by the server).
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { MAT, bez, slicePoly, pointAt } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;

  // bottom -> top. [name, width, mat, hint]
  const LAYERS = [
    { id: 'ext', title: 'EXTERNAL PROVIDERS', note: 'reached over outbound HTTP/SMTP', items: [['SMTP', 1.4, 'bone2'], ['WhatsApp', 1.6, 'bone2'], ['Slack', 1.4, 'bone2'], ['Teams', 1.4, 'bone2'], ['Stripe', 1.4, 'bone2'], ['Razorpay', 1.7, 'bone2'], ['OpenAI', 1.5, 'bone2'], ['S3-compatible', 2.1, 'bone2']] },
    { id: 'jobs', title: 'JOBS', note: 'in-process queue · optional Redis / BullMQ', items: [['in-process jobs', 3.6, 'bone'], ['Redis · BullMQ (optional)', 3.6, 'bone2']] },
    { id: 'db', title: 'PERSISTENCE', note: 'JSON store in dev · PostgreSQL in production', items: [['JSON store (dev)', 3.0, 'bone2'], ['PostgreSQL (prod)', 3.4, 'emerald'], ['migrations 0001 · 0002', 3.6, 'bone']] },
    { id: 'lib', title: 'SHARED LIB  src/lib', note: '', items: [['client-ip', 2.0, 'bone'], ['features', 2.0, 'bone'], ['http-body', 2.0, 'bone'], ['outbound', 2.0, 'bone'], ['static-assets', 2.4, 'bone']] },
    { id: 'routes', title: 'ROUTES  src/routes', note: '', items: [['responses', 1.9, 'bone'], ['analytics', 1.9, 'bone'], ['ai-summary', 1.9, 'bone'], ['billing', 1.6, 'bone'], ['survey-lifecycle', 2.4, 'bone'], ['auth-credentials', 2.4, 'bone'], ['admin-readiness', 2.4, 'bone']] },
    { id: 'http', title: 'HTTP ROOT', note: 'node:http · no web framework', items: [['server.js', 4.2, 'emerald'], ['security.js', 2.4, 'bone'], ['production-config.js', 3.6, 'bone']] },
    { id: 'client', title: 'CLIENT EDGE  public/', note: '', items: [['survey.html · survey.js', 3.4, 'bone'], ['app.js (operator)', 3.2, 'bone'], ['embed.js', 1.8, 'bone'], ['sdk.js', 1.6, 'bone']] },
  ];
  const PATH = [['client', 0], ['http', 0], ['routes', 0], ['db', 1], ['jobs', 0], ['ext', 1]]; // verified flow, illustrative selection

  const GAP = 3.0;
  const layout = LAYERS.map((L, li) => {
    const total = L.items.reduce((a, b) => a + b[1] + 0.35, -0.35);
    let x = -total / 2;
    const mods = L.items.map(([name, w, mat], mi) => { const m = { name, w, mat, cx: x + w / 2, li, mi, t0: 2.2 + li * 0.28 + mi * 0.05 }; x += w + 0.35; return m; });
    return { ...L, li, mods, total };
  });

  function layerY(li, t) {
    const e = E.io3(seg(t, 0.9 + li * 0.08, 3.4 + li * 0.08));
    return 0.3 + li * lerp(0.7, GAP, e);
  }

  registerScene('engineering', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 8.0,
    scene: { fogNear: 34, fogFar: 90, fogMax: 0.5 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H);
      S.setCamera({ target: [0, 7.2, 0], yaw: track(t, [[0, 0.55], [6, 0.8], [12, 0.62]]), pitch: track(t, [[0, 0.32], [6, 0.38], [12, 0.34]]), dist: 46, fov: 0.6, shift: [-50, -6] });
      S.begin();
      KIT.floor(S, 0.2, t, 22, 1.6, 0.18);
      const active = (t - 5.2) / 0.95; // index into PATH being highlighted
      const centres = {};
      layout.forEach((L) => {
        const y = layerY(L.li, t);
        const pe = E.out5(seg(t, 0.4 + L.li * 0.1, 1.6 + L.li * 0.1));
        S.box({ c: [0, y - 0.12, 0], s: [L.total + 2.0, 0.14, 4.6], mat: { base: P.steel, amb: 0.5, dif: 0.5, fill: 0.2, rim: 0.2 }, alpha: 0.9 * pe, edge: P.e600, edgeA: 0.7, shadow: false });
        L.mods.forEach((m) => {
          const e = E.out5(seg(t, m.t0, m.t0 + 0.9)), hh = (L.id === 'http' && m.mi === 0 ? 1.2 : 0.7) * e;
          const hot = PATH.some(([id, k], pi) => id === L.id && k === m.mi && t > 5.2 + pi * 0.95 && t < 5.2 + pi * 0.95 + 2.0) ? 1 : 0;
          const mat = { ...MAT[m.mat] }; if (hot) mat.base = FS.mix3(mat.base, P.e300, 0.55);
          if (hh > 0.02) S.box({ c: [m.cx, y + hh / 2 + (1 - e) * 1.5, 0], s: [m.w, hh, 1.7], mat, emit: hot ? P.e100 : null, emitK: 0.3 * hot });
          centres[`${L.id}:${m.mi}`] = [m.cx, y + hh + 0.15, 0];
        });
      });
      // request path (client -> ... -> providers)
      const pts = PATH.map(([id, k]) => centres[`${id}:${k}`]).filter(Boolean);
      if (pts.length === PATH.length && t > 5.0) {
        const poly = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1], c1 = [a[0], a[1] - 0.2, 2.4], c2 = [b[0], b[1] + 0.2, 2.4];
          poly.push(...bez(a, c1, c2, b, 14));
        }
        const prog = clamp((t - 5.1) / (0.95 * (PATH.length - 1) + 0.6));
        const sl = slicePoly(poly, 0, E.io3(prog));
        if (sl.length > 1) S.line({ pts: sl, color: P.e300, alpha: 0.95, w: 2, glow: true, bias: -50 });
        S.dot({ c: pointAt(poly, E.io3(prog)), r: 0.18, color: P.e100, bias: -60 });
      }
      S.flush();
      // layer labels
      layout.forEach((L) => {
        const y = layerY(L.li, t);
        const p = S.project([-L.total / 2 - 1.2, y, 2.3]); if (!p) return;
        const a = E.smooth(seg(t, 2.2 + L.li * 0.28, 3.0 + L.li * 0.28)) * (1 - E.smooth(seg(t, 11.0, 11.6)));
        const hot = PATH.some(([id], pi) => id === L.id && t > 5.2 + pi * 0.95 && t < 5.2 + pi * 0.95 + 1.6);
        FS.text(ctx, L.title, p[0] - 14, p[1] + 4, { size: 13, mono: true, weight: 600, color: css(hot ? P.e300 : P.e100), alpha: a * (hot ? 1 : 0.7), align: 'right', spacing: 1.4 });
        if (L.note) if (L.li > 1) FS.text(ctx, L.note, p[0] - 14, p[1] + 20, { size: 11, mono: true, color: css(P.e100), alpha: a * 0.5, align: 'right', spacing: 0.6 });
        if (!hot) return;
        L.mods.forEach((m) => {
          const q = S.project([m.cx, y + 0.1, 0.95]); if (!q) return;
          FS.text(ctx, m.name, q[0], q[1] + 12, { size: 11, mono: true, color: css(P.e100), alpha: a * 0.85, align: 'center' });
        });
      });
      KIT.loopFade(ctx, W, H, t, DUR);
      FS.vignette(ctx, W, H, 0.55);
      const cap = t < 1 ? '01 THE SYSTEM, COLLAPSED' : t < 5.2 ? '02 EXPLODED — LAYERS AND MODULES THAT EXIST IN THE REPOSITORY' : '03 A REQUEST ACROSS THE BOUNDARIES [ILLUSTRATIVE PATH]';
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 08 — ENGINEERING BENEATH THE SURFACE', caption: cap });
    },
  });
})();
