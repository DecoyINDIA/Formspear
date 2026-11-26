/*
 * Formspear README art engine
 * ---------------------------------------------------------------------------
 * A small deterministic pseudo-3D renderer on Canvas 2D. No dependencies.
 * Every scene is a pure function of time: draw(ctx, t, S) -> pixels.
 * That makes frame capture reproducible (same inputs, same frames).
 *
 * Contents: math/easing, colour helpers, seeded RNG, perspective camera,
 * convex-polyhedron rasteriser with directional lighting + fog + projected
 * shadows, 3D line/dot primitives, and typographic/HUD helpers.
 */
(function () {
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /* ---------------------------------------------------------------- easing */
  const E = {
    lin: (t) => t,
    in2: (t) => t * t,
    out2: (t) => 1 - (1 - t) * (1 - t),
    io2: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    in3: (t) => t * t * t,
    out3: (t) => 1 - Math.pow(1 - t, 3),
    io3: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out5: (t) => 1 - Math.pow(1 - t, 5),
    io5: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    ioExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    /* small pull-back before the move: anticipation */
    anticipate: (t, a = 0.07) => {
      const base = E.io3(t);
      const k = t < 0.28 ? Math.sin((t / 0.28) * Math.PI) : 0;
      return base - a * k;
    },
    /* critically-ish damped settle: physically inspired arrival */
    settle: (t) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.exp(-6.5 * t) * Math.cos(9.5 * t)),
    smooth: (t) => t * t * (3 - 2 * t),
    smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  };
  const pulse = (t, a, b, c, d) => E.smooth(seg(t, a, b)) * (1 - E.smooth(seg(t, c, d)));

  /* ------------------------------------------------------------------- rng */
  function rng(seed) {
    let a = seed >>> 0;
    const f = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + (hi - lo) * f();
    f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
    f.sign = () => (f() < 0.5 ? -1 : 1);
    return f;
  }

  /* ---------------------------------------------------------------- colour */
  const hex = (h) => {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  /* Formspear brand palette: verified from assets/readme/brand-identity.svg
     (emerald ramp + sky + amber on #08110F) and the application UI (#176B5B). */
  const P = {
    ink: hex('#06100d'),
    ground: hex('#08110F'),
    grid: hex('#16382E'),
    e100: hex('#ECFDF5'), e300: hex('#6EE7B7'), e400: hex('#34D399'), e500: hex('#10B981'),
    e600: hex('#059669'), e700: hex('#047857'), e900: hex('#022C22'),
    sky: hex('#38BDF8'), amber: hex('#F59E0B'),
    app: hex('#176B5B'),
    bone: hex('#E8E2D4'), bone2: hex('#CFC8B8'), steel: hex('#2A3A35'), steel2: hex('#3C4F49'),
    paper: hex('#F6F1E8'),
  };

  /* ---------------------------------------------------------------- vec3 */
  const v = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
  };
  function rotXYZ(p, r) {
    // order: Z, X, Y
    let [x, y, z] = p;
    if (r[2]) { const c = Math.cos(r[2]), s = Math.sin(r[2]); [x, y] = [x * c - y * s, x * s + y * c]; }
    if (r[0]) { const c = Math.cos(r[0]), s = Math.sin(r[0]); [y, z] = [y * c - z * s, y * s + z * c]; }
    if (r[1]) { const c = Math.cos(r[1]), s = Math.sin(r[1]); [x, z] = [x * c + z * s, -x * s + z * c]; }
    return [x, y, z];
  }

  /* ------------------------------------------------------------- 3D scene */
  const BOX_FACES = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];

  class Scene3D {
    constructor(ctx, W, H, opts = {}) {
      this.ctx = ctx; this.W = W; this.H = H;
      this.bg = opts.bg || P.ground;
      this.light = v.norm(opts.light || [-0.55, 0.85, 0.5]);
      this.fill = v.norm(opts.fill || [0.7, 0.25, -0.4]);
      this.fogNear = opts.fogNear ?? 14; this.fogFar = opts.fogFar ?? 60; this.fogMax = opts.fogMax ?? 0.8;
      this.cam = { target: [0, 0, 0], yaw: 0.6, pitch: 0.5, dist: 20, fov: 0.7, roll: 0, shift: [0, 0] };
      this.shadowCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      if (this.shadowCanvas) { this.shadowCanvas.width = W; this.shadowCanvas.height = H; }
      this.items = []; this.under = []; this.shadows = [];
    }
    setCamera(c) { Object.assign(this.cam, c); this._basis(); }
    _basis() {
      const c = this.cam;
      const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      const eye = [c.target[0] + c.dist * Math.sin(c.yaw) * cp, c.target[1] + c.dist * sp, c.target[2] + c.dist * Math.cos(c.yaw) * cp];
      const f = v.norm(v.sub(c.target, eye));
      let right = v.norm(v.cross(f, [0, 1, 0]));
      let up = v.cross(right, f);
      if (c.roll) {
        const cr = Math.cos(c.roll), sr = Math.sin(c.roll);
        const r2 = v.add(v.mul(right, cr), v.mul(up, sr));
        const u2 = v.add(v.mul(up, cr), v.mul(right, -sr));
        right = r2; up = u2;
      }
      this.eye = eye; this.f = f; this.right = right; this.up = up;
      this.F = (this.H / 2) / Math.tan(c.fov / 2);
    }
    project(p) {
      const d = v.sub(p, this.eye);
      const z = v.dot(d, this.f);
      if (z < 0.05) return null;
      const x = v.dot(d, this.right), y = v.dot(d, this.up);
      const k = this.F / z;
      return [this.W / 2 + x * k + this.cam.shift[0], this.H / 2 - y * k + this.cam.shift[1], z];
    }
    begin() { this.items.length = 0; this.under.length = 0; this.shadows.length = 0; this._basis(); }

    fogMix(color, dist) {
      const f = this.fogMax * E.smooth(seg(dist, this.fogNear, this.fogFar));
      return f > 0 ? mix3(color, this.bg, f) : color;
    }

    /* A lit convex face (array of world-space points). */
    _face(pts, normal, mat, o = {}) {
      const cen = [0, 0, 0];
      for (const p of pts) { cen[0] += p[0]; cen[1] += p[1]; cen[2] += p[2]; }
      cen[0] /= pts.length; cen[1] /= pts.length; cen[2] /= pts.length;
      const toEye = v.sub(this.eye, cen);
      const dist = v.len(toEye);
      const vd = v.dot(normal, toEye) / dist;
      const twoSided = o.alpha !== undefined && o.alpha < 1;
      if (vd <= 0 && !twoSided) return;
      const nn = vd < 0 ? v.mul(normal, -1) : normal;
      const key = Math.max(0, v.dot(nn, this.light));
      const fil = Math.max(0, v.dot(nn, this.fill));
      const amb = mat.amb ?? 0.34;
      let k = amb + (mat.dif ?? 0.62) * key + (mat.fill ?? 0.14) * fil;
      let col = [mat.base[0] * k, mat.base[1] * k, mat.base[2] * k];
      const fres = Math.pow(1 - Math.abs(vd), 3) * (mat.rim ?? 0.1);
      if (fres > 0) col = [col[0] + 255 * fres * 0.4, col[1] + 255 * fres * 0.6, col[2] + 255 * fres * 0.5];
      if (o.emit) col = mix3(col, o.emit, o.emitK ?? 0.5);
      col = this.fogMix(col, dist);
      const sp = [];
      for (const p of pts) { const q = this.project(p); if (!q) return; sp.push(q); }
      this.items.push({ d: dist, kind: 'face', sp, col, alpha: o.alpha ?? 1, edge: o.edge, edgeA: o.edgeA ?? 0.5, lw: o.lw ?? 0.9, k });
    }

    box(o) {
      const c = o.c, s = o.s, r = o.rot || [0, 0, 0];
      const mat = o.mat || { base: P.bone };
      const m = o.mat ? o.mat : { base: o.fill || P.bone };
      const faces = o.faces; // optional per-face base colours by index
      const worldPts = [];
      for (let fi = 0; fi < 6; fi++) {
        const F = BOX_FACES[fi];
        if (o.hideBottom && fi === 5) continue;
        const nrm = rotXYZ(F.n, r);
        const pts = F.v.map((q) => v.add(c, rotXYZ([q[0] * s[0] / 2, q[1] * s[1] / 2, q[2] * s[2] / 2], r)));
        const base = faces && faces[fi] ? faces[fi] : m.base;
        this._face(pts, nrm, { ...m, base }, o);
      }
      if (o.shadow !== false) {
        const pts = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          pts.push(v.add(c, rotXYZ([sx * s[0] / 2, sy * s[1] / 2, sz * s[2] / 2], r)));
        }
        this.shadows.push({ pts, a: o.shadowA ?? 1 });
      }
    }

    /* Extruded convex polygon (polygon given in XZ plane, y0..y1). */
    prism(o) {
      const { poly, y0, y1 } = o; const r = o.rot || [0, 0, 0]; const c = o.c || [0, 0, 0];
      const m = o.mat ? o.mat : { base: o.fill || P.bone };
      const bot = poly.map((p) => v.add(c, rotXYZ([p[0], y0, p[1]], r)));
      const top = poly.map((p) => v.add(c, rotXYZ([p[0], y1, p[1]], r)));
      this._face(top, rotXYZ([0, 1, 0], r), m, o);
      this._face(bot.slice().reverse(), rotXYZ([0, -1, 0], r), m, o);
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        const e = v.sub(bot[j], bot[i]);
        let n = v.norm(v.cross([0, 1, 0], e)); n = rotXYZ(v.norm(v.cross(e, [0, 1, 0])), [0, 0, 0]);
        const nrm = v.norm(v.cross(v.sub(top[i], bot[i]), e));
        this._face([bot[i], bot[j], top[j], top[i]], v.mul(nrm, -1), m, o);
        void n;
      }
      if (o.shadow !== false) this.shadows.push({ pts: bot.concat(top), a: o.shadowA ?? 1 });
    }

    /* Arbitrary planar polygon in world space with explicit normal. */
    poly(o) { this._face(o.pts, v.norm(o.n || [0, 1, 0]), o.mat || { base: o.fill || P.bone }, o); }

    line(o) {
      const pts = o.pts.map((p) => this.project(p));
      if (pts.some((p) => !p)) return;
      let d = 0; for (const p of o.pts) d += v.len(v.sub(this.eye, p));
      d /= o.pts.length;
      const fog = this.fogMax * E.smooth(seg(d, this.fogNear, this.fogFar));
      this.items.push({ d: d + (o.bias || 0), kind: 'line', sp: pts, color: o.color || P.e400, alpha: (o.alpha ?? 1) * (1 - fog * 0.8), w: o.w || 1.2, glow: o.glow, dash: o.dash, dashOffset: o.dashOffset });
    }
    dot(o) {
      const p = this.project(o.c); if (!p) return;
      if (!isFinite(p[0] + p[1] + p[2])) { console.error('non-finite dot', JSON.stringify(o.c)); return; }
      const d = v.len(v.sub(this.eye, o.c));
      const r = (o.r || 0.1) * this.F / p[2];
      this.items.push({ d: d + (o.bias || 0), kind: 'dot', p, r, color: o.color || P.e300, alpha: o.alpha ?? 1, glow: o.glow ?? true });
    }
    /* Textured quad (real screenshots as spatial planes). corners: tl,tr,br,bl in world space.
       Sub-divided affine mapping approximates perspective-correct texturing. */
    image(o) {
      const img = o.img; if (!img) return;
      const [sx, sy, sw, sh] = o.src || [0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height];
      const [tl, tr, br, bl] = o.corners;
      const nx = o.nx || 8, ny = o.ny || 5;
      const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const grid = [];
      for (let j = 0; j <= ny; j++) {
        const L = lerp3(tl, bl, j / ny), Rr = lerp3(tr, br, j / ny); const row = [];
        for (let i = 0; i <= nx; i++) { const p = this.project(lerp3(L, Rr, i / nx)); if (!p) return; row.push(p); }
        grid.push(row);
      }
      const cen = lerp3(lerp3(tl, tr, 0.5), lerp3(bl, br, 0.5), 0.5);
      const d = v.len(v.sub(this.eye, cen));
      const fog = this.fogMax * E.smooth(seg(d, this.fogNear, this.fogFar));
      this.items.push({ d: d + (o.bias || 0), kind: 'img', img, src: [sx, sy, sw, sh], grid, nx, ny, alpha: o.alpha ?? 1, dim: Math.max(o.dim || 0, fog * 0.9), frame: o.frame, frameA: o.frameA ?? 0.6 });
    }

    /* Ground-plane polyline drawn beneath everything (grid, rings, plans). */
    groundLine(pts, color, alpha, w = 1) {
      this.under.push({ pts, color, alpha, w });
    }
    underFn(fn) { this.under.push({ fn }); }

    _drawShadows() {
      if (!this.shadows.length || !this.shadowCanvas) return;
      const sc = this.shadowCanvas.getContext('2d');
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, this.W, this.H);
      sc.fillStyle = '#000'; sc.strokeStyle = '#000'; sc.lineWidth = 1;
      const L = this.light;
      for (const s of this.shadows) {
        const gp = [];
        for (const p of s.pts) {
          if (p[1] < 0) continue;
          const t = p[1] / L[1];
          const q = this.project([p[0] - L[0] * t, 0, p[2] - L[2] * t]);
          if (q) gp.push(q);
        }
        if (gp.length < 3) continue;
        const h = hull(gp);
        sc.beginPath(); sc.moveTo(h[0][0], h[0][1]);
        for (let i = 1; i < h.length; i++) sc.lineTo(h[i][0], h[i][1]);
        sc.closePath(); sc.fill(); sc.stroke();
      }
      this.ctx.save();
      this.ctx.globalAlpha = 0.3;
      this.ctx.drawImage(this.shadowCanvas, 0, 0);
      this.ctx.restore();
    }

    flush() {
      const ctx = this.ctx;
      for (const u of this.under) {
        if (u.fn) { u.fn(ctx, this); continue; }
        const sp = u.pts.map((p) => this.project(p));
        if (sp.some((p) => !p)) continue;
        ctx.strokeStyle = css(u.color, u.alpha); ctx.lineWidth = u.w;
        ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]);
        for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]);
        ctx.stroke();
      }
      this._drawShadows();
      this.items.sort((a, b) => b.d - a.d);
      ctx.lineJoin = 'round';
      for (const it of this.items) {
        if (it.kind === 'face') {
          ctx.beginPath(); ctx.moveTo(it.sp[0][0], it.sp[0][1]);
          for (let i = 1; i < it.sp.length; i++) ctx.lineTo(it.sp[i][0], it.sp[i][1]);
          ctx.closePath();
          ctx.fillStyle = css(it.col, it.alpha);
          ctx.fill();
          ctx.lineWidth = it.lw;
          if (it.edge) {
            ctx.strokeStyle = css(it.edge, it.edgeA * (it.alpha < 1 ? 1 : 1)); ctx.stroke();
          } else if (it.alpha >= 1) {
            ctx.strokeStyle = css(it.col, 1); ctx.stroke(); // seal hairline seams
          }
        } else if (it.kind === 'line') {
          ctx.save();
          if (it.dash) { ctx.setLineDash(it.dash); ctx.lineDashOffset = it.dashOffset || 0; }
          ctx.beginPath(); ctx.moveTo(it.sp[0][0], it.sp[0][1]);
          for (let i = 1; i < it.sp.length; i++) ctx.lineTo(it.sp[i][0], it.sp[i][1]);
          if (it.glow) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = css(it.color, it.alpha * 0.16); ctx.lineWidth = it.w * 4.5; ctx.stroke();
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = css(it.color, it.alpha); ctx.lineWidth = it.w; ctx.stroke();
          ctx.restore();
        } else if (it.kind === 'img') {
          drawImagePlane(ctx, it, this.bg);
        } else if (it.kind === 'dot') {
          ctx.save();
          if (it.glow) {
            ctx.globalCompositeOperation = 'lighter';
            const g = ctx.createRadialGradient(it.p[0], it.p[1], 0, it.p[0], it.p[1], it.r * 5);
            g.addColorStop(0, css(it.color, 0.55 * it.alpha)); g.addColorStop(1, css(it.color, 0));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(it.p[0], it.p[1], it.r * 5, 0, TAU); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = css(it.color, it.alpha); ctx.beginPath(); ctx.arc(it.p[0], it.p[1], Math.max(0.8, it.r), 0, TAU); ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  function drawImagePlane(ctx, it, bg) {
    const [sx, sy, sw, sh] = it.src, { grid, nx, ny } = it;
    ctx.save(); ctx.globalAlpha = it.alpha;
    // base layer: one affine mapping for the whole plane (hides triangle seams)
    {
      const tlp = grid[0][0], trp = grid[0][nx], blp = grid[ny][0];
      ctx.save(); ctx.setTransform((trp[0] - tlp[0]) / sw, (trp[1] - tlp[1]) / sw, (blp[0] - tlp[0]) / sh, (blp[1] - tlp[1]) / sh, tlp[0], tlp[1]);
      ctx.drawImage(it.img, sx, sy, sw, sh, 0, 0, sw, sh); ctx.restore();
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p00 = grid[j][i], p10 = grid[j][i + 1], p11 = grid[j + 1][i + 1], p01 = grid[j + 1][i];
      const u0 = (i / nx) * sw, u1 = ((i + 1) / nx) * sw, v0 = (j / ny) * sh, v1 = ((j + 1) / ny) * sh;
      tri(ctx, it.img, it.src, p00, p10, p11, [u0, v0], [u1, v0], [u1, v1]);
      tri(ctx, it.img, it.src, p00, p11, p01, [u0, v0], [u1, v1], [u0, v1]);
    }
    ctx.restore();
    const quad = [grid[0][0], grid[0][nx], grid[ny][nx], grid[ny][0]];
    if (it.dim > 0.01) { ctx.save(); ctx.globalAlpha = it.alpha * it.dim; ctx.fillStyle = css(bg); ctx.beginPath(); quad.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.restore(); }
    if (it.frame) { ctx.save(); ctx.strokeStyle = css(it.frame, it.frameA * it.alpha); ctx.lineWidth = 1.2; ctx.beginPath(); quad.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.restore(); }
  }
  function tri(ctx, img, src, s0, s1, s2, t0, t1, t2) {
    const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, [u0, v0] = t0, [u1, v1] = t1, [u2, v2] = t2;
    const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0); if (!den) return;
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den, c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den, e = x0 - a * u0 - c * v0;
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den, d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den, f = y0 - b * u0 - d * v0;
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, ex = (x, y) => [x + Math.sign(x - cx) * 0.7, y + Math.sign(y - cy) * 0.7];
    ctx.save(); ctx.beginPath();
    const q0 = ex(x0, y0), q1 = ex(x1, y1), q2 = ex(x2, y2);
    ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.closePath(); ctx.clip();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(img, src[0], src[1], src[2], src[3], 0, 0, src[2], src[3]);
    ctx.restore();
  }

  function hull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    const up = []; for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop(); return lo.concat(up);
  }

  /* -------------------------------------------------------------- 2D helpers */
  const FONT_SANS = "Bahnschrift, 'Segoe UI Variable Display', 'Segoe UI', Arial, sans-serif";
  const FONT_MONO = "'Cascadia Mono', Consolas, 'Courier New', monospace";

  function text(ctx, str, x, y, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || 400} ${o.size || 14}px ${o.mono ? FONT_MONO : FONT_SANS}`;
    ctx.fillStyle = o.color ? (typeof o.color === 'string' ? o.color : css(o.color, o.alpha ?? 1)) : '#fff';
    ctx.globalAlpha = o.color && typeof o.color === 'string' ? (o.alpha ?? 1) : 1;
    ctx.textBaseline = o.baseline || 'alphabetic';
    ctx.textAlign = o.align || 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing || 0}px`;
    if (o.stretch && 'fontStretch' in ctx) ctx.fontStretch = o.stretch;
    ctx.fillText(str, x, y);
    ctx.restore();
  }
  function measure(ctx, str, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || 400} ${o.size || 14}px ${o.mono ? FONT_MONO : FONT_SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing || 0}px`;
    const w = ctx.measureText(str).width; ctx.restore(); return w;
  }

  function vignette(ctx, W, H, strength = 0.55) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 0.98);
    g.addColorStop(0, 'rgba(3,8,6,0)'); g.addColorStop(1, `rgba(3,8,6,${strength})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  /* A fine technical grid that fades with distance from centre (2D backdrop). */
  function techGrid(ctx, W, H, o = {}) {
    const step = o.step || 40, a = o.alpha ?? 0.35;
    ctx.save(); ctx.lineWidth = 1;
    for (let x = (o.ox || 0) % step; x < W; x += step) {
      const fade = 1 - Math.abs(x - W / 2) / (W / 2);
      ctx.strokeStyle = css(P.grid, a * (0.25 + 0.75 * fade)); ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }
    for (let y = (o.oy || 0) % step; y < H; y += step) {
      const fade = 1 - Math.abs(y - H / 2) / (H / 2);
      ctx.strokeStyle = css(P.grid, a * (0.25 + 0.75 * fade)); ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }
    ctx.restore();
  }

  /* Exhibition-style catalogue frame: figure number, caption, timecode hairline. */
  function frame(ctx, W, H, t, dur, o = {}) {
    const m = o.margin ?? 34;
    text(ctx, o.fig || '', m, m + 8, { size: 12, mono: true, color: css(P.e300), spacing: 2.4, alpha: 0.9 });
    if (o.caption) text(ctx, o.caption, m, H - m + 4, { size: 12, mono: true, color: css(P.e100), alpha: 0.5, spacing: 1.6 });
    const tc = `T+${t.toFixed(2).padStart(5, '0')}s`;
    text(ctx, tc, W - m, m + 8, { size: 12, mono: true, color: css(P.e100), alpha: 0.45, align: 'right', spacing: 1.6 });
    // progress hairline
    const x0 = W - m - 180, y0 = H - m;
    ctx.fillStyle = css(P.grid, 0.9); ctx.fillRect(x0, y0, 180, 1.5);
    ctx.fillStyle = css(P.e400, 0.95); ctx.fillRect(x0, y0, 180 * clamp(t / dur), 1.5);
    // corner registration ticks
    ctx.strokeStyle = css(P.e500, 0.45); ctx.lineWidth = 1;
    const k = 14;
    for (const [cx, cy, sx, sy] of [[m - 12, m - 12, 1, 1], [W - m + 12, m - 12, -1, 1], [m - 12, H - m + 12, 1, -1], [W - m + 12, H - m + 12, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx, cy + sy * k); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * k, cy); ctx.stroke();
    }
  }

  /* The Formspear emblem, as flat polygons in the brand SVG's own coordinates
     (assets/readme/brand-identity.svg). Origin (180,150) is the emblem centre. */
  const EMBLEM = {
    outline: [[180, 65], [245, 150], [180, 218], [115, 150]],
    left: [[180, 75], [125, 150], [180, 205], [162, 150]],
    right: [[180, 75], [235, 150], [180, 205], [198, 150]],
    spine: [[180, 72], [190, 150], [180, 185], [170, 150]],
    centre: [180, 150],
  };
  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function drawEmblem(ctx, cx, cy, scale, o = {}) {
    const a = o.alpha ?? 1, T = (p) => [cx + (p[0] - 180) * scale, cy + (p[1] - 150) * scale];
    const path = (poly) => { ctx.beginPath(); poly.map(T).forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
    ctx.save(); ctx.globalAlpha = a;
    path(EMBLEM.left); ctx.fillStyle = css(P.e700); ctx.fill();
    path(EMBLEM.right); ctx.fillStyle = css(P.e400); ctx.fill();
    path(EMBLEM.spine); ctx.fillStyle = css(P.e100); ctx.fill();
    path(EMBLEM.outline); ctx.strokeStyle = css(P.e300); ctx.lineWidth = Math.max(1, 2 * scale); ctx.stroke();
    ctx.restore();
  }

  /* Keyframe track: scalar or array values, eased between keys. */
  function track(t, keys, ease = E.io3) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const a = keys[i - 1], b = keys[i], k = ease(seg(t, a[0], b[0]));
        return Array.isArray(a[1]) ? a[1].map((x, j) => lerp(x, b[1][j], k)) : lerp(a[1], b[1], k);
      }
    }
    return keys[keys.length - 1][1];
  }
  const wrapPI = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };

  window.FS = {
    track, wrapPI, TAU, clamp, lerp, seg, mix3, E, pulse, rng, hex, css, P, v, rotXYZ, Scene3D, hull,
    text, measure, vignette, techGrid, frame, EMBLEM, pointInPoly, drawEmblem, FONT_SANS, FONT_MONO,
  };
})();
