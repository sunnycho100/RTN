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

  // Country code: type digits or a country name; the list filters by prefix, and a code not in it is kept as typed.
  var CODES = [['1', 'US and Canada'], ['7', 'Kazakhstan'], ['20', 'Egypt'], ['27', 'South Africa'], ['31', 'Netherlands'], ['32', 'Belgium'],
    ['33', 'France'], ['34', 'Spain'], ['36', 'Hungary'], ['39', 'Italy'], ['40', 'Romania'], ['41', 'Switzerland'], ['43', 'Austria'],
    ['44', 'United Kingdom'], ['45', 'Denmark'], ['46', 'Sweden'], ['47', 'Norway'], ['48', 'Poland'], ['49', 'Germany'], ['52', 'Mexico'],
    ['55', 'Brazil'], ['60', 'Malaysia'], ['61', 'Australia'], ['62', 'Indonesia'], ['63', 'Philippines'], ['64', 'New Zealand'],
    ['65', 'Singapore'], ['66', 'Thailand'], ['81', 'Japan'], ['82', 'Korea'], ['84', 'Vietnam'], ['86', 'China'], ['90', 'Turkey'],
    ['91', 'India'], ['351', 'Portugal'], ['353', 'Ireland'], ['358', 'Finland'], ['420', 'Czechia'], ['852', 'Hong Kong'], ['886', 'Taiwan'],
    ['966', 'Saudi Arabia'], ['971', 'United Arab Emirates'], ['972', 'Israel']];
  var cc = document.getElementById('cc'), ccList = document.getElementById('cc-list'), ccMatch = [], ccAt = -1;
  function ccOpen(open) { ccList.hidden = !open; cc.setAttribute('aria-expanded', open); if (!open) cc.removeAttribute('aria-activedescendant'); }
  function ccFilter() {
    var q = cc.value.trim().toLowerCase(), digits = q.replace(/[^0-9]/g, ''), name = q.replace(/^\+?[0-9 ]*/, '');
    ccMatch = CODES.filter(function (c) { return digits ? c[0].indexOf(digits) === 0 : !name || c[1].toLowerCase().indexOf(name) === 0; });
    ccAt = ccMatch.length ? 0 : -1;
    ccList.innerHTML = ccMatch.map(function (c, i) { return '<li role="option" id="cc-' + i + '" aria-selected="' + (i === ccAt) + '"><b>+' + c[0] + '</b>' + c[1] + '</li>'; }).join('');
    ccOpen(ccMatch.length > 0); ccMark();
  }
  function ccMark() {
    [].forEach.call(ccList.children, function (li, i) { li.setAttribute('aria-selected', i === ccAt); });
    if (ccAt >= 0) { cc.setAttribute('aria-activedescendant', 'cc-' + ccAt); ccList.children[ccAt].scrollIntoView({ block: 'nearest' }); }
  }
  function ccPick(i) { cc.value = '+' + ccMatch[i][0]; ccOpen(false); }
  cc.addEventListener('input', ccFilter);
  cc.addEventListener('focus', function () { cc.select(); ccFilter(); });
  cc.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (ccList.hidden) return ccFilter();
      ccAt = (ccAt + (e.key === 'ArrowDown' ? 1 : ccMatch.length - 1)) % ccMatch.length; ccMark();
    } else if (e.key === 'Enter' && !ccList.hidden && ccAt >= 0) { e.preventDefault(); ccPick(ccAt); }
    else if (e.key === 'Escape' && !ccList.hidden) { e.preventDefault(); e.stopPropagation(); ccOpen(false); }
  });
  ccList.addEventListener('mousedown', function (e) { var li = e.target.closest('li'); if (li) { e.preventDefault(); ccPick([].indexOf.call(ccList.children, li)); } });
  cc.addEventListener('blur', function () {   // keep a code that is not in the list, written as +digits
    ccOpen(false); var d = cc.value.replace(/[^0-9]/g, ''); cc.value = d ? '+' + d : '';
  });

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
