/* Shared animation engine for the landing page drafts (index.html, v2.html).
   Draws the real scan (scan.js) on two 2D canvases: #hero (a capture dome around the scan) and #sim (a pinned scroll story).
   Colors come from the page's CSS tokens; layout knobs come from window.SITE (see DEFAULTS). No libraries. */
(function () {
'use strict';
var DEFAULTS = {
  hero: { ox: 0.68, oy: 0.42, pitch: 0.32, fov: 0.62, dist: 4.3, strut: 0.22 },
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
var reveal = new Float32Array(N), near5 = 0, near15 = 0;
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
  if (d < 0.05) near5++; if (d < 0.15) near15++;
}
function setText(id, s) { var el = document.getElementById(id); if (el) el.innerHTML = s; }
setText('stat-build', S.walls.length + ' wall boxes · ' + S.hulls.length + ' clutter pieces');
setText('stat-check', Math.round(100 * near5 / N) + '% of scan points within 5 cm of a shape · ' + Math.round(100 * near15 / N) + '% within 15 cm');

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
function drawPoints(ctx, v, pick, size, dx, dy, step, xs, ys, zs) {
  xs = xs || X; ys = ys || Y; zs = zs || Z;
  var nb = 4 * LEVELS; for (k = 0; k < nb; k++) (buckets[k] || (buckets[k] = [])).length = 0;
  for (i = 0; i < N; i += step) {
    var r = pick(i); if (!r) continue;               // r = colorIndex * 16 + alphaLevel (1..8)
    if (!proj(v, xs[i] + dx, ys[i] + dy, zs[i])) continue;
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

/* ---- HERO: a dome (icosphere struts) around the real scan, with one scanner at the top ---- */
var dome = (function () {
  var q = (1 + Math.sqrt(5)) / 2, IV = [[-1, q, 0], [1, q, 0], [-1, -q, 0], [1, -q, 0], [0, -1, q], [0, 1, q], [0, -1, -q], [0, 1, -q], [q, 0, -1], [q, 0, 1], [-q, 0, -1], [-q, 0, 1]];
  var IF = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  var V = [], E = {}, F = 3, idx = {};
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
  });
  return { V: V, E: Object.keys(E).map(function (s) { return s.split('-').map(Number); }) };
})();

var heroCv = document.getElementById('hero'), heroOn = true, heroT0 = performance.now();
/* Hero robots are drawn 1.6x life size so they read at globe size; each arm stands on a raised platform of dots
   (0.6 m square, 0.75 m tall before scaling), like a workbench. */
var HSC = 1.6, PED_H = 0.75 * HSC, PED = (function () {
  var p = [], w = 0.3 * HSC, st = 0.05 * HSC, x, y, z;
  for (x = -w; x <= w + 1e-6; x += st) for (y = -w; y <= w + 1e-6; y += st) p.push(x, y, PED_H);   // top
  for (z = 0; z < PED_H; z += st) for (x = -w; x <= w + 1e-6; x += st) p.push(x, -w, z, x, w, z, -w, x, z, w, x, z);   // sides
  return p;
})();
function drawPed(ctx, v, ox, oy, a) {
  ctx.fillStyle = rgba(C.ink, 0.5 * a);
  for (var j = 0; j < PED.length; j += 3) {
    if (!proj(v, ox + PED[j], oy + PED[j + 1], PED[j + 2])) continue;
    var s = clamp(0.02 * v.f / P[2], 0.8, 2.4); ctx.fillRect(P[0] - s / 2, P[1] - s / 2, s, s);
  }
}
/* Intro: the floor appears first, then everything above it rises in height order (scan.js lists the ground points
   first, then the rest by rising z), then the robots fade in. */
var GROUND = S.ground_count || 0;
/* Hero only: points near the floor's four edges drift up and a little outward and fade, so the scan dissolves instead of
   stopping at a hard rectangle. The band width wobbles along each edge so no two sides look the same. */
var EX = new Float32Array(N), EY = new Float32Array(N), EZ = new Float32Array(N), EA = new Float32Array(N);
(function () {
  var seed = 11, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, hx = RW / 2, hy = RD / 2;
  for (i = 0; i < N; i++) {
    var dx = hx - Math.abs(X[i]), dy = hy - Math.abs(Y[i]), d = Math.min(dx, dy);
    var band = 0.9 + 0.35 * Math.sin(X[i] * 1.7 + Y[i] * 2.3), e = clamp(1 - d / band, 0, 1), r = rnd(); e *= e;
    EX[i] = X[i] + (dx < dy ? Math.sign(X[i]) * e * r * 0.3 : 0);
    EY[i] = Y[i] + (dx < dy ? 0 : Math.sign(Y[i]) * e * r * 0.3);
    EZ[i] = Z[i] + e * (0.1 + 0.8 * r * r);
    EA[i] = 1 - 0.55 * e;
  }
})();
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
  ctx.lineWidth = dpr;
  var fp = REDUCED ? 1 : clamp((t - 300) / 2600, 0, 1), shown = GROUND * smooth(0, 0.35, fp) + (N - GROUND) * smooth(0.35, 1, fp);
  // one scanner at the top of the dome sweeps a slow line back and forth across the floor; dots under it light up
  var scanOn = !REDUCED && t > 3200, sweep = scanOn ? 0.5 - 0.5 * Math.cos(((t - 3200) / 9000) * TAU) : 0, sx = (sweep - 0.5) * RW;
  drawPoints(ctx, v, function (i) {
    if (i >= shown) return 0;
    if (scanOn && Math.abs(EX[i] - sx) < 0.14) return 16 + lvl(0.95);   // accent colour bucket
    return lvl((0.35 + 0.07 * SH[i]) * EA[i]);
  }, 0.022, 0, 0, SMALL ? 3 : 2, EX, EY, EZ);   // every other point: the 6.5 cm cloud reads as a carpet otherwise
  if (proj(v, 0, 0, cz + R)) {
    var hx = P[0], hy = P[1];
    if (scanOn && proj(v, sx, -RD / 2, 0)) {
      var ax = P[0], ay = P[1];
      if (proj(v, sx, RD / 2, 0)) {   // a faint fan from the scanner to the line it is reading
        ctx.fillStyle = rgba(C.acc, 0.07); ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ax, ay); ctx.lineTo(P[0], P[1]); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(C.acc, 0.8); ctx.lineWidth = 1.4 * dpr; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(P[0], P[1]); ctx.stroke();
      }
    }
    ctx.fillStyle = rgba(C.acc, 0.95); ctx.fillRect(hx - 3 * dpr, hy - 3 * dpr, 6 * dpr, 6 * dpr);   // the scanner
  }
  if (BOTS && BOTS.h1) {   // two Unitree H1s facing each other in the rebuilt room
    var ha = REDUCED ? 1 : smooth(2900, 4100, t), fr = Math.floor(t / 1000 * BOTS.h1.fps) % BOTS.h1.n;
    if (ha > 0) {
      drawBot(ctx, v, BOTS.h1, fr, -RW * 0.27, -0.2, (1 - ha) * 0.8, 0, 0.95 * ha, true, HSC);
      drawBot(ctx, v, BOTS.h1, (fr + 20) % BOTS.h1.n, RW * 0.27, 0.2, (1 - ha) * 0.8, Math.PI, 0.95 * ha, true, HSC);
    }
    var ra = REDUCED ? 1 : smooth(3600, 4800, t), sec = t / 1000;   // then two arms on raised platforms and a Go2 trotting across
    if (ra > 0) {
      var fa = Math.floor(sec * BOTS.arm.fps) % BOTS.arm.n;
      [-1, 1].forEach(function (side, j) {
        drawPed(ctx, v, side * RW * 0.13, RD * 0.28, ra);
        drawBot(ctx, v, BOTS.arm, (fa + j * 45) % BOTS.arm.n, side * RW * 0.13, RD * 0.28, PED_H + (1 - ra) * 0.8, -Math.PI / 2, 0.95 * ra, true, HSC);
      });
      var u = (Math.sin(sec / 3) + 1) / 2;
      drawBot(ctx, v, BOTS.quad, Math.floor(sec * BOTS.quad.fps) % BOTS.quad.n, RW * (u - 0.5) * 0.6, -RD * 0.3, (1 - ra) * 0.8, Math.cos(sec / 3) < 0 ? Math.PI : 0, 0.95 * ra, true, HSC);
    }
  }
}
if (heroCv) {
  onScreen(heroCv, function (on) { heroOn = on; });
  (function heroLoop(now) { if (heroOn) drawHero(now); if (!REDUCED) requestAnimationFrame(heroLoop); })(performance.now());
}

/* ---- STORY: one pinned canvas, scroll drives six stages ---- */
var story = document.getElementById('story'), simCv = document.getElementById('sim');
if (!story || !simCv) return;
var capsEl = Array.prototype.slice.call(document.querySelectorAll('.cap')), railBtns = Array.prototype.slice.call(document.querySelectorAll('[data-stage]'));
var verdictEl = document.getElementById('verdict'), storyOn = false, tShown = 0;
var KEYS = [  // camera at the start of each stage (input, capture, rebuild, team, run, decide) and the final pull-back
  { yaw: -2.6, pitch: 0.75, dist: 9.0 }, { yaw: -2.3, pitch: 0.62, dist: 8.2 }, { yaw: -1.4, pitch: 0.7, dist: 7.8 },
  { yaw: -0.9, pitch: 0.85, dist: 8.2 }, { yaw: -0.3, pitch: 0.38, dist: 6.5 }, { yaw: 0.25, pitch: 0.9, dist: 9.5 }, { yaw: 0.55, pitch: 1.02, dist: 30 }];
KEYS.forEach(function (k, j) { if (j !== 4) k.dist *= Math.max(RW, RD) / 4.83; });   // tuned for a 4.83 m room; stage 04 frames the robots, not the room
var panels = { lead: document.getElementById('lead-panel'), pip: document.getElementById('pip'), team: document.getElementById('team-panel') };
function show(el, o) { if (el) { el.style.opacity = o.toFixed(3); el.style.visibility = o > 0.01 ? 'visible' : 'hidden'; } }
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
}
function eachBotPoint(R, frame, fn) {   // fn(x, y, z, accent, body index) for every body point, in the robot's frame
  var fr = R.f[frame];
  R.bodies.forEach(function (b, bi) {
    var o = bi * 7, px = fr[o] / 1000, py = fr[o + 1] / 1000, pz = fr[o + 2] / 1000;
    var qw = fr[o + 3] / 1000, qx = fr[o + 4] / 1000, qy = fr[o + 5] / 1000, qz = fr[o + 6] / 1000, p = b.p;
    for (var j = 0; j < p.length; j += 3) {
      var lx = p[j], ly = p[j + 1], lz = p[j + 2];
      var tx = 2 * (qy * lz - qz * ly), ty = 2 * (qz * lx - qx * lz), tz = 2 * (qx * ly - qy * lx);   // rotate by the body quaternion
      fn(lx + qw * tx + (qy * tz - qz * ty) + px, ly + qw * ty + (qz * tx - qx * tz) + py, lz + qw * tz + (qx * ty - qy * tx) + pz, b.c, bi);
    }
  });
}
function drawBot(ctx, v, R, frame, ox, oy, oz, yaw, a, tint, sc) {
  var cy = Math.cos(yaw), sy = Math.sin(yaw), cols = [rgba(C.ink, a), rgba(C.acc, a)];
  sc = sc || 1;
  eachBotPoint(R, frame, function (wx, wy, wz, c) {
    wx *= sc; wy *= sc; wz *= sc;
    if (!proj(v, ox + cy * wx - sy * wy, oy + sy * wx + cy * wy, oz + wz)) return;
    ctx.fillStyle = tint ? cols[1] : cols[c];
    var s = clamp(0.022 * v.f / P[2], 1, 3.4); ctx.fillRect(P[0] - s / 2, P[1] - s / 2, s, s);
  });
}
/* Step 04: the WS30 robot team (two rail arms, two G1s, the door) from dots_data.js, in the scan's own plant frame.
   dots.js parses it; one rigid transform per part per frame, every other point. */
function wsTeam() { return window.DOTS && window.DOTS.sides && window.DOTS.sides.team; }
var teamB = null, teamC = null, teamT0 = 0;
function teamPose(T, pi, k, k2, u) {
  var fr = T.frames, o0 = k * T.stride + pi * 7, o1 = k2 * T.stride + pi * 7, m = function (j) { return fr[o0 + j] * (1 - u) + fr[o1 + j] * u; };
  var qx = m(0), qy = m(1), qz = m(2), qw = m(3), ql = Math.hypot(qx, qy, qz, qw) || 1; qx /= ql; qy /= ql; qz /= ql; qw /= ql;
  return [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw), 2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz - qx * qw), 2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy), m(4) / 1000 - OX, m(5) / 1000 - OY, m(6) / 1000];
}
function drawTeam(ctx, v, T, sec, a) {
  var fi = clamp(sec * 15, 0, T.F - 1), k = Math.floor(fi), k2 = Math.min(k + 1, T.F - 1), u = fi - k, Q = T.pts, cols = [rgba(C.ink, 0.85 * a), rgba(C.acc, a)];
  T.parts.forEach(function (p, pi) {
    var r = teamPose(T, pi, k, k2, u);
    ctx.fillStyle = cols[p.c === 'a' ? 1 : 0];
    for (var j = p.o * 3; j < (p.o + p.n) * 3; j += 6) {
      var x = Q[j], y = Q[j + 1], z = Q[j + 2];
      if (!proj(v, r[9] + r[0] * x + r[1] * y + r[2] * z, r[10] + r[3] * x + r[4] * y + r[5] * z, r[11] + r[6] * x + r[7] * y + r[8] * z)) continue;
      var s = clamp(0.02 * v.f / P[2], 1, 3); ctx.fillRect(P[0] - s / 2, P[1] - s / 2, s, s);
    }
  });
}
function teamBox(T) {   // where the robots work over the whole run: frames the step 04 camera and the floor grid
  var b = [1e9, -1e9, 1e9, -1e9];
  for (var k = 0; k < T.F; k += 15) T.parts.forEach(function (p, pi) {
    if (p.c !== 'a') return; var r = teamPose(T, pi, k, k, 0);
    b[0] = Math.min(b[0], r[9]); b[1] = Math.max(b[1], r[9]); b[2] = Math.min(b[2], r[10]); b[3] = Math.max(b[3], r[10]);
  });
  return b;
}
function drawStory(now) {
  var dpr = fit(simCv), W = simCv.width, H = simCv.height, ctx = simCv.getContext('2d'), so = SMALL ? CFG.storySmall : CFG.story;
  tShown += (storyT() - tShown) * (REDUCED ? 1 : 0.14); var t = tShown;
  var a = Math.min(5, Math.floor(t)), u = smooth(0, 1, t - a), K0 = KEYS[a], K1 = KEYS[a + 1];
  var T = wsTeam(); if (T && !teamB) { teamB = teamBox(T); teamC = [(teamB[0] + teamB[1]) / 2, (teamB[2] + teamB[3]) / 2]; }
  var fc = teamC || [spawn[0] - 0.7, spawn[1] - 0.5], focus = T || BOTS ? smooth(4, 4.35, t) * (1 - smooth(5, 5.35, t)) : 0;   // stage 04 looks at the robots
  var v = view(W, H, { tx: focus * fc[0], ty: focus * fc[1], tz: a === 5 ? 0.4 : 0.7, yaw: K0.yaw + (K1.yaw - K0.yaw) * u + (REDUCED ? 0 : Math.sin(now / 9000) * 0.03),
    pitch: K0.pitch + (K1.pitch - K0.pitch) * u + CFG.story.pitch, dist: K0.dist + (K1.dist - K0.dist) * (a === 5 ? smooth(0.15, 1, t - 5) : u), fov: CFG.story.fov, ox: so.ox, oy: so.oy });
  ctx.clearRect(0, 0, W, H);

  var cap = clamp(t - 1, 0, 1), robots = smooth(4, 4.25, t), fac = smooth(5.15, 5.7, t), g;
  var team = smooth(3, 3.2, t) * (1 - smooth(3.8, 4, t)), dots = smooth(0.85, 1.05, t) * (1 - 0.75 * team);
  show(panels.lead, 1 - smooth(0.75, 1, t)); show(panels.pip, smooth(2, 2.2, t) * (1 - smooth(2.8, 3, t))); show(panels.team, team);

  ctx.lineWidth = dpr; ctx.strokeStyle = rgba(C.line, 0.9); ctx.beginPath();     // floor grid
  // the grid covers the scan and, when the robot team works past the scanned edge, the simulated floor under it too
  var x0 = -RW / 2 - 0.6, x1 = RW / 2 + 0.6, y0 = -RD / 2 - 0.6, y1 = RD / 2 + 0.6;
  if (teamB) { x0 = Math.min(x0, teamB[0] - 1); x1 = Math.max(x1, teamB[1] + 1); y0 = Math.min(y0, teamB[2] - 1); y1 = Math.max(y1, teamB[3] + 1); }
  x0 = Math.floor(x0 * 2) / 2; y0 = Math.floor(y0 * 2) / 2;
  for (g = x0; g <= x1 + 1e-6; g += 0.5) seg(ctx, v, [g, y0, 0], [g, y1, 0]);
  for (g = y0; g <= y1 + 1e-6; g += 0.5) seg(ctx, v, [x0, g, 0], [x1, g, 0]);
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
  drawPoints(ctx, v, function (i) {   // the scan: revealed along the camera path, then the rebuilt room
    if (t < 2 && reveal[i] > cap * 1.04) return 0;
    return lvl(dots * (1 - robots * (1 - fac)) * (0.38 + 0.065 * SH[i]));   // step 04 shows only what moves on the grid floor; the scan returns for the zoom-out
  }, 0.03, 0, 0, SMALL ? 2 : 1);

  var path = smooth(0.9, 1.05, t) * (1 - smooth(1.7, 2.3, t));   // camera path and the moving camera (capture)
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

  if (robots > 0 && T) {   // the WS30 robot team doing the door job, restarted each time step 04 comes into view
    if (!teamT0) teamT0 = now;
    drawTeam(ctx, v, T, REDUCED ? T.F / 15 : ((now - teamT0) / 1000) % (T.F / 15 + 2), 0.95 * robots * (1 - 0.5 * fac));
  } else teamT0 = 0;

  var cur = Math.min(5, Math.floor(clamp(t, 0, 5.999)));
  capsEl.forEach(function (el, j) { el.classList.toggle('on', j === cur); });
  railBtns.forEach(function (b) { b.classList.toggle('on', +b.dataset.stage === cur); });
  if (verdictEl) verdictEl.classList.toggle('on', t > 5.45);
}
/* ---- hero runner: a Go2 trots in towing "your workplace." on a leash; the words slide out after "into" and settle,
   the leash lets go and the dog runs off. Reduced motion shows the finished headline. ---- */
var runCv = document.getElementById('runner'), tow = document.querySelector('.tow'), towIn = tow && tow.firstElementChild;
if (runCv && towIn && BOTS && BOTS.quad && !REDUCED) {
  tow.classList.add('wait');
  var YAW = 0.5, PITCH = 0.32, cyw = Math.cos(YAW), syw = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  var dog = function (fr, fn) {   // three-quarter view of the Go2: screen x, height above the feet
    eachBotPoint(BOTS.quad, fr, function (x, y, z, c, bi) { var xr = x * cyw - y * syw, yr = x * syw + y * cyw; fn(xr, z * cp + yr * sp, bi); });
  };
  var vMin = 1e9, vTop = -1e9, xMin = 1e9, xMax = -1e9;
  dog(0, function (x, v) { vMin = Math.min(vMin, v); vTop = Math.max(vTop, v); xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); });
  var RUN0 = 900, ARRIVE = 1700, LAG = 90, SETTLE = 450, LET_GO = 300, ACC = 300;   // ms
  var bgc = rgba(rgb(css('--bg')), 1), YELLOW = '#f7c600', LEG = '#4a4d4c', done = false, pts = [];   // Spot colours: yellow body, dark lower legs
  (function runLoop(now) {
    var dpr = fit(runCv), ctx = runCv.getContext('2d'), W = runCv.width, t = now - heroT0 - RUN0;
    ctx.clearRect(0, 0, W, runCv.height);
    if (done) return;
    requestAnimationFrame(runLoop);
    if (t < 0) return;
    tow.classList.remove('wait');
    var cr = runCv.getBoundingClientRect(), tr = tow.getBoundingClientRect(), fs = parseFloat(getComputedStyle(tow).fontSize);
    var h = Math.max(1.1 * fs, 56) * dpr, s = h / (vTop - vMin), len = (xMax - xMin) * s;   // dog height in canvas px, px per metre
    var base = (tr.bottom - cr.top - 0.2 * fs) * dpr, endX = (tr.right - cr.left) * dpr, slot = (tr.left - cr.left) * dpr, midY = (tr.top - cr.top + 0.55 * tr.height) * dpr;
    var L = 0.9 * len, hx0 = -0.2 * s, hz = (0.32 - vMin) * s;   // leash length; harness on the dog's back
    var p = function (u) { return u < ACC ? u * u / (2 * ACC) : u - ACC / 2; };   // ease into a steady run
    var x0 = -0.7 * len, v = (endX + L - hx0 - x0) / p(ARRIVE - LAG);
    var D = x0 + v * p(t), text = Math.min(endX, x0 + v * p(Math.max(0, t - LAG)) + hx0 - L);   // the words trail the dog
    var off = text - endX, skew, since = t - ARRIVE;
    if (since < 0) skew = Math.min(9, v / dpr * 10);
    else { off = 0; skew = 9 * Math.exp(-since / 110) * Math.cos(since / 55); }   // a small wobble as they land
    towIn.style.transform = 'translateX(' + (off / dpr).toFixed(1) + 'px) skewX(' + skew.toFixed(2) + 'deg)';
    if (since > SETTLE && D > W + len) { towIn.style.transform = ''; done = true; return; }   // hand the headline back to CSS
    var la = since < 0 ? 1 : clamp(1 - since / LET_GO, 0, 1);   // leash: slight sag while it pulls, then slack and gone
    if (la > 0) {
      var ax = D + hx0, ay = base - hz, bx = Math.max(slot, text) + 2 * dpr, by = midY, d = Math.hypot(ax - bx, ay - by), rest = L * 1.06 + Math.max(0, since) * 0.3 * dpr;
      var sag = d < rest ? Math.sqrt(rest * rest - d * d) * 0.6 : 0.02 * fs * dpr;
      ctx.strokeStyle = rgba(C.acc, 0.9 * la); ctx.lineWidth = 1.6 * dpr; ctx.beginPath(); ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 2 * sag, bx, by); ctx.stroke();
    }
    var fr = Math.floor(t / 1000 * BOTS.quad.fps * 2) % BOTS.quad.n, q = Math.max(2.4 * dpr, h / 34);   // trot at double speed: a run
    pts.length = 0; dog(fr, function (x, vz, bi) { pts.push(D + x * s, base - (vz - vMin) * s, bi > 0 && bi % 3 === 0); });   // bodies: base, then hip, thigh, calf per leg
    ctx.fillStyle = bgc; for (var j = 0; j < pts.length; j += 3) ctx.fillRect(pts[j] - (q + 5 * dpr) / 2, pts[j + 1] - (q + 5 * dpr) / 2, q + 5 * dpr, q + 5 * dpr);   // dark cutout so it reads over the text
    for (j = 0; j < pts.length; j += 3) { ctx.fillStyle = pts[j + 2] ? LEG : YELLOW; ctx.fillRect(pts[j] - q / 2, pts[j + 1] - q / 2, q, q); }
  })(performance.now());
}
onScreen(story, function (on) { storyOn = on; });
drawStory(performance.now());
(function storyLoop(now) { if (storyOn) drawStory(now); requestAnimationFrame(storyLoop); })(performance.now());
addEventListener('resize', function () { drawHero(performance.now()); drawStory(performance.now()); });
})();
