/* Shared animation engine for the landing page drafts (index.html, v2.html).
   Draws the real scan (scan.js) on two 2D canvases: #hero (a capture dome around the scan) and #sim (a pinned scroll story).
   Colors come from the page's CSS tokens; layout knobs come from window.SITE (see DEFAULTS). No libraries. */
(function () {
'use strict';
var DEFAULTS = {
  hero: { ox: 0.68, oy: 0.42, pitch: 0.32, fov: 0.62, dist: 4.3, strut: 0.22, ray: 0.35 },
  heroSmall: { ox: 0.5, oy: 0.36 },
  story: { ox: 0.56, oy: 0.46, pitch: 0, fov: 0.85 },
  storySmall: { ox: 0.5, oy: 0.42 }
};
var SITE = window.SITE || {}, CFG = {};
Object.keys(DEFAULTS).forEach(function (k) { CFG[k] = Object.assign({}, DEFAULTS[k], SITE[k] || {}); });
var S = window.SCAN;
var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
var SMALL = matchMedia('(max-width: 720px)').matches;
var TAU = Math.PI * 2;
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
var C = { ink: rgb(css('--ink')), line: rgb(css('--line')), acc: rgb(css('--accent')), mid: rgb(css('--mid')), hot: rgb(css('--hot')) };
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }

/* ---- typed tagline (runs even without scan data) ---- */
var typed = document.getElementById('typed');
if (typed) {
  var full = typed.dataset.text;
  if (REDUCED) typed.innerHTML = full + '<b></b>';
  else { var ti = 0; (function tick() { typed.innerHTML = full.slice(0, ti) + '<b></b>'; if (ti++ < full.length) setTimeout(tick, ti < 2 ? 700 : 34); })(); }
}

/* ---- lazy videos: load and play only while on screen ---- */
var vio = new IntersectionObserver(function (es) {
  es.forEach(function (e) {
    var v = e.target;
    if (e.isIntersecting) { if (!v.src) v.src = v.dataset.src; if (!REDUCED) v.play().catch(function () {}); }
    else if (!v.paused) v.pause();
  });
}, { rootMargin: '200px' });
document.querySelectorAll('video[data-src]').forEach(function (v) {
  v.addEventListener('error', function () {  // link died: show an empty placeholder instead of a black box
    var d = document.createElement('div'); d.className = 'empty';
    d.textContent = 'Clip unavailable · ' + v.dataset.src.replace(/^https?:\/\//, '').split('/')[0];
    v.replaceWith(d);
  });
  vio.observe(v);
});

if (!S) return;

/* ---- scan data, centered on the room ---- */
var N = S.pts.length / 4, X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N), SH = new Uint8Array(N);
var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, i, k;
for (i = 0; i < N; i++) { var x0 = S.pts[4 * i] / 100, y0 = S.pts[4 * i + 1] / 100;
  if (x0 < minx) minx = x0; if (x0 > maxx) maxx = x0; if (y0 < miny) miny = y0; if (y0 > maxy) maxy = y0; }
var OX = (minx + maxx) / 2, OY = (miny + maxy) / 2, RW = maxx - minx, RD = maxy - miny;
for (i = 0; i < N; i++) { X[i] = S.pts[4 * i] / 100 - OX; Y[i] = S.pts[4 * i + 1] / 100 - OY; Z[i] = S.pts[4 * i + 2] / 100; SH[i] = S.pts[4 * i + 3]; }
var cams = [];
for (k = 0; k < S.cams.length; k += 6) cams.push({ x: S.cams[k] / 100 - OX, y: S.cams[k + 1] / 100 - OY, z: S.cams[k + 2] / 100,
  fx: S.cams[k + 3] / 100, fy: S.cams[k + 4] / 100, fz: S.cams[k + 5] / 100 });
function box(b, wall) { return { cx: b[0] / 100 - OX, cy: b[1] / 100 - OY, cz: b[2] / 100, hx: b[3] / 100, hy: b[4] / 100, hz: b[5] / 100, c: Math.cos(b[6]), s: Math.sin(b[6]), wall: wall }; }
var boxes = S.walls.map(function (b) { return box(b, true); }).concat(S.hulls.map(function (b) { return box(b, false); }));

/* Per point: which camera saw it first (capture reveal), and distance to the nearest simple shape (check stage). */
var reveal = new Float32Array(N), err = new Float32Array(N), near5 = 0, near15 = 0;
for (i = 0; i < N; i++) {
  var best = 1e9, bi = 0;
  for (k = 0; k < cams.length; k++) { var dx = X[i] - cams[k].x, dy = Y[i] - cams[k].y, dd = dx * dx + dy * dy; if (dd < best) { best = dd; bi = k; } }
  reveal[i] = bi / (cams.length - 1);
  var d = Math.abs(Z[i]);  // the floor slab
  for (k = 0; k < boxes.length; k++) {
    var b = boxes[k], ex = X[i] - b.cx, ey = Y[i] - b.cy;
    var lx = Math.abs(b.c * ex + b.s * ey) - b.hx, ly = Math.abs(-b.s * ex + b.c * ey) - b.hy, lz = Math.abs(Z[i] - b.cz) - b.hz;
    var out = Math.hypot(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0)), ins = Math.min(Math.max(lx, ly, lz), 0);
    var bd = Math.abs(out + ins); if (bd < d) d = bd;
  }
  err[i] = d; if (d < 0.05) near5++; if (d < 0.15) near15++;
}
function fmt(n) { return n.toLocaleString('en-US'); }
function setText(id, s) { var el = document.getElementById(id); if (el) el.innerHTML = s; }
setText('readout', 'SCAN · floor4_static3<br>' + fmt(N) + ' points · voxel ' + S.voxel_cm + ' cm<br>' + cams.length + ' camera poses<br>' + RW.toFixed(1) + ' × ' + RD.toFixed(1) + ' m<br>drag to rotate');
setText('num-pts', fmt(N));
setText('stat-cap', cams.length + ' camera poses · ' + fmt(N) + ' points');
setText('stat-build', S.walls.length + ' wall boxes · ' + S.hulls.length + ' clutter pieces');
setText('stat-check', Math.round(100 * near5 / N) + '% of scan points within 5 cm of a shape · ' + Math.round(100 * near15 / N) + '% within 15 cm');
setText('dims', RW.toFixed(2) + ' × ' + RD.toFixed(2) + ' m');

/* ---- tiny 3D: orbit camera + perspective projection onto a 2D canvas ---- */
function view(W, H, cam) {
  var cp = Math.cos(cam.pitch), px = cam.tx + cam.dist * cp * Math.cos(cam.yaw), py = cam.ty + cam.dist * cp * Math.sin(cam.yaw), pz = cam.tz + cam.dist * Math.sin(cam.pitch);
  var fx = cam.tx - px, fy = cam.ty - py, fz = cam.tz - pz, fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  var rx = fy, ry = -fx, rl = Math.hypot(rx, ry); rx /= rl; ry /= rl;
  return { px: px, py: py, pz: pz, fx: fx, fy: fy, fz: fz, rx: rx, ry: ry, ux: ry * fz, uy: -rx * fz, uz: rx * fy - ry * fx,  // up = right × forward
    f: 0.5 * Math.min(H, W * 0.8) / Math.tan(cam.fov / 2), cx: W * cam.ox, cy: H * cam.oy };
}
var P = [0, 0, 0];
function proj(v, x, y, z) {
  var dx = x - v.px, dy = y - v.py, dz = z - v.pz, zc = dx * v.fx + dy * v.fy + dz * v.fz;
  if (zc < 0.1) return false;
  P[0] = v.cx + v.f * (dx * v.rx + dy * v.ry) / zc; P[1] = v.cy - v.f * (dx * v.ux + dy * v.uy + dz * v.uz) / zc; P[2] = zc; return true;
}
function seg(ctx, v, a, b) { if (!proj(v, a[0], a[1], a[2])) return; var x = P[0], y = P[1]; if (!proj(v, b[0], b[1], b[2])) return; ctx.moveTo(x, y); ctx.lineTo(P[0], P[1]); }
var EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
function boxEdges(ctx, v, b, dx, dy) {
  var c = [], sx, sy, sz;
  for (sx = -1; sx <= 1; sx += 2) for (sy = -1; sy <= 1; sy += 2) for (sz = -1; sz <= 1; sz += 2) {
    var lx = sx * b.hx, ly = sy * b.hy; c.push([b.cx + dx + b.c * lx - b.s * ly, b.cy + dy + b.s * lx + b.c * ly, b.cz + sz * b.hz]); }
  for (var e = 0; e < 12; e++) seg(ctx, v, c[EDGES[e][0]], c[EDGES[e][1]]);
}

/* Points drawn in buckets (color × alpha level) so the canvas changes fillStyle only a few dozen times per frame. */
var LEVELS = 8, buckets = [], COLS = [C.ink, C.acc, C.mid, C.hot];
function drawPoints(ctx, v, pick, size, dx, dy, step) {
  var nb = 4 * LEVELS; for (k = 0; k < nb; k++) (buckets[k] || (buckets[k] = [])).length = 0;
  for (i = 0; i < N; i += step) {
    var r = pick(i); if (!r) continue;               // r = colorIndex * 16 + alphaLevel (1..8)
    if (!proj(v, X[i] + dx, Y[i] + dy, Z[i])) continue;
    var s = clamp(size * v.f / P[2], 0.8, 3.2);
    buckets[(r >> 4) * LEVELS + (r & 15) - 1].push(P[0] - s / 2, P[1] - s / 2, s);
  }
  for (k = 0; k < nb; k++) { var a = buckets[k]; if (!a.length) continue;
    ctx.fillStyle = rgba(COLS[(k / LEVELS) | 0], ((k % LEVELS) + 1) / LEVELS);
    for (var j = 0; j < a.length; j += 3) ctx.fillRect(a[j], a[j + 1], a[j + 2], a[j + 2]); }
}
function lvl(a) { return clamp(Math.round(a * LEVELS), 0, LEVELS); }

function fit(cv) {
  var dpr = Math.min(window.devicePixelRatio || 1, SMALL ? 1.5 : 2), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  return dpr;
}
function onScreen(el, cb) { new IntersectionObserver(function (es) { cb(es[0].isIntersecting); }).observe(el); }

/* ---- HERO: a capture dome (icosphere struts, camera heads aimed in) around the real scan ---- */
var dome = (function () {
  var q = (1 + Math.sqrt(5)) / 2, IV = [[-1, q, 0], [1, q, 0], [-1, -q, 0], [1, -q, 0], [0, -1, q], [0, 1, q], [0, -1, -q], [0, 1, -q], [q, 0, -1], [q, 0, 1], [-q, 0, -1], [-q, 0, 1]];
  var IF = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  var V = [], E = {}, heads = [], F = 3, idx = {};
  function nrm(p) { var l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; }
  function vid(p) { p = nrm(p); var kk = p.map(function (x) { return x.toFixed(4); }).join(); if (!(kk in idx)) { idx[kk] = V.length; V.push(p); } return idx[kk]; }
  function edge(a, b) { E[Math.min(a, b) + '-' + Math.max(a, b)] = 1; }
  IF.forEach(function (f) {
    var A = IV[f[0]], B = IV[f[1]], Cc = IV[f[2]], g = [], a, bb;
    for (a = 0; a <= F; a++) { g[a] = []; for (bb = 0; bb <= F - a; bb++) { var c = F - a - bb;
      g[a][bb] = vid([(A[0] * a + B[0] * bb + Cc[0] * c) / F, (A[1] * a + B[1] * bb + Cc[1] * c) / F, (A[2] * a + B[2] * bb + Cc[2] * c) / F]); } }
    for (a = 0; a <= F; a++) for (bb = 0; bb <= F - a; bb++) {
      if (bb < F - a) edge(g[a][bb], g[a][bb + 1]);
      if (a < F - bb) edge(g[a][bb], g[a + 1][bb]);
      if (a < F - bb && bb > 0) edge(g[a][bb], g[a + 1][bb - 1]);
    }
    heads.push(nrm([(A[0] + B[0] + Cc[0]) / 3, (A[1] + B[1] + Cc[1]) / 3, (A[2] + B[2] + Cc[2]) / 3]));
  });
  return { V: V, E: Object.keys(E).map(function (s) { return s.split('-').map(Number); }), heads: heads };
})();

var heroCv = document.getElementById('hero'), heroOn = true, heroT0 = performance.now();
/* Drag the dome with a mouse or a finger: horizontal turns it, vertical tilts it, and it coasts a little after release.
   Touch keeps vertical swipes for page scrolling (touch-action: pan-y), so on phones a drag only turns it. */
var drag = { yaw: 0, pitch: 0, vy: 0, vp: 0, down: false, x: 0, y: 0 };
if (heroCv) {
  heroCv.style.cursor = 'grab'; heroCv.style.touchAction = 'pan-y';
  heroCv.addEventListener('pointerdown', function (e) {
    drag.down = true; drag.x = e.clientX; drag.y = e.clientY; drag.vy = drag.vp = 0;
    heroCv.setPointerCapture(e.pointerId); heroCv.style.cursor = 'grabbing';
  });
  heroCv.addEventListener('pointermove', function (e) {
    if (!drag.down) return;
    drag.vy = -(e.clientX - drag.x) * 0.006; drag.vp = e.pointerType === 'touch' ? 0 : (e.clientY - drag.y) * 0.004;
    drag.yaw += drag.vy; drag.pitch = clamp(drag.pitch + drag.vp, -CFG.hero.pitch - 0.25, 1.25 - CFG.hero.pitch);
    drag.x = e.clientX; drag.y = e.clientY;
    if (REDUCED) drawHero(performance.now());
  });
  ['pointerup', 'pointercancel'].forEach(function (n) { heroCv.addEventListener(n, function () { drag.down = false; heroCv.style.cursor = 'grab'; }); });
}
function drawHero(now) {
  if (!heroCv) return;
  var dpr = fit(heroCv), W = heroCv.width, H = heroCv.height, ctx = heroCv.getContext('2d'), h = CFG.hero, hs = SMALL ? CFG.heroSmall : h;
  ctx.clearRect(0, 0, W, H);
  var t = REDUCED ? 0 : (now - heroT0), spin = t / 90000 * TAU, R = Math.max(RW, RD) * 0.78, cz = 0.9, far = R * h.dist;
  if (!drag.down) { drag.yaw += drag.vy; drag.pitch = clamp(drag.pitch + drag.vp, -h.pitch - 0.25, 1.25 - h.pitch); drag.vy *= 0.94; drag.vp *= 0.94; }
  var v = view(W, H, { tx: 0, ty: 0, tz: cz, yaw: -0.9 + spin + drag.yaw, pitch: h.pitch + drag.pitch, dist: R * h.dist, fov: h.fov, ox: hs.ox, oy: hs.oy });
  ctx.lineWidth = dpr;
  dome.E.forEach(function (e) {      // struts, fading with depth
    var a = dome.V[e[0]], b = dome.V[e[1]];
    if (!proj(v, a[0] * R, a[1] * R, a[2] * R + cz)) return; var ax = P[0], ay = P[1], az = P[2];
    if (!proj(v, b[0] * R, b[1] * R, b[2] * R + cz)) return;
    var depth = clamp(1.25 - ((az + P[2]) / 2 - far + R) / (2 * R), 0.12, 1);
    ctx.strokeStyle = rgba(C.ink, h.strut * depth); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(P[0], P[1]); ctx.stroke();
  });
  dome.heads.forEach(function (hd, j) {   // camera heads aimed at the scan; a few fire a ray
    if (!proj(v, hd[0] * R, hd[1] * R, hd[2] * R + cz)) return; var ax = P[0], ay = P[1], az = P[2];
    if (!proj(v, hd[0] * R * 0.9, hd[1] * R * 0.9, hd[2] * R * 0.9 + cz)) return;
    var depth = clamp(1.25 - (az - far + R) / (2 * R), 0.15, 1);
    ctx.strokeStyle = rgba(C.acc, 0.85 * depth); ctx.lineWidth = 2.2 * dpr; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(P[0], P[1]); ctx.stroke();
    var phase = (t / 1400 + j * 0.37) % 1;
    if (!REDUCED && phase < 0.18 && proj(v, 0, 0, cz * 0.6)) {
      ctx.lineWidth = dpr; ctx.strokeStyle = rgba(C.acc, h.ray * (1 - phase / 0.18) * depth); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(P[0], P[1]); ctx.stroke();
    }
  });
  ctx.lineWidth = dpr;
  drawPoints(ctx, v, function (i) { return lvl(0.35 + 0.07 * SH[i]); }, 0.022, 0, 0, SMALL ? 2 : 1);
}
if (heroCv) {
  onScreen(heroCv, function (on) { heroOn = on; });
  (function heroLoop(now) { if (heroOn) drawHero(now); if (!REDUCED) requestAnimationFrame(heroLoop); })(performance.now());
}

/* ---- MINI views: small live canvases (<canvas class="mini" data-mode="orbit|shapes|heat|facility">) in the detail rows ---- */
document.querySelectorAll('canvas.mini').forEach(function (cv) {
  var on = false, mode = cv.dataset.mode;
  onScreen(cv, function (v) { on = v; });
  (function loop(now) {
    if (on && cv.clientWidth) {
      var dpr = fit(cv), W = cv.width, H = cv.height, ctx = cv.getContext('2d');
      var far = mode === 'facility';
      var v = view(W, H, { tx: 0, ty: 0, tz: far ? 0.2 : 0.6, yaw: -1 + (REDUCED ? 0 : now / 16000 * TAU), pitch: far ? 0.95 : 0.7,
        dist: far ? 26 : 8.4, fov: 0.7, ox: 0.5, oy: 0.5 });
      ctx.clearRect(0, 0, W, H); ctx.lineWidth = dpr;
      if (far) {
        var sx = RW + 1.6, sy = RD + 1.6;
        for (var a = -2; a <= 2; a++) for (var b = -2; b <= 2; b++) {
          ctx.strokeStyle = rgba(a || b ? C.ink : C.acc, a || b ? 0.18 : 0.8); ctx.beginPath();
          boxes.forEach(function (bx) { if (bx.wall) boxEdges(ctx, v, bx, a * sx, b * sy); }); ctx.stroke();
          drawPoints(ctx, v, function () { return lvl(a || b ? 0.3 : 0.9); }, 0.03, a * sx, b * sy, a || b ? 7 : 2);
        }
      } else {
        if (mode === 'shapes') { ctx.strokeStyle = rgba(C.acc, 0.75); ctx.beginPath(); boxes.forEach(function (bx) { boxEdges(ctx, v, bx, 0, 0); }); ctx.stroke(); }
        drawPoints(ctx, v, function (i) {
          if (mode === 'heat') return (err[i] < 0.05 ? 1 : err[i] < 0.15 ? 2 : 3) * 16 + lvl(0.85);
          return lvl((mode === 'shapes' ? 0.35 : 1) * (0.38 + 0.065 * SH[i]));
        }, 0.03, 0, 0, 1);
      }
    }
    if (!REDUCED || !on) requestAnimationFrame(loop);
  })(performance.now());
});

/* ---- STORY: one pinned canvas, scroll drives six stages ---- */
var story = document.getElementById('story'), simCv = document.getElementById('sim');
if (!story || !simCv) return;
var capsEl = Array.prototype.slice.call(document.querySelectorAll('.cap')), railBtns = Array.prototype.slice.call(document.querySelectorAll('[data-stage]'));
var verdictEl = document.getElementById('verdict'), storyOn = false, tShown = 0;
var KEYS = [  // camera at the start of each stage, and the final pull-back
  { yaw: -2.3, pitch: 0.62, dist: 8.2 }, { yaw: -1.7, pitch: 0.66, dist: 7.6 }, { yaw: -1.1, pitch: 0.8, dist: 8.0 },
  { yaw: -0.6, pitch: 1.0, dist: 8.2 }, { yaw: -0.3, pitch: 0.38, dist: 3.7 }, { yaw: 0.25, pitch: 0.9, dist: 9.5 }, { yaw: 0.55, pitch: 1.02, dist: 30 }];
function storyT() { var span = story.offsetHeight - innerHeight; return clamp(-story.getBoundingClientRect().top / span, 0, 1) * 6; }
railBtns.forEach(function (b) { b.addEventListener('click', function () {
  var span = story.offsetHeight - innerHeight; scrollTo({ top: story.offsetTop + span * (+b.dataset.stage + 0.5) / 6, behavior: REDUCED ? 'auto' : 'smooth' }); }); });

var spawn = [S.spawn[0] / 100 - OX, S.spawn[1] / 100 - OY];

/* Robots (robots.js): points on each body plus body poses per frame, exported from MuJoCo by tools/export_robots.py.
   coop is the real two-G1 carry run; arm and quad are scripted stand-ins. */
var BOTS = null;
if (window.ROBOTS) {
  BOTS = {};
  Object.keys(window.ROBOTS).forEach(function (k) {
    var r = window.ROBOTS[k];
    BOTS[k] = { fps: r.fps, n: r.frames, f: r.f, bodies: r.bodies.map(function (b) { return { p: Float32Array.from(b.p, function (x) { return x / 1000; }), c: b.c }; }) };
  });
  // The arm sits on the largest table-height clutter piece in the scan, so it works a real surface.
  var table = null;
  boxes.forEach(function (b) { var top = b.cz + b.hz; if (!b.wall && top > 0.55 && top < 1.05 && b.hx > 0.15 && b.hy > 0.15 && (!table || b.hx * b.hy > table.hx * table.hy)) table = b; });
  BOTS.arm.at = table ? [table.cx, table.cy, table.cz + table.hz] : [spawn[0] - 1.2, spawn[1] - 1.0, 0];
}
function drawBot(ctx, v, R, frame, ox, oy, oz, yaw, a) {
  var fr = R.f[frame], cy = Math.cos(yaw), sy = Math.sin(yaw), cols = [rgba(C.ink, a), rgba(C.acc, a)];
  R.bodies.forEach(function (b, bi) {
    var o = bi * 7, px = fr[o] / 1000, py = fr[o + 1] / 1000, pz = fr[o + 2] / 1000;
    var qw = fr[o + 3] / 1000, qx = fr[o + 4] / 1000, qy = fr[o + 5] / 1000, qz = fr[o + 6] / 1000, p = b.p;
    ctx.fillStyle = cols[b.c];
    for (var j = 0; j < p.length; j += 3) {
      var lx = p[j], ly = p[j + 1], lz = p[j + 2];
      var tx = 2 * (qy * lz - qz * ly), ty = 2 * (qz * lx - qx * lz), tz = 2 * (qx * ly - qy * lx);   // rotate by the body quaternion
      var wx = lx + qw * tx + (qy * tz - qz * ty) + px, wy = ly + qw * ty + (qz * tx - qx * tz) + py, wz = lz + qw * tz + (qx * ty - qy * tx) + pz;
      if (!proj(v, ox + cy * wx - sy * wy, oy + sy * wx + cy * wy, oz + wz)) continue;
      var s = clamp(0.022 * v.f / P[2], 1, 3.4); ctx.fillRect(P[0] - s / 2, P[1] - s / 2, s, s);
    }
  });
}
function pingpong(R, sec) { var k = Math.floor(sec * R.fps) % (2 * R.n - 2); return k < R.n ? k : 2 * R.n - 2 - k; }
function drawStory(now) {
  var dpr = fit(simCv), W = simCv.width, H = simCv.height, ctx = simCv.getContext('2d'), so = SMALL ? CFG.storySmall : CFG.story;
  tShown += (storyT() - tShown) * (REDUCED ? 1 : 0.14); var t = tShown;
  var a = Math.min(5, Math.floor(t)), u = smooth(0, 1, t - a), K0 = KEYS[a], K1 = KEYS[a + 1];
  var focus = BOTS ? smooth(4, 4.35, t) * (1 - smooth(5, 5.35, t)) : 0;   // stage 05 looks at the robots
  var v = view(W, H, { tx: focus * (spawn[0] - 0.7), ty: focus * (spawn[1] - 0.5), tz: a === 5 ? 0.4 : 0.7, yaw: K0.yaw + (K1.yaw - K0.yaw) * u + (REDUCED ? 0 : Math.sin(now / 9000) * 0.03),
    pitch: K0.pitch + (K1.pitch - K0.pitch) * u + CFG.story.pitch, dist: K0.dist + (K1.dist - K0.dist) * (a === 5 ? smooth(0.15, 1, t - 5) : u), fov: CFG.story.fov, ox: so.ox, oy: so.oy });
  ctx.clearRect(0, 0, W, H);

  var cap = clamp(t, 0, 1), heat = smooth(3, 3.25, t) * (1 - smooth(3.85, 4.1, t)), shapes = smooth(2, 2.3, t), robots = smooth(4, 4.25, t), fac = smooth(5.15, 5.7, t);
  var base = t < 1 ? 1 : 1 - 0.62 * smooth(2, 2.35, t) * (1 - heat), g;

  ctx.lineWidth = dpr; ctx.strokeStyle = rgba(C.line, 0.9); ctx.beginPath();     // floor grid
  var gx = RW / 2 + 0.6, gy = RD / 2 + 0.6;
  for (g = -gx; g <= gx + 1e-6; g += 0.5) seg(ctx, v, [g, -gy, 0], [g, gy, 0]);
  for (g = -gy; g <= gy + 1e-6; g += 0.5) seg(ctx, v, [-gx, g, 0], [gx, g, 0]);
  ctx.stroke();

  if (fac > 0) {   // facility: copies of the room around it (the zoom-out)
    var sx = RW + 1.6, sy = RD + 1.6;
    for (var gxi = -2; gxi <= 2; gxi++) for (var gyi = -2; gyi <= 2; gyi++) {
      if (!gxi && !gyi) continue;
      var ring = Math.max(Math.abs(gxi), Math.abs(gyi)), on = clamp(fac * 2.2 - (Math.abs(gxi) + Math.abs(gyi)) * 0.35, 0, 1); if (on <= 0) continue;
      ctx.strokeStyle = rgba(C.ink, 0.16 * on); ctx.beginPath();
      boxes.forEach(function (b) { if (b.wall) boxEdges(ctx, v, b, gxi * sx, gyi * sy); }); ctx.stroke();
      drawPoints(ctx, v, function () { return lvl(0.32 * on); }, 0.03, gxi * sx, gyi * sy, ring === 1 ? 4 : 9);
    }
  }
  if (shapes > 0) {   // walls and clutter as a line drawing
    ctx.lineWidth = dpr; ctx.strokeStyle = rgba(C.acc, (heat > 0 ? 0.25 : 0.7) * shapes * (1 - 0.5 * robots)); ctx.beginPath();
    boxes.forEach(function (b) { boxEdges(ctx, v, b, 0, 0); }); ctx.stroke();
  }
  drawPoints(ctx, v, function (i) {   // the scan
    if (t < 1 && reveal[i] > cap * 1.04) return 0;
    if (heat > 0.02) return (err[i] < 0.05 ? 1 : err[i] < 0.15 ? 2 : 3) * 16 + lvl(0.25 + 0.7 * heat + (1 - heat) * 0.2);
    return lvl(base * (0.38 + 0.065 * SH[i]));
  }, 0.03, 0, 0, SMALL ? 2 : 1);

  var path = 1 - smooth(1.6, 2.2, t);   // camera path and the moving camera (capture)
  if (path > 0) {
    var upto = Math.max(1, Math.round(cap * (cams.length - 1)));
    ctx.strokeStyle = rgba(C.acc, 0.9 * path); ctx.lineWidth = 1.6 * dpr; ctx.beginPath();
    for (k = 1; k <= upto; k++) seg(ctx, v, [cams[k - 1].x, cams[k - 1].y, cams[k - 1].z], [cams[k].x, cams[k].y, cams[k].z]);
    ctx.stroke();
    var cm = cams[upto], f = [cm.fx, cm.fy, cm.fz], r = [cm.fy, -cm.fx, 0], rl = Math.hypot(r[0], r[1]) || 1; r = [r[0] / rl, r[1] / rl, 0];
    var up = [r[1] * f[2], -r[0] * f[2], r[0] * f[1] - r[1] * f[0]], o = [cm.x, cm.y, cm.z], q = [];
    for (var cx = -1; cx <= 1; cx += 2) for (var cy = -1; cy <= 1; cy += 2)
      q.push([o[0] + f[0] * 0.3 + r[0] * cx * 0.2 + up[0] * cy * 0.12, o[1] + f[1] * 0.3 + r[1] * cx * 0.2 + up[1] * cy * 0.12, o[2] + f[2] * 0.3 + up[2] * cy * 0.12]);
    ctx.beginPath(); q.forEach(function (c) { seg(ctx, v, o, c); }); seg(ctx, v, q[0], q[1]); seg(ctx, v, q[1], q[3]); seg(ctx, v, q[3], q[2]); seg(ctx, v, q[2], q[0]); ctx.stroke();
  }

  if (robots > 0 && BOTS) {   // the real two-G1 carry at the spawn point, an arm on a scanned table, a Go2 patrolling
    var sec = REDUCED ? 0 : now / 1000, ra = 0.95 * robots * (1 - 0.5 * fac);
    drawBot(ctx, v, BOTS.coop, pingpong(BOTS.coop, sec), spawn[0], spawn[1] - 0.3, 0, Math.PI / 2, ra);
    drawBot(ctx, v, BOTS.arm, Math.floor(sec * BOTS.arm.fps) % BOTS.arm.n, BOTS.arm.at[0], BOTS.arm.at[1], BOTS.arm.at[2], 2.4, ra);
    var along = (Math.sin(sec / 4) + 1) / 2, back = Math.cos(sec / 4) < 0;
    drawBot(ctx, v, BOTS.quad, Math.floor(sec * BOTS.quad.fps) % BOTS.quad.n, spawn[0] - 0.4 - along * 2.6, spawn[1] - 1.3, 0, back ? 0 : Math.PI, ra);
  }

  var cur = Math.min(5, Math.floor(clamp(t, 0, 5.999)));
  capsEl.forEach(function (el, j) { el.classList.toggle('on', j === cur); });
  railBtns.forEach(function (b) { b.classList.toggle('on', +b.dataset.stage === cur); });
  if (verdictEl) verdictEl.classList.toggle('on', t > 5.45);
}
onScreen(story, function (on) { storyOn = on; });
drawStory(performance.now());
(function storyLoop(now) { if (storyOn) drawStory(now); requestAnimationFrame(storyLoop); })(performance.now());
addEventListener('resize', function () { drawHero(performance.now()); drawStory(performance.now()); });
})();
