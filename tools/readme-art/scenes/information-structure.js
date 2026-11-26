/*
 * 07 — INFORMATION BECOMES STRUCTURE  (Level 5)
 * Starts from the REAL public survey (assets/readme/mobile-public-survey.png):
 * its three answer regions peel away as fragments, are typed, checked at a
 * validation gate (the server runs validateAnswers on submit), and settle as
 * structured response records, then resolve into the real operator dashboard.
 * Stream volume is illustrative; the pipeline stages are real.
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { KIT_ } = window;
  const W = 1280, H = 720, DUR = 12, FPS = 24;
  const R = FS.rng(4242);

  const PHONE = { x: -13.5, y: 4.6, u: 0.0118 }; // screenshot px -> world
  const crops = [
    { k: 'email', src: [37, 175, 316, 30], col: 'bone' },
    { k: 'csat', src: [37, 270, 316, 42], col: 'emerald' },
    { k: 'long', src: [37, 375, 316, 52], col: 'sky' },
  ];
  const lane = { email: -2.6, csat: 0, long: 2.6 };
  const TOK = { bone: { base: P.bone, amb: 0.38, dif: 0.62, fill: 0.14, rim: 0.06 }, emerald: { base: P.e500, amb: 0.34, dif: 0.7, fill: 0.14, rim: 0.12 }, sky: { base: P.sky, amb: 0.4, dif: 0.62, fill: 0.14, rim: 0.12 } };
  const NR = 14, REJ = 4;
  const resp = Array.from({ length: NR }, (_, r) => ({ r, s: 1.9 + r * 0.27, csat: 1 + Math.floor(R() * 5), rej: r === REJ, slot: null, jit: [R.range(-0.4, 0.4), R.range(-0.4, 0.4), R.range(-0.4, 0.4)] }));
  let rec = 0; resp.forEach((x) => { if (!x.rej) x.slot = rec++; });

  const phoneP = (px, py) => [PHONE.x + (px - 195) * PHONE.u, PHONE.y + (422 - py) * PHONE.u, 0];

  function tokenGeom(kind, csat) {
    if (kind === 'email') return [{ c: [0, 0.1, 0], s: [1.3, 0.2, 0.42] }];
    if (kind === 'csat') return [{ c: [0, 0.1 + csat * 0.07, 0], s: [0.44, 0.2 + csat * 0.14, 0.44] }];
    return [{ c: [0, 0.07, -0.18], s: [1.2, 0.14, 0.2] }, { c: [-0.2, 0.07, 0.14], s: [0.8, 0.14, 0.2] }];
  }

  function tokenPos(x, kind, t) {
    // returns {c, a (alpha), glow, state}
    const sA = x.s, sB = x.s + 1.5, sC = x.s + 2.5, sD = x.s + 3.9;
    const L = lane[kind];
    const a0 = phoneP(195, 360 + (kind === 'email' ? -180 : kind === 'csat' ? -90 : 15));
    const start = [a0[0] + 1.2, a0[1] + x.jit[1] * 1.5, 0.4 + x.jit[2]];
    const entry = [-8.2, 2.0 + x.jit[0], L];
    const gate = [0.8, 1.3, L];
    const slot = x.slot === null ? [3.4, 2.0, L] : [8.5 + (kind === 'email' ? -0.9 : kind === 'csat' ? 0.15 : 0.95), 0.34 + x.slot * 0.24, 0];
    let c = start, state = 0, glow = 0, al = 1, scale = 1;
    if (t < sA) return null;
    const pA = E.io3(seg(t, sA, sB));
    const mid = [lerp(start[0], entry[0], 0.5), Math.max(start[1], entry[1]) + 2.2, lerp(start[2], entry[2], 0.5) + x.jit[2] * 4];
    c = [lerp(lerp(start[0], mid[0], pA), lerp(mid[0], entry[0], pA), pA), lerp(lerp(start[1], mid[1], pA), lerp(mid[1], entry[1], pA), pA), lerp(lerp(start[2], mid[2], pA), lerp(mid[2], entry[2], pA), pA)];
    const pB = E.io3(seg(t, sB, sC));
    if (pB > 0) {
      c = v.lerp(c, gate, pB);
      glow = Math.sin(Math.PI * pB);
      if (x.rej && pB > 0.5) { const q = seg(t, sB + 0.5 * (sC - sB), sC + 0.5); c = [c[0] + q * 1.5, c[1] + q * 3.5, c[2] + (kind === 'email' ? -1 : 1) * q * 3]; al = 1 - q; state = 2; }
    }
    const pC = x.rej ? 0 : E.io3(seg(t, sC, sD));
    if (pC > 0) { c = v.lerp(c, slot, pC); state = 1; }
    if (x.rej && t > sC + 0.5) al = Math.max(0, 1 - (t - sC - 0.5) * 2);
    return { c, glow, al, state, scale, slot };
  }

  function camera(t) {
    return {
      target: track(t, [[0, [-10, 3.2, 0]], [2.0, [-7, 2.6, 0]], [6.5, [-0.5, 2.0, 0]], [8.8, [4.5, 1.6, 0]], [10, [0, 0, 0]]]),
      yaw: track(t, [[0, 0.18], [3, 0.38], [6.5, 0.5], [8.8, 0.35], [9.8, 0.0]]),
      pitch: track(t, [[0, 0.2], [3, 0.28], [6.5, 0.36], [9.0, 0.3], [9.8, 0.0]]),
      dist: track(t, [[0, 24], [2, 26], [6.5, 29], [9, 24], [10, 20]]),
      fov: 0.62,
    };
  }

  const gateBox = (S, x, a) => {
    const mat = { base: P.steel2, amb: 0.5, dif: 0.55, fill: 0.2, rim: 0.2 };
    for (const z of [-4.6, 4.6]) S.box({ c: [x, 2.2, z], s: [0.22, 4.4, 0.22], mat, shadow: false });
    S.box({ c: [x, 4.5, 0], s: [0.22, 0.22, 9.4], mat, shadow: false });
    S.box({ c: [x, 0.05, 0], s: [0.22, 0.1, 9.4], mat, shadow: false });
    if (a > 0) {
      const y = 0.2 + ((a * 4) % 1) * 4.0;
      S.line({ pts: [[x, y, -4.5], [x, y, 4.5]], color: P.e300, alpha: 0.8, w: 1.6, glow: true });
    }
  };

  registerScene('information-structure', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 8.6,
    assets: { phone: '../../assets/readme/mobile-public-survey.png', dash: '../../assets/readme/desktop-dashboard.png' },
    scene: { fogNear: 30, fogFar: 80, fogMax: 0.55 },
    draw(ctx, t, S) {
      ctx.fillStyle = css(P.ground); ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H * 0.5, 40, W / 2, H / 2, W * 0.7);
      g.addColorStop(0, 'rgba(24,78,62,0.36)'); g.addColorStop(1, 'rgba(8,17,15,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      FS.techGrid(ctx, W, H, { step: 64, alpha: 0.15 });
      const dashA = E.smooth(seg(t, 9.0, 10.0));
      const cam = camera(t);
      S.setCamera(cam); S.begin();

      for (let i = -14; i <= 14; i++) {
        const a = 0.22 * (1 - Math.abs(i) / 16);
        S.groundLine([[i * 1.8, 0, -9], [i * 1.8, 0, 9]], P.e600, a);
      }
      for (let k = -5; k <= 5; k++) S.groundLine([[-26, 0, k * 1.8], [26, 0, k * 1.8]], P.e600, 0.2 * (1 - Math.abs(k) / 7));
      // lane rails
      for (const z of Object.values(lane)) S.line({ pts: [[-9, 0.02, z], [1.2, 0.02, z]], color: P.e700, alpha: 0.5, w: 1 });
      gateBox(S, 0.2, seg(t, 3, 11) * 1);

      // the real phone UI, standing in the scene
      const pa = E.out5(seg(t, 0.0, 0.9));
      const peel = E.io3(seg(t, 0.9, 2.0));
      const phoneCorners = [phoneP(0, 0), phoneP(390, 0), phoneP(390, 844), phoneP(0, 844)].map((p) => [p[0], p[1] + 0, p[2] - 0.05]);
      S.image({ img: S.img.phone, src: [0, 0, 390, 640], corners: [phoneP(0, 0), phoneP(390, 0), phoneP(390, 640), phoneP(0, 640)].map((p) => [p[0], p[1], p[2] - 0.05]), alpha: pa, nx: 6, ny: 10, frame: P.e400, frameA: 0.5, dim: 0.0 });
      void phoneCorners;
      // peeled UI fragments rise off the plane then hand over to typed tokens
      crops.forEach((c, i) => {
        const [sx, sy, sw, sh] = c.src;
        const lift = E.io3(seg(t, 0.9 + i * 0.12, 1.7 + i * 0.12));
        const out = E.io3(seg(t, 1.7 + i * 0.12, 2.3 + i * 0.12));
        const z = 0.1 + lift * 2.4, a = (1 - out);
        if (a > 0.01 && lift > 0.01) {
          const tl = phoneP(sx, sy), br = phoneP(sx + sw, sy + sh);
          S.image({ img: S.img.phone, src: c.src, corners: [[tl[0], tl[1], z], [br[0], tl[1], z], [br[0], br[1], z], [tl[0], br[1], z]], alpha: a, nx: 4, ny: 2, frame: P.e300, frameA: 0.9, bias: -20 });
        }
      });

      // response stream
      let nTok = 0;
      for (const x of resp) {
        for (const kind of ['email', 'csat', 'long']) {
          const tp = tokenPos(x, kind, t); if (!tp || tp.al <= 0.01) continue;
          const mat = TOK[kind === 'email' ? 'bone' : kind === 'csat' ? 'emerald' : 'sky'];
          const rawMat = tp.state === 2 ? { ...mat, base: P.amber } : mat;
          for (const gm of tokenGeom(kind, x.csat)) {
            S.box({ c: v.add(tp.c, gm.c), s: gm.s, mat: rawMat, alpha: tp.al < 0.98 ? tp.al : undefined, emit: tp.glow > 0.05 ? P.e100 : null, emitK: 0.45 * tp.glow, shadow: tp.al > 0.9 });
          }
          nTok++;
          if (tp.glow > 0.4 && tp.state !== 2) S.dot({ c: v.add(tp.c, [0, 0.7, 0]), r: 0.08, color: P.e100, alpha: tp.glow * 0.7 });
        }
        // the record slab under its tokens
        if (x.slot !== null) {
          const arr = seg(t, x.s + 2.5, x.s + 3.9);
          if (arr > 0) S.box({ c: [8.5, 0.12 + x.slot * 0.24 - 0.05 + 0.0, 0], s: [3.2, 0.1, 1.5], mat: { base: P.steel2, amb: 0.5, dif: 0.55, fill: 0.2, rim: 0.2 }, alpha: undefined, shadow: x.slot === 0 });
        }
      }
      S.flush();

      // labels
      const tg = (anchor, text, a, o = {}) => KIT.tag(ctx, S, anchor, text, { alpha: a, dx: o.dx ?? 40, dy: o.dy ?? -44, run: 16 });
      tg([-9.4, 3.4, -2.6], 'email', seg(t, 2.6, 3.0) * (1 - dashA), { dx: -34, dy: -40 });
      tg([-9.4, 3.4, 0], 'csat', seg(t, 2.7, 3.1) * (1 - dashA), { dx: -34, dy: -64 });
      tg([-9.4, 3.4, 2.6], 'long_text', seg(t, 2.8, 3.2) * (1 - dashA), { dx: -34, dy: -88 });
      tg([0.2, 4.6, 0], 'VALIDATE · validateAnswers', seg(t, 3.4, 4.0) * (1 - dashA), { dx: 30, dy: -50 });
      tg([8.5, 3.8, 0], 'RESPONSE RECORDS', seg(t, 6.0, 7.0) * (1 - dashA), { dx: 40, dy: -50 });
      tg([-8.0, 5.8, 0], 'required field missing → rejected', E.smooth(seg(t, 4.6, 5.0)) * (1 - seg(t, 6.2, 6.8)) * (1 - dashA), { dx: 40, dy: -56 });

      // real dashboard reveal (masked strips)
      if (dashA > 0) {
        S.setCamera({ yaw: 0, pitch: 0, dist: 20.5, target: [0, 0, 0], fov: 0.62, shift: [0, 0] }); S.begin();
        ctx.save(); ctx.beginPath();
        const strips = 10, sw = W / strips;
        for (let s = 0; s < strips; s++) {
          const p = E.out5(clamp((t - 9.0 - s * 0.05) / 0.8)); const y = H - p * (H + 80);
          ctx.moveTo(s * sw, H + 2); ctx.lineTo((s + 1) * sw, H + 2); ctx.lineTo((s + 1) * sw - 16, y); ctx.lineTo(s * sw - 16, y); ctx.closePath();
        }
        ctx.clip();
        S.image({ img: S.img.dash, src: [0, 0, 1440, 900], corners: KIT.planeCorners(0, 0, 1440, 900, 0, { u: 0.0122, cy: 450 }), nx: 10, ny: 6, frame: P.e400, frameA: 0.6 });
        S.flush(); ctx.restore();
        FS.text(ctx, 'REAL OPERATOR DASHBOARD (APP NAME IN-UI: FEEDBACKOS) — EMPTY-STATE CAPTURE, NO SEEDED DATA', 640, 96, { size: 11, mono: true, color: css(P.e100), alpha: 0.75 * dashA, align: 'center', spacing: 1.6 });
      }

      const fade = Math.max(1 - E.smooth(seg(t, 0, 0.5)), E.smooth(seg(t, 11.4, 12)));
      if (fade > 0) { ctx.fillStyle = css(P.ground, fade); ctx.fillRect(0, 0, W, H); }
      FS.vignette(ctx, W, H, 0.55);
      const cap = t < 2.3 ? '01 FRAGMENTS — THE REAL SURVEY GIVES UP ITS ANSWERS' : t < 4.6 ? '02 CLASSIFY — EACH ANSWER IS TYPED' : t < 7.0 ? '03 VALIDATE — INVALID SUBMISSIONS ARE REJECTED' : t < 9.0 ? '04 RECORDS — RESPONSES SETTLE AS STRUCTURE' : '05 THE OPERATOR DASHBOARD — REAL EMPTY-STATE CAPTURE';
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 05 — INFORMATION BECOMES STRUCTURE', caption: cap + '   [ILLUSTRATIVE STREAM]' });
    },
  });
})();
