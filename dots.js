/* Story step 03: the WS30 door job, today (a real worker's motion, CarDA CC BY 4.0) beside a robot team (two rail arms and
   two G1s, kinematic replay), on one real-time clock. engine.js draws both side by side in the story canvas; this file parses
   dots_data.js (tools/pack_dots.py) and runs the clock, the event strip and the progress bar while the step shows. */
(function () {
  'use strict';
  var D = window.DOTS, panel = document.getElementById('team-panel');
  if (!D || !panel) return;
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches, M = D.manifest;

  function parse(meta, b64) {
    var bin = atob(b64), u8 = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    var a = new Int16Array(u8.buffer), np = meta.points, pts = new Float32Array(np * 3);
    for (i = 0; i < np * 3; i++) pts[i] = a[i] / 1000;
    var parts = [], off = 0;
    meta.parts.forEach(function (p) { parts.push({ c: p.c, o: off, n: p.n }); off += p.n; });
    return { pts: pts, parts: parts, frames: a.subarray(np * 3), stride: parts.length * 7 + 6, F: meta.frames, fov: meta.fov_deg * Math.PI / 180 };
  }
  D.sides = { today: parse(M.sides.today, D.today), team: parse(M.sides.team, D.team) };
  D.clock = 0;   // seconds into the run; engine.js reads it
  var ev = document.getElementById('dots-events'), bar = document.getElementById('dots-bar');
  var NAMES = [[/team/i, 'Team formed'], [/picked/i, 'Door picked up'], [/delivered/i, 'Door delivered'], [/glass/i, 'Glass placed'],
    [/screw/i, 'Screw driven'], [/complete/i, 'Station done']];   // customer-facing names: no arm ids or station codes
  var spans = M.events.map(function (e) {
    var s = document.createElement('span'), m = NAMES.filter(function (n) { return n[0].test(e.name); })[0];
    s.textContent = m ? m[1] : e.name; ev.appendChild(s); return s;
  });
  var period = M.duration + 2.5, t0 = 0, was = false;
  (function frame(now) {
    requestAnimationFrame(frame);
    var vis = panel.style.visibility === 'visible';
    if (vis && !was) t0 = now;
    was = vis;
    if (!vis) return;
    var t = REDUCED ? M.duration : ((now - t0) / 1000) % period, tc = Math.min(t, M.duration);
    D.clock = tc;
    M.events.forEach(function (e, j) { spans[j].className = tc >= e.t ? 'on' : ''; });
    bar.style.width = (100 * tc / M.duration).toFixed(2) + '%';
  })(performance.now());
})();
