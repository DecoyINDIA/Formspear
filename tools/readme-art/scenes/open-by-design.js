/*
 * 12 — OPEN BY DESIGN  (Level 4)
 * Repository is MIT licensed (LICENSE). A closed shell opens; the real top-level
 * directories separate, recombine, and a new module docks into the system.
 * Rights shown are the ones the MIT text itself grants:
 * "use, copy, modify, merge, publish, distribute, sublicense, and/or sell".
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { MAT, B, bez, slicePoly } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;

  // internals: real top-level directories
  const DIRS = [
    ['public/', 'emerald', [3.6, 1.6, 2.4], [-2.2, 0.8, 2.2]],
    ['src/', 'bone', [3.6, 2.4, 2.4], [2.2, 1.2, 2.2]],
    ['migrations/', 'bone2', [2.4, 1.0, 2.4], [-2.2, 0.5, -2.2]],
    ['scripts/', 'steel', [2.4, 1.2, 2.4], [2.2, 0.6, -2.2]],
    ['tests/', 'mint', [2.4, 1.4, 1.6], [0, 0.7, 0]],
    ['docs/', 'paper', [2.4, 0.8, 1.6], [0, 0.4, -4.4]],
  ];
  // second configuration (recombined)
  // a ring with the centre left empty: the docking bay for a module of your own
  const CONF2 = [[-5.4, 0.8, 0], [-2.7, 1.2, 4.7], [2.7, 0.5, 4.7], [5.4, 0.6, 0], [2.7, 0.7, -4.7], [-2.7, 0.4, -4.7]];
  const SHELL = [
    { n: [0, 1, 0], p: [0, 4.0, 0], s: [8.4, 0.16, 8.4] }, { n: [1, 0, 0], p: [4.2, 2.0, 0], s: [0.16, 4.0, 8.4] }, { n: [-1, 0, 0], p: [-4.2, 2.0, 0], s: [0.16, 4.0, 8.4] },
    { n: [0, 0, 1], p: [0, 2.0, 4.2], s: [8.4, 4.0, 0.16] }, { n: [0, 0, -1], p: [0, 2.0, -4.2], s: [8.4, 4.0, 0.16] },
  ];
  const RIGHTS = ['USE', 'COPY', 'MODIFY', 'MERGE', 'PUBLISH', 'DISTRIBUTE', 'SUBLICENSE', 'SELL'];

  registerScene('open-by-design', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 9.6,
    scene: { fogNear: 28, fogFar: 80, fogMax: 0.5 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H);
      S.setCamera({ target: [0, 2.2, 0], yaw: track(t, [[0, 0.6], [6, 0.2], [12, -0.3]]), pitch: track(t, [[0, 0.42], [12, 0.5]]), dist: track(t, [[0, 32], [3, 38], [12, 36]]), fov: 0.62, shift: [-10, -30] });
      S.begin();
      KIT.floor(S, 0.1, t, 20, 1.6, 0.16);
      const open = E.io3(seg(t, 1.6, 3.8));
      const spread = E.io3(seg(t, 3.8, 5.4));
      const recomb = E.io3(seg(t, 6.0, 8.0));
      // shell panels peel away
      SHELL.forEach((s, i) => {
        const o = open * (1 - 0);
        const out = v.mul(s.n, o * 9);
        const al = 1 - E.smooth(seg(t, 3.0, 4.2));
        if (al > 0.01) S.box({ c: [s.p[0] + out[0], s.p[1] + out[1] + o * 2, s.p[2] + out[2]], s: s.s, rot: [o * 0.5 * (s.n[2]), o * 0.4 * s.n[0], o * 0.6 * s.n[1]], mat: { base: P.steel, amb: 0.5, dif: 0.5, fill: 0.2, rim: 0.25 }, alpha: al < 0.99 ? al : undefined, edge: P.e500, edgeA: 0.7 });
      });
      // internal modules
      DIRS.forEach(([name, mat, size, p0], i) => {
        const from = p0;
        const a = [lerp(from[0], from[0] * 2.4, spread), from[1], lerp(from[2], from[2] * 2.0, spread)];
        const to = CONF2[i];
        const pos = [lerp(a[0], to[0] * 1.15, recomb), lerp(a[1], to[1], recomb) + Math.sin(Math.PI * recomb) * 2.0, lerp(a[2], to[2] * 1.15, recomb)];
        const rot = [0, (1 - E.settle(recomb)) * 0 + recomb * (i % 2 ? 0.9 : -0.9) * 1, 0];
        const ap = E.smooth(seg(t, 1.8 + i * 0.1, 3.0 + i * 0.1));
        S.box({ c: [pos[0], pos[1] * ap + (1 - ap) * 0.5, pos[2]], s: size.map((x) => x * ap), rot, mat: MAT[mat], shadow: true });
      });
      // the newcomer: a module of your own
      const nw = E.io3(seg(t, 8.2, 9.6));
      if (nw > 0) {
        const pos = [lerp(14, 0, nw), 0.6 + Math.sin(Math.PI * nw) * 3, lerp(8, 0, nw)];
        S.box({ c: pos, s: [2.0, 1.2, 2.0], mat: MAT.amber, emit: P.e100, emitK: 0.2 * (1 - nw), rot: [0, (1 - nw) * 3, 0] });
        // connectors into neighbours
        for (const k of [0, 1, 2, 3, 4, 5]) {
          const to = CONF2[k], pts = bez([0, 1.4, 0], [to[0] * 0.3, 3.4, to[2] * 0.3], [to[0] * 0.7, 3.4, to[2] * 0.7], [to[0] * 1.15, to[1] + 0.9, to[2] * 1.15], 18);
          S.line({ pts: slicePoly(pts, 0, E.io3(seg(t, 9.0, 10.0))), color: P.amber, alpha: 0.8, w: 1.6, glow: true });
        }
      }
      S.flush();
      // labels
      if (spread > 0.5 || recomb > 0) DIRS.forEach(([name, , size, p0], i) => {
        const from = p0, a = [lerp(from[0], from[0] * 2.4, spread), from[1], lerp(from[2], from[2] * 2.0, spread)], to = CONF2[i];
        const pos = [lerp(a[0], to[0] * 1.15, recomb), lerp(a[1], to[1], recomb) + Math.sin(Math.PI * recomb) * 2.0, lerp(a[2], to[2] * 1.15, recomb)];
        const p = S.project([pos[0], pos[1] + size[1] / 2 + 0.4, pos[2]]); if (!p) return;
        const al = E.smooth(seg(t, 4.2 + i * 0.08, 4.8 + i * 0.08)) * (1 - E.smooth(seg(t, 11.0, 11.5)));
        const tw = FS.measure(ctx, name, { size: 13, mono: true, weight: 600, spacing: 1.2 });
        ctx.fillStyle = css(P.ground, 0.78 * al); ctx.fillRect(p[0] - tw / 2 - 7, p[1] - 24, tw + 14, 22);
        ctx.fillStyle = css(P.e400, al); ctx.fillRect(p[0] - tw / 2 - 7, p[1] - 24, 2, 22);
        FS.text(ctx, name, p[0], p[1] - 8, { size: 13, mono: true, weight: 600, color: css(P.bone), alpha: al, align: 'center', spacing: 1.2 });
      });
      // MIT rights, typed
      RIGHTS.forEach((r, i) => {
        const a = E.smooth(seg(t, 9.6 + i * 0.16, 10.0 + i * 0.16)) * (1 - E.smooth(seg(t, 11.2, 11.7)));
        FS.text(ctx, r, 56 + i * 0, 470 + i * 26, { size: 16, mono: true, weight: 600, color: css(i === 2 ? P.amber : P.e300), alpha: a, spacing: 4 });
      });
      FS.text(ctx, 'MIT LICENSE', 56, 440, { size: 12, mono: true, color: css(P.e100), alpha: 0.7 * E.smooth(seg(t, 9.4, 10.0)) * (1 - E.smooth(seg(t, 11.2, 11.7))), spacing: 3 });
      KIT.loopFade(ctx, W, H, t, DUR);
      FS.vignette(ctx, W, H, 0.55);
      const cap = t < 1.8 ? '01 A CLOSED SHELL' : t < 5.6 ? '02 THE CONSTRUCTION IS OPENED — THESE ARE THE REAL TOP-LEVEL DIRECTORIES' : t < 8.2 ? '03 MODULES RECOMBINE INTO A NEW CONFIGURATION' : '04 YOUR MODULE DOCKS — MIT-LICENSED';
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 10 — OPEN BY DESIGN', caption: cap });
    },
  });
})();
