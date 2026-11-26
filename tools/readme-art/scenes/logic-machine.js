/*
 * 06 — THE LOGIC MACHINE  (Level 5)
 * A survey's rule graph as a spatial machine. Rule ACTIONS shown are the
 * engine's real action types (show_question, skip_to_question, trigger_alert).
 * The score thresholds are an illustrative rule set. The blocked back-edge
 * reproduces the engine's real validation outcome:
 *   "Circular logic paths are blocked."  /  "Skip logic must point to a later question."
 */
(function () {
  const { E, P, v, css, lerp, seg, clamp, TAU, track } = FS;
  const { SPEC, draw, tag, bez, slicePoly, pointAt } = KIT;
  const W = 1280, H = 720, DUR = 12, FPS = 24;

  const N = {
    q1: { pos: [-9, 0, 0], spec: null, label: 'Q1 · nps' },
    q2: { pos: [-1.5, 0, 4.2], spec: 'long_text', label: 'Q2 · long_text' },
    al: { pos: [6.5, 0, 6.0], spec: null, label: 'trigger_alert' },
    q3: { pos: [-1.5, 0, -4.8], spec: 'single_choice', label: 'Q3 · single_choice' },
    q4: { pos: [8, 0, -0.5], spec: 'header', label: 'Q4 · statement' },
  };
  const parts = Object.fromEntries(Object.entries(N).map(([k, n]) => [k, n.spec ? SPEC[n.spec]() : null]));
  const top = (k, y = 0.5) => [N[k].pos[0], y, N[k].pos[2]];

  // edges: curved rule paths
  const EDGE = {
    toQ2: bez(top('q1', 0.6), [-6, 3.5, 1], [-5, 3.0, 3.6], top('q2', 0.4)),
    toAl: bez(top('q2'), [2, 3.2, 4.6], [4, 3.2, 6], top('al', 0.4)),
    toQ3: bez(top('q1', 0.6), [-6, 2.5, -1], [-5, 2.5, -4.2], top('q3', 0.4)),
    q2q4: bez(top('q2'), [3, 2.5, 3.5], [6, 2.5, 2], top('q4', 0.4)),
    q3q4: bez(top('q3'), [3, 2.5, -4.5], [6, 2.5, -3], top('q4', 0.4)),
    skip: bez(top('q1', 1.4), [-6, 10, -0.5], [3, 10, -0.5], top('q4', 0.9), 40),
    back: bez(top('q4', 0.4), [3, 6.5, 6], [-8, 6.5, 6], top('q1', 0.6), 40),
  };

  const SCORE = (t) => (t < 1.6 ? 6 : t < 2.5 ? lerp(6, 4, E.io3(seg(t, 1.6, 2.5))) : t < 5.0 ? 4 : t < 6.0 ? lerp(4, 9, E.io3(seg(t, 5.0, 6.0))) : 9);

  function camera(t) {
    return {
      target: [-0.5, 0.5, 2.2],
      yaw: track(t, [[0, 0.7], [4, 0.45], [8, 0.2], [12, 0.7]]),
      pitch: track(t, [[0, 0.72], [6, 0.82], [12, 0.72]]),
      dist: track(t, [[0, 31], [4, 28], [8, 28], [12, 31]]),
      fov: 0.62,
    };
  }

  registerScene('logic-machine', {
    w: W, h: H, fps: FPS, dur: DUR, poster: 7.2,
    scene: { fogNear: 30, fogFar: 80, fogMax: 0.55 },
    draw(ctx, t, S) {
      ctx.fillStyle = css(P.ground); ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H * 0.5, 40, W / 2, H / 2, W * 0.7);
      g.addColorStop(0, 'rgba(24,78,62,0.36)'); g.addColorStop(1, 'rgba(8,17,15,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      FS.techGrid(ctx, W, H, { step: 64, alpha: 0.15 });
      S.setCamera(camera(t)); S.begin();

      // activation per scenario ---------------------------------------------------
      const s1 = pulseWin(t, 2.4, 3.0, 4.7, 5.2);   // low score: Q2 + alert
      const s2 = pulseWin(t, 6.0, 6.8, 8.1, 8.5);   // high score: skip to Q4
      const rise = E.out5(seg(t, 0.1, 1.4));
      const act = {
        q1: 1, q4: 1,
        q2: Math.max(0.14, s1), al: Math.max(0.1, s1 * seg(t, 3.0, 3.6)), q3: Math.max(0.14, 0.14 + (1 - s1 - s2) * 0.0),
      };
      // Q3 stays dimmed/withdrawn in both scenarios (a distinct path with no active rule here)
      act.q3 = 0.14 + 0.0;

      // ground lattice
      for (let i = -12; i <= 12; i++) {
        const a = 0.22 * (1 - Math.abs(i) / 14);
        S.groundLine([[i * 1.5, 0, -18], [i * 1.5, 0, 18]], P.e600, a);
        S.groundLine([[-20, 0, i * 1.5], [20, 0, i * 1.5]], P.e600, a);
      }

      // nodes ---------------------------------------------------------------------
      for (const [k, n] of Object.entries(N)) {
        const a = k === 'q1' || k === 'q4' ? 1 : act[k];
        const lift = (a - 0.14) / 0.86; // 0 = withdrawn, 1 = active
        const y = (k === 'q1' || k === 'q4') ? 0 : -1.3 + lift * 1.3;
        const tint = k === 'q1' || k === 'q4' ? null : [P.ground, 0.72 * (1 - lift)];
        const pos = [n.pos[0], y * rise - (1 - rise) * 3, n.pos[2]];
        if (k === 'al') {
          // alert beacon: amber prism lit when triggered
          const lit = lift;
          S.prism({ poly: KIT.ngon(6, 0.9), y0: 0, y1: 0.4 + lit * 0.5, c: pos, mat: { base: FS.mix3(P.steel, P.amber, lit), amb: 0.4, dif: 0.6, fill: 0.14, rim: 0.1 }, emit: P.amber, emitK: 0.4 * lit });
          if (lit > 0.05) S.dot({ c: [pos[0], pos[1] + 1.5 + lit * 0.5, pos[2]], r: 0.2, color: P.amber, alpha: lit });
        } else {
          if (parts[k]) draw(S, parts[k], { pos, scale: 1.15, tint });
        }
      }

      // NPS selector: the input that drives the machine
      const sc = SCORE(t);
      const sel = Math.round(sc);
      for (let i = 0; i <= 10; i++) {
        const on = i === sel;
        const h = 0.3 + i * 0.1 + (on ? 0.8 : 0);
        S.box({ c: [N.q1.pos[0] + (i - 5) * 0.52, h / 2 + rise * 0, N.q1.pos[2]], s: [0.4, h, 0.9], mat: { base: on ? (sel <= 6 ? P.amber : P.e400) : i <= 6 ? P.steel2 : i <= 8 ? P.bone2 : P.e600, amb: 0.4, dif: 0.65, fill: 0.14, rim: 0.1 }, emit: on ? P.e100 : null, emitK: on ? 0.35 : 0 });
      }

      // rule edges ------------------------------------------------------------------
      const edge = (pts, k, color, o = {}) => {
        if (k <= 0.005) { S.line({ pts, color: P.e700, alpha: 0.28, w: 1 }); return; }
        const seg1 = slicePoly(pts, 0, clamp(k));
        S.line({ pts: pts, color: P.e700, alpha: 0.2, w: 1 });
        S.line({ pts: seg1, color, alpha: 0.95, w: o.w || 2, glow: true, bias: 30 });
        for (let q = 0; q < 3; q++) S.dot({ c: pointAt(pts, ((t * 0.55 + q / 3) % 1) * clamp(k)), r: 0.12, color: P.e100, alpha: 0.9, bias: 30 });
      };
      const a1 = E.io3(seg(t, 2.6, 3.4)) * (1 - E.smooth(seg(t, 4.9, 5.4)));
      edge(EDGE.toQ2, a1, P.e400);
      edge(EDGE.toAl, E.io3(seg(t, 3.2, 4.0)) * (1 - E.smooth(seg(t, 4.9, 5.4))), P.amber);
      edge(EDGE.toQ3, 0, P.e400);
      edge(EDGE.q2q4, 0, P.e400); edge(EDGE.q3q4, 0, P.e400);
      const ak = E.io3(seg(t, 6.2, 7.4)) * (1 - E.smooth(seg(t, 8.2, 8.6)));
      edge(EDGE.skip, ak, P.e300, { w: 2.4 });
      // blocked circular edge: grows, is rejected, collapses
      const bk = E.io3(seg(t, 8.7, 9.7));
      const bkOut = E.io3(seg(t, 10.3, 11.1));
      if (bk > 0.01) {
        const pts = slicePoly(EDGE.back, bkOut, bk);
        if (pts.length > 1) S.line({ pts, color: P.amber, alpha: 0.95, w: 1.8, dash: [7, 6], dashOffset: -t * 30, glow: true, bias: 30 });
        if (bk >= 1 && bkOut < 0.2) {
          const hit = top('q1', 0.9);
          const q = clamp((t - 9.7) / 0.5);
          for (const sgn of [-1, 1]) S.line({ pts: [[hit[0] - 0.7, hit[1] + 0.7 * sgn, hit[2] - 0.7], [hit[0] + 0.7, hit[1] - 0.7 * sgn, hit[2] + 0.7]], color: P.amber, alpha: 1 - 0.3 * q, w: 2.4, glow: true, bias: -10 });
        }
      }
      S.flush();

      // annotations ------------------------------------------------------------------
      const lab = (anchor, text, a, o = {}) => tag(ctx, S, anchor, text, { alpha: a, dx: o.dx ?? 40, dy: o.dy ?? -46, run: 18 });
      lab(top('q1', 2.4), `INPUT  nps = ${Math.round(sc)}`, seg(t, 1.0, 1.6), { dx: -40, dy: -60 });
      lab(top('q2', 1.6), 'show_question', E.smooth(seg(t, 3.2, 3.8)) * (1 - seg(t, 4.8, 5.2)), { dx: 50, dy: -50 });
      lab(top('al', 1.6), 'trigger_alert', E.smooth(seg(t, 4.0, 4.5)) * (1 - seg(t, 4.8, 5.2)), { dx: 50, dy: -30 });
      lab(top('q3', 1.0), 'withdrawn', E.smooth(seg(t, 3.0, 3.6)) * (1 - seg(t, 8.5, 9.0)) * 0.7, { dx: 50, dy: -30 });
      lab(pointAt(EDGE.skip, 0.5), 'skip_to_question', E.smooth(seg(t, 6.9, 7.5)) * (1 - seg(t, 8.0, 8.4)), { dx: 40, dy: -34 });
      lab(pointAt(EDGE.back, 0.5), 'Circular logic paths are blocked.', E.smooth(seg(t, 9.6, 10.0)) * (1 - seg(t, 10.5, 11.0)), { dx: -40, dy: 50 });

      // condition ticker
      const cond = t < 5.5 ? 'IF nps ≤ 6  →  show_question(Q2) + trigger_alert' : t < 8.6 ? 'IF nps ≥ 9  →  skip_to_question(Q4)' : 'RULE  Q4 → Q1  ✕  circular logic paths are blocked';
      const ca = t < 1.2 ? 0 : 1 - E.smooth(seg(t, 11.2, 11.8));
      FS.text(ctx, cond, 640, 92, { size: 14, mono: true, color: css(t > 8.7 ? P.amber : P.e100), alpha: 0.85 * ca, align: 'center', spacing: 1.2 });

      const fade = Math.max(1 - E.smooth(seg(t, 0, 0.5)), E.smooth(seg(t, 11.4, 12)));
      if (fade > 0) { ctx.fillStyle = css(P.ground, fade); ctx.fillRect(0, 0, W, H); }
      FS.vignette(ctx, W, H, 0.55);
      const cap = t < 2.4 ? '01 THE RULE GRAPH — ILLUSTRATIVE RULE SET' : t < 5.6 ? '02 DETRACTOR SCORE — THE ACTIVE WORKFLOW REORGANISES' : t < 8.6 ? '03 PROMOTER SCORE — UNNEEDED BRANCHES WITHDRAW' : '04 A CIRCULAR RULE IS REFUSED';
      FS.frame(ctx, W, H, t, DUR, { fig: 'FIG. 04 — THE LOGIC MACHINE', caption: cap });
    },
  });

  function pulseWin(t, a, b, c, d) { return E.smooth(seg(t, a, b)) * (1 - E.smooth(seg(t, c, d))); }
})();
