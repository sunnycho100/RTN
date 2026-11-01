/* Story step 03: the WS30 door job as dots. Today (a real worker's motion, CarDA CC BY 4.0) beside a robot team (two rail
   arms and two G1s, kinematic replay), on one real-time clock. Ported from docs/evidence/web/dots_team in the robot repo;
   data from dots_data.js (tools/pack_dots.py). Draws only while the team panel shows, and restarts each time it appears. */
(function () {
  'use strict';
  var D = window.DOTS, panel = document.getElementById('team-panel');
  if (!D || !panel) return;
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches, LEVELS = 6, M = D.manifest;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function css(n) { var h = getComputedStyle(document.documentElement).getPropertyValue(n).trim(), v = parseInt(h.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }
  var INK = css('--ink'), ACC = css('--accent');

  function parse(meta, b64) {
    var bin = atob(b64), u8 = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    var a = new Int16Array(u8.buffer), np = meta.points, pts = new Float32Array(np * 3);
    for (i = 0; i < np * 3; i++) pts[i] = a[i] / 1000;
    var parts = [], off = 0;
    meta.parts.forEach(function (p) { parts.push({ c: p.c, o: off, n: p.n }); off += p.n; });
    return { pts: pts, parts: parts, frames: a.subarray(np * 3), stride: parts.length * 7 + 6, F: meta.frames, fov: meta.fov_deg * Math.PI / 180 };
  }
  var sides = { today: parse(M.sides.today, D.today), team: parse(M.sides.team, D.team) };
  D.sides = sides;   // engine.js also draws the team inside the scan at story step 04
  var ev = document.getElementById('dots-events'), bar = document.getElementById('dots-bar');
  var NAMES = [[/team/i, 'Team formed'], [/picked/i, 'Door picked up'], [/delivered/i, 'Door delivered'], [/glass/i, 'Glass placed'],
    [/screw/i, 'Screw driven'], [/complete/i, 'Station done']];   // customer-facing names: no arm ids or station codes
  var spans = M.events.map(function (e) {
    var s = document.createElement('span'), m = NAMES.filter(function (n) { return n[0].test(e.name); })[0];
    s.textContent = m ? m[1] : e.name; ev.appendChild(s); return s;
  });
  var floor = makeFloor(M), period = M.duration + 2.5, t0 = 0, was = false;
  (function frame(now) {
    requestAnimationFrame(frame);
    var vis = panel.style.visibility === 'visible';
    if (vis && !was) t0 = now;
    was = vis;
    if (!vis) return;
    var t = REDUCED ? M.duration : ((now - t0) / 1000) % period, tc = Math.min(t, M.duration);
    draw(document.getElementById('dots-today'), sides.today, tc, floor, false);
    draw(document.getElementById('dots-team'), sides.team, tc, floor, true);
    M.events.forEach(function (e, j) { spans[j].className = tc >= e.t ? 'on' : ''; });
    bar.style.width = (100 * tc / M.duration).toFixed(2) + '%';
  })(performance.now());

  /* floor dots: platform grid; the belt band rides the belt; rails and the station stand on the team side */
  function makeFloor(M) {
    var f = M.floor, st = [], belt = [], rails = [], x, y, s = 0.32;
    for (x = f.x[0]; x <= f.x[1]; x += s) for (y = f.y[0]; y <= f.y[1]; y += s) {
      if (y > f.belt_y[0] && y < f.belt_y[1] && x < f.belt_x[1]) continue;
      st.push(x, y, 0);
    }
    for (x = f.x[0]; x <= f.belt_x[1]; x += 0.1) for (y = f.belt_y[0]; y <= f.belt_y[1]; y += 0.47) belt.push(x, y, 0);
    M.rails.forEach(function (r) { for (x = r.x[0]; x <= r.x[1]; x += 0.06) rails.push(x, r.y - 0.15, 0.1, x, r.y + 0.15, 0.1); });
    var w = M.ws2;
    for (x = -0.5; x <= 0.5; x += 0.05) for (y = -0.1; y <= 0.1; y += 0.1) rails.push(w[0] + x, w[1] + y, w[2]);
    return { st: st, belt: belt, rails: rails, beltV: M.belt, bx: f.belt_x };
  }

  var buckets = [];
  function cam(S, t, W, H) {
    var fi = clamp(t * 15, 0, S.F - 1), k = Math.floor(fi), u = fi - k, k2 = Math.min(k + 1, S.F - 1);
    var a = S.frames, b0 = k * S.stride + S.parts.length * 7, b1 = k2 * S.stride + S.parts.length * 7, e = [], g = [], i;
    for (i = 0; i < 3; i++) { e[i] = (a[b0 + i] * (1 - u) + a[b1 + i] * u) / 1000; g[i] = (a[b0 + 3 + i] * (1 - u) + a[b1 + 3 + i] * u) / 1000; }
    var dx = e[0] - g[0], dy = e[1] - g[1], yaw = 0.035 * Math.sin(t * 2 * Math.PI / 23), c = Math.cos(yaw), s = Math.sin(yaw);
    e[0] = g[0] + c * dx - s * dy; e[1] = g[1] + s * dx + c * dy; e[2] += 0.06 * Math.sin(t * 2 * Math.PI / 31);   // slow drift
    var fx = g[0] - e[0], fy = g[1] - e[1], fz = g[2] - e[2], fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    var rx = fy, ry = -fx, rl = Math.hypot(rx, ry); rx /= rl; ry /= rl;
    return { px: e[0], py: e[1], pz: e[2], fx: fx, fy: fy, fz: fz, rx: rx, ry: ry, ux: ry * fz, uy: -rx * fz, uz: rx * fy - ry * fx,
      f: 0.5 * W / Math.tan(S.fov / 2), cx: W / 2, cy: H / 2, k: k, k2: k2, u: u };
  }
  function put(v, x, y, z, col, size, base, dpr) {
    var dx = x - v.px, dy = y - v.py, dz = z - v.pz, zc = dx * v.fx + dy * v.fy + dz * v.fz;
    if (zc < 0.15) return;
    var sx = v.cx + v.f * (dx * v.rx + dy * v.ry) / zc, sy = v.cy - v.f * (dx * v.ux + dy * v.uy + dz * v.uz) / zc;
    var s = clamp(size * v.f / zc, 0.7 * dpr, 2.6 * dpr), al = clamp(Math.round(base * clamp(1.5 - zc / 14, 0.35, 1) * LEVELS), 1, LEVELS);
    buckets[col * LEVELS + al - 1].push(sx - s / 2, sy - s / 2, s);
  }
  function draw(cv, S, t, FL, team) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var W = cv.width, H = cv.height, ctx = cv.getContext('2d'), v = cam(S, t, W, H), i, j;
    for (i = 0; i < 2 * LEVELS; i++) (buckets[i] || (buckets[i] = [])).length = 0;
    ctx.clearRect(0, 0, W, H);
    var a = FL.st; for (i = 0; i < a.length; i += 3) put(v, a[i], a[i + 1], a[i + 2], 0, 0.015, 0.3, dpr);
    var sh = (FL.beltV * t) % 0.1; a = FL.belt;
    for (i = 0; i < a.length; i += 3) { var bx = a[i] + sh; if (bx < FL.bx[1]) put(v, bx, a[i + 1], 0, 0, 0.014, 0.42, dpr); }
    if (team) { a = FL.rails; for (i = 0; i < a.length; i += 3) put(v, a[i], a[i + 1], a[i + 2], 1, 0.013, 0.38, dpr); }
    var fr = S.frames, P = S.pts;
    S.parts.forEach(function (p, pi) {
      var o0 = v.k * S.stride + pi * 7, o1 = v.k2 * S.stride + pi * 7, u = v.u;
      var qx = fr[o0] * (1 - u) + fr[o1] * u, qy = fr[o0 + 1] * (1 - u) + fr[o1 + 1] * u, qz = fr[o0 + 2] * (1 - u) + fr[o1 + 2] * u, qw = fr[o0 + 3] * (1 - u) + fr[o1 + 3] * u;
      var ql = Math.hypot(qx, qy, qz, qw) || 1; qx /= ql; qy /= ql; qz /= ql; qw /= ql;
      var tx = (fr[o0 + 4] * (1 - u) + fr[o1 + 4] * u) / 1000, ty = (fr[o0 + 5] * (1 - u) + fr[o1 + 5] * u) / 1000, tz = (fr[o0 + 6] * (1 - u) + fr[o1 + 6] * u) / 1000;
      var r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw),
          r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw),
          r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
      var col = p.c === 'a' ? 1 : 0, base = p.c === 'a' ? 1 : 0.92;
      for (j = p.o * 3; j < (p.o + p.n) * 3; j += 3) {
        var x = P[j], y = P[j + 1], z = P[j + 2];
        put(v, tx + r00 * x + r01 * y + r02 * z, ty + r10 * x + r11 * y + r12 * z, tz + r20 * x + r21 * y + r22 * z, col, 0.011, base, dpr);
      }
    });
    for (i = 0; i < 2 * LEVELS; i++) {
      var bk = buckets[i]; if (!bk.length) continue;
      ctx.fillStyle = rgba(i < LEVELS ? INK : ACC, ((i % LEVELS) + 1) / LEVELS);
      for (j = 0; j < bk.length; j += 3) ctx.fillRect(bk[j], bk[j + 1], bk[j + 2], bk[j + 2]);
    }
  }
})();
