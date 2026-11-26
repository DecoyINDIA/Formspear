/*
 * 11 — CONNECTED BY DESIGN  (Level 4)
 * Only integrations that exist in src/server.js: outbound webhooks (HMAC-SHA256
 * signed), Slack, Microsoft Teams, WhatsApp alerts, SMTP email, Stripe,
 * Razorpay, OpenAI-backed AI summaries, and S3-compatible file storage.
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { MAT, bez, slicePoly, pointAt, B, PR, ngon, draw } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;

  const GLYPH = {
    webhook: () => [B([0, 0.12, 0], [1.6, 0.24, 0.4], 'bone'), PR([1.0, 0], [[-0.32, -0.45], [-0.32, 0.45], [0.4, 0]], 0.0, 0.34, 'emerald')],
    whatsapp: () => [B([0, 0.4, 0], [1.6, 0.8, 0.28], 'bone'), PR([-0.5, 0.2], [[-0.3, 0], [0.3, 0], [-0.3, 0.5]], 0, 0.28, 'bone'), B([0, 0.5, 0.18], [0.9, 0.1, 0.06], 'emerald')],
    slack: () => [B([-0.25, 0.14, 0], [1.6, 0.24, 0.3], 'bone'), B([0.25, 0.14, 0.55], [1.6, 0.24, 0.3], 'bone'), B([-0.55, 0.14, -0.2], [0.3, 0.24, 1.6], 'mint'), B([0.55, 0.14, 0.2], [0.3, 0.24, 1.6], 'mint')],
    teams: () => [B([-0.5, 0.25, 0], [0.8, 0.5, 0.8], 'deep'), B([0.45, 0.2, 0.2], [0.8, 0.4, 0.8], 'bone'), B([0.1, 0.55, -0.4], [0.5, 0.3, 0.5], 'emerald')],
    smtp: () => [B([0, 0.1, 0], [1.8, 0.2, 1.1], 'bone'), PR([0, 0], [[-0.9, -0.55], [0.9, -0.55], [0, 0.1]], 0.2, 0.32, 'emerald')],
    stripe: () => [PR([0, 0], ngon(20, 0.8), 0, 0.14, 'bone'), PR([0, 0], ngon(20, 0.6), 0.14, 0.28, 'emerald')],
    razorpay: () => [PR([0, 0], [[-0.9, -0.4], [0.5, -0.4], [0.9, 0.4], [-0.5, 0.4]], 0, 0.3, 'deep'), PR([0, 0], [[-0.4, -0.15], [0.3, -0.15], [0.5, 0.15], [-0.2, 0.15]], 0.3, 0.42, 'mint')],
    openai: () => [PR([0, 0], ngon(6, 0.9), 0, 0.2, 'bone'), PR([0, 0], ngon(6, 0.5), 0.2, 0.46, 'emerald')],
    s3: () => [B([0, 0.06, 0], [1.9, 0.12, 1.3], 'steel'), B([0, 0.2, 0], [1.9, 0.12, 1.3], 'bone2'), B([0, 0.34, 0], [1.9, 0.12, 1.3], 'bone')],
  };
  const NODES = [
    ['Webhooks', 'webhook', 'HMAC-SHA256 signed'], ['WhatsApp alerts', 'whatsapp', ''], ['Slack', 'slack', ''], ['Microsoft Teams', 'teams', ''], ['SMTP email', 'smtp', ''],
    ['Stripe', 'stripe', ''], ['Razorpay', 'razorpay', ''], ['OpenAI summaries', 'openai', ''], ['S3-compatible storage', 's3', ''],
  ].map(([name, g, note], i) => {
    const a = (i / 9) * TAU + Math.PI / 2, r = 12;
    return { name, g, note, parts: GLYPH[g](), a, pos: [Math.cos(a) * r, 0, Math.sin(a) * r], t0: 1.5 + i * 0.28, fire: 4.2 + i * 0.55 };
  });

  const core = (S, e, pulse) => {
    const K = 0.075, mats = { left: { base: P.e700, amb: 0.4, dif: 0.7, fill: 0.16, rim: 0.2 }, right: { base: P.e400, amb: 0.4, dif: 0.7, fill: 0.16, rim: 0.2 }, spine: { base: P.e100, amb: 0.45, dif: 0.7, fill: 0.16, rim: 0.2 } };
    for (const [name, h] of [['left', 0.7], ['right', 1.2], ['spine', 1.9]]) {
      const poly = FS.EMBLEM[name].map((p) => [(p[0] - 180) * K, (p[1] - 150) * K]);
      S.prism({ poly, y0: 0, y1: h * e, c: [0, 5.6 + 0.0, 0], rot: [Math.PI / 2, 0, 0], mat: mats[name], emit: P.e100, emitK: 0.3 * pulse });
    }
  };

  registerScene('integrations', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 8.4,
    scene: { fogNear: 34, fogFar: 90, fogMax: 0.5 },
    draw(ctx, t, S) {
      KIT.bg(ctx, W, H);
      S.setCamera({ target: [0, 3.2, 0], yaw: track(t, [[0, -0.5], [6, 0.1], [12, 0.6]]), pitch: track(t, [[0, 0.5], [12, 0.46]]), dist: 39, fov: 0.6, shift: [0, -4] });
      S.begin();
      KIT.floor(S, 0.1, t, 22, 1.6, 0.16);
      // orbit rings
      const gr = E.io3(seg(t, 0.4, 2.2));
      for (const r of [12, 16]) S.groundLine(Array.from({ length: 97 }, (_, i) => [Math.cos((i / 96) * TAU) * r * gr, 0.02, Math.sin((i / 96) * TAU) * r * gr]), P.e500, r === 12 ? 0.45 : 0.18, 1);
      const ce = E.settle(seg(t, 0.3, 1.8));
      core(S, ce, Math.max(0, Math.sin(t * 2)) * 0.2);
      S.box({ c: [0, 0.12, 0], s: [7, 0.24, 7], mat: { base: P.steel, amb: 0.5, dif: 0.5, fill: 0.2, rim: 0.2 }, edge: P.e600, edgeA: 0.6, shadow: false });

      NODES.forEach((n, i) => {
        const e = E.out5(seg(t, n.t0, n.t0 + 1.0));
        if (e > 0.01) {
          const hot = Math.exp(-Math.pow((t - n.fire - 0.5) / 0.6, 2));
          draw(S, n.parts, { pos: [n.pos[0], (1 - e) * -2.5, n.pos[2]], rot: [0, -n.a + Math.PI / 2, 0], scale: 1.5 * e, emit: P.e100, emitK: 0.4 * hot });
          S.prism({ poly: ngon(24, 1.6), y0: -0.05, y1: 0.05, c: [n.pos[0], 0, n.pos[2]], mat: { base: P.steel, amb: 0.5, dif: 0.5, fill: 0.2, rim: 0.2 }, shadow: false, alpha: e });
        }
        // the connection (spline from core to node)
        const pe = E.io3(seg(t, n.t0 + 0.2, n.t0 + 1.6));
        if (pe > 0.01) {
          const a = [0, 4.2, 0], b = [n.pos[0], 1.6, n.pos[2]];
          const pts = bez(a, [a[0] + n.pos[0] * 0.3, 8, a[2] + n.pos[2] * 0.3], [n.pos[0] * 0.75, 6.5, n.pos[2] * 0.75], b, 28);
          S.line({ pts, color: P.e700, alpha: 0.3, w: 1 });
          S.line({ pts: slicePoly(pts, 0, pe), color: P.e400, alpha: 0.7, w: 1.3, glow: true });
          // event packets
          for (let k = 0; k < 6; k++) {
            const ph = (t - n.fire) / 0.9 - k * 0.12;
            if (ph > 0 && ph < 1 && t > n.fire) S.dot({ c: pointAt(pts, ph), r: 0.14, color: P.e100, alpha: 1 - k * 0.15, bias: -30 });
          }
        }
      });
      S.flush();
      NODES.forEach((n, i) => {
        const a = E.smooth(seg(t, n.t0 + 0.5, n.t0 + 1.2)) * (1 - E.smooth(seg(t, 11.0, 11.6)));
        const p = S.project([n.pos[0], 0, n.pos[2]]); if (!p) return;
        const out = Math.cos(n.a) >= 0 ? 1 : -1;
        FS.text(ctx, n.name.toUpperCase(), p[0], p[1] + 34, { size: 13, mono: true, color: css(P.e100), alpha: a * 0.9, align: 'center', spacing: 1.2 });
        if (n.note && false) FS.text(ctx, n.note, p[0], p[1] + 50, { size: 12, mono: true, color: css(P.e300), alpha: a * 0.85, align: 'center', spacing: 1 });
        void out;
      });
      const ev = E.smooth(seg(t, 4.0, 4.6)) * (1 - E.smooth(seg(t, 9.8, 10.6)));
      FS.text(ctx, 'EVENT  response.completed', 640, 96, { size: 13, mono: true, color: css(P.e300), alpha: ev, align: 'center', spacing: 2 });
      KIT.loopFade(ctx, W, H, t, DUR);
      FS.vignette(ctx, W, H, 0.55);
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 09 — CONNECTED BY DESIGN', caption: t < 4 ? '01 THE CORE, AND ITS SUPPORTED INTEGRATION POINTS' : '02 EVENTS TRAVEL OUTWARD ALONG EACH CONNECTION [ILLUSTRATIVE TIMING]' });
    },
  });
})();
