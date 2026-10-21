// Momentum Ledger live overlay client: renders verified overlays over a 2D match view.
const $ = (id) => document.getElementById(id);
const state = { meta: null, es: null, mv: [], counts: { ok: 0, bad: 0 }, minute: 0, queue: [], showing: false, speed: 30 };
const view = { persona: "casual", club: "" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function init() {
  const cfg = await (await fetch("/api/config")).json();
  state.meta = cfg.meta;
  const { home, away } = cfg.meta;
  $("homeCode").textContent = home.code; $("awayCode").textContent = away.code;
  $("homeSwatch").style.background = home.color; $("awaySwatch").style.background = away.color;
  $("clubHome").textContent = home.short; $("clubAway").textContent = away.short;
  $("momHome").textContent = home.short; $("momAway").textContent = away.short;
  document.documentElement.style.setProperty("--home", home.color);
  document.documentElement.style.setProperty("--away", away.color);

  $("services").innerHTML = Object.entries(cfg.services)
    .map(([k, v]) => `<span class="chip">${esc(k.replace("_", " "))}: <b>${esc(v)}</b></span>`).join("");
  $("lang").innerHTML = Object.entries(cfg.languages).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");

  const opts = [home, away].map((t) => `<optgroup label="${esc(t.name)}">` +
    [...t.players, ...t.bench].map((p) => `<option value="${p.id}">${p.number} · ${esc(p.name)}</option>`).join("") +
    "</optgroup>").join("");
  $("player").insertAdjacentHTML("beforeend", opts);

  document.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    view[seg.dataset.name] = b.dataset.v;
  }));
  $("go").onclick = start;
  $("catch").onclick = catchUp;
  $("multi").onclick = multiview;
  $("modalClose").onclick = () => $("modal").classList.add("hidden");
}

function params(extra = {}) {
  const p = { persona: view.persona, club: view.club, player: $("player").value, lang: $("lang").value,
    speed: $("speed").value, start: $("start").value || 0, ...extra };
  return new URLSearchParams(Object.entries(p).filter(([, v]) => v !== "" && v != null)).toString();
}

function resetUI() {
  state.counts = { ok: 0, bad: 0 }; state.queue = []; state.showing = false;
  ["trustList", "feedList", "trails"].forEach((id) => ($(id).innerHTML = ""));
  ["lowerThird", "flash", "panel"].forEach((id) => $(id).classList.add("hidden"));
  updateCounts();
}

function start() {
  if (state.es) state.es.close();
  resetUI();
  state.speed = Number($("speed").value);
  const es = new EventSource(`/api/stream?${params()}`);
  state.es = es;
  $("livePill").textContent = "LIVE"; $("livePill").classList.add("on");
  es.addEventListener("tick", (e) => onTick(JSON.parse(e.data)));
  es.addEventListener("joined", (e) => onTick(JSON.parse(e.data).state));
  es.addEventListener("overlay", (e) => onOverlay(JSON.parse(e.data)));
  es.addEventListener("trust", (e) => onTrust(JSON.parse(e.data)));
  es.addEventListener("end", () => { es.close(); $("livePill").textContent = "FULL TIME"; $("livePill").classList.remove("on"); });
  es.onerror = () => { es.close(); $("livePill").classList.remove("on"); };
}

// --- live state ---------------------------------------------------------------------------
function onTick(s) {
  if (s.clock) $("clock").textContent = s.clock;
  state.minute = Math.floor((s.t || 0) / 60) + 1;
  $("scoreHome").textContent = s.score.home; $("scoreAway").textContent = s.score.away;
  const m = s.momentum || 0;
  const bar = $("momBar");
  bar.style.left = m >= 0 ? `${50 - m * 50}%` : "50%";
  bar.style.width = `${Math.abs(m) * 50}%`;
  bar.style.background = m >= 0 ? "var(--home)" : "var(--away)";
  $("possBar").style.width = `${s.possession_10m}%`;
  $("possHome").textContent = `${Math.round(s.possession_10m)}%`;
  $("possAway").textContent = `${Math.round(100 - s.possession_10m)}%`;
  $("chaosBar").style.width = `${s.chaos}%`; $("chaosVal").textContent = Math.round(s.chaos);
  $("statLine").innerHTML = `${s.shots.home} · ${s.xg.home.toFixed(2)} &nbsp;|&nbsp; ${s.shots.away} · ${s.xg.away.toFixed(2)}`;
  const ev = s.event;
  if (ev && ev.x != null) drawEvent(ev);
}

function drawEvent(ev) {
  const ball = $("ball");
  const x = ev.end_x ?? ev.x, y = ev.end_y ?? ev.y;
  ball.setAttribute("cx", x); ball.setAttribute("cy", y);
  if ((ev.type === "pass" || ev.type === "carry" || ev.type === "shot") && ev.x != null) {
    const g = $("trails");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const ex = ev.type === "shot" ? (ev.team === "home" ? 105 : 0) : x;
    const ey = ev.type === "shot" ? 34 : y;
    line.setAttribute("x1", ev.x); line.setAttribute("y1", ev.y); line.setAttribute("x2", ex); line.setAttribute("y2", ey);
    line.setAttribute("class", `trail ${ev.team} ${ev.outcome === "fail" ? "fail" : ""}`);
    g.appendChild(line);
    while (g.childNodes.length > 8) g.removeChild(g.firstChild);
    [...g.childNodes].forEach((n, i, arr) => n.setAttribute("opacity", (0.15 + 0.85 * (i + 1) / arr.length).toFixed(2)));
  }
}

// --- overlays ----------------------------------------------------------------------------
function onOverlay(o) {
  addFeed(o);
  $("jsonOut").textContent = JSON.stringify(o, null, 2);
  state.queue.push(o);
  state.queue.sort((a, b) => b.priority - a.priority || a.trigger.t - b.trigger.t);
  if (!state.showing) showNext();
}

function showNext() {
  const o = state.queue.shift();
  if (!o) { state.showing = false; return; }
  state.showing = true;
  const proof = `✓ verified · ${o.verification.checks.length} checks · ${o.source}`;
  const against = /^(Danger for|Alerta para|Tahadhari kwa)/.test(o.text);
  const ms = Math.max(2500, Math.min(7000, (o.duration_s * 1000 * 6) / Math.sqrt(state.speed)));
  let el;
  if (o.graphic === "goal_flash" || o.graphic === "scoreboard_summary") {
    el = $("flash");
    const big = o.kind === "goal" ? (o.lang === "es" ? "¡GOL!" : o.lang === "sw" ? "GOLI!" : "GOAL!") : o.kind === "half_time" ? "HT" : "FT";
    el.innerHTML = `<div><div class="big">${big}</div><div class="sub">${esc(o.text)}</div><div class="lt-proof">${esc(proof)}</div></div>`;
  } else if (o.graphic === "tactical_panel" || o.graphic === "momentum_banner") {
    el = $("panel");
    el.innerHTML = `<div class="tag">${o.graphic === "tactical_panel" ? "TACTICAL SHIFT" : "MOMENTUM"} · ${o.trigger.minute}'</div>
      <div class="txt">${esc(o.text)}</div><div class="proof">${esc(proof)}</div>`;
  } else {
    el = $("lowerThird");
    $("ltTag").textContent = o.graphic === "player_card" ? "PLAYER LENS" : o.graphic === "player_tag" ? "SPEED" : `${o.trigger.minute}'`;
    $("ltText").textContent = o.text; $("ltProof").textContent = proof;
    el.classList.toggle("against", against);
  }
  el.classList.remove("hidden");
  setTimeout(() => { el.classList.add("hidden"); showNext(); }, state.queue.length > 3 ? ms / 2 : ms);
}

function addFeed(o) {
  const li = document.createElement("li");
  li.innerHTML = `<span class="min">${o.trigger.minute}'</span><div><div class="kind">${esc(o.kind.replace(/_/g, " "))} · ${esc(o.lang)}</div>${esc(o.text)}</div>`;
  $("feedList").prepend(li);
}

// --- trust panel -------------------------------------------------------------------------
function onTrust(r) {
  if (r.status === "verified") state.counts.ok++;
  if (r.status === "blocked") state.counts.bad++;
  updateCounts();
  if (r.status === "verified" && !r.injected && r.attempt === 1 && $("trustList").children.length > 40) return;
  const li = document.createElement("li");
  li.className = r.status;
  const why = (r.checks || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ");
  li.innerHTML = `<div class="tr-top"><span>${r.minute}' · ${esc(r.kind.replace(/_/g, " "))} · ${esc(r.agent)} #${r.attempt}</span>
      <span class="tr-status">${esc(r.status)}</span></div>
    ${r.text ? `<div class="tr-text">${esc(r.text)}</div>` : ""}
    ${why ? `<div class="tr-why">✗ ${esc(why)}</div>` : ""}
    ${r.note ? `<div class="hint">${esc(r.note)}</div>` : ""}
    ${r.injected ? `<span class="tr-inj">demo fault injected: ${esc(r.injected.replace(/_/g, " "))}</span>` : ""}`;
  $("trustList").prepend(li);
}

function updateCounts() {
  $("cOk").textContent = `${state.counts.ok} verified`;
  $("cBad").textContent = `${state.counts.bad} blocked`;
}

// --- catch me up -------------------------------------------------------------------------
async function catchUp() {
  const minute = state.es && state.es.readyState !== 2 ? state.minute : Number($("start").value) || 60;
  $("modalTitle").textContent = "Catching you up…"; $("modalList").innerHTML = ""; $("modalHint").textContent = "";
  $("modal").classList.remove("hidden");
  const r = await (await fetch(`/api/catchup?${params({ minute: Math.max(1, minute), speed: undefined, start: undefined })}`)).json();
  $("modalTitle").textContent = r.header || `Catch-up at ${r.minute}'`;
  $("modalList").innerHTML = r.items.map((i) => `<li><b>${i.minute}'</b> ${esc(i.text)}</li>`).join("") ||
    "<li>Nothing decisive yet.</li>";
  const blocked = r.trust.filter((t) => t.status === "blocked").length;
  $("modalHint").textContent = `${r.items.length} verified moments, ranked by impact${blocked ? ` · ${blocked} draft(s) blocked before you saw them` : ""}.`;
}

// --- multiview ---------------------------------------------------------------------------
function multiview() {
  const mv = $("multiview");
  state.mv.forEach((es) => es.close()); state.mv = [];
  mv.classList.remove("hidden");
  const { home, away } = state.meta;
  const star = away.players.find((p) => p.role === "FWD" && p.number === 9) || away.players[9];
  const langs = [...$("lang").options].map((o) => o.value);
  const viewers = [
    { label: "Casual fan · English", q: { persona: "casual", lang: "en" } },
    { label: "Analyst · English", q: { persona: "analyst", lang: "en" } },
    { label: `${home.short} fan · Player Lens: ${star.name} · ${langs.includes("sw") ? "Kiswahili" : "Español"}`,
      q: { persona: "casual", club: "home", player: star.id, lang: langs.includes("sw") ? "sw" : "es" } },
  ];
  $("mvGrid").innerHTML = viewers.map((v, i) => `<div class="mv-col"><h3>${esc(v.label)}</h3><ul id="mv${i}"></ul></div>`).join("");
  const base = { speed: $("speed").value, start: $("start").value || 0 };
  viewers.forEach((v, i) => {
    const es = new EventSource(`/api/stream?${new URLSearchParams({ ...base, ...v.q })}`);
    es.addEventListener("overlay", (e) => {
      const o = JSON.parse(e.data);
      $(`mv${i}`).insertAdjacentHTML("afterbegin", `<li><b>${o.trigger.minute}'</b>${esc(o.text)}</li>`);
    });
    es.addEventListener("end", () => es.close());
    state.mv.push(es);
  });
  mv.scrollIntoView({ behavior: "smooth" });
}

init();
