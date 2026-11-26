/*
 * 08 — PRECISION BY DESIGN  (Level 4)
 * An imperfect structure resolves to alignment. The four rules listed are
 * real checks in src/server.js (validateAnswers on submit; publish validation
 * messages: choice questions need two options, skip logic must point to a
 * later question, circular logic paths are blocked). The deviation numbers
 * are illustrative geometry, not measurements.
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { MAT, B, bez, slicePoly } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;
  const R = FS.rng(808);

  const N = 9;
  const bars = Array.from({ length: N }, (_, i) => ({
    i, w: 7.0 + (i % 3) * 0.0, y: (N - 1 - i) * 1.05 + 0.4,
    dx: R.range(-2.6, 2.6), dz: R.range(-1.8, 1.8), ry: R.range(-0.5, 0.5), rz: R.range(-0.12, 0.12), dw: R.range(-1.4, 1.4),
    t0: 3.6 + i * 0.28,
  }));
  const CHECKS = [
    ['Required answers are validated on submit', 3.0],
    ['Choice questions need at least two options', 5.0],
    ['Skip logic must point to a later question', 7.0],
    ['Circular logic paths are blocked', 9.0],
  ];

  registerScene('precision', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 10.2,
    scene: { fogNear: 28, fogFar: 80, fogMax: 0.5 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H);
      S.setCamera({ target: [-3, 4.6, 0], yaw: track(t, [[0, 0.7], [6, 0.35], [12, 0.15]]), pitch: track(t, [[0, 0.4], [12, 0.26]]), dist: 30, fov: 0.6, shift: [-190, 0] });
      S.begin();
      KIT.floor(S, 0.0, t, 18, 1.0, 0.2);
      const meas = E.io3(seg(t, 1.2, 3.4));
      // reference grid column lines (the constraint)
      for (const x of [-3.5, 3.5]) S.line({ pts: [[x, 0, 0], [x, 10.5 * meas, 0]], color: P.e500, alpha: 0.5, w: 1, dash: [6, 6] });
      let dev0 = 0, dev1 = 0;
      bars.forEach((b) => {
        const e = E.io3(seg(t, b.t0, b.t0 + 1.0));
        const k = 1 - E.settle(clamp((t - b.t0) / 1.0)); // residual after snap
        const sx = lerp(b.dx, 0, e), sz = lerp(b.dz, 0, e), ry = lerp(b.ry, 0, e), rz = lerp(b.rz, 0, e), w = lerp(7 + b.dw, 7, e);
        const dev = Math.hypot(sx, sz) + Math.abs(ry) * 3;
        dev0 += Math.hypot(b.dx, b.dz) + Math.abs(b.ry) * 3; dev1 += dev;
        const snapped = e >= 1;
        const mat = { ...MAT[b.i === 6 ? 'emerald' : b.i % 2 ? 'bone' : 'bone2'] }; if (snapped) mat.base = FS.mix3(mat.base, P.e300, 0.12);
        const a = E.smooth(seg(t, 0.3 + b.i * 0.08, 1.2 + b.i * 0.08));
        S.box({ c: [sx, b.y, sz], s: [w, 0.5, 1.5], rot: [0, ry, rz], mat, alpha: a < 0.99 ? a : undefined, emit: P.e100, emitK: snapped ? 0.25 * (1 - clamp((t - b.t0 - 1.0) * 2)) : 0 });
        // measurement dimension line: deviation from the constraint
        if (meas > 0.02 && !snapped) {
          const m = [sx - w / 2, b.y + 0.4, sz + 0.9];
          S.line({ pts: [[-3.5, b.y + 0.4, 0.9], m], color: P.amber, alpha: 0.65 * meas, w: 1, bias: -20 });
          S.dot({ c: m, r: 0.07, color: P.amber, alpha: 0.9 * meas });
        }
        if (snapped && t - b.t0 - 1.0 < 0.5) {
          const q = (t - b.t0 - 1.0) / 0.5;
          S.line({ pts: [[-w / 2 - 0.4, b.y + 0.4, 0.95], [w / 2 + 0.4, b.y + 0.4, 0.95]], color: P.e300, alpha: 1 - q, w: 1.6, glow: true, bias: -20 });
        }
      });
      // forward-only arrows alongside (skip logic must point later)
      const fo = E.io3(seg(t, 7.0, 8.6));
      if (fo > 0) {
        const pts = bez([5.2, bars[2].y, 0], [7.4, bars[2].y - 0.4, 0], [7.4, bars[5].y + 0.4, 0], [5.2, bars[5].y, 0], 20);
        S.line({ pts: slicePoly(pts, 0, fo), color: P.e300, alpha: 0.95, w: 2, glow: true });
      }
      S.flush();

      // right-hand ledger: rules + live deviation readout
      const x0 = 706;
      FS.text(ctx, 'CONSTRAINTS', x0, 160, { size: 12, mono: true, color: css(P.e300), alpha: 0.9, spacing: 3 });
      CHECKS.forEach(([txt, ts], i) => {
        const a = E.smooth(seg(t, ts, ts + 0.6)) * (1 - E.smooth(seg(t, 11.2, 11.7)));
        const ok = t > ts + 1.2;
        FS.text(ctx, ok ? '✓' : '·', x0, 204 + i * 52, { size: 20, mono: true, weight: 700, color: css(ok ? P.e400 : P.amber), alpha: a });
        FS.text(ctx, txt, x0 + 34, 204 + i * 52, { size: 18, weight: 500, color: css(P.bone), alpha: a });
        ctx.strokeStyle = css(P.grid, a); ctx.beginPath(); ctx.moveTo(x0, 220 + i * 52); ctx.lineTo(x0 + 470, 220 + i * 52); ctx.stroke();
      });
      const devA = E.smooth(seg(t, 1.8, 2.6)) * (1 - E.smooth(seg(t, 11.2, 11.7)));
      const dev = t < 3.6 ? dev0 : dev1;
      const dispAvg = (dev / N);
      FS.text(ctx, 'ENGINE CHECKS PASSING', x0, 470, { size: 13, mono: true, color: css(P.e100), alpha: devA * 0.75, spacing: 2 });
      const passed = CHECKS.filter(([, ts]) => t > ts + 1.2).length;
      FS.text(ctx, passed + ' / 4', x0, 548, { size: 78, weight: 700, color: css(passed === 4 ? P.e400 : P.bone), alpha: devA });
      FS.text(ctx, 'bars snap to the grid as each rule is satisfied', x0, 580, { size: 12, mono: true, color: css(P.e100), alpha: devA * 0.5 });
      KIT.loopFade(ctx, W, H, t, DUR);
      FS.vignette(ctx, W, H, 0.55);
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 06 — PRECISION BY DESIGN', caption: t < 3.6 ? '01 AN IMPERFECT STRUCTURE' : t < 7 ? '02 CONSTRAINTS APPLY — EACH MODULE SNAPS TO THE GRID' : '03 RULES THE ENGINE ACTUALLY ENFORCES' });
    },
  });
})();
