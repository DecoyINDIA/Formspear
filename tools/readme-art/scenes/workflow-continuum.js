/*
 * 09 — THE WORKFLOW CONTINUUM  (Level 4)
 * One camera move through the real product. Stages are the dashboard's own
 * "first insight path": Create from template -> Publish -> Collect response ->
 * Review insight. Every plane is a real screenshot or a crop of one.
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { bez, slicePoly, pointAt } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;

  const STAGES = [
    { n: '01', name: 'CREATE', img: 'builder', src: [0, 0, 1440, 900], u: 0.0112, pos: [-14, 0, 0], yaw: 0.28, note: 'Dashboard step: create from template · survey builder shown' },
    { n: '02', name: 'PUBLISH', img: 'builder', src: [1090, 100, 330, 76], u: 0.03, pos: [-1.5, 0.5, -7], yaw: 0.28, note: 'Public slug + Publish action' },
    { n: '03', name: 'COLLECT RESPONSE', img: 'phone', src: [0, 0, 390, 844], u: 0.0132, pos: [9.5, 0, -13], yaw: 0.28, note: 'Public respondent runtime on a phone' },
    { n: '04', name: 'REVIEW INSIGHT', img: 'dash', src: [0, 0, 1440, 900], u: 0.0112, pos: [24, 0, -19], yaw: 0.28, note: 'Operator dashboard' },
  ];

  const corners = (st) => {
    const w = st.src[2] * st.u, h = st.src[3] * st.u, c = st.pos, cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
    const P3 = (x, y) => [c[0] + x * cy, c[1] + y, c[2] - x * sy];
    return [P3(-w / 2, h / 2), P3(w / 2, h / 2), P3(w / 2, -h / 2), P3(-w / 2, -h / 2)].map((p) => [p[0], p[1] + h / 2 + 0.3, p[2]]);
  };
  const centres = STAGES.map((s) => [s.pos[0], s.src[3] * s.u * 0.5 + 0.3, s.pos[2]]);
  const flow = [];
  for (let i = 0; i < centres.length - 1; i++) {
    const a = [centres[i][0] + 3, 0.4, centres[i][2] + 1.5], b = [centres[i + 1][0] - 3, 0.4, centres[i + 1][2] + 1.5];
    flow.push(...bez(a, [a[0] + 4, 0.4, a[2] - 1], [b[0] - 4, 0.4, b[2] + 1], b, 18));
  }

  function camera(t) {
    // stage dwell times
    const at = [0.6, 3.6, 6.6, 9.4];
    const tgt = track(t, [[0, centres[0]], [at[0] + 1.5, centres[0]], [at[1], [centres[1][0], 1.6, centres[1][2]]], [at[1] + 1.6, [centres[1][0], 1.6, centres[1][2]]], [at[2], centres[2]], [at[2] + 1.6, centres[2]], [at[3], centres[3]], [12, centres[3]]], E.io5);
    return {
      target: tgt, yaw: track(t, [[0, 0.1], [3.6, 0.42], [6.6, 0.18], [9.4, 0.42], [12, 0.3]]), pitch: track(t, [[0, 0.2], [6, 0.24], [12, 0.18]]),
      dist: track(t, [[0, 23], [2, 19], [3.6, 12], [5.2, 17], [6.6, 20], [8.2, 22], [9.4, 20], [12, 24]]), fov: 0.62,
    };
  }

  registerScene('workflow-continuum', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 9.8,
    assets: { builder: '../../assets/readme/desktop-builder.png', phone: '../../assets/readme/mobile-public-survey.png', dash: '../../assets/readme/desktop-dashboard.png' },
    scene: { fogNear: 26, fogFar: 70, fogMax: 0.7 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H);
      S.setCamera(camera(t)); S.begin();
      // floor along the journey
      const gl = E.io3(seg(t, 0, 1.2));
      for (let i = -3; i <= 20; i++) S.groundLine([[i * 2 - 8, 0, 6], [i * 2 - 8 - 0, 0, -30]], P.e600, 0.16 * gl);
      for (let k = -6; k <= 4; k++) S.groundLine([[-20, 0, k * 4], [40, 0, k * 4]], P.e600, 0.12 * gl);
      // planes
      STAGES.forEach((st, i) => {
        const e = E.out5(seg(t, 0.1 + i * 0.5, 1.3 + i * 0.5));
        const lift = (1 - e) * 2;
        const [a, b, c, d] = corners(st).map((p) => [p[0], p[1] - lift, p[2]]);
        S.image({ img: S.img[st.img], src: st.src, corners: [a, b, c, d], alpha: e, nx: 10, ny: 6, frame: P.e400, frameA: 0.65 });
        // pedestal
        S.box({ c: [st.pos[0], 0.14, st.pos[2] - 0.01], s: [Math.abs(b[0] - a[0]) + 0.6, 0.12, 0.7], mat: { base: P.steel, amb: 0.5, dif: 0.5, fill: 0.2, rim: 0.2 }, alpha: undefined, shadow: false, rot: [0, st.yaw, 0] });
      });
      // the data path
      const fp = E.io3(seg(t, 0.8, 9.6));
      const sl = slicePoly(flow, 0, fp);
      if (sl.length > 1) S.line({ pts: sl, color: P.e300, alpha: 0.9, w: 2.2, glow: true, bias: -50 });
      for (let k = 0; k < 4; k++) S.dot({ c: pointAt(flow, ((t * 0.12 + k / 4) % 1) * fp), r: 0.1, color: P.e100, alpha: 0.9, bias: -60 });
      S.flush();

      // protected title column: dark scrim so type never fights the screenshots
      { const g = ctx.createLinearGradient(0, 0, 760, 0); g.addColorStop(0, 'rgba(6,16,13,0.94)'); g.addColorStop(0.7, 'rgba(6,16,13,0.8)'); g.addColorStop(1, 'rgba(6,16,13,0)'); ctx.fillStyle = g; ctx.fillRect(0, 60, 760, 160); }
      // stage titles: large kinetic typography
      const at = [0.6, 3.6, 6.6, 9.4];
      STAGES.forEach((st, i) => {
        const a = E.smooth(clamp(1.6 - Math.abs(camera(t).target[0] - centres[i][0]) / 4));
        if (a <= 0.01) return;
        const q = a;
        ctx.save(); ctx.beginPath(); ctx.rect(40, 80, 700, 90); ctx.clip();
        FS.text(ctx, st.n, 44, 112 + (1 - q) * 48, { size: 22, mono: true, color: css(P.e400), alpha: a, spacing: 4 });
        FS.text(ctx, st.name, 44, 156 + (1 - q) * 60, { size: 40, weight: 700, color: css(P.bone), alpha: a });
        ctx.restore();
        FS.text(ctx, st.note.toUpperCase(), 46, 186, { size: 11, mono: true, color: css(P.e100), alpha: a * 0.55 * q, spacing: 1.5 });
      });
      // progress ticks
      STAGES.forEach((st, i) => {
        const on = t >= at[i] - 0.2;
        const x = 44 + i * 64;
        ctx.fillStyle = css(on ? P.e400 : P.grid, on ? 1 : 0.8); ctx.fillRect(x, 640, 52, 3);
        FS.text(ctx, st.n, x, 660, { size: 10, mono: true, color: css(P.e100), alpha: on ? 0.9 : 0.35 });
      });
      KIT.loopFade(ctx, W, H, t, DUR);
      FS.vignette(ctx, W, H, 0.55);
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 07 — THE WORKFLOW CONTINUUM', caption: 'REAL INTERFACE CAPTURES, COMPOSED INTO ONE CAMERA PATH (COMPOSED PRODUCT TOUR)' });
    },
  });
})();
