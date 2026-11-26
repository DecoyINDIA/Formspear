/*
 * 04 — THE FORM ARCHITECT  (Level 5)
 * Verified question types are built as geometric specimens, snap into a
 * vertical form structure, then the concept resolves into the real
 * Formspear survey builder (assets/readme/desktop-builder.png).
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { SPEC, draw, tag } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;

  const ORDER = [
    ['header', 'FORM HEADER'], ['short_text', 'short_text'], ['long_text', 'long_text'], ['single_choice', 'single_choice'],
    ['multiple_choice', 'multiple_choice'], ['dropdown', 'dropdown'], ['nps', 'nps'], ['date', 'date'], ['file_upload', 'file_upload'], ['submit', 'SUBMIT'],
  ];
  const N = ORDER.length;
  const parts = ORDER.map(([k]) => SPEC[k]());
  const rr = FS.rng(77);
  const mods = ORDER.map(([k, label], i) => {
    const a = -1.05 + (i / (N - 1)) * 2.1 + (i % 2 ? 0.05 : -0.05);
    return {
      i, k, label, slot: [0, (N - 1 - i) * 0.98 + 0.2, 0],
      start: [Math.sin(a) * 10.5, 2.0 + (i % 3) * 2.2 + 1.0, Math.cos(a) * 6 - 5 + (i % 2) * 2],
      spin: [rr.range(-0.4, 0.4), rr.range(-1.2, 1.2), rr.range(-0.3, 0.3)],
      t0: 1.7 + i * 0.36,
    };
  });

  const UI = { left: [274, 187, 290, 713], centre: [578, 187, 512, 713], right: [1104, 187, 310, 713] };

  function camera(t) {
    return {
      target: track(t, [[0, [0, 4.2, 0]], [5.2, [0, 4.6, 0]], [7.2, [0, 5.0, 0]], [12, [0, 5.0, 0]]]),
      yaw: track(t, [[0, 0.55], [1.7, 0.62], [5.2, 1.0], [6.8, 0.0], [12, 0.0]]),
      pitch: track(t, [[0, 0.3], [5.2, 0.34], [6.8, 0.1], [12, 0.0]]),
      dist: track(t, [[0, 26], [5.2, 24], [6.8, 24], [8.0, 18.6], [12, 18.6]]),
      fov: 0.62,
    };
  }

  registerScene('form-architect', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 10.6,
    assets: { builder: '../../assets/readme/desktop-builder.png' },
    scene: { fogNear: 28, fogFar: 70, fogMax: 0.6 },
    draw(ctx, t, S) {
      ctx.fillStyle = css(P.ground); ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H / 2, W * 0.7);
      g.addColorStop(0, 'rgba(24,78,62,0.38)'); g.addColorStop(1, 'rgba(8,17,15,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      FS.techGrid(ctx, W, H, { step: 64, alpha: 0.16 });

      const cam = camera(t);
      S.setCamera(cam); S.begin();
      const uiA = E.smooth(seg(t, 7.0, 8.2));
      const modFade = 1 - E.smooth(seg(t, 7.2, 8.0));

      // ground reference + slot guides
      const gl = E.io3(seg(t, 0.2, 1.8));
      for (let i = -10; i <= 10; i++) {
        const a = 0.3 * gl * (1 - Math.abs(i) / 12) * (1 - uiA);
        S.groundLine([[i * 1.2, 0, -12], [i * 1.2, 0, 12]], P.e600, a);
        S.groundLine([[-12, 0, i * 1.2], [12, 0, i * 1.2]], P.e600, a);
      }
      const rails = E.io3(seg(t, 1.5, 3.4)) * (1 - uiA);
      if (rails > 0) for (const [x, z] of [[-1.9, -0.95], [1.9, -0.95], [1.9, 0.95], [-1.9, 0.95]]) {
        S.line({ pts: [[x, 0, z], [x, 0.1 + rails * 10.4, z]], color: P.e400, alpha: 0.55, w: 1, glow: true });
      }

      if (modFade > 0.01) {
        mods.forEach((m, i) => {
          const e = clamp((t - m.t0) / 1.25);
          const k = E.anticipate(e, 0.05);
          const ph = t * 0.35 + i;
          const hover = [m.start[0], m.start[1] + Math.sin(ph) * 0.35, m.start[2]];
          const approach = [lerp(hover[0], m.slot[0], k), lerp(hover[1], m.slot[1], k) + Math.sin(Math.PI * clamp(k)) * 1.6, lerp(hover[2], m.slot[2], k)];
          // arrival impulse: small damped vertical bounce + rotation settle
          const imp = e >= 1 ? Math.exp(-(t - m.t0 - 1.25) * 7) * Math.sin((t - m.t0 - 1.25) * 24) * 0.09 : 0;
          const rotK = 1 - E.settle(e);
          const rot = [m.spin[0] * rotK * 2.2, m.spin[1] * 3 * rotK + (1 - clamp(e * 1.4)) * t * 0.4, m.spin[2] * rotK];
          const pos = [approach[0], approach[1] + imp, approach[2]];
          const flat = E.io3(seg(t, 6.6, 7.4));
          draw(S, parts[i], { pos, rot, scale: [1, 1 - flat * 0.7, 1], emit: P.e100, emitK: 0.3 * (1 - clamp((t - m.t0 - 1.0) * 2)) * (e > 0 ? 1 : 0) });
          // slot outline lights up before arrival; spark ring on arrival
          const pre = E.smooth(seg(t, m.t0 - 0.6, m.t0 + 0.2));
          if (pre > 0 && t < 6.9) {
            const y = m.slot[1] - 0.2, hw = 1.7, hd = 0.85;
            S.line({ pts: [[-hw, y, -hd], [hw, y, -hd], [hw, y, hd], [-hw, y, hd], [-hw, y, -hd]], color: e >= 1 ? P.e400 : P.amber, alpha: 0.5 * pre * (e >= 1 ? 0.5 : 1), w: 1 });
          }
          if (e >= 1 && t - m.t0 - 1.25 < 0.5) {
            const q = (t - m.t0 - 1.25) / 0.5, r0 = 1.5 + q * 1.8;
            const ring = Array.from({ length: 25 }, (_, a) => [Math.cos((a / 24) * TAU) * r0 * 1.3, m.slot[1] - 0.15, Math.sin((a / 24) * TAU) * r0 * 0.7]);
            S.line({ pts: ring, color: P.e300, alpha: (1 - q) * 0.7, w: 1.2, glow: true });
          }
        });
      }
      S.flush();
      // annotations (screen space, after geometry)
      if (modFade > 0.01 && t < 6.6) {
        mods.forEach((m, i) => {
          const e = clamp((t - m.t0) / 1.25);
          const a = (e < 1 ? seg(t, m.t0 - 1.2, m.t0 - 0.5) * (1 - seg(e, 0.2, 0.7)) : seg(t, m.t0 + 1.4, m.t0 + 2.0) * (1 - seg(t, 5.6, 6.3))) * modFade;
          const anchor = e < 1 ? [m.start[0], m.start[1] + 0.2 + Math.sin(t * 0.35 + i) * 0.35, m.start[2]] : [m.slot[0] + 1.6, m.slot[1] + 0.2, 0];
          tag(ctx, S, anchor, m.label.toUpperCase(), { alpha: a, dx: e < 1 ? (m.start[0] < 0 ? -38 : 38) : 54, dy: e < 1 ? -34 : 0, run: 18 });
        });
      }

      // ---- the real interface: multi-plane builder reveal ----
      if (uiA > 0) {
        const b = S.img.builder;
        const spread = E.io3(seg(t, 8.6, 9.8)) * (1 - E.io3(seg(t, 10.4, 11.4)));
        S.setCamera({ yaw: spread * -0.3, pitch: spread * 0.08, dist: 18.6 - spread * 1.5, target: [0, 0, 0], fov: 0.62, shift: [0, 0] });
        S.begin();
        const planes = [['left', UI.left, 1.5], ['centre', UI.centre, 0], ['right', UI.right, -1.5]];
        ctx.save();
        const strips = 12, sw = W / strips;
        ctx.beginPath();
        for (let s = 0; s < strips; s++) {
          const p = E.out5(clamp((t - 7.0 - s * 0.045) / 0.7));
          const y = -80 + p * (H + 160);
          ctx.moveTo(s * sw, -2); ctx.lineTo((s + 1) * sw + 18, -2); ctx.lineTo((s + 1) * sw - 18, y); ctx.lineTo(s * sw - 18, y); ctx.closePath();
        }
        ctx.clip();
        for (const [, r, z] of planes) {
          S.image({ img: b, src: r, corners: KIT.planeCorners(r[0], r[1], r[2], r[3], z * spread, { cy: 490 }), nx: 10, ny: 8, frame: P.e400, frameA: 0.5 * spread + 0.12 });
        }
        S.flush();
        ctx.restore();
        const lab = E.smooth(seg(t, 9.0, 9.8)) * (1 - E.smooth(seg(t, 10.3, 10.9)));
        if (lab > 0.01) {
          [['QUESTIONS · ADD TYPE', UI.left, 1.5, -1], ['QUESTION EDITOR', UI.centre, 0, 0], ['SETTINGS · PUBLISH', UI.right, -1.5, 1]].forEach(([txt, r, zz, side]) => {
            const c = KIT.planeCorners(r[0], r[1], r[2], r[3], zz * spread, { cy: 490 });
            tag(ctx, S, [(c[0][0] + c[1][0]) / 2, c[0][1], c[0][2]], txt, { alpha: lab, dx: side * 30, dy: -46, run: 14 });
          });
        }
      }

      const fade = Math.max(1 - E.smooth(seg(t, 0, 0.5)), E.smooth(seg(t, 11.4, 12)));
      if (fade > 0) { ctx.fillStyle = css(P.ground, fade); ctx.fillRect(0, 0, W, H); }
      FS.vignette(ctx, W, H, 0.55);
      const cap = t < 1.7 ? '01 SPECIMENS — VERIFIED QUESTION TYPES' : t < 5.9 ? '02 ASSEMBLY — MODULES SNAP INTO THE FORM STRUCTURE' : t < 7.4 ? '03 ELEVATION — THE STRUCTURE TURNS TO FACE US' : '04 RESOLUTION — THE REAL FORMSPEAR SURVEY BUILDER';
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 02 — THE FORM ARCHITECT', caption: cap });
    },
  });
})();
