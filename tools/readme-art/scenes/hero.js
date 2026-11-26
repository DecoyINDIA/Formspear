/*
 * 01 — THE EMERGENCE OF ORDER  (hero, Level 5)
 * One population of modules travels through six poses:
 *   scatter (orbital entropy) -> staging lattice -> twisted blade tower
 *   -> relief mosaic of the Formspear emblem -> scatter (seamless loop).
 * Everything is a pure function of t. Loop length DUR; orbit rates are integer
 * multiples of 2*pi/DUR so frame(DUR) === frame(0).
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, rng, track, wrapPI } = FS;
  const W = 1280, H = 720, DUR = 14, FPS = 30;

  const R = rng(20260628);
  const MATS = {
    bone: { base: P.bone, amb: 0.36, dif: 0.64, fill: 0.14, rim: 0.05 },
    bone2: { base: P.bone2, amb: 0.34, dif: 0.62, fill: 0.14, rim: 0.05 },
    emerald: { base: P.e500, amb: 0.34, dif: 0.7, fill: 0.14, rim: 0.12 },
    steel: { base: P.steel2, amb: 0.5, dif: 0.55, fill: 0.2, rim: 0.2 },
    amber: { base: P.amber, amb: 0.4, dif: 0.65, fill: 0.14, rim: 0.1 },
  };
  const CLASSES = ['bone', 'bone', 'bone2', 'bone2', 'steel', 'steel', 'emerald'];

  /* ---- target 1: emblem relief mosaic (cells classified against the real emblem polygons) */
  const K = 0.082;            // world units per emblem unit
  const CS = 3.9;             // cell size in emblem units
  const emblemCells = [];
  for (let ey = 65 + CS / 2; ey < 218; ey += CS) {
    for (let ex = 115 + CS / 2; ex < 245; ex += CS) {
      const p = [ex, ey];
      let kind = null;
      if (FS.pointInPoly(p, FS.EMBLEM.spine)) kind = 'spine';
      else if (FS.pointInPoly(p, FS.EMBLEM.left)) kind = 'left';
      else if (FS.pointInPoly(p, FS.EMBLEM.right)) kind = 'right';
      else if (FS.pointInPoly(p, FS.EMBLEM.outline)) kind = 'rim';
      if (!kind) continue;
      emblemCells.push({ kind, c: [(ex - 180) * K, 0, (ey - 150) * K] });
    }
  }
  emblemCells.sort((a, b) => a.c[2] - b.c[2] || a.c[0] - b.c[0]);

  /* ---- target 2: twisted blade tower (parametric brise-soleil) */
  const FLOORS = 30, BLADES = 18;
  const tower = [];
  for (let f = 0; f < FLOORS; f++) {
    const u = f / (FLOORS - 1);
    const r = 2.3 + 2.6 * Math.pow(Math.abs(u - 0.42) * 1.75, 1.5);
    for (let j = 0; j < BLADES; j++) {
      const phi = (j * TAU) / BLADES + f * 0.17 + (f % 2) * (Math.PI / BLADES);
      const len = 0.92 * ((TAU * r) / BLADES) * (0.82 + 0.18 * Math.sin(f * 0.8 + j * 1.3));
      tower.push({
        c: [r * Math.cos(phi), 0.2 + f * 0.27, r * Math.sin(phi)],
        s: [len, 0.2, 0.26],
        cls: ((j + f * 5) % 9 === 0) ? 'emerald' : (j % 6 === 3 && f % 7 === 3 ? 'amber' : (f % 2 ? 'bone' : 'bone2')),
        ry: Math.atan2(-Math.cos(phi), -Math.sin(phi)),
        floor: f,
      });
    }
  }

  const M = Math.max(tower.length, emblemCells.length);
  const mods = [];
  for (let i = 0; i < M; i++) {
    const cls = R.pick(CLASSES);
    const kind = R.pick(['blade', 'plate', 'cube', 'pillar', 'blade', 'plate']);
    const sizes = { blade: [1.5, 0.2, 0.42], plate: [0.9, 0.1, 0.9], cube: [0.5, 0.5, 0.5], pillar: [0.24, 1.2, 0.24] };
    const sc = R.range(0.6, 1.1);
    const ang = R.range(0, TAU), rad = Math.pow(R(), 0.6) * 13 + 6;
    mods.push({
      i, cls: i < tower.length ? tower[i].cls : cls, glass: R() < 0.06,
      s0: sizes[kind].map((x) => x * sc),
      orb: { a: ang, r: rad, k: R.pick([-2, -1, -1, 1, 1, 2]), y: R.range(-1.5, 9), ya: R.range(0.3, 1.8), ym: R.pick([1, 2, 3]), yp: R.range(0, TAU), zr: R.range(0.55, 0.95) },
      rot0: [R.range(0, TAU), R.range(0, TAU), R.range(0, TAU)],
      rk: [R.pick([-1, 0, 1]), R.pick([-2, -1, 1, 2]), R.pick([-1, 0, 1])],
      grp: i % 6,
      wob: [R.range(-1, 1), R.range(-1, 1), R.range(-1, 1)],
      tw: i < tower.length ? tower[i] : null,
      ec: null,
    });
  }
  // emblem assignment: tower floors (bottom->top) sweep onto cells (north->south)
  mods.forEach((m, i) => { m.ec = i < emblemCells.length ? emblemCells[i] : null; });
  const NSTAGE = M;
  // staging lattice: ONE flat layer of identical tiles on a square grid. Tiles nearest the
  // centre become the lowest tower floors, so the lattice opens up from the middle outward.
  const SIDE = Math.ceil(Math.sqrt(M * 1.08)), PITCH = 1.12;
  const latticeCells = [];
  for (let z = 0; z < SIDE; z++) for (let x = 0; x < SIDE; x++) {
    const cx = (x - (SIDE - 1) / 2) * PITCH, cz = (z - (SIDE - 1) / 2) * PITCH;
    latticeCells.push({ c: [cx, 0.13, cz], d: Math.hypot(cx, cz) + ((x * 7 + z * 13) % 5) * 0.01 });
  }
  latticeCells.sort((a, b) => a.d - b.d);
  mods.forEach((m, i) => { m.gs = { c: latticeCells[i].c, s: [0.92, 0.26, 0.92] }; });

  const T_STAGE = [
    ['ENTROPY', 0, 2.0, 'Independent fragments. No shared reference.'],
    ['RECOGNITION', 2.0, 4.0, 'Relationships surface between fragments.'],
    ['ALIGNMENT', 4.0, 6.6, 'Fragments converge on a shared mathematical grid.'],
    ['CONSTRUCTION', 6.6, 9.2, 'Modules assemble into a parametric structure.'],
    ['IDENTITY', 9.2, 10.8, 'The structure resolves into the Formspear emblem.'],
    ['RESOLUTION', 10.8, 12.6, 'Order from complexity.'],
    ['ENTROPY', 12.6, 14.1, 'The structure releases. The cycle restarts.'],
  ];

  function scatter(m, t) {
    const o = m.orb, ph = (TAU * t) / DUR;
    const a = o.a + o.k * ph;
    // composite flow: orbit + two integer-frequency perturbations (loop-safe)
    const fx = 0.9 * Math.sin(ph * 3 + m.i * 0.7), fz = 0.9 * Math.cos(ph * 2 + m.i * 1.1);
    return {
      c: [o.r * Math.cos(a) + fx, o.y + o.ya * Math.sin(ph * o.ym + o.yp), o.r * o.zr * Math.sin(a) + fz],
      r: [m.rot0[0] + m.rk[0] * ph, m.rot0[1] + m.rk[1] * ph, m.rot0[2] + m.rk[2] * ph],
      s: m.s0,
    };
  }

  const eIn = (t, a, d) => clamp((t - a) / d);

  function pose(m, t) {
    const base = scatter(m, t);
    let c = base.c, r = base.r, s = base.s, k = [0, 0, 0, 0]; // k: stage activation for colour/secondary
    const move = (e, tc, tr, ts) => {
      if (e <= 0) return;
      const lift = Math.sin(Math.PI * e);
      const ee = e;
      c = v.lerp(c, tc, ee);
      r = [lerp(r[0], tr[0], ee), lerp(r[1], tr[1], ee), lerp(r[2], tr[2], ee)];
      s = [lerp(s[0], ts[0], ee), lerp(s[1], ts[1], ee), lerp(s[2], ts[2], ee)];
      c = [c[0], c[1] + lift * 0.7, c[2]];
      r = [r[0] + lift * 0.35 * m.wob[0], r[1] + lift * 0.35 * m.wob[1], r[2] + lift * 0.35 * m.wob[2]];
    };
    // wrapped rotation targets (shortest path from current rotation)
    const near = (cur, tgt) => [cur[0] + wrapPI(tgt[0] - cur[0]), cur[1] + wrapPI(tgt[1] - cur[1]), cur[2] + wrapPI(tgt[2] - cur[2])];

    // 1) staging lattice
    const e1 = E.anticipate(eIn(t, 4.0 + m.grp * 0.16 + (m.i % 5) * 0.03, 1.5));
    if (e1 > 0) { k[0] = clamp(e1); move(clamp(e1), m.gs.c, near(r, [0, 0, 0]), m.gs.s); }
    // 2) tower
    if (m.tw) {
      const e2 = E.io3(eIn(t, 6.6 + m.tw.floor * 0.055 + (m.i % 3) * 0.02, 1.3));
      if (e2 > 0) { k[1] = e2; move(e2, m.tw.c, near(r, [0, m.tw.ry, 0]), m.tw.s); }
    } else {
      const e2 = E.io3(eIn(t, 7.6, 1.2));
      if (e2 > 0) { k[1] = e2; move(e2, [0, 8.6, 0], r, [0.01, 0.01, 0.01]); }
    }
    // 3) emblem relief
    const eIdx = m.i / M;
    const e3 = E.io3(eIn(t, 9.2 + eIdx * 0.55, 1.0));
    if (e3 > 0) {
      k[2] = e3;
      if (m.ec) {
        const h = m.ec.kind === 'spine' ? 0.95 : m.ec.kind === 'right' ? 0.62 : m.ec.kind === 'left' ? 0.4 : 0.14;
        const cs = CS * K * 0.88;
        move(e3, [m.ec.c[0], h / 2, m.ec.c[2]], near(r, [0, 0, 0]), [cs, h, cs]);
      } else move(e3, [0, 0.2, 0], r, [0.01, 0.01, 0.01]);
    }
    // 4) release to scatter (loop)
    const e4 = E.io3(eIn(t, 12.6 + m.grp * 0.1 + (m.i % 7) * 0.02, 1.2));
    if (e4 > 0) {
      k[3] = e4;
      const sc = scatter(m, t);
      const lift = Math.sin(Math.PI * e4);
      c = v.lerp(c, sc.c, e4); c = [c[0], c[1] + lift * 1.2, c[2]];
      r = [lerp(r[0], sc.r[0], e4), lerp(r[1], sc.r[1], e4), lerp(r[2], sc.r[2], e4)];
      s = [lerp(s[0], sc.s[0], e4), lerp(s[1], sc.s[1], e4), lerp(s[2], sc.s[2], e4)];
    }
    return { c, r, s, k };
  }

  function colourFor(m, p) {
    // module material by class -> emblem facet colours during identity
    let mat = MATS[m.cls];
    let base = mat.base;
    if (m.ec && p.k[2] > 0) {
      const tgt = m.ec.kind === 'spine' ? P.e100 : m.ec.kind === 'right' ? P.e300 : m.ec.kind === 'left' ? FS.hex('#064e3b') : FS.hex('#0b7a5a');
      const w = p.k[2] * (1 - p.k[3]);
      base = FS.mix3(base, tgt, w);
    }
    return { ...mat, base };
  }

  function stageAt(t) { return T_STAGE.find((s) => t >= s[1] && t < s[2]) || T_STAGE[T_STAGE.length - 1]; }

  function camera(t) {
    return {
      target: track(t, [[0, [0, 2.4, 0]], [4, [0, 2.0, 0]], [6.6, [0, 3.2, 0]], [9.2, [0, 4.0, 0]], [10.6, [0, 0.3, 0]], [14, [0, 2.4, 0]]]),
      yaw: track(t, [[0, 0.55], [4, 0.95], [6.6, 1.35], [9.2, 2.3], [10.8, 0.0], [12.6, 0.0], [14, 0.55]], E.io3),
      pitch: track(t, [[0, 0.34], [4, 0.5], [6.6, 0.34], [9.2, 0.3], [10.8, 1.16], [12.6, 1.18], [14, 0.34]]),
      dist: track(t, [[0, 36], [4, 32], [6.6, 27], [9.2, 25], [10.8, 27], [12.6, 26], [14, 36]]),
      fov: 0.62,
      shift: track(t, [[0, [0, 0]], [9.4, [0, 0]], [10.9, [-318, 6]], [12.7, [-318, 6]], [13.9, [0, 0]]]),
    };
  }

  function drawWordmark(ctx, t) {
    const a = seg(t, 10.0, 10.2) * (1 - E.smooth(seg(t, 12.7, 13.5)));
    if (a <= 0) return;
    const letters = 'FORMSPEAR', size = 92, x0 = 598, y = 360;
    const trk = lerp(40, 6, E.out5(seg(t, 10.0, 11.7)));
    const widths = letters.split('').map((ch) => FS.measure(ctx, ch, { size, weight: 700 }));
    const total = widths.reduce((s, w) => s + w, 0) + trk * (letters.length - 1);
    ctx.save();
    ctx.globalAlpha = a;
    let x = x0 - 0.0 * total;
    const exit = E.in3(seg(t, 12.7, 13.5)) * 70;
    letters.split('').forEach((ch, i) => {
      const q = E.out5(seg(t, 10.0 + i * 0.075, 10.0 + i * 0.075 + 0.75));
      ctx.save();
      ctx.beginPath(); ctx.rect(x - 8 + exit, y - size * 0.8, widths[i] + 16, size * 0.95); ctx.clip();
      const col = i < 4 ? css(P.bone) : css(P.e400);
      FS.text(ctx, ch, x + exit, y + (1 - q) * size * 0.95, { size, weight: 700, color: col });
      ctx.restore();
      x += widths[i] + trk;
    });
    // measure line + ticks
    const ml = E.io3(seg(t, 10.8, 11.6));
    const xe = x0 + total * ml + exit;
    ctx.strokeStyle = css(P.e500, 0.8); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0 + exit, y + 30); ctx.lineTo(xe, y + 30); ctx.stroke();
    for (const tx of [x0 + exit, xe]) { ctx.beginPath(); ctx.moveTo(tx, y + 24); ctx.lineTo(tx, y + 36); ctx.stroke(); }
    // ORDER FROM COMPLEXITY, decoding
    const sub = 'ORDER FROM COMPLEXITY';
    const glyphs = '#%&*+=/\\|<>?01';
    let out = '';
    for (let i = 0; i < sub.length; i++) {
      const res = 10.9 + i * 0.03 + 0.3;
      if (sub[i] === ' ') { out += ' '; continue; }
      if (t >= res) out += sub[i];
      else if (t > res - 0.32) { const rr = rng((i + 1) * 7919 + Math.floor(t * 24)); out += glyphs[Math.floor(rr() * glyphs.length)]; }
      else out += ' ';
    }
    const settled = out === sub;
    FS.text(ctx, out, x0 + 2 + exit, y + 74, { size: 20, mono: true, weight: 500, spacing: 7.4, color: settled ? css(P.bone) : css(P.e300) });
    FS.text(ctx, 'FORMS · SURVEYS · FEEDBACK OPERATIONS', x0 + 2 + exit, y + 112, { size: 12, mono: true, spacing: 3.4, color: css(P.e100), alpha: 0.5 * ml });
    ctx.restore();
  }

  window.__hero = { mods, pose, tower, emblemCells };
  registerScene("hero", {
    w: W, h: H, fps: FPS, dur: DUR, poster: 12.2,
    scene: { fogNear: 22, fogFar: 70, fogMax: 0.85 },
    draw(ctx, t, S) {
      // backdrop: matte ground tone + soft key-light pool
      ctx.fillStyle = css(P.ground); ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W * 0.5, H * 0.46, 40, W * 0.5, H * 0.5, W * 0.7);
      g.addColorStop(0, 'rgba(24,78,62,0.42)'); g.addColorStop(1, 'rgba(8,17,15,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      FS.techGrid(ctx, W, H, { step: 64, alpha: 0.18 });

      S.setCamera(camera(t)); S.begin();

      // ground lattice (draws outward from the centre after recognition)
      const gr = E.io3(seg(t, 2.3, 5.2)) * 16;
      const gfade = 1 - E.smooth(seg(t, 12.4, 13.8));
      if (gr > 0.1) {
        for (let i = -13; i <= 13; i++) {
          const x = i * 1.15, span = Math.sqrt(Math.max(0, gr * gr - x * x));
          const a = (0.34 - Math.abs(i) * 0.012) * gfade * (i % 5 === 0 ? 1.5 : 1);
          if (span > 0.2) {
            S.groundLine([[x, 0, -span], [x, 0, span]], P.e600, a, 1);
            S.groundLine([[-span, 0, x], [span, 0, x]], P.e600, a, 1);
          }
        }
      }

      // draw modules
      const poses = mods.map((m) => pose(m, t));
      mods.forEach((m, i) => {
        const p = poses[i];
        if (p.s[0] < 0.03 && p.s[1] < 0.03) return;
        const mat = colourFor(m, p);
        S.box({ c: p.c, s: p.s, rot: p.r, mat, alpha: m.glass && p.k[2] < 0.5 ? 0.42 : undefined, edge: m.glass && p.k[2] < 0.5 ? P.sky : undefined, edgeA: 0.8 });
      });

      // recognition: nearest-neighbour relationships + directed paths + pulses
      const rec = E.smooth(seg(t, 2.0, 3.0)) * (1 - E.smooth(seg(t, 4.6, 6.2)));
      if (rec > 0.01) {
        const pos = poses.map((p) => p.c);
        for (let i = 0; i < mods.length; i += 2) {
          let b1 = -1, d1 = 1e9, b2 = -1, d2 = 1e9;
          for (let j = 0; j < mods.length; j++) {
            if (j === i) continue;
            const d = (pos[i][0] - pos[j][0]) ** 2 + (pos[i][1] - pos[j][1]) ** 2 + (pos[i][2] - pos[j][2]) ** 2;
            if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = j; } else if (d < d2) { d2 = d; b2 = j; }
          }
          for (const [j, d] of [[b1, d1], [b2, d2]]) {
            if (j < 0 || d > 36) continue;
            const al = rec * (1 - d / 36) * 0.85;
            S.line({ pts: [pos[i], pos[j]], color: mods[i].grp === mods[j].grp ? P.e300 : P.sky, alpha: al, w: 1, glow: true, bias: 40 });
            const ph = (t * 0.7 + (i * 0.173)) % 1;
            S.dot({ c: v.lerp(pos[i], pos[j], ph), r: 0.07, color: P.e100, alpha: al, bias: 40 });
          }
        }
        // organising intelligence: curved intent paths from each module toward the staging lattice
        const ia = E.smooth(seg(t, 2.8, 3.6)) * (1 - E.smooth(seg(t, 5.2, 6.4)));
        if (ia > 0.01) {
          for (let i = 0; i < mods.length; i += 5) {
            const m = mods[i], a = pos[i], b = m.gs.c;
            const mid = v.add(v.lerp(a, b, 0.5), [0, 2.2, 0]);
            const pts = []; for (let u = 0; u <= 1.001; u += 0.1) {
              pts.push(v.add(v.add(v.mul(a, (1 - u) ** 2), v.mul(mid, 2 * u * (1 - u))), v.mul(b, u * u)));
            }
            S.line({ pts, color: P.amber, alpha: ia * 0.55, w: 1, dash: [5, 6], dashOffset: -t * 24, bias: 50 });
          }
        }
      }

      // identity: laser-drawn emblem contour on the ground + centre beacon
      const oc = seg(t, 9.6, 10.9) * (1 - E.smooth(seg(t, 12.5, 13.3)));
      if (oc > 0) {
        const pts = FS.EMBLEM.outline.map((p) => [(p[0] - 180) * K, 0.03, (p[1] - 150) * K]);
        pts.push(pts[0]);
        const total = E.io3(seg(t, 9.6, 10.9));
        const n = Math.max(2, Math.floor(total * 40));
        // sample the polyline proportionally
        const lens = []; let L = 0; for (let i = 1; i < pts.length; i++) { const d = v.len(v.sub(pts[i], pts[i - 1])); lens.push(d); L += d; }
        const draw = []; let rem = total * L; draw.push(pts[0]);
        for (let i = 0; i < lens.length && rem > 0; i++) {
          const f = Math.min(1, rem / lens[i]); draw.push(v.lerp(pts[i], pts[i + 1], f)); rem -= lens[i];
        }
        void n;
        S.line({ pts: draw, color: P.e300, alpha: oc, w: 2, glow: true, bias: -60 });
        S.dot({ c: [0, 1.05 + 0.05 * Math.sin(t * 3), 0], r: 0.05, color: P.e100, alpha: oc * 0.9, bias: -80 });
      }

      S.flush();
      FS.vignette(ctx, W, H, 0.6);

      drawWordmark(ctx, t);

      const st = stageAt(t);
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 01 — THE EMERGENCE OF ORDER', caption: `${String(T_STAGE.indexOf(st) + 1).padStart(2, '0')} ${st[0]} — ${st[3].toUpperCase()}` });
    },
  });
})();
