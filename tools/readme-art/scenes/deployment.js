/*
 * 14 — DEPLOYMENT AND AVAILABILITY  (Level 4)
 * Only paths the repository documents: local (`npm install && npm start`,
 * http://localhost:4173), Railway (railway.json + Procfile, health check
 * /api/health, numReplicas 1) and any Node >= 20 host, where production
 * requires PostgreSQL (docs/ARCHITECTURE.md). There is no Dockerfile in this
 * repository, so none is shown.
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { MAT, ngon } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;

  const ENV = [
    { x: -13, title: 'LOCAL', sub: 'development', cmds: ['git clone', '  github.com/DecoyINDIA/Formspear', 'npm install · npm start', '→ http://localhost:4173'], blocks: ['server.js'], t0: 1.4, kind: 'local' },
    { x: 0, title: 'RAILWAY', sub: 'railway.json · Procfile', cmds: ['builder: NIXPACKS', 'web: node src/server.js', 'healthcheck: /api/health', 'numReplicas: 1'], blocks: ['public', 'server.js', 'PostgreSQL'], t0: 3.0, kind: 'railway' },
    { x: 13, title: 'ANY NODE ≥ 20 HOST', sub: 'self-managed', cmds: ['node src/server.js', 'DATABASE_URL → PostgreSQL', 'production config verified', 'at boot (fail-closed)'], blocks: ['server.js', 'PostgreSQL'], t0: 4.6, kind: 'host' },
  ];
  const BM = [MAT.bone, MAT.emerald, MAT.bone2];

  function typed(ctx, lines, x, y, t0, t, o = {}) {
    const cps = 90; let tt = Math.max(0, (t - t0) * cps);
    lines.forEach((ln, i) => {
      const n = Math.min(ln.length, Math.floor(tt)); tt = Math.max(0, tt - ln.length - 3);
      if (n <= 0) return;
      FS.text(ctx, (ln.startsWith('→') ? '' : '') + ln.slice(0, n), x, y + i * 21, { size: 15, mono: true, color: css(ln.startsWith('→') ? P.e300 : P.e100), alpha: (o.alpha ?? 1) * 0.9 });
    });
  }

  registerScene('deployment', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 9.4,
    scene: { fogNear: 30, fogFar: 80, fogMax: 0.5 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H);
      S.setCamera({ target: [0, 1.5, 0], yaw: track(t, [[0, 0.2], [12, -0.12]]), pitch: 0.58, dist: 46, fov: 0.6, shift: [0, -70] });
      S.begin();
      KIT.floor(S, 0.1, t, 26, 1.6, 0.14);
      ENV.forEach((e, ei) => {
        const pe = E.out5(seg(t, e.t0 - 0.8, e.t0 + 0.4));
        S.box({ c: [e.x, -0.1 + (1 - pe) * -2, 0], s: [10.5, 0.3, 7.5], mat: { base: P.steel, amb: 0.5, dif: 0.5, fill: 0.2, rim: 0.2 }, edge: P.e500, edgeA: 0.8 * pe, alpha: pe < 0.99 ? pe : undefined });
        // architecture assembles in this environment
        e.blocks.forEach((b, bi) => {
          const bt = e.t0 + 0.5 + bi * 0.6, k = E.out5(seg(t, bt, bt + 0.8)), drop = (1 - k) * 6;
          const w = e.blocks.length === 1 ? 5.0 : (bi === 1 ? 7.4 : 6.4), y = 0.25 + bi * 1.15;
          const bounce = k >= 1 ? Math.exp(-(t - bt - 0.8) * 6) * Math.sin((t - bt - 0.8) * 22) * 0.06 : 0;
          if (k > 0.01) S.box({ c: [e.x, y + 0.45 + drop + bounce, 0], s: [w, 0.9, 4.2 - bi * 0.5], mat: BM[bi], shadow: true });
        });
        // per-environment signature geometry
        if (e.kind === 'railway') {
          const k2 = E.smooth(seg(t, e.t0 + 2.2, e.t0 + 3.0));
          const ring = (r0) => Array.from({ length: 49 }, (_, i) => [e.x + Math.cos((i / 48) * TAU) * r0, 0.5, Math.sin((i / 48) * TAU) * r0 * 0.7 + 2.6]);
          const q = ((t - e.t0) * 0.5) % 1;
          S.line({ pts: ring(1 + q * 3.2), color: P.e300, alpha: (1 - q) * 0.7 * k2, w: 1.4, glow: true });
          S.box({ c: [e.x + 4.4, 0.5, 2.6], s: [0.9, 0.7, 0.9], mat: MAT.mint, alpha: undefined });
        }
        if (e.kind === 'host' || e.kind === 'railway') {
          const k3 = E.out5(seg(t, e.t0 + 1.6, e.t0 + 2.4));
          if (e.kind === 'host') S.prism({ poly: ngon(20, 1.5), y0: 0, y1: 1.6 * k3, c: [e.x + 3.2, 0, -1.0], mat: MAT.deep });
        }
        // beacon: environment is live
        const live = E.smooth(seg(t, e.t0 + 2.6, e.t0 + 3.2));
        if (live > 0) {
          S.line({ pts: [[e.x, 3.9, 0], [e.x, 6.2, 0]], color: P.e300, alpha: 0.7 * live, w: 1.4, glow: true });
          S.dot({ c: [e.x, 6.4 + Math.sin(t * 3 + ei) * 0.1, 0], r: 0.22, color: P.e100, alpha: live });
        }
      });
      S.flush();
      ENV.forEach((e) => {
        const p = S.project([e.x - 5, 0, 3.9]); if (!p) return;
        const a = E.smooth(seg(t, e.t0, e.t0 + 0.7)) * (1 - E.smooth(seg(t, 11.0, 11.6)));
        FS.text(ctx, e.title, p[0], p[1] + 46, { size: 20, weight: 700, color: css(P.bone), alpha: a });
        FS.text(ctx, e.sub.toUpperCase(), p[0], p[1] + 66, { size: 12, mono: true, color: css(P.e300), alpha: a * 0.85, spacing: 1.8 });
        typed(ctx, e.cmds, p[0], p[1] + 96, e.t0 + 1.2, t, { alpha: a });
      });
      KIT.loopFade(ctx, W, H, t, DUR);
      FS.vignette(ctx, W, H, 0.55);
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 12 — DEPLOYMENT AND AVAILABILITY', caption: 'DOCUMENTED PATHS ONLY · SEE docs/DEPLOYMENT.md' });
    },
  });
})();
