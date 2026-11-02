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
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches, trigger = null;
  function show(name, animate) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    var v = views[name]; v.classList.remove('enter');
    if (animate) { void v.offsetWidth; v.classList.add('enter'); }
    var first = v.querySelector('input, select, textarea, button');   // focus moves in on desktop; on phones it would pop the keyboard
    if (first && matchMedia('(min-width: 601px)').matches) first.focus({ preventScroll: true });
  }
  // A step change fades the old view out (150 ms), eases the panel height to the new view (280 ms) and lets it rise in.
  function go(name) {
    var cur = Object.keys(views).filter(function (k) { return !views[k].hidden; })[0];
    if (!dlg.open || !cur || cur === name) return show(name, false);
    var h0 = dlg.offsetHeight; views[cur].classList.add('leave');
    setTimeout(function () {
      views[cur].classList.remove('leave'); show(name, true);
      if (REDUCED) return;
      var h1 = dlg.offsetHeight; dlg.style.height = h0 + 'px'; void dlg.offsetHeight;
      dlg.style.transition = 'height 280ms cubic-bezier(0.16, 1, 0.3, 1)'; dlg.style.height = h1 + 'px';
      setTimeout(function () { dlg.style.height = dlg.style.transition = ''; }, 300);
    }, REDUCED ? 120 : 150);
  }
  function closeQuote() {   // let the close animation play, then hand focus back to whatever opened the form
    if (!dlg.open || dlg.classList.contains('closing')) return;
    dlg.classList.add('closing');
    setTimeout(function () { dlg.classList.remove('closing'); dlg.close(); if (trigger) trigger.focus(); }, REDUCED ? 120 : 160);
  }
  document.querySelectorAll('[data-quote]').forEach(function (b) {
    b.addEventListener('click', function (e) { e.preventDefault(); trigger = b; dlg.showModal(); show('step1', false); });   // after showModal, which would focus the close button
  });
  dlg.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeQuote); });
  dlg.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });
  // The dialog element itself is the target for clicks on its padding as well as on the backdrop, so close only when the press
  // and the release both land outside its box (a text selection dragged out of a field does not count).
  function outside(e) { var r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; }
  var downOut = false;
  dlg.addEventListener('pointerdown', function (e) { downOut = e.target === dlg && outside(e); });
  dlg.addEventListener('click', function (e) { if (downOut && e.target === dlg && outside(e)) closeQuote(); downOut = false; });
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); closeQuote(); });   // Esc

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

  // On the live site each step is emailed through FormSubmit; MAIL is FormSubmit's alias for the inbox, so no address sits in the page.
  var MAIL = 'ea48693d03f47fa49242d01578c7fee8';
  // Not awaited: FormSubmit can take half a minute to answer. A form-encoded body skips the CORS preflight, and keepalive
  // lets the send finish if the visitor closes the tab.
  function mail(subject, data) {
    if (!MAIL) return;
    fetch('https://formsubmit.co/ajax/' + MAIL, { method: 'POST', headers: { Accept: 'application/json' }, keepalive: true,
      body: new URLSearchParams(Object.assign({ _subject: subject, _template: 'table' }, data)) }).catch(function () {});
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
    var btn = f1.querySelector('[type=submit]'); btn.disabled = true; btn.classList.add('sending');
    var lead = { email: email, phone: phone ? d.get('cc') + ' ' + phone : '', company: String(d.get('company') || '').trim() };
    mail('RTOS quote request from ' + email, Object.assign({ _replyto: email }, lead));
    await save(Object.assign({ details: false, createdAt: new Date().toISOString() }, lead));
    btn.disabled = false; btn.classList.remove('sending');
    go('received');
  });

  var rows = document.getElementById('machines');
  function addRow() {
    var r = document.createElement('div'); r.className = 'mrow';
    r.innerHTML = '<input placeholder="Type, e.g. CNC mill" aria-label="Machine type">' +
      '<input placeholder="Model, e.g. Haas VF-2" aria-label="Brand and model">' +
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
    if (file && file.size > 20 * 1024 * 1024) { note.textContent = 'This video is too large to upload here. Please share a Google Drive link instead.'; return; }
    var btn = f2.querySelector('[type=submit]'); btn.disabled = true; btn.classList.add('sending'); note.textContent = '';
    var s = await store;
    if (file && s && s.assets) {   // without a backend the file never leaves the browser
      try { details.videoAsset = (await s.assets.upload(file)).id; }
      catch (err) { note.textContent = "The video didn't upload. Please share a Google Drive link instead."; btn.disabled = false; btn.classList.remove('sending'); return; }
    }
    mail('RTOS quote details from ' + f1.email.value.trim(), { _replyto: f1.email.value.trim(), email: f1.email.value.trim(),
      location: details.location, task: details.task, goal: details.goal, machines: machines.map(function (m) { return [m.type, m.model].filter(Boolean).join(', '); }).join('; '),
      videoLink: details.videoLink, videoFile: file ? file.name + ' (' + (file.size / 1048576).toFixed(1) + ' MB, chosen on the site, not uploaded)' : '', notes: details.notes });
    await save(details, true);
    btn.disabled = false; btn.classList.remove('sending');
    go('done');
  });
})();
