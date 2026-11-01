/* Options A, B, C section: the design funnel, the priority toggle with option cards, and the station cycles.
   Merged from docs/evidence/web/options_abc/options_abc.html in the robot repo. Numbers are industrial engineering
   estimates from the robot_consult_demo s5x run (config/demo_regress.yaml); priority shares from priority_shares.py. */
(() => {
  // ---- data (s5x headline, config/demo_regress.yaml) ----
  const OPT = {
    A: { title: "Better layout, no robot arms", desc: "A mobile robot brings parts to every station.", adds: "START HERE",
         capex: 54000, npv: 41221, overrun: 41.1, strain: 80.0, payback: 2.3, doors: 13.6, share: 24 },
    B: { title: "One robot at the slowest station", desc: "A, plus a collaborative robot arm on a track.", adds: "BUILDS ON A",
         capex: 190625, npv: 238291, overrun: 28.0, strain: 36.8, payback: 1.8, doors: 14.1, share: 38 },
    C: { title: "One robot at every station", desc: "B, plus the same arm at the other two stations.", adds: "BUILDS ON B",
         capex: 436876, npv: 97006, overrun: 5.3, strain: 13.1, payback: 3.3, doors: 14.9, share: 26 },
  };
  // station cycle p95 in s from the MuJoCo runs on 30 shared draws (carda/options_abc/summary.json): Today is the worker
  // alone, A at walk x0.5, C with the worker leaving the door after their part
  const SIM = { Today: [294.7, 328.7, 254.4], A: [262.8, 296.3, 247.0], B: [262.8, 197.2, 247.0], C: [223.7, 197.2, 220.5] };
  const STATIONS = [["Station 1", "glass"], ["Station 2", "mirror"], ["Station 3", "speaker"]];
  const CAP = 228, TAKT = 240, AXIS = 340;
  const KPI = [   // [key, label, format, lower is better]
    ["capex", "Install cost", v => "$" + Math.round(v / 1000) + "k", true],
    ["npv", "5-year return", v => "$" + Math.round(v / 1000) + "k", false],
    ["overrun", "Cycles over target", v => Math.round(v) + "%", true],
    ["strain", "Awkward posture", v => Math.round(v) + " s per door", true],
  ];
  // share of the 20,000 weightings where each option holds the best practical design, split by top-weighted criterion
  // (priority_shares.py). X = the two-robot setup, which is not one of the three options.
  const PRI = [
    { id: "all",    label: "Weigh all equally",     lead: "With no single priority",        s: { A: 24, B: 38, C: 26, X: 12 } },
    { id: "spend",  label: "Spend less up front",   lead: "When install cost comes first",  s: { A: 56, B: 40, C: 0, X: 4 } },
    { id: "return", label: "Best 5-year return",    lead: "When return comes first",        s: { A: 4, B: 75, C: 12, X: 10 } },
    { id: "takt",   label: "Hit the target every cycle",  lead: "When hitting the target comes first",  s: { A: 1, B: 10, C: 71, X: 17 } },
    { id: "strain", label: "Less worker strain",    lead: "When worker strain comes first", s: { A: 0, B: 26, C: 47, X: 27 } },
  ];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = id => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const C_INK = css.getPropertyValue("--ink").trim(), C_LINE = css.getPropertyValue("--line").trim(),
        C_ACC = css.getPropertyValue("--accent").trim(), C_DIM = css.getPropertyValue("--dim").trim();
  const onView = (el, fn, t = 0.35) => {
    if (!("IntersectionObserver" in window)) return fn();
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold: t });
    io.observe(el);
  };

  // ---- 1. funnel: one square per design, survivors nested stage to stage ----
  const STAGES = [1219, 40, 31, 10, 3], N = STAGES[0];
  let seed = 11; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const order = [...Array(N).keys()];
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rank = new Array(N); order.forEach((d, i) => rank[d] = i);   // design d survives stage k if rank < STAGES[k]
  const cv = $("abc-dots"), ctx = cv.getContext("2d");
  const alpha = new Float32Array(N).fill(1);
  let stage = 0, cols = 61, cell = 10, raf = 0;
  const layout = () => {
    const w = cv.clientWidth || cv.parentElement.clientWidth;
    cols = w < 560 ? 35 : 61;
    cell = w / cols;
    const rows = Math.ceil(N / cols), dpr = Math.min(devicePixelRatio || 1, 2);
    cv.style.height = rows * cell + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(rows * cell * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const draw = () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    const s = Math.max(2, cell * 0.72), off = (cell - s) / 2, last = stage === STAGES.length - 1;
    for (let d = 0; d < N; d++) {
      const x = (d % cols) * cell + off, y = Math.floor(d / cols) * cell + off;
      ctx.fillStyle = C_LINE; ctx.fillRect(x, y, s, s);
      if (alpha[d] > 0.01) {
        ctx.globalAlpha = alpha[d];
        ctx.fillStyle = last && rank[d] < 3 ? C_ACC : stage > 0 && rank[d] < STAGES[stage] ? C_INK : C_DIM;
        ctx.fillRect(x, y, s, s);
        ctx.globalAlpha = 1;
      }
    }
    if (last) {   // name the three survivors
      ctx.font = `500 ${Math.max(11, cell * 1.1)}px ${css.getPropertyValue("--mono")}`;
      ctx.textBaseline = "middle";
      for (let d = 0; d < N; d++) if (rank[d] < 3) {
        const cx = (d % cols) * cell, cy = Math.floor(d / cols) * cell;
        ctx.strokeStyle = C_ACC; ctx.lineWidth = 1.5;
        ctx.strokeRect(cx - cell, cy - cell, cell * 3, cell * 3);
        const right = (d % cols) < cols - 4, label = "ABC"[rank[d]];
        ctx.fillStyle = C_ACC; ctx.textAlign = right ? "left" : "right";
        ctx.fillText(label, right ? cx + cell * 2.6 : cx - cell * 1.6, cy + cell / 2);
      }
    }
  };
  const tick = () => {
    let moving = false;
    for (let d = 0; d < N; d++) {
      const target = rank[d] < STAGES[stage] ? 1 : 0;
      const a = alpha[d] + (target - alpha[d]) * 0.12;
      alpha[d] = Math.abs(target - a) < 0.01 ? target : a;
      moving ||= alpha[d] !== target;
    }
    draw();
    raf = moving ? requestAnimationFrame(tick) : 0;
  };
  const LAST = STAGES.length - 1, BEAT = 1300, HOLD = 1600;
  const steps = [...$("abc-steps").children], ask = $("abc-ask"), replay = $("abc-replay");
  $("abc-steps").classList.add("play");
  ask.classList.add("abc-wait");
  const setStage = k => {
    stage = k;
    steps.forEach((li, i) => li.className = i < k ? "past" : i === k ? "now" : "");
    if (reduce) { for (let d = 0; d < N; d++) alpha[d] = rank[d] < STAGES[k] ? 1 : 0; draw(); }
    else if (!raf) raf = requestAnimationFrame(tick);
  };
  let auto = 0, revealed = false;
  const reveal = () => {   // the options come in once the funnel has landed on 3
    if (revealed) return;
    revealed = true;
    ask.classList.remove("abc-wait");
    setTimeout(() => onView($("abc-cards"), fillBars, 0.25), reduce ? 0 : 400);
  };
  const play = () => {
    clearInterval(auto); replay.hidden = true; setStage(0);
    auto = setInterval(() => {
      if (stage < LAST) setStage(stage + 1);
      if (stage === LAST) { clearInterval(auto); replay.hidden = false; setTimeout(reveal, HOLD); }
    }, BEAT);
  };
  const finish = () => { clearInterval(auto); setStage(LAST); replay.hidden = false; reveal(); };
  replay.addEventListener("click", play);
  layout(); setStage(0);
  addEventListener("resize", () => { layout(); draw(); });
  onView(cv, () => reduce ? finish() : play(), 0.5);
  if ("IntersectionObserver" in window)   // scrolled past before it finished: jump to the end
    new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting && e.boundingClientRect.top < 0 && !revealed) finish(); })).observe(cv);

  // ---- 2. cards + priority ----
  const max = Object.fromEntries(KPI.map(([k]) => [k, Math.max(...Object.values(OPT).map(o => o[k]))]));
  const best = Object.fromEntries(KPI.map(([k, , , low]) => {
    const vals = Object.entries(OPT).map(([id, o]) => [id, o[k]]);
    return [k, vals.reduce((a, b) => (low ? b[1] < a[1] : b[1] > a[1]) ? b : a)[0]];
  }));
  $("abc-cards").innerHTML = Object.entries(OPT).map(([id, o]) => `
    <button type="button" class="abc-card" data-o="${id}" aria-pressed="false">
      <div class="abc-top"><span class="abc-letter">${id}</span><span class="mono">${o.adds}</span></div>
      <h4>${o.title}</h4>
      <p>${o.desc}</p>
      <dl class="abc-kpis">${KPI.map(([k, label, f]) => `
        <div class="abc-kpi"><dt>${label}</dt><dd>${f(o[k])}${best[k] === id ? "<em>BEST</em>" : ""}</dd>
          <div class="abc-bar"><i class="${best[k] === id ? "best" : ""}" data-w="${(o[k] / max[k] * 100).toFixed(1)}"></i></div></div>`).join("")}
      </dl>
      <div class="mono abc-foot">Payback ${o.payback} yr · ${o.doors} doors per hour<br>Top pick for ${o.share}% of priorities</div>
    </button>`).join("");
  const cards = [...document.querySelectorAll(".abc-card")];
  function fillBars() {   // called by reveal()
    document.querySelectorAll(".abc-bar i").forEach((b, i) => {
      b.style.transitionDelay = reduce ? "0s" : (i % 4) * 0.08 + Math.floor(i / 4) * 0.12 + "s";
      b.style.width = b.dataset.w + "%";
    });
  }

  $("abc-seg").innerHTML = PRI.map(p => `<button type="button" data-p="${p.id}" aria-pressed="false">${p.label}</button>`).join("");
  const segs = [...$("abc-seg").querySelectorAll("button")];
  const NAME = { A: "A", B: "B", C: "C", X: "other setups" };
  const setPriority = id => {
    const p = PRI.find(q => q.id === id);
    const win = ["A", "B", "C"].reduce((a, b) => p.s[b] > p.s[a] ? b : a);
    segs.forEach(b => b.setAttribute("aria-pressed", b.dataset.p === id));
    const rest = Object.entries(p.s).filter(([k, v]) => k !== win && v > 0).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${NAME[k]} ${v}%`).join(", ");
    $("abc-why").innerHTML = `${p.lead}, <b>option ${win}</b> comes out on top ${p.s[win]}% of the time. ${rest ? "Then " + rest + "." : ""}`;
    $("abc-share").innerHTML = ["A", "B", "C", "X"].map(k => `<i class="${k === win ? "win" : k === "X" ? "x" : ""}" style="flex-basis:${p.s[k]}%">${p.s[k] >= 7 ? (k === "X" ? "" : k + " ") + p.s[k] + "%" : ""}</i>`).join("");
    pick(win);
  };
  segs.forEach(b => b.addEventListener("click", () => setPriority(b.dataset.p)));

  // ---- 3. station cycles ----
  const VIEWS = SIM;
  $("abc-tabs").innerHTML = Object.keys(VIEWS).map(k => `<button type="button" data-v="${k}" aria-pressed="false">${k}</button>`).join("");
  const tabs = [...$("abc-tabs").querySelectorAll("button")];
  $("abc-st").insertAdjacentHTML("beforeend", STATIONS.map(([s, what]) => `
    <div class="abc-row"><span><b>${s}</b>${what}</span><div class="abc-track"><i></i><em></em></div></div>`).join(""));
  $("abc-lines").innerHTML = `<i style="left:${CAP / AXIS * 100}%" data-l="228 s target"></i><i class="takt" style="left:${TAKT / AXIS * 100}%" data-l="240 s line pace"></i>`;
  const tracks = [...document.querySelectorAll(".abc-track")];
  const NOTE = {
    Today: "Worker alone, no robot. Every station runs slower than the line.",
    A: "Parts come to the worker, but every station stays over the target.",
    B: "The robot brings station 2 under the target. Stations 1 and 3 stay over.",
    C: "Every station hits the target if the worker steps away after their part.",
  };
  let shown = false, view = "B";
  const showView = v => {
    view = v;
    tabs.forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
    $("abc-stnote").textContent = NOTE[v];
    if (!shown) return;
    VIEWS[v].forEach((sec, i) => {
      const bar = tracks[i].querySelector("i"), lab = tracks[i].querySelector("em");
      bar.style.width = sec / AXIS * 100 + "%";
      bar.classList.toggle("over", sec > CAP);
      lab.textContent = sec.toFixed(1) + " s";
    });
  };
  tabs.forEach(b => b.addEventListener("click", () => showView(b.dataset.v)));
  onView($("abc-st"), () => { shown = true; showView(view); }, 0.4);

  function pick(id) {
    cards.forEach(c => { c.classList.toggle("on", c.dataset.o === id); c.setAttribute("aria-pressed", c.dataset.o === id); });
    $("abc-cards").classList.add("picked");
    showView(id);
  }
  cards.forEach(c => c.addEventListener("click", () => pick(c.dataset.o)));
  setPriority("all");
})();
