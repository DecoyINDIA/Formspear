/*
 * 07 — THE WORKFLOW CONTINUUM  (Level 4)
 * One survey object travels one rail and changes state at each stage of the
 * dashboard's own "first insight path": Create from template -> Publish ->
 * Collect response -> Review insight. The object is never swapped: question
 * blocks assemble, compress into one sealed published slab (served under
 * /s/ — see src/server.js), fan out to devices, receive answers, and those
 * answers settle into banded insight. Response values are illustrative.
 */
(function () {
  const { E, P, css, lerp, seg, clamp, TAU, track } = FS;
  const { MAT, SPEC, draw, bez, slicePoly, pointAt } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;
  const X = [-14, -4.6, 4.6, 14];
  const ROWS = ['header', 'single_choice', 'nps', 'long_text', 'submit'];
  const SC = 1.25;

  const STAGES = [
    { n: '01', name: 'CREATE', note: 'question blocks assemble into a survey', at: 0.4 },
    { n: '02', name: 'PUBLISH', note: 'compressed into one sealed, public survey · /s/…', at: 3.2 },
    { n: '03', name: 'COLLECT RESPONSE', note: 'the same survey reaches each respondent', at: 6.0 },
    { n: '04', name: 'REVIEW INSIGHT', note: 'answers resolve into banded insight', at: 9.0 },
  ];
  // illustrative answers: device index + NPS band (0 detractor, 1 passive, 2 promoter)
  const ANSWERS = [[0, 2], [1, 1], [2, 2], [0, 0], [1, 2], [2, 1], [0, 2], [1, 0], [2, 2]];
  const BAND_MAT = ['steel', 'bone', 'emerald'];

  const slabX = (t) => track(t, [[0, X[0]], [3.0, X[0]], [4.6, X[1]], [5.9, X[1]], [7.0, X[2]], [9.0, X[2]], [10.2, X[3]], [12, X[3]]], E.io5);
  const camX = (t) => track(t, [[0, X[0] + 1.2], [2.7, X[0] + 1.2], [4.7, X[1] + 0.8], [5.7, X[1] + 0.8], [7.1, X[2] + 0.6], [8.8, X[2] + 0.6], [10.3, X[3]], [12, X[3] + 1.2]], E.io5);

  registerScene('workflow-continuum', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 10.9,
    scene: { fogNear: 22, fogFar: 62, fogMax: 0.75 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H, { glow: 0.28 });
      S.setCamera({ target: [camX(t), 1.2, 0], yaw: 0.5 + 0.08 * Math.sin((t / DUR) * TAU), pitch: 0.44, dist: 19, fov: 0.62, shift: [90, 40] });
      S.begin();
      // the rail: one continuous line through every stage
      for (let i = -30; i <= 30; i++) S.groundLine([[i * 1.2, 0, -5], [i * 1.2, 0, 5]], P.e600, 0.08);
      S.groundLine([[-30, 0.01, 3.6], [30, 0.01, 3.6]], P.e500, 0.5, 1.5);
      const lit = slabX(t);
      S.line({ pts: [[-30, 0.02, 3.6], [lit, 0.02, 3.6]], color: P.e300, alpha: 0.85, w: 2, glow: true, bias: -40 });
      X.forEach((x, i) => {
        const on = lit >= x - 0.1;
        S.groundLine(Array.from({ length: 33 }, (_, k) => [x + Math.cos((k / 32) * TAU) * 0.35, 0.02, 3.6 + Math.sin((k / 32) * TAU) * 0.35]), on ? P.e300 : P.e700, on ? 0.9 : 0.5, 1.5);
      });

      const sx = slabX(t);
      const press = E.io3(seg(t, 3.5, 4.4)), seal = E.out5(seg(t, 4.3, 5.0));
      const plate = E.out5(seg(t, 0.1, 0.7));
      // base plate (the survey itself)
      S.box({ c: [sx, 0.12, 0], s: [5.0 * plate + 0.001, 0.24, lerp(7.2, 3.2, press) * plate + 0.001], mat: MAT.dark, edge: seal > 0 ? P.e300 : P.e600, edgeA: 0.5 + 0.5 * seal });

      // CREATE: rows fly in and dock; PUBLISH: they compress into one slab
      ROWS.forEach((id, i) => {
        const e = E.out5(seg(t, 0.4 + i * 0.32, 1.4 + i * 0.32));
        if (e <= 0) return;
        const from = [X[0] + (i % 2 ? 7 : -7), 6 + i * 0.6, -5 + i];
        const slotZ = lerp(-2.8 + i * 1.4, -1.2 + i * 0.6, press);
        const pos = [lerp(from[0], sx, e), lerp(from[1], 0.24, e) + Math.sin(Math.PI * e) * 1.6, lerp(from[2], slotZ, e)];
        const sy = lerp(SC, 0.35, press), sz = lerp(SC * 0.9, 0.42, press);
        const al = 1 - seal;
        if (al > 0.02) draw(S, SPEC[id](), { pos, scale: [SC, sy, sz], rot: [0, (1 - e) * 1.4 * (i % 2 ? 1 : -1), 0], alpha: al < 0.98 ? al : undefined, emit: P.e100, emitK: 0.2 * (1 - e) });
      });
      // sealed slab = the published survey
      if (seal > 0) {
        const after = t > 9.9 ? E.io3(seg(t, 10.0, 10.6)) : 0;
        S.box({ c: [sx, 0.24 + 0.35 * seal, 0], s: [4.6, 0.7 * seal * (1 - 0.6 * after) + 0.001, 3.0], mat: { ...MAT.emerald }, emit: P.e100, emitK: 0.25 * (1 - seg(t, 5.0, 6.0)) });
        S.box({ c: [sx + 1.4, 0.24 + 0.72 * seal * (1 - 0.6 * after), -0.8], s: [1.2, 0.08, 0.5], mat: MAT.paper, alpha: seal < 0.98 ? seal : undefined });
      }
      // publish gate: a ring the survey passes through
      const gate = E.io3(seg(t, 2.8, 3.6)) * (1 - E.io3(seg(t, 5.6, 6.3)));
      if (gate > 0.01) {
        const pass = Math.exp(-Math.pow((sx - (X[1] - 1.6)) / 1.2, 2));
        const ring = Array.from({ length: 49 }, (_, k) => [X[1] - 1.6, 2.2 + Math.sin((k / 48) * TAU) * 2.6 * gate, Math.cos((k / 48) * TAU) * 2.6 * gate]);
        S.line({ pts: ring, color: P.e300, alpha: 0.5 + 0.5 * pass, w: 1.6 + 2 * pass, glow: true });
      }

      // COLLECT: three respondent devices; links out, answers back
      const dev = [-2.8, 0.6, 4.0].map((dx, i) => [X[2] + dx, 0, -4.4 - (i === 1 ? 0.6 : 0)]);
      const devIn = E.out5(seg(t, 5.8, 6.8)) * (1 - E.io3(seg(t, 9.3, 10.1)));
      dev.forEach((d, i) => {
        if (devIn <= 0.01) return;
        S.box({ c: [d[0], 1.6 * devIn, d[2]], s: [1.5, 3.0 * devIn, 0.2], mat: MAT.dark, edge: P.e400, edgeA: 0.7 });
        S.box({ c: [d[0], 1.6 * devIn, d[2] + 0.12], s: [1.25, 2.6 * devIn, 0.04], mat: MAT.paper, alpha: 0.9 });
        const link = E.io3(seg(t, 6.6 + i * 0.12, 7.3 + i * 0.12)) * (1 - E.io3(seg(t, 9.0, 9.6)));
        if (link > 0) {
          const pts = bez([sx, 1.0, 0], [lerp(sx, d[0], 0.3), 3.5, -1], [d[0], 3.5, d[2] + 1], [d[0], 2.2, d[2] + 0.3], 18);
          S.line({ pts: slicePoly(pts, 0, link), color: P.e300, alpha: 0.6, w: 1.2, glow: true });
        }
      });
      // answers: fly from device to the slab, then settle into banded insight
      const counts = [0, 0, 0];
      ANSWERS.forEach(([di, band], k) => {
        const t0 = 7.2 + k * 0.17, fly = E.io3(seg(t, t0, t0 + 0.8));
        if (fly <= 0) return;
        const d = dev[di], slot = counts[band]++;
        const onSlab = [sx + (k % 3 - 1) * 1.1, 1.0, (Math.floor(k / 3) - 1) * 0.8];
        const bar = [sx + (band - 1) * 1.25, 0.45 + slot * 0.62, 0.2];
        const arrive = [lerp(d[0], onSlab[0], fly), lerp(2.2, onSlab[1], fly) + Math.sin(Math.PI * fly) * 1.6, lerp(d[2] + 0.4, onSlab[2], fly)];
        const settle = E.io3(seg(t, 10.0 + band * 0.12 + slot * 0.05, 10.8 + band * 0.12 + slot * 0.05));
        const out = 1 - E.io3(seg(t, 11.5, 12));
        const pos = settle > 0 ? [lerp(onSlab[0], bar[0], settle), lerp(onSlab[1], bar[1], settle) + Math.sin(Math.PI * settle) * 0.8, lerp(onSlab[2], bar[2], settle)] : arrive;
        const s = lerp(0.42, 1.0, settle) * out;
        if (s > 0.02) S.box({ c: pos, s: [s, lerp(0.42, 0.56, settle) * out, s], mat: MAT[settle > 0.5 ? BAND_MAT[band] : 'mint'], emit: P.e100, emitK: fly < 1 ? 0.3 : 0 });
      });
      S.flush();

      // band labels in REVIEW
      const lab = E.smooth(seg(t, 10.6, 11.0)) * (1 - E.smooth(seg(t, 11.5, 11.9)));
      if (lab > 0.01) ['0–6', '7–8', '9–10'].forEach((txt, b) => {
        const p = S.project([sx + (b - 1) * 1.25, 0.05, 1.6]); if (!p) return;
        FS.text(ctx, txt, p[0], p[1] + 16, { size: 13, mono: true, color: css(P.e100), alpha: lab * 0.85, align: 'center' });
      });
      // the public path tag in PUBLISH
      const pt = E.smooth(seg(t, 4.8, 5.2)) * (1 - E.smooth(seg(t, 6.6, 7.0)));
      if (pt > 0.01) KIT.tag(ctx, S, [sx + 2.3, 0.95, 0], 'GET /s/<slug>', { dx: 70, dy: -60, alpha: pt, progress: pt, size: 13 });

      // stage titles
      const cur = STAGES.reduce((k, s, i) => (t >= s.at - 0.3 ? i : k), 0);
      STAGES.forEach((st, i) => {
        const next = STAGES[i + 1] ? STAGES[i + 1].at - 0.3 : DUR + 1;
        const a = E.out5(seg(t, st.at - 0.3, st.at + 0.4)) * (1 - E.io3(seg(t, next - 0.35, next)));
        if (a <= 0.01) return;
        ctx.save(); ctx.beginPath(); ctx.rect(56, 120, 640, 70); ctx.clip();
        FS.text(ctx, st.name, 62, 176 + (1 - a) * 60, { size: 46, weight: 700, color: css(P.bone), alpha: a });
        ctx.restore();
        FS.text(ctx, st.n + ' / 04', 64, 116, { size: 13, mono: true, color: css(P.e400), alpha: a, spacing: 3 });
        FS.text(ctx, st.note, 64, 214, { size: 14, mono: true, color: css(P.e100), alpha: a * 0.7 });
      });
      // stage rail index
      STAGES.forEach((st, i) => {
        const on = i <= cur, x = 64 + i * 150;
        ctx.fillStyle = css(on ? P.e400 : P.grid, on ? 1 : 0.9); ctx.fillRect(x, 622, 136, 2);
        FS.text(ctx, `${st.n} ${st.name}`, x, 642, { size: 11, mono: true, color: css(i === cur ? P.bone : P.e100), alpha: on ? 0.95 : 0.35, spacing: 1 });
      });
      KIT.loopFade(ctx, W, H, t, DUR, 0.4, 0.5);
      FS.vignette(ctx, W, H, 0.5);
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 07 — THE WORKFLOW CONTINUUM', caption: "THE DASHBOARD'S FIRST INSIGHT PATH · ONE OBJECT, FOUR STATES · ANSWERS ILLUSTRATIVE" });
    },
  });
})();
