/* Request-a-quote modal. Step 1 asks only for an email (phone and company optional); step 2 adds site details if the
   visitor wants feedback right away, saved against the same request.
   Storage: on the claude.ai share link, the artifact's db keeps each request and its assets store keeps an uploaded video,
   for viewers the platform lets write (the owner and organization members; outside visitors never can). Everywhere else,
   including the GitHub copy and local runs, there is no backend: the page shows the confirmation and stores nothing. */
(function () {
  'use strict';
  var dlg = document.getElementById('quote');
  if (!dlg) return;
  var views = {};
  dlg.querySelectorAll('[data-view]').forEach(function (v) { views[v.dataset.view] = v; });
  function go(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    var first = views[name].querySelector('input, select, textarea, button');
    if (first) first.focus();
  }
  document.querySelectorAll('[data-quote]').forEach(function (b) {
    b.addEventListener('click', function (e) { e.preventDefault(); go('step1'); dlg.showModal(); });
  });
  dlg.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
  dlg.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });   // a click on the backdrop closes it

  // null means no backend: the confirmation still shows, nothing is stored
  var store = (async function () {
    if (!window.claude || !window.claude.use) return null;
    var db = await window.claude.use('db'), user = await window.claude.use('user');
    if (!db || !user) return null;
    var uid = await user.id();
    return uid ? { db: db, uid: uid, assets: await window.claude.use('assets') } : null;
  })().catch(function () { return null; });
  var key = null;   // one request document per email, under the viewer's own subtree

  async function save(data, merge) {
    var s = await store;
    if (!s || !key) return false;
    try {
      var ref = s.db.doc('requests/' + s.uid + '/emails/' + key);
      if (merge) await ref.update(data); else await ref.set(data);
      return true;
    } catch (err) { return false; }
  }

  var f1 = document.getElementById('quote-step1');
  f1.addEventListener('submit', async function (e) {
    e.preventDefault();
    var d = new FormData(f1), email = String(d.get('email')).trim(), phone = String(d.get('phone') || '').trim();
    key = email.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 120);
    var btn = f1.querySelector('[type=submit]'); btn.disabled = true;
    await save({ email: email, phone: phone ? d.get('cc') + ' ' + phone : '', company: String(d.get('company') || '').trim(),
      details: false, createdAt: new Date().toISOString() });
    btn.disabled = false;
    go('received');
  });

  var rows = document.getElementById('machines');
  function addRow() {
    var r = document.createElement('div'); r.className = 'mrow';
    r.innerHTML = '<input placeholder="Machine type, for example CNC mill" aria-label="Machine type">' +
      '<input placeholder="Brand and model, for example Haas VF-2" aria-label="Brand and model">' +
      '<button type="button" class="x" aria-label="Remove this machine">&times;</button>';
    r.querySelector('.x').addEventListener('click', function () { r.remove(); });
    rows.appendChild(r);
  }
  addRow();
  document.getElementById('add-machine').addEventListener('click', addRow);

  var f2 = document.getElementById('quote-step2'), note = document.getElementById('upload-note');
  f2.addEventListener('submit', async function (e) {
    e.preventDefault();
    var d = new FormData(f2), file = f2.querySelector('input[type=file]').files[0], machines = [];
    rows.querySelectorAll('.mrow').forEach(function (r) {
      var t = r.children[0].value.trim(), m = r.children[1].value.trim();
      if (t || m) machines.push({ type: t, model: m });
    });
    var details = { location: String(d.get('location')).trim(), task: d.get('task'), goal: d.get('goal'), machines: machines,
      videoLink: String(d.get('videoLink') || '').trim(), notes: String(d.get('notes') || '').trim(),
      details: true, detailsAt: new Date().toISOString() };
    if (file && file.size > 20 * 1024 * 1024) { note.textContent = 'This video is over 20 MB. Please share a Drive or Dropbox link instead.'; return; }
    var btn = f2.querySelector('[type=submit]'); btn.disabled = true; note.textContent = '';
    var s = await store;
    if (file && s && s.assets) {   // without a backend the file never leaves the browser
      try { details.videoAsset = (await s.assets.upload(file)).id; }
      catch (err) { note.textContent = "The video didn't upload. Please share a Drive or Dropbox link instead."; btn.disabled = false; return; }
    }
    await save(details, true);
    btn.disabled = false;
    go('done');
  });
})();
