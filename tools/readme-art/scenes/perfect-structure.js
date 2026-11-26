/*
 * 17 — THE PERFECT STRUCTURE  (closing, Level 5)
 * A different construction from the hero: the emblem is a true extruded solid
 * (left facet / right facet / spine) fractured into shards that spiral in,
 * docking onto a plinth ring of the README's own artefacts (question
 * specimens + response records), joined by pulsing data pathways, then the
 * wordmark assembles from sliced typographic fragments.
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track, wrapPI } = FS;
  const { SPEC, draw } = KIT;
  const W = 1280, H = 720, DUR = 13, FPS = 24;
  const R = FS.rng(1701);
  const K = 0.06, HC = 5.4;

  // ---- fracture the emblem polygons into triangular shards ----
  const tri = (a, b, c) => [a, b, c];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  function split(t, depth) {
    if (!depth) return [t];
    const [a, b, c] = t, ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    return [...split(tri(a, ab, ca), depth - 1), ...split(tri(ab, b, bc), depth - 1), ...split(tri(ca, bc, c), depth - 1), ...split(tri(ab, bc, ca), depth - 1)];
  }
  const E_ = FS.EMBLEM;
  const facets = [
    { name: 'left', h: 0.9, tris: [tri(E_.left[0], E_.left[1], E_.left[3]), tri(E_.left[1], E_.left[2], E_.left[3])], col: P.e700 },
    { name: 'right', h: 1.5, tris: [tri(E_.right[0], E_.right[1], E_.right[3]), tri(E_.right[1], E_.right[2], E_.right[3])], col: P.e400 },
    { name: 'spine', h: 2.3, tris: [tri(E_.spine[0], E_.spine[1], E_.spine[2]), tri(E_.spine[0], E_.spine[2], E_.spine[3])], col: P.e100 },
  ];
  const shards = [];
  for (const f of facets) {
    const depth = f.name === 'spine' ? 1 : 2;
    for (const t0 of f.tris) for (const tt of split(t0, depth)) {
      const cx = (tt[0][0] + tt[1][0] + tt[2][0]) / 3, cy = (tt[0][1] + tt[1][1] + tt[2][1]) / 3;
      const dist = Math.hypot(cx - 180, cy - 150);
      shards.push({
        f, tt, cx, cy, dist,
        c: [(cx - 180) * K, HC + (150 - cy) * K, 0],
        poly: tt.map((p) => [(p[0] - cx) * K * 0.97, (p[1] - cy) * K * 0.97]),
        ang: R.range(0, TAU), rad: R.range(14, 34), lift: R.range(-6, 10), spin: [R.range(-3, 3), R.range(-3, 3), R.range(-3, 3)],
        t0: 3.0 + (dist / 80) * 2.2 + R.range(0, 0.9),
      });
    }
  }
  shards.sort((a, b) => a.dist - b.dist);

  // ---- plinth ring: question specimens + response record slabs ----
  const KINDS = ['short_text', 'long_text', 'single_choice', 'multiple_choice', 'dropdown', 'nps', 'date', 'file_upload'];
  const ring = [];
  KINDS.forEach((k, i) => ring.push({ k, spec: SPEC[k](), a: (i / KINDS.length) * TAU + 0.2, r: 8.4, rec: false, t0: 1.2 + i * 0.22 }));
  for (let i = 0; i < 16; i++) ring.push({ k: 'record', spec: [KIT.B([0, 0.06, 0], [1.6, 0.12, 0.8], i % 3 === 0 ? 'emerald' : i % 3 === 1 ? 'bone' : 'steel'), KIT.B([-0.3, 0.14, 0], [0.5, 0.06, 0.4], 'sky')], a: (i / 16) * TAU + 0.1, r: 6.0, rec: true, t0: 1.7 + i * 0.1 });
  ring.forEach((x) => { x.from = [Math.cos(x.a + 1.2) * 34, R.range(4, 14), Math.sin(x.a + 1.2) * 34]; x.to = [Math.cos(x.a) * x.r, 0.0, Math.sin(x.a) * x.r]; });

  function camera(t) {
    return {
      target: [0, track(t, [[0, 6], [8, 4.2], [13, 4.0]]), 0],
      yaw: track(t, [[0, -1.1], [5, -0.55], [8.5, -0.12], [11, 0.1], [13, 0.18]]),
      pitch: track(t, [[0, 0.3], [6, 0.34], [9, 0.24], [13, 0.2]]),
      dist: track(t, [[0, 36], [3, 40], [8, 34], [10.5, 31], [13, 30.5]]),
      fov: 0.62,
      shift: track(t, [[0, [0, 0]], [9, [0, -34]], [13, [0, -34]]]),
    };
  }

  function wordmark(ctx, t) {
    const word = 'FORMSPEAR', size = 66, trk = 15, y = 628;
    const widths = word.split('').map((c) => FS.measure(ctx, c, { size, weight: 700 }));
    const total = widths.reduce((a, b) => a + b, 0) + trk * (word.length - 1);
    let x = 640 - total / 2;
    const out = 1 - E.smooth(seg(t, 12.3, 13));
    word.split('').forEach((ch, i) => {
      const e = E.out5(seg(t, 8.2 + i * 0.07, 9.5 + i * 0.07));
      for (let s = 0; s < 5; s++) {
        const band = [y - size * 0.78 + (s * size * 0.82) / 5, (size * 0.82) / 5 + 0.6];
        const dir = s % 2 ? 1 : -1;
        const dx = dir * (1 - e) * 260;
        ctx.save(); ctx.beginPath(); ctx.rect(x - 6, band[0], widths[i] + 12, band[1]); ctx.clip();
        FS.text(ctx, ch, x + dx, y, { size, weight: 700, color: i < 4 ? css(P.bone) : css(P.e400), alpha: e * out });
        ctx.restore();
      }
      x += widths[i] + trk;
    });
    const sub = 'ORDER FROM COMPLEXITY';
    const se = E.io3(seg(t, 9.6, 10.8));
    FS.text(ctx, sub, 640, y + 40, { size: 16, mono: true, weight: 500, spacing: 9 * (1.6 - 0.6 * se), color: css(P.e300), alpha: se * out, align: 'center' });
    ctx.strokeStyle = css(P.e500, 0.7 * se * out); ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(640 - total / 2, y + 16); ctx.lineTo(640 - total / 2 + total * se, y + 16); ctx.stroke();
  }

  registerScene('perfect-structure', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 11.4,
    scene: { fogNear: 34, fogFar: 90, fogMax: 0.7, light: [-0.5, 0.7, 0.7] },
    draw(ctx, t, S) {
      ctx.fillStyle = css(P.ground); ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H * 0.4, 30, W / 2, H * 0.45, W * 0.6);
      g.addColorStop(0, `rgba(30,100,80,${0.18 + 0.3 * E.smooth(seg(t, 6, 8))})`); g.addColorStop(1, 'rgba(8,17,15,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      FS.techGrid(ctx, W, H, { step: 64, alpha: 0.14 });
      S.setCamera(camera(t)); S.begin();

      // ground: concentric measure rings (data-visualisation base)
      const gr = E.io3(seg(t, 0.4, 3.2));
      for (let r = 4; r <= 22; r += 3) {
        const pts = Array.from({ length: 73 }, (_, i) => [Math.cos((i / 72) * TAU) * r * gr, 0, Math.sin((i / 72) * TAU) * r * gr]);
        S.groundLine(pts, P.e600, 0.3 * (1 - r / 26), 1);
      }
      for (let a = 0; a < 24; a++) S.groundLine([[0, 0, 0], [Math.cos((a / 24) * TAU) * 22 * gr, 0, Math.sin((a / 24) * TAU) * 22 * gr]], P.e700, 0.14, 1);

      // plinth ring items fly in on arcs
      ring.forEach((x, i) => {
        const e = E.io3(seg(t, x.t0, x.t0 + 1.6));
        const arc = Math.sin(Math.PI * e) * 5;
        const pos = [lerp(x.from[0], x.to[0], e), lerp(x.from[1], x.to[1], e) + arc, lerp(x.from[2], x.to[2], e)];
        const rot = [0, -x.a - Math.PI / 2 + (1 - E.settle(e)) * 2.4 * (i % 2 ? 1 : -1), 0];
        draw(S, x.spec, { pos, rot, scale: x.rec ? 1 : 0.62, emit: P.e100, emitK: 0.3 * (1 - e) });
        // data pathway from ring item to the sculpture base
        const pw = E.io3(seg(t, 5.0 + i * 0.05, 7.0 + i * 0.05));
        if (pw > 0.01 && e >= 1) {
          const a = [x.to[0], 0.3, x.to[2]], b = [0, HC - 4.4, 0];
          const pts = KIT.bez(a, [a[0] * 0.5, 1.4, a[2] * 0.5], [a[0] * 0.15, 2.2, a[2] * 0.15], b, 16);
          const sl = KIT.slicePoly(pts, 0, pw);
          if (sl.length > 1) S.line({ pts: sl, color: x.rec ? P.sky : P.e400, alpha: 0.4, w: 1, glow: true, bias: 60 });
          const ph = ((t * 0.5 + i * 0.13) % 1) * pw;
          S.dot({ c: KIT.pointAt(pts, ph), r: 0.07, color: P.e100, alpha: 0.9, bias: 60 });
        }
      });

      // the emblem: shards spiral in, dock, then a light sweep passes over the solid
      const sweep = seg(t, 7.2, 8.6);
      shards.forEach((s) => {
        const e = E.out5(seg(t, s.t0, s.t0 + 2.4));
        const spiral = (1 - e) * 1.6 * (s.ang > 3 ? 1 : -1);
        const a = s.ang + (1 - e) * 2.6 + spiral * 0.0;
        const from = [Math.cos(a) * s.rad * (1 - e) + s.c[0], s.c[1] + s.lift * (1 - e), Math.sin(a) * s.rad * (1 - e)];
        const pos = [lerp(from[0], s.c[0], 0) , from[1], from[2] + (s.c[2] * e)];
        const k2 = 1 - E.settle(clamp((t - s.t0) / 2.4));
        const rot = [Math.PI / 2 + s.spin[0] * k2 * 1.5, s.spin[1] * k2 * 1.5, s.spin[2] * k2 * 1.5];
        const base = s.f.col;
        const sw = Math.exp(-Math.pow((s.cx - (115 + sweep * 130)) / 12, 2)) * (sweep > 0 && sweep < 1 ? 1 : 0);
        S.prism({ poly: s.poly, y0: 0, y1: s.f.h * (0.4 + 0.6 * e), c: pos, rot, mat: { base, amb: 0.4, dif: 0.7, fill: 0.16, rim: 0.2 }, emit: P.e100, emitK: Math.max(0.55 * (1 - e), 0.7 * sw), shadow: e > 0.9 });
      });
      // docked-state beacon + ground ripple
      const dock = seg(t, 7.0, 8.0);
      if (dock > 0) {
        const q = (t - 7.0) % 3;
        const r = 2 + q * 7;
        S.groundLine(Array.from({ length: 49 }, (_, i) => [Math.cos((i / 48) * TAU) * r, 0.02, Math.sin((i / 48) * TAU) * r]), P.e300, 0.5 * (1 - q / 3) * dock, 1.5);
      }
      S.flush();
      FS.vignette(ctx, W, H, 0.6);
      wordmark(ctx, t);

      const fade = Math.max(1 - E.smooth(seg(t, 0, 0.6)), E.smooth(seg(t, 12.3, 13)));
      if (fade > 0) { ctx.fillStyle = css(P.ground, fade); ctx.fillRect(0, 0, W, H); }
      const cap = t < 3 ? '01 COMPONENTS ARRIVE FROM EVERY CHAPTER' : t < 7 ? '02 THE EMBLEM ASSEMBLES FROM FRAGMENTS' : t < 9.5 ? '03 THE STRUCTURE IS COMPLETE' : '04 FORMSPEAR — ORDER FROM COMPLEXITY';
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 13 — THE PERFECT STRUCTURE', caption: cap });
    },
  });
})();
