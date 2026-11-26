/*
 * Shared geometry kit: the verified Formspear question types as small
 * architectural specimens (see QUESTION_TYPES in src/server.js), plus
 * annotation helpers used by several scenes.
 */
(function () {
  const { P, v, rotXYZ, css, TAU, E, seg, clamp, lerp } = FS;

  const MAT = {
    bone: { base: P.bone, amb: 0.36, dif: 0.64, fill: 0.14, rim: 0.05 },
    bone2: { base: P.bone2, amb: 0.34, dif: 0.62, fill: 0.14, rim: 0.05 },
    emerald: { base: P.e500, amb: 0.34, dif: 0.7, fill: 0.14, rim: 0.12 },
    mint: { base: P.e300, amb: 0.4, dif: 0.62, fill: 0.14, rim: 0.12 },
    deep: { base: P.e700, amb: 0.34, dif: 0.66, fill: 0.14, rim: 0.1 },
    steel: { base: P.steel2, amb: 0.5, dif: 0.55, fill: 0.2, rim: 0.2 },
    dark: { base: P.steel, amb: 0.5, dif: 0.5, fill: 0.2, rim: 0.2 },
    amber: { base: P.amber, amb: 0.4, dif: 0.65, fill: 0.14, rim: 0.1 },
    sky: { base: P.sky, amb: 0.4, dif: 0.62, fill: 0.14, rim: 0.12 },
    paper: { base: P.paper, amb: 0.4, dif: 0.6, fill: 0.14, rim: 0.05 },
  };

  const ngon = (n, r, rot = 0) => Array.from({ length: n }, (_, i) => [Math.cos(rot + (i * TAU) / n) * r, Math.sin(rot + (i * TAU) / n) * r]);
  const B = (c, s, m = 'bone') => ({ t: 'box', c, s, m });
  const PR = (c, poly, y0, y1, m = 'bone') => ({ t: 'prism', c, poly, y0, y1, m });

  /* Each specimen sits on y=0, footprint ~ 3.2 x 1.6, local origin at its centre. */
  const SPEC = {
    short_text: () => [B([0, 0.09, 0], [3.0, 0.18, 0.62], 'bone'), B([-1.32, 0.26, 0], [0.12, 0.34, 0.46], 'emerald'), B([-0.1, 0.2, 0], [1.4, 0.04, 0.1], 'steel')],
    long_text: () => [B([0, 0.08, -0.46], [3.0, 0.16, 0.3], 'bone'), B([0, 0.08, 0], [3.0, 0.16, 0.3], 'bone'), B([-0.6, 0.08, 0.46], [1.8, 0.16, 0.3], 'bone2'), B([1.36, 0.22, 0.46], [0.1, 0.28, 0.24], 'emerald')],
    single_choice: () => [-1, 0, 1].flatMap((k, i) => [PR([k * 1.05, 0, 0], ngon(16, 0.4), 0, 0.12, 'bone'), ...(i === 1 ? [PR([k * 1.05, 0, 0], ngon(16, 0.2), 0.12, 0.3, 'emerald')] : [])]),
    multiple_choice: () => [-1, 0, 1].map((k, i) => B([k * 1.05, i === 1 ? 0.32 : 0.15, 0], [0.62, i === 1 ? 0.64 : 0.3, 0.62], i === 1 ? 'emerald' : 'bone')),
    dropdown: () => [B([0, 0.11, 0], [3.0, 0.22, 0.7], 'bone'), PR([1.2, 0, 0], [[-0.28, -0.14], [0.28, -0.14], [0, 0.2]], 0.22, 0.34, 'emerald'), B([-0.5, 0.25, 0], [1.6, 0.06, 0.12], 'steel')],
    nps: () => Array.from({ length: 11 }, (_, i) => B([(i - 5) * 0.29, 0.07 + i * 0.045, 0], [0.22, 0.14 + i * 0.09, 0.62], i <= 6 ? 'steel' : i <= 8 ? 'bone' : 'emerald')),
    date: () => {
      const out = [B([0, 0.05, 0], [2.0, 0.1, 1.6], 'bone2')];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
        const hit = r === 1 && c === 3;
        out.push(B([(c - 2) * 0.34, hit ? 0.3 : 0.16, (r - 1) * 0.42], [0.26, hit ? 0.34 : 0.12, 0.3], hit ? 'emerald' : 'bone'));
      }
      return out;
    },
    file_upload: () => [B([0, 0.04, 0.2], [2.0, 0.08, 1.2], 'steel'), B([0, 0.2, 0.0], [2.0, 0.08, 1.2], 'bone2'), B([0, 0.36, -0.2], [2.0, 0.08, 1.2], 'bone'), PR([0, -0.2], [[-0.34, 0.3], [0.34, 0.3], [0, -0.3]], 0.44, 0.58, 'emerald')],
    section: () => [B([0, 0.08, -0.7], [3.2, 0.16, 0.12], 'mint'), B([0, 0.08, 0.7], [3.2, 0.16, 0.12], 'mint'), B([-1.54, 0.08, 0], [0.12, 0.16, 1.28], 'mint'), B([1.54, 0.08, 0], [0.12, 0.16, 1.28], 'mint')],
    header: () => [B([0, 0.14, 0], [3.2, 0.28, 0.9], 'dark'), B([-0.9, 0.31, 0], [1.2, 0.06, 0.2], 'bone'), B([0.9, 0.31, 0], [0.8, 0.06, 0.2], 'emerald')],
    submit: () => [B([0, 0.16, 0], [1.5, 0.32, 0.7], 'emerald'), B([0.45, 0.34, 0], [0.5, 0.04, 0.1], 'paper')],
  };

  function draw(S, parts, o) {
    const sc = typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : o.scale || [1, 1, 1];
    const rot = o.rot || [0, 0, 0];
    for (const p of parts) {
      const m0 = o.mat || MAT[p.m];
      const m = o.tint ? { ...m0, base: FS.mix3(m0.base, o.tint[0], o.tint[1]) } : m0;
      const local = [p.c[0] * sc[0], p.c[1] * sc[1], p.c[2] * sc[2]];
      const c = v.add(o.pos, rotXYZ(local, rot));
      if (p.t === 'box') S.box({ c, s: [p.s[0] * sc[0], p.s[1] * sc[1], p.s[2] * sc[2]], rot, mat: m, alpha: o.alpha, edge: o.edge, edgeA: o.edgeA, shadow: o.shadow, emit: o.emit, emitK: o.emitK });
      else {
        const poly = p.poly.map((q) => [q[0] * sc[0], q[1] * sc[2]]);
        S.prism({ poly, y0: p.y0 * sc[1], y1: p.y1 * sc[1], c: v.add(o.pos, rotXYZ([p.c[0] * sc[0], 0, p.c[1] * sc[2]], rot)), rot, mat: m, alpha: o.alpha, shadow: o.shadow, emit: o.emit, emitK: o.emitK });
      }
    }
  }

  /* Leader-line annotation: world anchor -> screen label. */
  function tag(ctx, S, anchor, label, o = {}) {
    const p = S.project(anchor); if (!p) return;
    const a = o.alpha ?? 1; if (a <= 0.01) return;
    const dx = o.dx ?? 60, dy = o.dy ?? -40, k = o.progress ?? 1;
    const x1 = p[0] + dx * k, y1 = p[1] + dy * k;
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = css(o.color || P.e300, 0.9); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(x1, y1); ctx.lineTo(x1 + (dx >= 0 ? 1 : -1) * (o.run ?? 26) * k, y1); ctx.stroke();
    ctx.fillStyle = css(o.color || P.e300); ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, TAU); ctx.fill();
    ctx.restore();
    if (k > 0.6) FS.text(ctx, label, x1 + (dx >= 0 ? 1 : -1) * ((o.run ?? 26) + 8), y1 + 4, { size: o.size || 12, mono: true, color: css(o.textColor || P.e100), alpha: a * seg(k, 0.6, 1), align: dx >= 0 ? 'left' : 'right', spacing: 1.4 });
  }

  /* Cubic bezier in 3D, returned as a polyline. */
  function bez(a, b, c, d, n = 24) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([0, 1, 2].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k]));
    }
    return out;
  }
  /* Part of a polyline between fractions f0..f1 (arc-length). */
  function slicePoly(pts, f0, f1) {
    const L = []; let tot = 0;
    for (let i = 1; i < pts.length; i++) { const d = v.len(v.sub(pts[i], pts[i - 1])); L.push(d); tot += d; }
    const a = f0 * tot, b = f1 * tot, out = []; let acc = 0;
    for (let i = 0; i < L.length; i++) {
      const s0 = acc, s1 = acc + L[i];
      if (L[i] > 1e-9 && s1 >= a && s0 <= b) {
        const ta = clamp((a - s0) / L[i]), tb = clamp((b - s0) / L[i]);
        if (!out.length) out.push(v.lerp(pts[i], pts[i + 1], ta));
        out.push(v.lerp(pts[i], pts[i + 1], tb));
      }
      acc = s1;
    }
    return out;
  }
  function pointAt(pts, f) {
    const sl = slicePoly(pts, clamp(f), clamp(f) + 1e-4); return sl[0] || pts[0];
  }

  /* World-space corners for a screenshot crop laid on a plane facing +z. */
  function planeCorners(x, y, w, h, z, o = {}) {
    const u = o.u ?? 0.0119, cx = o.cx ?? 720, cy = o.cy ?? 450, ox = o.ox ?? 0, oy = o.oy ?? 0;
    return [[(x - cx) * u + ox, (cy - y) * u + oy, z], [(x + w - cx) * u + ox, (cy - y) * u + oy, z], [(x + w - cx) * u + ox, (cy - y - h) * u + oy, z], [(x - cx) * u + ox, (cy - y - h) * u + oy, z]];
  }

  /* Common backdrop + loop fade so every scene shares one material language. */
  function bg(ctx, W, H, o = {}) {
    ctx.fillStyle = css(P.ground); ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H * 0.48, 30, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, `rgba(24,78,62,${o.glow ?? 0.36})`); g.addColorStop(1, 'rgba(8,17,15,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    FS.techGrid(ctx, W, H, { step: 64, alpha: o.grid ?? 0.15 });
  }
  function loopFade(ctx, W, H, t, dur, fin = 0.5, fout = 0.6) {
    const f = Math.max(1 - E.smooth(seg(t, 0, fin)), E.smooth(seg(t, dur - fout, dur)));
    if (f > 0) { ctx.fillStyle = css(P.ground, f); ctx.fillRect(0, 0, W, H); }
  }
  function floor(S, t0, t, R = 20, step = 1.5, a = 0.22) {
    const e = E.io3(seg(t, t0, t0 + 1.5)), n = Math.floor(R / step);
    for (let i = -n; i <= n; i++) {
      const al = a * e * (1 - Math.abs(i) / (n + 3));
      S.groundLine([[i * step, 0, -R], [i * step, 0, R]], P.e600, al);
      S.groundLine([[-R, 0, i * step], [R, 0, i * step]], P.e600, al);
    }
  }
  /* A box part-list placed as a named block: label + footprint. */
  function block(S, c, s, matKey, o = {}) { S.box({ c, s, mat: MAT[matKey], ...o }); }

  window.KIT = { bg, loopFade, floor, block, MAT, SPEC, ngon, draw, tag, bez, slicePoly, pointAt, planeCorners, B, PR };
})();
