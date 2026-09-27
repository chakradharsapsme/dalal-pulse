/* Dalal Pulse — static single-page app.
   Live mode (GitHub Pages / local preview): reads data/latest.json and checks for new data every minute.
   Snapshot mode (shared preview link): data is embedded in the page as window.__DP_DATA__. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 2) => n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const px = n => n == null ? "–" : "₹" + fmt(n, n >= 1000 ? 0 : 2);
const inr = n => n == null || isNaN(n) ? "–" : (n < 0 ? "−₹" : "₹") + fmt(Math.abs(n), 0);
const pct = c => c == null || isNaN(c) ? "–" : (c > 0 ? "+" : c < 0 ? "−" : "") + Math.abs(c).toFixed(2) + "%";
const cls = c => c == null ? "" : c > 0 ? "up" : c < 0 ? "down" : "";
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
function toast(m) { document.querySelectorAll(".toast").forEach(t => t.remove()); const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 4500); }

const SNAPSHOT = Boolean(window.__DP_DATA__);
let D = null, S = {}, NEWS = {}, prevPrice = {};
let view = "news", sel = null;
let my = store.get("dp-my", { holdings: [], watch: [], alerts: [] });
const saveMy = () => store.set("dp-my", my);
const isMine = s => my.watch.includes(s) || my.holdings.some(h => h.symbol === s);
const ui = { nf: "withnews", q: "", preset: "all", sort: { k: "change_pct", d: -1 }, w52: "highs", w52s: "all", cal: "tracked", range: 252, sq: "",
  ov: { ma: true, bb: false, sr: true, sig: true }, sub: "vol", hp: "change_pct", hm: "ind", bh: 20, bdir: "all", irange: "1d", crange: "252", icmp: [], fq: "", ff: "all", fsort: { k: "score", d: -1 }, bm: "fo", bsize: "turnover", sgrp: "Popular", suni: "n200", sview: "cards", slimit: 60, smore: false, cside: "upper", cband: "all", csort: "turnover", ccap: "all", climit: 60, odir: "all", osym: "NIFTY", olimit: 9 };
const charts = window.__DP_CHARTS__ || {};

// ---------- data ----------
async function load(first) {
  let d;
  try {
    if (SNAPSHOT) d = window.__DP_DATA__;
    else { const r = await fetch("data/latest.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error(r.status); d = await r.json(); }
  } catch {
    if (first) $("#view").innerHTML = `<div class="card"><div class="empty"><b>The first data update is still running</b>This page will fill in by itself in a minute or two.</div></div>`;
    return;
  }
  const changed = !D || d.generated_at !== D.generated_at;
  if (D) prevPrice = Object.fromEntries(D.stocks.map(s => [s.symbol, s.price]));
  D = d; S = Object.fromEntries(D.stocks.map(s => [s.symbol, s])); NEWS = Object.fromEntries(D.news.map(n => [n.id, n]));
  if (!changed) { footer(); return; }
  renderTape(); renderTape2(); renderBand(); renderTicker(); render(); footer(); checkAlerts(first); newsFlash(first);
  if (!first) { flashChanges(); toast("New prices and headlines just arrived"); }
}
function footer() {
  $("#footUpd").textContent = `Data built ${new Date(D.generated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} (${ago(D.generated_at)}).` + (SNAPSHOT ? " This is a snapshot." : " The page checks for new data every minute.");
  if (SNAPSHOT) { const b = $("#snap"); b.hidden = false; b.textContent = `Snapshot preview · data from ${new Date(D.generated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. The published site refreshes every 15 minutes.`; }
}
function flashChanges() {
  document.querySelectorAll("[data-sel]").forEach(r => {
    const s = r.dataset.sel, a = prevPrice[s], b = S[s]?.price;
    if (a != null && b != null && a !== b) { r.classList.remove("flash-up", "flash-down"); void r.offsetWidth; r.classList.add(b > a ? "flash-up" : "flash-down"); }
  });
}

// ---------- market clock (IST) ----------
function istNow() { const n = new Date(); return new Date(n.getTime() + (n.getTimezoneOffset() + 330) * 60000); }
function tickClock() {
  const t = istNow(), mins = t.getHours() * 60 + t.getMinutes(), day = t.getDay();
  $("#clockT").textContent = t.toLocaleTimeString("en-GB") + " IST";
  const st = $("#mstat"); let label, c = "";
  const dur = x => { const hh = Math.floor(x / 60), mm = x % 60; return (hh ? hh + "h " : "") + mm + "m"; };
  const weekday = day >= 1 && day <= 5;
  if (weekday && mins >= 555 && mins < 930) { c = "open"; label = `Market open · closes in ${dur(930 - mins)}`; }
  else if (weekday && mins >= 540 && mins < 555) { c = "pre"; label = `Pre-open · opens in ${dur(555 - mins)}`; }
  else {
    let add = 0, d = day;
    if (!(weekday && mins < 540)) { add = 1; d = (day + 1) % 7; while (d === 0 || d === 6) { add++; d = (d + 1) % 7; } }
    label = `Market closed · opens ${add === 0 ? "today" : add === 1 ? "tomorrow" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]} 09:15`;
  }
  st.className = "status " + c; st.innerHTML = `<i></i><span>${label}</span>`; st.title = "Exchange holidays aren't shown";
}

// ---------- ticker tape & band ----------
function renderTape() {
  const list = D.stocks.filter(s => s.nifty50 && s.price != null).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const item = s => `<button class="it" data-go="${esc(s.symbol)}"><b>${esc(s.symbol)}</b><span class="p">${fmt(s.price, s.price >= 1000 ? 0 : 2)}</span><span class="${s.change_pct >= 0 ? "u" : "d"}">${s.change_pct >= 0 ? "▲" : "▼"} ${Math.abs(s.change_pct ?? 0).toFixed(2)}%</span></button>`;
  const h = list.map(item).join("");
  $("#track").innerHTML = h + h.replace(/<button class="it"/g, '<button class="it" tabindex="-1" aria-hidden="true"');
}
// second tape: only quality large/mid-cap stocks (Nifty 200) within 3% of their 52-week high or low; Nifty 50 first
function renderTape2() {
  const el = $("#track2"); if (!el) return;
  const hi = D.stocks.filter(s => s.nifty200 !== false && s.tech && s.price != null && s.tech.from_high_pct != null && s.tech.from_high_pct >= -3).sort((a, b) => (b.nifty50 - a.nifty50) || b.tech.from_high_pct - a.tech.from_high_pct);
  const lo = D.stocks.filter(s => s.nifty200 !== false && s.tech && s.price != null && s.tech.from_low_pct != null && s.tech.from_low_pct <= 3).sort((a, b) => (b.nifty50 - a.nifty50) || a.tech.from_low_pct - b.tech.from_low_pct);
  const mk = (s, up) => { const at = up ? s.tech.from_high_pct >= -0.3 : s.tech.from_low_pct <= 0.3;
    return `<button class="it ${up ? "hz" : "lz"}" data-go="${esc(s.symbol)}" title="${esc(s.name)} · 52-week ${up ? "high" : "low"} ${px(up ? s.tech.high52 : s.tech.low52)}"><span class="${up ? "u" : "d"}">${up ? "▲" : "▼"}</span><b>${esc(s.symbol)}</b>${s.nifty50 ? '<span class="n50t">N50</span>' : ""}<span class="p">${fmt(s.price, s.price >= 1000 ? 0 : 2)}</span>${at ? `<span class="tag ${up ? "u" : "d"}">${up ? "AT 52W HIGH" : "AT 52W LOW"}</span>` : `<span class="${up ? "u" : "d"}">${up ? pct(s.tech.from_high_pct) + " from high" : pct(s.tech.from_low_pct) + " above low"}</span>`}<span class="${s.change_pct >= 0 ? "u" : "d"}" style="opacity:.8">${pct(s.change_pct)}</span></button>`; };
  // NSE whole-market fresh 52-week hits not in the tracked list
  const tracked = new Set(D.stocks.map(s => s.symbol));
  const ext = (list, up) => (list || []).filter(x => !tracked.has(x.symbol)).slice(0, 12).map(x => `<a class="it ${up ? "hz" : "lz"}" href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(x.symbol)}" target="_blank" rel="noopener" title="${esc(x.name)} (not tracked here, opens NSE)"><span class="${up ? "u" : "d"}">${up ? "▲" : "▼"}</span><b>${esc(x.symbol)}</b><span class="p">${fmt(x.ltp, x.ltp >= 1000 ? 0 : 2)}</span><span class="tag ${up ? "u" : "d"}">NEW 52W ${up ? "HIGH" : "LOW"}</span><span class="${x.change_pct >= 0 ? "u" : "d"}" style="opacity:.8">${pct(x.change_pct)}</span></a>`);
  const items = [];
  const H = hi.map(s => mk(s, true)), Lo = lo.map(s => mk(s, false)); // small / low-cap NSE stocks are deliberately left out
  for (let i = 0; i < Math.max(H.length, Lo.length); i++) { if (H[i]) items.push(H[i]); if (Lo[i]) items.push(Lo[i]); }
  if (!items.length) { el.innerHTML = '<span class="it">No stocks near their 52-week high or low right now</span>'; el.style.animation = "none"; return; }
  let h = items.join("");
  while (items.length && h.length < 6000 && items.length < 12) h += items.join("");
  el.style.animationDuration = Math.max(40, items.length * 4.5) + "s";
  el.innerHTML = h + h.replace(/class="it /g, 'tabindex="-1" aria-hidden="true" class="it ');
  $("#tape2").querySelector(".tlab").innerHTML = `<span class="u">▲ ${hi.length} near 52W high</span><span class="d">▼ ${lo.length} near 52W low</span>`;
}
const arcPath = (cx, cy, r) => `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`;
const moodColor = s => s >= 57 ? "var(--up)" : s <= 43 ? "var(--down)" : "var(--accent)";
function renderBand() {
  const m = D.mood;
  let h = `<div class="tk mood" title="${esc(m.lines.join(" "))}"><svg width="54" height="32" viewBox="0 0 54 32" aria-hidden="true">
      <path d="${arcPath(27, 29, 22)}" fill="none" stroke="rgba(223,233,230,.15)" stroke-width="6" stroke-linecap="round"/>
      <path d="${arcPath(27, 29, 22)}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - m.score}" fill="none" stroke="${moodColor(m.score)}" stroke-width="6" stroke-linecap="round"/></svg>
    <div><div class="l">Market mood</div><div class="v"><span data-count="${m.score}">${m.score}</span> · ${esc(m.label)}</div></div></div>`;
  for (const p of D.pulse) {
    const c = p.key === "INDIA VIX" ? -p.change_pct : p.change_pct;
    const iid = PULSE_IDX[p.key] && (D.indices || []).some(x => x.id === PULSE_IDX[p.key]) ? PULSE_IDX[p.key] : "";
    h += `<div class="tk${iid ? " link" : ""}"${iid ? ` data-idx="${iid}" role="button" tabindex="0" title="Open the ${esc(p.label)} chart"` : ""}><div class="l">${esc(p.label)}</div><div class="v">${fmt(p.last, p.last > 1000 ? 0 : 2)}</div><div class="c ${cls(c)}">${pct(p.change_pct)}</div></div>`;
  }
  for (const f of D.fii_dii || []) h += `<div class="tk" title="Net buying in the cash market, ₹ crore, ${esc(f.date)}"><div class="l">${esc(f.category.replace("/FPI", ""))} net · ₹ cr</div><div class="v ${cls(f.net)}">${f.net >= 0 ? "+" : "−"}${fmt(Math.abs(f.net), 0)}</div><div class="c muted">${esc(f.date)}</div></div>`;
  $("#band").innerHTML = `<div class="tks">${h}</div><div class="mm" id="mm" aria-live="polite"></div>`;
  countUp($("#band")); renderMM();
}
function countUp(root) {
  root.querySelectorAll("[data-count]").forEach(el => {
    const to = +el.dataset.count; if (reduced || !isFinite(to)) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 900;
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

// ---------- navigation ----------
function nav(v, s) {
  view = v; sel = s ?? null;
  if (!SNAPSHOT) { const h = "#" + v + (sel ? "/" + encodeURIComponent(sel) : ""); if (location.hash !== h) history.replaceState(null, "", h); }
  render(); window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
}
function readHash() {
  const [v, s] = location.hash.replace(/^#\/?/, "").split("/");
  if (["news", "markets", "indices", "fno", "options", "circuits", "screener", "w52", "portfolio", "calendar"].includes(v)) { view = v; sel = s ? (v === "indices" ? decodeURIComponent(s).toLowerCase() : decodeURIComponent(s).toUpperCase()) : null; }
}
const go = sym => nav("news", sym);

function render() {
  if (!D) return;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.nav === view));
  const keep = document.querySelector(".list")?.scrollTop;
  $("#view").innerHTML = view === "markets" ? markets() : view === "indices" ? indicesView() : view === "fno" ? fnoView() : view === "circuits" ? circuitsView() : view === "options" ? optionsView() : view === "screener" ? screener() : view === "w52" ? w52() : view === "portfolio" ? portfolio() : view === "calendar" ? calendar() : newsView();
  if (keep && document.querySelector(".list")) document.querySelector(".list").scrollTop = keep;
  if (view === "news") { if (sel && S[sel]) drawChart(sel); document.querySelector(".row.on")?.scrollIntoView({ block: "nearest" }); }
  if (view === "options") drawChain();
  if (view === "indices") { if (sel && sel !== "compare") drawIndexChart(sel); else drawCompare(); document.querySelector(".row.on")?.scrollIntoView({ block: "nearest" }); }
  animateBars(); countUp($("#view"));
}
function animateBars() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll("[data-w]").forEach(el => { el.style.width = el.dataset.w; if (el.dataset.l) el.style.left = el.dataset.l; });
    document.querySelectorAll(".gauge .arc[data-off]").forEach(el => el.setAttribute("stroke-dashoffset", el.dataset.off));
  }));
}

// ---------- NEWS BY STOCK ----------
const stockNews = s => (S[s]?.news_ids || []).map(id => NEWS[id]).filter(Boolean);
function sparkSvg(v, up) {
  if (!v || v.length < 2) return "<span></span>";
  const lo = Math.min(...v), hi = Math.max(...v), W = 84, H = 30;
  const pts = v.map((y, i) => [i / (v.length - 1) * (W - 6) + 2, H - 4 - (hi === lo ? .5 : (y - lo) / (hi - lo)) * (H - 8)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  const col = up ? "var(--up)" : "var(--down)", last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}L${last[0].toFixed(1)} ${H}L2 ${H}Z" fill="${col}" opacity=".1"/><path class="l" d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4" fill="${col}"/></svg>`;
}
function filterCount(k) {
  return D.stocks.filter(s => { const n = s.news_ids.length; return k === "withnews" ? n : k === "n50" ? s.nifty50 : k === "mine" ? isMine(s.symbol) : k === "pos" ? n && s.insight.news_score > 15 : k === "neg" ? n && s.insight.news_score < -15 : true; }).length;
}
function newsView() {
  const q = ui.q.trim().toLowerCase(), f = ui.nf;
  const rows = D.stocks.map(s => ({ s, news: stockNews(s.symbol) })).filter(({ s, news }) =>
    (f === "withnews" ? news.length : f === "n50" ? s.nifty50 : f === "mine" ? isMine(s.symbol) : f === "pos" ? news.length && s.insight.news_score > 15 : f === "neg" ? news.length && s.insight.news_score < -15 : true) &&
    (!q || s.symbol.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q) || news.some(n => n.title.toLowerCase().includes(q))));
  rows.sort((a, b) => (b.news[0]?.published || "").localeCompare(a.news[0]?.published || "") || Math.abs(b.s.change_pct || 0) - Math.abs(a.s.change_pct || 0));
  const general = D.news.filter(n => !n.symbols.length);
  const chip = (k, l) => `<button class="chip${ui.nf === k ? " on" : ""}" data-nf="${k}">${l}<span class="n">${filterCount(k)}</span></button>`;
  let list = `<button class="row${sel === "__MARKET" ? " on" : ""}" data-sel="__MARKET"><div><div class="s">General market news</div><div class="n2">Economy, indices, IPOs and stories not tied to one stock</div></div><span></span>
    <div class="p">${general.length}<small class="muted">stories</small></div><div class="hl">${esc(general[0]?.title || "")}</div></button>`;
  list += rows.slice(0, 250).map(({ s, news }) => {
    const ins = s.insight, latest = news[0];
    return `<button class="row${sel === s.symbol ? " on" : ""}" data-sel="${esc(s.symbol)}">
      <div><div class="s">${esc(s.symbol)}${s.nifty50 ? '<span class="badge n50">N50</span>' : ""}${isMine(s.symbol) ? '<span class="badge mine">★</span>' : ""}</div><div class="n2">${esc(s.name)}</div></div>
      ${sparkSvg(s.spark, (s.spark?.[s.spark.length - 1] ?? 0) >= (s.spark?.[0] ?? 0))}
      <div class="p">${px(s.price)}<small class="${cls(s.change_pct)}">${pct(s.change_pct)}</small></div>
      <div class="m"><span class="badge ${ins.signal}">${esc(ins.label)}</span>${news.length ? `<span>${news.length} ${news.length === 1 ? "story" : "stories"}</span><span class="tdots" title="Tone of recent headlines">${news.slice(0, 6).map(n => `<i class="${n.tone}"></i>`).join("")}</span><span>${ago(latest.published)}</span>${Date.now() - Date.parse(latest.published) < 3600e3 ? '<span class="badge new">NEW</span>' : ""}` : "<span>No recent news</span>"}</div>
      ${latest ? `<div class="hl">${esc(latest.title)}</div>` : ""}</button>`;
  }).join("") || `<div class="empty"><b>No stocks here yet</b>${ui.nf === "mine" ? "Use ☆ Watch or Add to portfolio on any stock." : "Try another filter."}</div>`;
  const detail = sel ? (sel === "__MARKET" ? marketNewsDetail(general) : stockDetail(sel)) : glance();
  return `<div class="md${sel ? " detail-open" : ""}">
    <section class="card master" aria-label="Stocks">
      <div class="tools"><input class="field" id="nq" placeholder="Filter stocks or headlines" value="${esc(ui.q)}" aria-label="Filter stocks or headlines">
        <div class="chips">${chip("withnews", "In the news")}${chip("mine", "★ Mine")}${chip("n50", "Nifty 50")}${chip("pos", "Good news")}${chip("neg", "Bad news")}${chip("all", "All")}</div></div>
      <div class="list">${list}</div>
    </section>
    <section class="card detail fade" id="detail">${detail}</section>
  </div>`;
}
function gaugeSvg(score, label) {
  const col = moodColor(score);
  return `<svg viewBox="0 0 220 128" role="img" aria-label="Market mood ${score} of 100, ${esc(label)}">
    <path d="${arcPath(110, 110, 88)}" fill="none" stroke="var(--line)" stroke-width="16" stroke-linecap="round"/>
    <path class="arc" d="${arcPath(110, 110, 88)}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${reduced ? 100 - score : 100}" data-off="${100 - score}" fill="none" stroke="${col}" stroke-width="16" stroke-linecap="round"/>
    <text x="22" y="126" text-anchor="middle" font-size="10" fill="var(--muted)">0</text><text x="198" y="126" text-anchor="middle" font-size="10" fill="var(--muted)">100</text>
    <text x="110" y="92" text-anchor="middle" font-size="40" font-weight="800" fill="${col}" style="font-family:var(--display)" data-count="${score}">${score}</text>
    <text x="110" y="116" text-anchor="middle" font-size="13" font-weight="700" fill="var(--muted)">${esc(label)}</text></svg>`;
}
// ---------- MARKET-MOVING NEWS (top stocks) ----------
// Approximate Nifty 50 weights (%) of the heaviest stocks: a move in these shifts the whole index.
const HEAVY = { HDFCBANK: 13, ICICIBANK: 9, RELIANCE: 8.5, INFY: 5, BHARTIARTL: 4.5, LT: 4, ITC: 3.5, TCS: 3, AXISBANK: 3, KOTAKBANK: 2.8, SBIN: 2.8, "M&M": 2.5, BAJFINANCE: 2.2, HINDUNILVR: 2, SUNPHARMA: 1.7, HCLTECH: 1.6, MARUTI: 1.5, NTPC: 1.4, TITAN: 1.3, ULTRACEMCO: 1.2, TMPV: 1.1, TATAMOTORS: 1.1, POWERGRID: 1.1, TATASTEEL: 1, ETERNAL: 1 };
const BIGWORDS = /\b(results?|Q[1-4]|earnings|profit|revenue|guidance|order|contract|deal|acquir|merger|demerger|stake|block deal|bulk deal|buyback|dividend|bonus|split|upgrade|downgrade|target|rating|penalty|probe|raid|ban|SEBI|RBI|fraud|resign|CEO|MD|default|approval|USFDA|tariff|pledge|QIP|IPO|listing)/i;
function movers() {
  if (!D) return [];
  const out = [], per = {};
  for (const n of D.news) {
    const sym = n.symbols.find(s => S[s] && (S[s].nifty50 || HEAVY[s] || isMine(s))); if (!sym) continue;
    const s = S[sym], ageH = (Date.now() - Date.parse(n.published)) / 3600e3; if (ageH > 48) continue;
    const w = HEAVY[sym] ? 1.4 + Math.min(1, HEAVY[sym] / 8) : s.nifty50 ? 1.15 : 1.05;
    const move = Math.min(6, Math.abs(s.change_pct || 0));
    const big = n.official || BIGWORDS.test(n.title);
    const score = (0.45 + Math.abs(n.tone_score || 0) * 1.4 + (big ? 0.6 : 0)) * (1 + move / 3) * w * (isMine(sym) ? 1.2 : 1) * Math.exp(-ageH / 20);
    if ((per[sym] = (per[sym] || 0) + 1) > 2) continue; // at most 2 headlines per stock
    const why = [HEAVY[sym] ? `Nifty heavyweight (~${HEAVY[sym]}%)` : s.nifty50 ? "Nifty 50 stock" : "your stock", move >= 1.5 ? `stock ${pct(s.change_pct)} today` : "", n.tone !== "neutral" ? `${n.tone} tone` : "", big ? "big-event words" : ""].filter(Boolean);
    out.push({ n, sym, s, score, why, pts: HEAVY[sym] && s.change_pct != null ? HEAVY[sym] / 100 * s.change_pct / 100 * (D.pulse.find(p => p.key === "NIFTY 50")?.last || 0) : null });
  }
  out.sort((a, b) => b.score - a.score);
  const mx = out[0]?.score || 1; out.forEach(m => { m.impact = Math.max(8, Math.round(m.score / mx * 100)); });
  return out.slice(0, 12);
}
let mmI = 0, mmTimer = null, mmPaused = false, mmPrevTop = null;
function renderMM() {
  const box = $("#mm"); if (!box) return;
  const list = movers().slice(0, 8);
  if (!list.length) { box.innerHTML = `<div class="mmh"><span class="live"></span>Market-moving news · top stocks</div><div class="mmt muted">No big headlines on top stocks right now.</div>`; return; }
  const fresh = mmPrevTop && list[0].n.id !== mmPrevTop; mmPrevTop = list[0].n.id;
  if (mmI >= list.length || fresh) mmI = 0;
  const m = list[mmI], ageMin = (Date.now() - Date.parse(m.n.published)) / 60000;
  box.innerHTML = `<div class="mmh"><span class="live"></span>Market-moving news<span class="mmdots">${list.map((_, i) => `<i class="${i === mmI ? "on" : ""}" data-mmi="${i}"></i>`).join("")}</span></div>
    <button class="mmt${fresh ? " flash-up" : ""}" data-go="${esc(m.sym)}" title="${esc(m.why.join(" · "))}"><span class="mmr1"><span class="fsym">${esc(m.sym)}</span><b class="num ${cls(m.s.change_pct)}">${pct(m.s.change_pct)}</b>${m.pts != null && Math.abs(m.pts) >= 1 ? `<span class="muted num" title="Approximate effect on the Nifty 50">≈${m.pts > 0 ? "+" : "−"}${fmt(Math.abs(m.pts), 0)} Nifty pts</span>` : ""}<span class="muted mma">${ageMin < 60 ? '<span class="badge new">NEW</span> ' : ""}${ago(m.n.published)}</span></span>
      <span class="mmx"><span class="tdot ${m.n.tone}"></span>${esc(m.n.title)}</span></button>`;
  clearTimeout(mmTimer); mmTimer = setTimeout(() => { if (!mmPaused) mmI = (mmI + 1) % list.length; renderMM(); }, 6500);
}
function moversCard() {
  const list = movers().slice(0, 8);
  if (!list.length) return "";
  return `<div class="sect"><h3 style="display:flex;justify-content:space-between;gap:8px"><span><span class="live"></span>Market-moving news · top stocks</span><span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">updates with every refresh</span></h3>
    <div class="mml">${list.map((m, i) => `<button class="mmr" data-go="${esc(m.sym)}"><span class="mrank">${i + 1}</span>
      <div class="mmb"><div class="ft"><span class="fsym">${esc(m.sym)}</span><b class="num ${cls(m.s.change_pct)}">${pct(m.s.change_pct)}</b>${m.pts != null && Math.abs(m.pts) >= 1 ? `<span class="muted num" style="font-size:12px">≈ ${m.pts > 0 ? "+" : "−"}${fmt(Math.abs(m.pts), 0)} Nifty pts</span>` : ""}<span class="muted" style="margin-left:auto;font-size:12px">${Date.now() - Date.parse(m.n.published) < 3600e3 ? '<span class="badge new">NEW</span> ' : ""}${ago(m.n.published)}</span></div>
      <div class="fh"><span class="tdot ${m.n.tone}"></span>${esc(m.n.title)}</div>
      <div class="imp"><span class="ib"><i style="width:0" data-w="${m.impact}%"></i></span><span class="muted">${esc(m.why.join(" · "))}</span></div></div></button>`).join("")}</div>
    <div class="muted" style="font-size:12px;margin-top:6px">Ranked by rule: how big the stock is in the Nifty, today's move, headline tone, event words (results, orders, deals, ratings, regulators) and how recent it is. "Nifty pts" is a rough estimate from approximate index weights.</div></div>`;
}

// ---------- BOTTOM BREAKING-NEWS TICKER ----------
// major stock-moving headlines from the last 24 hours, any tracked stock: strong tone, big-event words, big price move, freshness
function impactNews() {
  const out = [], per = {};
  for (const n of D.news) {
    const sym = n.symbols.find(x => S[x]); if (!sym) continue;
    const s = S[sym], ageH = (Date.now() - Date.parse(n.published)) / 3600e3; if (ageH > 24) continue;
    const big = n.official || BIGWORDS.test(n.title), move = Math.min(8, Math.abs(s.change_pct || 0));
    if (!big && Math.abs(n.tone_score || 0) < 0.2 && move < 2) continue; // only headlines that matter
    const score = (0.4 + Math.abs(n.tone_score || 0) * 1.5 + (big ? 0.7 : 0)) * (1 + move / 2.5) * (s.nifty50 || HEAVY[sym] ? 1.25 : 1) * Math.exp(-ageH / 10);
    if ((per[sym] = (per[sym] || 0) + 1) > 2) continue;
    out.push({ n, sym, s, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 24);
}
let tickSig = "";
function renderTicker() {
  const bar = $("#bticker"); if (!bar || !D) return;
  const collapsed = store.get("dp-bt-min", false);
  document.body.classList.toggle("bt-on", !collapsed); bar.classList.toggle("min", collapsed);
  const list = impactNews();
  const sig = list.map(m => m.n.id).join(",") + collapsed; if (sig === tickSig) return; tickSig = sig;
  const item = m => { const fresh = Date.now() - Date.parse(m.n.published) < 45 * 60e3;
    return `<button class="bti ${m.n.tone}" data-go="${esc(m.sym)}"><span class="fsym">${esc(m.sym)}</span><b class="num ${cls(m.s.change_pct)}">${m.s.change_pct >= 0 ? "▲" : "▼"} ${pct(m.s.change_pct)}</b>${fresh ? '<span class="btnew">NEW</span>' : ""}<span class="bth">${esc(m.n.title)}</span><span class="bta">${m.n.official ? "🏛 NSE filing" : esc(m.n.source || "")}${m.n.first_by_min >= 1 ? " ⚡ first" : ""} · ${ago(m.n.published)}</span></button>`; };
  const h = list.length ? list.map(item).join('<i class="btsep">◆</i>') + '<i class="btsep">◆</i>' : '<span class="bti"><span class="bth">No major stock-moving headlines in the last 24 hours.</span></span>';
  bar.innerHTML = `<div class="btl"><span class="live"></span><b>BREAKING</b><span>stock news</span></div>
    <div class="btv"><div class="btt" style="animation-duration:${Math.max(45, list.length * 9)}s">${h}${list.length ? h.replace(/<button class="bti/g, '<button tabindex="-1" aria-hidden="true" class="bti') : ""}</div></div>
    <button class="btx" data-btmin aria-label="${collapsed ? "Show" : "Hide"} breaking news">${collapsed ? "▲ Breaking news" : "▾"}</button>`;
}

function glance() {
  const m = D.mood, top = D.stocks.filter(s => s.news_ids.length).sort((a, b) => b.news_ids.length - a.news_ids.length || Math.abs(b.change_pct) - Math.abs(a.change_pct)).slice(0, 6);
  return `${moversCard()}<div class="sect"><h3>Today on Dalal Street</h3><div class="glance"><div class="gauge">${gaugeSvg(m.score, m.label)}</div><div>${m.lines.map(l => `<p>${esc(l)}</p>`).join("")}</div></div></div>
    ${D.topics.length ? `<div class="sect"><h3>Trending in the headlines</h3><div class="topics">${D.topics.map(t => `<span>${esc(t.topic)}<em>${t.n}</em></span>`).join("")}</div></div>` : ""}
    <div class="sect"><h3>Most talked-about stocks</h3><div class="hot">${top.map(s => `<button class="hotc" data-go="${esc(s.symbol)}">
      <div class="top"><b>${esc(s.symbol)}</b><span class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</span></div>
      <div style="margin-top:4px"><span class="badge ${s.insight.signal}">${esc(s.insight.label)}</span> <span class="muted" style="font-size:12px">${s.news_ids.length} ${s.news_ids.length === 1 ? "story" : "stories"}</span></div>
      <p>${esc(NEWS[s.news_ids[0]]?.title || "")}</p></button>`).join("")}</div></div>
    <div class="sect muted" style="font-size:13.5px">Pick any stock on the left to read all its news, with a chart and an automated insight.</div>`;
}
function marketNewsDetail(list) {
  return `<div class="head"><button class="btn sm back" data-back>← All stocks</button><div><h2>General market news</h2><div class="co">${list.length} headlines from the last few days that aren't about a single tracked stock</div></div></div>
    <div class="sect">${list.slice(0, 250).map(newsItem).join("") || '<div class="empty">No headlines.</div>'}</div>`;
}
// where the story came from, and whether it was first
function srcTag(n) {
  const src = n.official ? `<span class="srcb off" title="Filed by the company with NSE: the earliest, official source">🏛 NSE filing</span>` : `<span class="srcb">${esc(n.source || "")}${n.via_google ? "" : ""}</span>`;
  const others = (n.also || []).filter(a => a.publisher !== n.source);
  const first = others.length && n.first_by_min != null && n.first_by_min >= 1 ? `<span class="firstb" title="${esc(others.map(a => `${a.publisher}: ${ago(a.published)}`).join(" · "))}">⚡ First, ${n.first_by_min >= 120 ? Math.round(n.first_by_min / 60) + " h" : n.first_by_min + " min"} before ${esc(others[0].publisher)}${others.length > 1 ? ` +${others.length - 1}` : ""}</span>`
    : others.length ? `<span class="alsob" title="${esc(others.map(a => a.publisher).join(", "))}">also on ${others.length} site${others.length > 1 ? "s" : ""}</span>` : "";
  return src + first;
}
function newsItem(n) {
  return `<div class="news-item"><span class="tone ${n.tone}" title="${n.tone} tone${n.words.length ? ": " + esc(n.words.join(", ")) : ""}"></span><div>
    <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
    <div class="m"><span title="${esc(new Date(n.published).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}">${ago(n.published)}</span>${srcTag(n)}${n.symbols.filter(s => s !== sel).slice(0, 4).map(s => `<button class="sy" data-go="${esc(s)}">${esc(s)}</button>`).join("")}${n.tone !== "neutral" ? `<span class="${n.tone === "positive" ? "up" : "down"}">${n.tone === "positive" ? "▲ positive" : "▼ negative"}</span>` : ""}</div></div></div>`;
}
function meter(label, v) {
  if (v == null) return `<div class="meter"><div class="l"><span>${label}</span><span>–</span></div><div class="bar"><b></b></div></div>`;
  const w = Math.min(50, Math.abs(v) / 2), left = v >= 0 ? 50 : 50 - w;
  return `<div class="meter"><div class="l"><span>${label}</span><span class="${cls(v)}">${v > 0 ? "+" : ""}${v}</span></div><div class="bar"><b></b><i style="left:50%;width:0;background:${v >= 0 ? "var(--up)" : "var(--down)"}" data-w="${w}%" data-l="${left}%"></i></div></div>`;
}
// ---------- signal track record helpers ----------
const btSig = id => D.backtest?.signals?.find(x => x.id === id);
const SIG_NAME = id => btSig(id)?.name || id;
function activeSignals(t) {
  if (!t) return [];
  const a = [];
  if (t.golden_cross) a.push("golden"); if (t.death_cross) a.push("death");
  if (t.macd_cross === "bull") a.push("macdup"); if (t.macd_cross === "bear") a.push("macddn");
  if (t.bb_squeeze && t.bb_pos > 1) a.push("bbsq");
  if (t.rsi14 < 30) a.push("rsios"); if (t.rsi14 > 70) a.push("rsiob");
  if (t.from_high_pct != null && t.from_high_pct > -0.5) a.push("high52"); if (t.from_low_pct != null && t.from_low_pct < 0.5) a.push("low52");
  if (t.breakout_20d && t.vol_ratio >= 2) a.push("brk20v");
  if (t.above_200 && t.price < t.sma20 && t.rsi14 >= 35 && t.rsi14 <= 50) a.push("pullback");
  return a.filter(id => btSig(id));
}
function verdictBadge(v) { return `<span class="badge ${v === "Worked well" ? "bullish" : v === "Slight edge" ? "watch" : v === "Worked the opposite way" ? "bearish" : "neutral"}">${esc(v)}</span>`; }
function trackLine(id, h = 20) {
  const g = btSig(id); if (!g) return "";
  const r = g.results[h]; if (!r?.n) return `<b>${esc(g.name)}</b>: not enough past cases yet.`;
  return `<b>${esc(g.name)}</b>: in ${fmt(r.n, 0)} past cases the stock ${g.dir === "down" ? "fell" : "rose"} over the next ${h} sessions <b>${r.hit}%</b> of the time, average <b class="${cls(r.avg)}">${pct(r.avg)}</b> (${r.vs_nifty == null ? "" : `${pct(r.vs_nifty)} vs Nifty`}). ${verdictBadge(g.verdict)}`;
}

function stockDetail(sym) {
  const s = S[sym];
  if (!s) return `<div class="empty"><b>${esc(sym)} isn't tracked</b>This site covers the Nifty 200.</div>`;
  const t = s.tech || {}, ins = s.insight, news = stockNews(sym), h = my.holdings.find(x => x.symbol === sym);
  const vsMa = ma => ma == null ? "–" : `${px(ma)} <span class="${t.price > ma ? "up" : "down"}" style="font-size:11px">${t.price > ma ? "above" : "below"}</span>`;
  const range = { 21: "1 month", 63: "3 months", 126: "6 months", 252: "1 year" };
  return `<div class="head">
      <button class="btn sm back" data-back>← All stocks</button>
      <div><h2>${esc(sym)} ${s.nifty50 ? '<span class="badge n50">Nifty 50</span>' : ""}<span class="badge ${ins.signal}">${esc(ins.label)}</span></h2>
        <div class="co">${esc(s.name)}${s.industry ? " · " + esc(s.industry) : ""}</div></div>
      <div class="px"><div class="v">${px(s.price)}</div><div class="num ${cls(s.change_pct)}" style="font-weight:700">${pct(s.change_pct)} today</div></div>
      <div class="acts">
        <button class="btn${my.watch.includes(sym) ? " primary" : ""}" data-star="${esc(sym)}">${my.watch.includes(sym) ? "★ Watching" : "☆ Watch"}</button>
        <a class="btn" href="https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(sym)}" target="_blank" rel="noopener">TradingView ↗</a>
        <a class="btn" href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}" target="_blank" rel="noopener">NSE ↗</a>
        <a class="btn" href="https://kite.zerodha.com/" target="_blank" rel="noopener">Trade on Kite ↗</a>
      </div>
    </div>
    <div class="insight">
      <div class="t"><span class="tag">Automated insight</span>What the news and the chart are saying</div>
      <div class="meters">${meter("News tone", ins.news_score)}${meter("Technicals", ins.tech_score)}${meter("Overall", ins.score)}</div>
      <p>${esc(ins.summary)}</p>
      ${ins.watch.length ? `<b style="font-size:14px">Levels and events to watch</b><ul>${ins.watch.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${activeSignals(t).length ? `<div class="reli"><b style="font-size:14px">How these signals have played out before</b>${activeSignals(t).map(id => `<p>${trackLine(id)}</p>`).join("")}</div>` : ""}
      <div class="muted" style="font-size:12px;margin-top:10px">Built from rules: headline tone words, trend, moving averages, RSI, MACD, Bollinger Bands, volume, support/resistance and the 52-week range. Not investment advice.</div>
    </div>
    <div class="sect"><h3>News · ${news.length}</h3>${news.length ? news.map(newsItem).join("") : '<div class="muted">No Moneycontrol stories in the last few days.</div>'}</div>
    <div class="sect"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><h3 style="margin:0">Price chart</h3>
      <div class="seg">${[[21, "1M"], [63, "3M"], [126, "6M"], [252, "1Y"]].map(([n, l]) => `<button data-range="${n}" class="${ui.range === n ? "on" : ""}" aria-label="${range[n]}">${l}</button>`).join("")}</div></div>
      <div class="ctrls"><span class="muted">Show</span>${[["ma", "Averages"], ["bb", "Bollinger Bands"], ["sr", "Support / resistance"], ["sig", "Past signals"]].map(([k, l]) => `<button class="tog${ui.ov[k] ? " on" : ""}" data-ov="${k}" aria-pressed="${ui.ov[k]}">${l}</button>`).join("")}
        <span class="muted" style="margin-left:6px">Lower panel</span><div class="seg">${[["vol", "Volume"], ["rsi", "RSI"], ["macd", "MACD"]].map(([k, l]) => `<button data-sub="${k}" class="${ui.sub === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="legend" id="legend"></div>
      <div class="chart" id="chart"><div class="skeleton" style="height:330px"></div></div></div>
    <div class="sect" id="pastsig"></div>
    <div class="sect"><h3>Key numbers</h3><div class="stats">
      ${[["Trend", esc(t.trend || "–")], ["RSI (14)", fmt(t.rsi14, 0) + (t.rsi14 > 70 ? " · overbought" : t.rsi14 < 30 ? " · oversold" : "")], ["Volume vs 20-day", t.vol_ratio == null ? "–" : fmt(t.vol_ratio, 1) + "×"],
         ["From 52W high", `<span class="${cls(t.from_high_pct)}">${pct(t.from_high_pct)}</span>`], ["50-day avg", vsMa(t.sma50)], ["200-day avg", vsMa(t.sma200)], ["52W high", px(t.high52)], ["52W low", px(t.low52)],
         ["1 week", `<span class="${cls(t.ret_1w)}">${pct(t.ret_1w)}</span>`], ["1 month", `<span class="${cls(t.ret_1m)}">${pct(t.ret_1m)}</span>`], ["3 months", `<span class="${cls(t.ret_3m)}">${pct(t.ret_3m)}</span>`], ["1 year", `<span class="${cls(t.ret_1y)}">${pct(t.ret_1y)}</span>`],
         ["MACD", t.macd_state ? `<span class="${t.macd_state === "bull" ? "up" : "down"}">${t.macd_state === "bull" ? "▲ above signal" : "▼ below signal"}</span>${t.macd_cross ? " · new cross" : ""}` : "–"],
         ["Bollinger", t.bb_pos == null ? "–" : (t.bb_pos > 1 ? "above upper band" : t.bb_pos < 0 ? "below lower band" : t.bb_pos > 0.5 ? "upper half" : "lower half") + (t.bb_squeeze ? " · squeeze" : "")],
         ["Support", t.support ? `${px(t.support)} <span class="muted" style="font-size:11px">${pct(t.to_support_pct)}</span>` : "–"],
         ["Resistance", t.resistance ? `${px(t.resistance)} <span class="muted" style="font-size:11px">${pct(t.to_resistance_pct)}</span>` : "none nearby"],
         ["RS rating", t.rs_rating == null ? "–" : `<span class="${t.rs_rating >= 70 ? "up" : t.rs_rating <= 30 ? "down" : ""}">${t.rs_rating}</span> <span class="muted" style="font-size:11px">of 99</span>`],
         ["vs Nifty · 3M", `<span class="${cls(t.rel_3m)}">${pct(t.rel_3m)}</span>`],
         ["vs Nifty · 1Y", `<span class="${cls(t.rel_1y)}">${pct(t.rel_1y)}</span>`],
         ["Bandwidth", t.bb_width == null ? "–" : fmt(t.bb_width, 1) + "%"]]
        .map(([l, v]) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("")}</div></div>
    ${s.events.length ? `<div class="sect"><h3>Coming up</h3>${s.events.map(e => `<div style="margin-bottom:8px"><span class="badge ${e.type === "Results" ? "n50" : "watch"}">${esc(e.type)}</span> <b class="num">${esc(e.date)}</b> <span class="muted">${esc(e.detail)}</span></div>`).join("")}</div>` : ""}
    <div class="sect"><h3>My position and alerts</h3>
      ${h ? `<p style="margin:0 0 10px">${h.qty} shares at ${px(h.avg)} · value <b class="num">${inr(h.qty * s.price)}</b> · P&L <b class="num ${cls(s.price - h.avg)}">${inr((s.price - h.avg) * h.qty)} (${pct((s.price / h.avg - 1) * 100)})</b></p>` : ""}
      <div class="form" style="margin-bottom:8px"><input id="hq" type="number" min="1" placeholder="Quantity" value="${h ? h.qty : ""}" aria-label="Quantity"><input id="ha" type="number" min="0.05" step="0.05" placeholder="Avg price ₹" value="${h ? h.avg : ""}" aria-label="Average price">
        <button class="btn primary sm" data-hsave="${esc(sym)}">${h ? "Update holding" : "Add to portfolio"}</button>${h ? `<button class="btn sm" data-hdel="${esc(sym)}">Remove</button>` : ""}</div>
      <div class="form"><select id="at" aria-label="Alert type"><option value="above">Alert when price rises to</option><option value="below">Alert when price falls to</option></select><input id="ap" type="number" min="0.05" step="0.05" placeholder="₹ price" aria-label="Alert price">
        <button class="btn sm" data-aset="${esc(sym)}">Set alert</button></div>
      ${my.alerts.filter(a => a.symbol === sym).map(a => `<div style="font-size:13.5px;margin-top:8px">${a.type === "above" ? "▲ Rises to" : "▼ Falls to"} <span class="num">${px(a.price)}</span> ${a.hit ? '<span class="up">· triggered</span>' : ""} <button class="sy" data-adel="${a.id}">remove</button></div>`).join("")}
      <div class="muted" style="font-size:12px;margin-top:8px">Kept privately in this browser.</div>
    </div>`;
}
const chartRows = ch => (Array.isArray(ch) ? ch : ch.rows).map(r => ({ t: r[0] * 1000, c: r[1], s50: r[2], s200: r[3], bu: r[4], bl: r[5], macd: r[6], sig: r[7], rsi: r[8], v: r[9] }));
const chartEvents = ch => Array.isArray(ch) ? [] : ch.ev || [];
async function drawChart(sym) {
  const box = $("#chart"); if (!box) return;
  try { if (!charts[sym]) { const r = await fetch(`data/charts/${sym.replace(/[^A-Z0-9&-]/gi, "_")}.json?t=${D.generated_at}`); charts[sym] = await r.json(); } }
  catch { box.innerHTML = '<div class="muted">Chart unavailable.</div>'; return; }
  if (!$("#chart") || sel !== sym) return;
  const all = chartRows(charts[sym]), evs = chartEvents(charts[sym]), t = S[sym]?.tech || {};
  renderPastSignals(sym, evs);
  const pts = all.slice(-ui.range);
  if (pts.length < 2) { $("#chart").innerHTML = '<div class="muted">Chart unavailable.</div>'; return; }
  const hasPro = pts.some(p => p.bu != null || p.v != null);
  const sub = hasPro ? ui.sub : null;
  const W = 720, L = 8, R = 60, T = 12, MH = 250, GAP = 26, SH = sub ? 86 : 0, H = MH + (sub ? GAP + SH : 0) + 22;
  const ov = ui.ov, keys = ["c"].concat(ov.ma ? ["s50", "s200"] : [], ov.bb && hasPro ? ["bu", "bl"] : []);
  const vals = pts.flatMap(p => keys.map(k => p[k])).filter(v => v != null);
  if (ov.sr && t.support) vals.push(t.support); if (ov.sr && t.resistance && t.resistance < Math.max(...vals) * 1.15) vals.push(t.resistance);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pd = (hi - lo) * 0.08 || 1; lo -= pd; hi += pd;
  const x = i => L + i / (pts.length - 1) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (MH - T - 4);
  const line = (k, yf = y) => { let d = "", on = false; pts.forEach((p, i) => { if (p[k] == null) { on = false; return; } d += (on ? "L" : "M") + x(i).toFixed(1) + " " + yf(p[k]).toFixed(1); on = true; }); return d; };
  const last = pts[pts.length - 1], chg = (last.c / pts[0].c - 1) * 100;
  const dot = (k, c) => last[k] == null ? "" : `<circle cx="${x(pts.length - 1)}" cy="${y(last[k])}" r="3.5" fill="${c}" stroke="var(--card)" stroke-width="2"/>`;
  const dfmt = tt => new Date(tt).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(ui.range > 130 ? { year: "2-digit" } : {}) });
  const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * (i + 0.5) / 4);
  // Bollinger band fill
  let bbFill = "";
  if (ov.bb && hasPro) {
    const up = [], dn = []; pts.forEach((p, i) => { if (p.bu != null && p.bl != null) { up.push([x(i), y(p.bu)]); dn.push([x(i), y(p.bl)]); } });
    if (up.length > 1) bbFill = `<path d="M${up.map(q => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L")}L${dn.reverse().map(q => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L")}Z" fill="var(--s4)" opacity=".10"/>
      <path d="${line("bu")}" fill="none" stroke="var(--s4)" stroke-width="1.3" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/><path d="${line("bl")}" fill="none" stroke="var(--s4)" stroke-width="1.3" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
  }
  // support / resistance
  const hline = (v, col, lab) => v == null || v < lo || v > hi ? "" : `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-width="1.4" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/><rect x="${W - R + 2}" y="${y(v) - 9}" width="${R - 4}" height="18" rx="4" fill="${col}"/><text x="${W - R / 2}" y="${y(v) + 4}" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">${lab}</text>`;
  const sr = ov.sr ? hline(t.support, "var(--up)", "SUP") + hline(t.resistance, "var(--down)", "RES") : "";
  // past-signal markers
  let marks = "";
  if (ov.sig && evs.length) {
    const idx = {}; pts.forEach((p, i) => { idx[new Date(p.t + 5.5 * 3600e3).toISOString().slice(0, 10)] = i; });
    for (const e of evs) { const i = idx[e.d]; if (i == null) continue; const g = btSig(e.s); if (!g) continue;
      const upSig = g.dir === "up", yy = y(pts[i].c) + (upSig ? 14 : -14), xx = x(i);
      marks += `<path d="${upSig ? `M${xx} ${yy - 6}l5 8h-10z` : `M${xx} ${yy + 6}l5 -8h-10z`}" fill="${upSig ? "var(--up)" : "var(--down)"}" opacity=".9"><title>${esc(g.name)} · ${esc(e.d)}${e.r20 != null ? ` · next 20 sessions ${pct(e.r20)}` : ""}</title></path>`; }
  }
  // lower panel
  let subSvg = "";
  const sy0 = MH + GAP, sy1 = sy0 + SH;
  if (sub === "vol") {
    const vmax = Math.max(1, ...pts.map(p => p.v || 0)), bw = Math.max(1, (W - L - R) / pts.length - 0.8);
    subSvg = pts.map((p, i) => { const hgt = (p.v || 0) / vmax * SH; const upd = i ? p.c >= pts[i - 1].c : true; return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(sy1 - hgt).toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="${upd ? "var(--up)" : "var(--down)"}" opacity=".55"/>`; }).join("")
      + `<text x="${W - R + 7}" y="${sy0 + 10}" font-size="10.5" fill="var(--muted)">Volume</text>`;
  } else if (sub === "rsi") {
    const ry = v => sy0 + (1 - v / 100) * SH;
    subSvg = `<rect x="${L}" y="${ry(70)}" width="${W - L - R}" height="${ry(30) - ry(70)}" fill="var(--paper2)"/>
      ${[30, 50, 70].map(v => `<line x1="${L}" x2="${W - R}" y1="${ry(v)}" y2="${ry(v)}" stroke="var(--line)" ${v !== 50 ? 'stroke-dasharray="3 3"' : ""}/><text x="${W - R + 7}" y="${ry(v) + 4}" font-size="10.5" fill="var(--muted)">${v}</text>`).join("")}
      <path d="${line("rsi", ry)}" fill="none" stroke="var(--s5)" stroke-width="1.8" vector-effect="non-scaling-stroke"/>`;
  } else if (sub === "macd") {
    const mv = pts.flatMap(p => [p.macd, p.sig, p.macd != null && p.sig != null ? p.macd - p.sig : null]).filter(v => v != null);
    const mx = Math.max(1e-9, ...mv.map(Math.abs)), my = v => sy0 + SH / 2 - v / mx * (SH / 2 - 2), bw = Math.max(1, (W - L - R) / pts.length - 0.8);
    subSvg = `<line x1="${L}" x2="${W - R}" y1="${my(0)}" y2="${my(0)}" stroke="var(--line2)"/>`
      + pts.map((p, i) => { if (p.macd == null || p.sig == null) return ""; const hv = p.macd - p.sig; return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${Math.min(my(0), my(hv)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(my(hv) - my(0)).toFixed(1)}" fill="${hv >= 0 ? "var(--up)" : "var(--down)"}" opacity=".45"/>`; }).join("")
      + `<path d="${line("macd", my)}" fill="none" stroke="var(--s1)" stroke-width="1.6" vector-effect="non-scaling-stroke"/><path d="${line("sig", my)}" fill="none" stroke="var(--s2)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <text x="${W - R + 7}" y="${sy0 + 10}" font-size="10.5" fill="var(--muted)">MACD</text>`;
  }
  const lg = [["var(--s1)", "Price"]].concat(ov.ma ? [["var(--s2)", "50-day avg"], ["var(--s3)", "200-day avg"]] : [], ov.bb && hasPro ? [["var(--s4)", "Bollinger Bands (20, 2)"]] : [], ov.sr ? [["var(--up)", "Support"], ["var(--down)", "Resistance"]] : [],
    sub === "rsi" ? [["var(--s5)", "RSI (14)"]] : sub === "macd" ? [["var(--s1)", "MACD"], ["var(--s2)", "Signal line"]] : []);
  $("#legend").innerHTML = lg.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("") + (ov.sig && evs.length ? `<span><b class="up">▲</b>/<b class="down">▼</b> past signals (hover)</span>` : "");
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${Math.round(H * 0.94)}px" role="img" aria-label="${esc(sym)} price chart">
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--s1)" stop-opacity=".22"/><stop offset="1" stop-color="var(--s1)" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(g => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)"/><text x="${W - R + 7}" y="${y(g) + 4}" font-size="10.5" fill="var(--muted)">${fmt(g, g > 1000 ? 0 : 1)}</text>`).join("")}
    ${[0, Math.floor(pts.length / 2), pts.length - 1].map(i => `<text x="${x(i)}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}">${dfmt(pts[i].t)}</text>`).join("")}
    ${bbFill}
    <path d="${line("c")}L${x(pts.length - 1)} ${MH - 4}L${x(0)} ${MH - 4}Z" fill="url(#ga)"/>
    ${ov.ma ? `<path d="${line("s200")}" fill="none" stroke="var(--s3)" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="${line("s50")}" fill="none" stroke="var(--s2)" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ""}
    <path d="${line("c")}" fill="none" stroke="var(--s1)" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
    ${sr}${marks}
    ${ov.ma ? dot("s200", "var(--s3)") + dot("s50", "var(--s2)") : ""}${dot("c", "var(--s1)")}
    ${subSvg}
    <line id="xh" y1="${T}" y2="${sub ? sy1 : MH}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>
    <rect id="hit" x="${L}" y="${T}" width="${W - L - R}" height="${(sub ? sy1 : MH) - T}" fill="transparent"/>
  </svg><div class="tip" id="tip" hidden></div>
  <div class="muted" style="font-size:12.5px;margin-top:6px">Last ${{ 21: "month", 63: "3 months", 126: "6 months", 252: "year" }[ui.range]}: <b class="num ${cls(chg)}">${pct(chg)}</b> · price ${px(last.c)}${last.s50 ? ` · 50-day ${px(last.s50)}` : ""}${last.s200 ? ` · 200-day ${px(last.s200)}` : ""}</div>`;
  const svg = $("#chart svg"), tip = $("#tip"), xh = $("#xh");
  const move = cx => {
    const b = svg.getBoundingClientRect(), sx = (cx - b.left) / b.width * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((sx - L) / (W - L - R) * (pts.length - 1)))), p = pts[i];
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
    tip.hidden = false; tip.innerHTML = `<b>${new Date(p.t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</b><br>Price ${px(p.c)}${ov.ma && p.s50 ? `<br><span style="color:var(--s2)">■</span> 50-day ${px(p.s50)}` : ""}${ov.ma && p.s200 ? `<br><span style="color:var(--s3)">■</span> 200-day ${px(p.s200)}` : ""}${ov.bb && p.bu != null ? `<br><span style="color:var(--s4)">■</span> Bands ${px(p.bl)} – ${px(p.bu)}` : ""}${p.rsi != null ? `<br>RSI ${fmt(p.rsi, 0)}` : ""}${p.macd != null && p.sig != null ? ` · MACD ${p.macd > p.sig ? "▲" : "▼"}` : ""}${p.v ? `<br>Volume ${fmt(p.v, 0)}` : ""}`;
    const lx = x(i) / W * b.width; tip.style.left = (lx > b.width - 190 ? lx - 180 : lx + 12) + "px"; tip.style.top = "6px";
  };
  svg.onmousemove = e => move(e.clientX); svg.ontouchmove = e => move(e.touches[0].clientX);
  svg.onmouseleave = () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); };
}
function renderPastSignals(sym, evs) {
  const box = $("#pastsig"); if (!box) return;
  if (!evs.length) { box.innerHTML = ""; return; }
  const rows = evs.slice(0, 14);
  const done = evs.filter(e => e.r20 != null && btSig(e.s)), ok = done.filter(e => btSig(e.s).dir === "down" ? e.r20 < 0 : e.r20 > 0).length;
  box.innerHTML = `<h3>Past signals on ${esc(sym)} · last 2 years</h3>
    ${done.length ? `<p class="muted" style="font-size:13.5px;margin:0 0 8px">${ok} of ${done.length} signals (${Math.round(ok / done.length * 100)}%) went the expected way over the next 20 sessions.</p>` : ""}
    <div class="tblwrap" style="max-height:none"><table class="tbl"><thead><tr><th class="l">Date</th><th class="l">Signal</th><th>Price</th><th>+5 days</th><th>+20 days</th><th>+60 days</th><th class="l">Result</th></tr></thead><tbody>
    ${rows.map(e => { const g = btSig(e.s) || { name: e.s, dir: "up" }; const r = e.r20 ?? e.r5, early = e.r20 == null; const good = r == null ? null : g.dir === "down" ? r < 0 : r > 0;
      return `<tr style="cursor:default"><td class="l num">${new Date(e.d + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}</td><td class="l"><span class="${g.dir === "up" ? "up" : "down"}">${g.dir === "up" ? "▲" : "▼"}</span> ${esc(g.name)}</td><td class="num">${px(e.p)}</td>
      ${["r5", "r20", "r60"].map(k => `<td class="num ${cls(e[k])}">${e[k] == null ? '<span class="muted">pending</span>' : pct(e[k])}</td>`).join("")}
      <td class="l">${good == null ? '<span class="badge neutral">Too early</span>' : early ? `<span class="badge neutral">So far ${good ? "✓" : "✗"}</span>` : good ? '<span class="badge bullish">Worked</span>' : '<span class="badge bearish">Didn\'t work</span>'}</td></tr>`; }).join("")}</tbody></table></div>`;
}

// ---------- MARKETS ----------
function heat(c, scale = 3) { if (c == null) return "background:var(--paper2)"; const a = Math.min(1, Math.abs(c) / scale); return `background:color-mix(in srgb, ${c >= 0 ? "var(--up)" : "var(--down)"} ${Math.round(14 + a * 56)}%, var(--mid))`; }
function markets() {
  const m = D.mood, withP = D.stocks.filter(s => s.change_pct != null);
  const gain = [...withP].sort((a, b) => b.change_pct - a.change_pct).slice(0, 8), lose = [...withP].sort((a, b) => a.change_pct - b.change_pct).slice(0, 8);
  const mv = s => `<button class="mv" data-go="${esc(s.symbol)}"><span><b>${esc(s.symbol)}</b> <span class="muted" style="font-size:12.5px">${esc((s.name || "").slice(0, 28))}</span></span><span class="num"><span class="muted">${px(s.price)}</span> <b class="${cls(s.change_pct)}">${pct(s.change_pct)}</b></span></button>`;
  const maxF = Math.max(1, ...(D.fii_dii || []).map(f => Math.max(f.buy, f.sell)));
  return `<div class="fade"><h1 class="page">Markets today</h1><p class="sub">Mood, sectors, institutional flows and the biggest movers among ${D.stocks.length} tracked stocks (Nifty 200 + F&O).</p>
  ${bubbleCard()}
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="hd"><h2>Market mood</h2><span class="muted" style="font-size:12.5px">rule-based score out of 100</span></div><div class="bd"><div class="glance"><div class="gauge">${gaugeSvg(m.score, m.label)}</div><div>${m.lines.map(l => `<p>${esc(l)}</p>`).join("")}</div></div></div></div>
    <div class="card"><div class="hd"><h2>Who's buying</h2><span class="muted" style="font-size:12.5px">cash market, ₹ crore</span></div><div class="bd">
      ${(D.fii_dii || []).length ? D.fii_dii.map(f => `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between"><b>${esc(f.category)}</b><b class="num ${cls(f.net)}">Net ${f.net >= 0 ? "+" : "−"}${fmt(Math.abs(f.net), 0)}</b></div>
        <div class="flow"><span class="muted">Bought</span><div class="bar"><i style="width:0;background:var(--up)" data-w="${(f.buy / maxF * 100).toFixed(1)}%"></i></div><span class="num">${fmt(f.buy, 0)}</span></div>
        <div class="flow"><span class="muted">Sold</span><div class="bar"><i style="width:0;background:var(--down)" data-w="${(f.sell / maxF * 100).toFixed(1)}%"></i></div><span class="num">${fmt(f.sell, 0)}</span></div></div>`).join("") + `<div class="muted" style="font-size:12.5px">${esc(D.fii_dii[0].date)}. FIIs are foreign investors; DIIs are Indian mutual funds and insurers.</div>`
      : '<div class="muted">FII/DII data unavailable in this update.</div>'}
      ${D.topics.length ? `<h3 style="font-family:var(--body);font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em;margin:18px 0 8px">Trending in the headlines</h3><div class="topics">${D.topics.map(t => `<span>${esc(t.topic)}<em>${t.n}</em></span>`).join("")}</div>` : ""}
    </div></div>
  </div>
  ${D.sectors.length ? `<div class="card" style="margin-top:16px"><div class="hd"><h2>Sector indices</h2><span class="muted" style="font-size:12.5px">green is up and red is down; the deeper the colour, the bigger the move</span></div><div class="bd"><div class="heat">
    ${D.sectors.map(s => `<div class="tile" style="${heat(s.change_pct)}"><b>${esc(s.name)}</b><div class="v">${pct(s.change_pct)}</div><div class="m">${s.ch30d != null ? "30 days " + pct(s.ch30d) : fmt(s.last, 0)}${s.adv != null ? ` · ${s.adv}▲ ${s.dec}▼` : ""}</div></div>`).join("")}</div></div></div>` : ""}
  ${heatmapCard()}
  ${rsCard()}
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="hd"><h2>Top gainers</h2></div><div class="bd" style="padding-top:4px">${gain.map(mv).join("")}</div></div>
    <div class="card"><div class="hd"><h2>Top losers</h2></div><div class="bd" style="padding-top:4px">${lose.map(mv).join("")}</div></div>
  </div></div>`;
}

const HP = { change_pct: ["1D", 3], ret_1w: ["1W", 6], ret_1m: ["1M", 10], ret_3m: ["3M", 20], ret_1y: ["1Y", 40] };
function heatmapCard() {
  const k = ui.hp, [pl, sc] = HP[k], v = s => k === "change_pct" ? s.change_pct : s.tech?.[k];
  const ctrl = `<div style="display:flex;gap:8px;flex-wrap:wrap"><div class="seg">${Object.entries(HP).map(([kk, [l]]) => `<button data-hp="${kk}" class="${k === kk ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="seg"><button data-hm="ind" class="${ui.hm === "ind" ? "on" : ""}">Industries</button><button data-hm="stk" class="${ui.hm === "stk" ? "on" : ""}">Every stock</button></div></div>`;
  let body;
  if (ui.hm === "ind") {
    const list = [...(D.industries || [])].map(g => ({ ...g, val: g[k] })).sort((a, b) => (b.val ?? -1e9) - (a.val ?? -1e9));
    body = `<div class="heat">${list.map(g => `<div class="tile" style="${heat(g.val, sc)}"><b>${esc(g.name)}</b><div class="v">${pct(g.val)}</div><div class="m">${g.count} stocks${g.rs_avg != null ? ` · RS ${Math.round(g.rs_avg)}` : ""} · ${g.top.map(x => `<button class="sy" data-go="${esc(x)}">${esc(x)}</button>`).join(" ")}</div></div>`).join("")}</div>`;
  } else {
    const groups = {};
    for (const st of D.stocks) if (v(st) != null) (groups[st.industry || "Other"] ||= []).push(st);
    const gl = Object.entries(groups).map(([n, a]) => [n, a.sort((x, y) => v(y) - v(x)), a.reduce((t, x) => t + v(x), 0) / a.length]).sort((a, b) => b[2] - a[2]);
    body = gl.map(([n, a, m]) => `<div class="hgrp"><div class="hgh"><b>${esc(n)}</b><span class="num ${cls(m)}">${pct(m)}</span></div><div class="smap">${a.map(st => `<button class="st" data-go="${esc(st.symbol)}" style="${heat(v(st), sc)}" title="${esc(st.name)} · ${pct(v(st))}"><b>${esc(st.symbol)}</b><span>${pct(v(st))}</span></button>`).join("")}</div></div>`).join("");
  }
  return `<div class="card" style="margin-top:16px"><div class="hd"><h2>Heatmap · ${pl}</h2>${ctrl}</div><div class="bd">${body}
    <div class="muted" style="font-size:12.5px;margin-top:10px">Green is up and red is down; the deeper the colour, the bigger the move (full colour at ±${sc}%). Tap a stock for its news and chart.</div></div></div>`;
}
function rsCard() {
  const rows = D.stocks.filter(s => s.tech?.rs_rating != null);
  if (!rows.length) return "";
  const lead = [...rows].sort((a, b) => b.tech.rs_rating - a.tech.rs_rating || b.tech.rel_3m - a.tech.rel_3m).slice(0, 10), lag = [...rows].sort((a, b) => a.tech.rs_rating - b.tech.rs_rating || a.tech.rel_3m - b.tech.rel_3m).slice(0, 10);
  const nr = D.nifty_returns || {};
  const li = s => `<button class="mv" data-go="${esc(s.symbol)}"><span class="rsl"><b>${esc(s.symbol)}</b><span class="rsbar"><i style="width:0" data-w="${s.tech.rs_rating}%"></i></span><span class="num">${s.tech.rs_rating}</span></span><span class="num"><span class="muted">3M</span> <b class="${cls(s.tech.ret_3m)}">${pct(s.tech.ret_3m)}</b> <span class="muted">vs Nifty</span> <b class="${cls(s.tech.rel_3m)}">${pct(s.tech.rel_3m)}</b></span></button>`;
  return `<div class="card" style="margin-top:16px"><div class="hd"><h2>Relative strength vs Nifty 50</h2><span class="muted" style="font-size:12.5px">Nifty: 3M ${pct(nr.m3)} · 1Y ${pct(nr.y1)}</span></div><div class="bd">
    <div class="explain" style="margin-bottom:12px"><b>RS rating (1–99)</b> ranks each stock's 3, 6, 9 and 12-month performance (recent months weigh double) against the other tracked stocks. 90 means it beat 90% of them. Leaders often keep leading; laggards often keep lagging.</div>
    <div class="grid g2"><div><h3 class="mini">Leaders</h3>${lead.map(li).join("")}</div><div><h3 class="mini">Laggards</h3>${lag.map(li).join("")}</div></div>
    <div style="margin-top:10px"><button class="sy" data-rs="1">Open all in the screener →</button></div></div></div>`;
}

// ---------- SCREENER ----------
const PRESETS = {
  all: ["All stocks", "Every tracked stock with its key technicals.", () => true],
  breakout: ["Uptrend near 52W high", "Above the 200-day average and within 3% of the 52-week high: stocks showing strength.", r => r.t.above_200 && r.t.from_high_pct >= -3],
  pullback: ["Dip in an uptrend", "Long-term uptrend (above the 200-day) but below the 20-day with RSI 35–50: a short-term pullback.", r => r.t.above_200 && r.t.price < r.t.sma20 && r.t.rsi14 >= 35 && r.t.rsi14 <= 50],
  oversold: ["Oversold · RSI < 30", "A sharp recent fall. It can bounce or keep falling, so check the news first.", r => r.t.rsi14 < 30],
  overbought: ["Overbought · RSI > 70", "A strong recent run. Momentum is high, and so is the chance of a pause.", r => r.t.rsi14 > 70],
  volume: ["Volume spike 2×", "Today's volume is at least twice the 20-day average, a sign that something is happening.", r => r.t.vol_ratio >= 2],
  golden: ["Golden cross", "The 50-day average crossed above the 200-day in the last 10 sessions.", r => r.t.golden_cross],
  death: ["Death cross", "The 50-day average crossed below the 200-day in the last 10 sessions.", r => r.t.death_cross],
  below200: ["Below 200-day", "Trading under the 200-day average, which points to a longer-term downtrend.", r => r.t.above_200 === false],
  nearlow: ["Near 52W low", "Within 5% of the 52-week low. Find out why before assuming it's cheap.", r => r.t.from_low_pct <= 5],
  newsy: ["Good news + uptrend", "Recent headlines lean positive and the stock is above its 200-day average.", r => r.s.insight.news_score > 15 && r.t.above_200],
  rslead: ["RS leaders · 80+", "Relative-strength rating of 80 or more: beating at least 80% of the tracked stocks over the past year.", r => r.t.rs_rating >= 80],
  rslag: ["RS laggards · 20−", "Relative-strength rating of 20 or less: among the weakest performers.", r => r.t.rs_rating <= 20],
  brk55: ["55-day breakout", "Closed above its highest price of the previous 55 sessions.", r => r.t.breakout_55d],
  brkvol: ["Breakout on 2× volume", "Closed above its 20-day high with volume at least twice the average: a breakout with conviction.", r => r.t.breakout_20d && r.t.vol_ratio >= 2],
  volup: ["Volume surge, price up", "Volume 2× the average on an up day: buyers stepping in.", r => r.t.vol_surge_up],
  voldn: ["Volume surge, price down", "Volume 2× the average on a down day: heavy selling.", r => r.t.vol_surge_down],
  macdup: ["MACD bullish cross", "MACD crossed above its signal line in the last 5 sessions: momentum turning up.", r => r.t.macd_cross === "bull"],
  macddn: ["MACD bearish cross", "MACD crossed below its signal line in the last 5 sessions: momentum turning down.", r => r.t.macd_cross === "bear"],
  squeeze: ["Bollinger squeeze", "Bollinger Bands at their tightest in 6 months: volatility is coiled and a big move often follows (either way).", r => r.t.bb_squeeze],
  nearsup: ["Near support", "Within 3% above a support level that price has bounced from before.", r => r.t.to_support_pct != null && r.t.to_support_pct >= -3],
  nearres: ["Near resistance", "Within 3% below a resistance level where price has turned down before.", r => r.t.to_resistance_pct != null && r.t.to_resistance_pct <= 3],
};
// which back-tested signal matches each scan (for the track-record line)
const PRESET_SIG = { golden: "golden", death: "death", oversold: "rsios", overbought: "rsiob", pullback: "pullback", below200: "below200", brkvol: "brk20v", volup: "volup", voldn: "voldn", macdup: "macdup", macddn: "macddn", squeeze: "bbsq", breakout: "high52", nearlow: "low52" };
const SGROUPS = [
  ["Popular", ["all", "breakout", "newsy", "pullback", "rslead", "brkvol"]],
  ["Momentum", ["volume", "volup", "macdup", "overbought", "oversold"]],
  ["Breakouts & trend", ["golden", "brk55", "squeeze", "nearres"]],
  ["Weakness", ["rslag", "death", "below200", "macddn", "voldn", "nearlow", "nearsup"]],
];
const SSORT = [["change_pct", "Today's move"], ["ret_1m", "1-month return"], ["ret_1y", "1-year return"], ["rs_rating", "Relative strength"], ["signal", "Signal score"], ["rsi14", "RSI"], ["news", "Most news"], ["symbol", "Name A–Z"]];
function whyMatch(k, s, t) {
  const m = { breakout: `${pct(t.from_high_pct)} from 52W high`, pullback: `RSI ${fmt(t.rsi14, 0)} · below 20-day avg`, oversold: `RSI ${fmt(t.rsi14, 0)}`, overbought: `RSI ${fmt(t.rsi14, 0)}`,
    volume: `Volume ${fmt(t.vol_ratio, 1)}× average`, volup: `Volume ${fmt(t.vol_ratio, 1)}× on an up day`, voldn: `Volume ${fmt(t.vol_ratio, 1)}× on a down day`, golden: "50-day avg just crossed above 200-day",
    death: "50-day avg just crossed below 200-day", below200: `200-day avg ${px(t.sma200)}`, nearlow: `${pct(t.from_low_pct)} above 52W low`, newsy: `${s.news_ids.length} news, tone +${s.insight.news_score}`,
    rslead: `RS ${t.rs_rating} · beat Nifty by ${pct(t.rel_3m)} in 3M`, rslag: `RS ${t.rs_rating} · ${pct(t.rel_3m)} vs Nifty in 3M`, brk55: "Closed above its 55-day high", brkvol: `20-day breakout on ${fmt(t.vol_ratio, 1)}× volume`,
    macdup: "MACD crossed up (last 5 days)", macddn: "MACD crossed down (last 5 days)", squeeze: "Bollinger Bands at 6-month tightest", nearsup: `Support ${px(t.support)} (${pct(t.to_support_pct)})`, nearres: `Resistance ${px(t.resistance)} (+${fmt(t.to_resistance_pct, 1)}%)` };
  return m[k] || `Trend: ${esc(t.trend || "–")}`;
}
function screener() {
  const uni = ui.suni;
  const rows0 = D.stocks.filter(s => s.tech && (uni === "all" || (uni === "n50" ? s.nifty50 : uni === "fo" ? s.fo : s.nifty200 !== false))).map(s => ({ s, t: s.tech }));
  if (!PRESETS[ui.preset]) ui.preset = "all";
  const [label, desc, f] = PRESETS[ui.preset], q = ui.sq.trim().toLowerCase();
  const ok = (p, r) => { try { return p(r); } catch { return false; } };
  const val = (r, k) => k === "symbol" ? r.s.symbol : k === "industry" ? r.s.industry : k === "change_pct" ? r.s.change_pct : k === "signal" ? r.s.insight.score : k === "news" ? r.s.news_ids.length : k === "macd" ? r.t.macd_hist : r.t[k];
  const rows = rows0.filter(r => ok(f, r)).filter(r => !q || r.s.symbol.toLowerCase().includes(q) || (r.s.name || "").toLowerCase().includes(q) || (r.s.industry || "").toLowerCase().includes(q))
    .sort((a, b) => { const x = val(a, ui.sort.k), y = val(b, ui.sort.k); return (typeof x === "string" ? String(x).localeCompare(y || "") : ((x ?? -1e9) - (y ?? -1e9))) * ui.sort.d; });
  const grp = SGROUPS.find(g => g[0] === ui.sgrp) || SGROUPS[0];
  const th = (k, l, left) => `<th class="${left ? "l" : ""}"><button data-sort="${k}">${l}${ui.sort.k === k ? (ui.sort.d > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  const shown = rows.slice(0, ui.slimit);
  const card = ({ s, t }) => `<button class="scard" data-go="${esc(s.symbol)}">
      <div class="sc1"><div><b class="sym">${esc(s.symbol)}</b>${s.nifty50 ? ' <span class="badge n50">N50</span>' : ""}${s.fo ? ' <span class="badge neutral">F&amp;O</span>' : ""}<div class="scn">${esc((s.name || "").replace(/ Limited$| Ltd\.?$/i, ""))}</div></div>
        <div class="scp"><div class="num">${px(s.price)}</div><b class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</b></div></div>
      <div class="sc2">${sparkSvg(s.spark, (s.spark?.[s.spark.length - 1] ?? 0) >= (s.spark?.[0] ?? 0))}<span class="badge ${s.insight.signal}">${esc(s.insight.label)}</span></div>
      <div class="why">✓ ${whyMatch(ui.preset, s, t)}</div>
      <div class="sc3"><span><em>1M</em><b class="num ${cls(t.ret_1m)}">${pct(t.ret_1m)}</b></span><span><em>1Y</em><b class="num ${cls(t.ret_1y)}">${pct(t.ret_1y)}</b></span><span><em>RSI</em><b class="num">${fmt(t.rsi14, 0)}</b></span><span><em>RS</em><b class="num ${t.rs_rating >= 70 ? "up" : t.rs_rating <= 30 ? "down" : ""}">${t.rs_rating ?? "–"}</b></span><span><em>News</em><b class="num">${s.news_ids.length || "–"}</b></span></div>
    </button>`;
  const more = ui.smore;
  return `<div class="fade"><h1 class="page">Screener</h1><p class="sub">Pick a scan, and the matching stocks appear below. Tap any stock for its news, chart and insight.</p>
  <div class="card scr-top"><div class="bd">
    <div class="sgrp">${SGROUPS.map(([g, ks]) => `<button class="${g === grp[0] ? "on" : ""}" data-sgrp="${esc(g)}">${esc(g)}</button>`).join("")}</div>
    <div class="presets">${grp[1].filter(k => PRESETS[k]).map(k => `<button class="chip big${k === ui.preset ? " on" : ""}" data-preset="${k}">${PRESETS[k][0]}<span class="n">${rows0.filter(r => ok(PRESETS[k][2], r)).length}</span></button>`).join("")}</div>
    <div class="explain" style="margin:10px 0 0"><b>${esc(label)}:</b> ${esc(desc)}</div>
  </div></div>
  <div class="stools">
    <input class="field" id="sq" placeholder="Search in results" value="${esc(ui.sq)}" aria-label="Search in results">
    <div class="seg">${[["all", "All"], ["n50", "Nifty 50"], ["n200", "Nifty 200"], ["fo", "F&O"]].map(([k, l]) => `<button data-suni="${k}" class="${uni === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <label class="ssort"><span class="muted">Sort</span><select id="ssort" aria-label="Sort by">${SSORT.map(([k, l]) => `<option value="${k}"${ui.sort.k === k ? " selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn sm" data-sdir title="Reverse order">${ui.sort.d > 0 ? "↑ Low to high" : "↓ High to low"}</button></label>
    <div class="seg"><button data-sview="cards" class="${ui.sview === "cards" ? "on" : ""}">▦ Cards</button><button data-sview="table" class="${ui.sview === "table" ? "on" : ""}">☰ Table</button></div>
    <b class="num scount">${rows.length} stock${rows.length === 1 ? "" : "s"}</b>
  </div>
  ${!rows.length ? `<div class="card"><div class="empty"><b>No stocks match this scan right now</b>Try another scan or switch to “All”.</div></div>`
  : ui.sview === "cards" ? `<div class="sgrid">${shown.map(card).join("")}</div>`
  : `<div class="card"><div class="tblwrap"><table class="tbl stbl"><thead><tr>${th("symbol", "Stock", 1)}${th("price", "Price")}${th("change_pct", "Day")}${th("signal", "Signal", 1)}${th("ret_1m", "1M")}${th("ret_1y", "1Y")}${th("rsi14", "RSI")}${th("rs_rating", "RS")}${th("news", "News")}
      ${more ? `${th("industry", "Industry", 1)}${th("from_high_pct", "From 52W high")}${th("vol_ratio", "Volume")}${th("rel_3m", "vs Nifty 3M")}${th("macd", "MACD")}${th("to_support_pct", "To support")}` : ""}</tr></thead><tbody>
    ${shown.map(({ s, t }) => `<tr data-go="${esc(s.symbol)}"><td class="l"><span class="sym">${esc(s.symbol)}</span>${s.nifty50 ? ' <span class="badge n50">N50</span>' : ""}<div class="muted" style="font-size:12px">${esc((s.name || "").replace(/ Limited$| Ltd\.?$/i, "").slice(0, 30))}</div></td>
      <td class="num">${px(s.price)}</td><td class="num ${cls(s.change_pct)}"><b>${pct(s.change_pct)}</b></td><td class="l"><span class="badge ${s.insight.signal}">${esc(s.insight.label)}</span></td>
      <td class="num ${cls(t.ret_1m)}">${pct(t.ret_1m)}</td><td class="num ${cls(t.ret_1y)}">${pct(t.ret_1y)}</td><td class="num ${t.rsi14 < 30 ? "down" : t.rsi14 > 70 ? "up" : ""}">${fmt(t.rsi14, 0)}</td>
      <td class="num ${t.rs_rating >= 70 ? "up" : t.rs_rating <= 30 ? "down" : ""}">${t.rs_rating ?? "–"}</td><td class="num">${s.news_ids.length || "–"}</td>
      ${more ? `<td class="l muted">${esc((s.industry || "").slice(0, 24))}</td><td class="num">${pct(t.from_high_pct)}</td><td class="num ${t.vol_ratio >= 2 ? "up" : ""}">${t.vol_ratio == null ? "–" : fmt(t.vol_ratio, 1) + "×"}</td><td class="num ${cls(t.rel_3m)}">${pct(t.rel_3m)}</td>
        <td class="num ${t.macd_state === "bull" ? "up" : t.macd_state === "bear" ? "down" : ""}">${t.macd_state ? (t.macd_state === "bull" ? "▲" : "▼") : "–"}</td><td class="num">${t.to_support_pct == null ? "–" : pct(t.to_support_pct)}</td>` : ""}</tr>`).join("")}
    </tbody></table></div><div class="bd" style="padding-top:8px"><button class="sy" data-smore>${more ? "− Fewer columns" : "+ More columns (industry, volume, MACD, support…)"}</button></div></div>`}
  ${rows.length > shown.length ? `<div style="text-align:center;margin-top:14px"><button class="btn" data-slimit>Show ${Math.min(60, rows.length - shown.length)} more of ${rows.length - shown.length}</button></div>` : ""}
  <div class="muted" style="font-size:12.5px;margin-top:12px">RSI above 70 means a stock has run up fast; below 30 means it has fallen fast. RS (relative strength, 1–99) compares a stock's past year with the other stocks: 80+ is a leader. For information only, not investment advice.</div></div>`;
}

// ---------- INDICES ----------
const IDX_KW = {
  nifty50: /\bNifty ?50\b|\bNifty\b(?! ?(Bank|IT|Auto|Pharma|FMCG|Metal|Realty|Energy|Media|PSU|Midcap|Smallcap|Next|Financial|Infra))/i, sensex: /\bSensex\b/i,
  next50: /Nifty Next 50/i, midcap: /mid-?caps?\b/i, smallcap: /small-?caps?\b/i, bank: /Bank Nifty|Nifty Bank|bank(ing)? (stocks|shares|index)|lenders?\b/i,
  fin: /Nifty Financial|NBFCs?\b|financial (stocks|services)|insurers?\b/i, psubank: /PSU banks?|public sector banks?|\bPSBs?\b/i,
  it: /Nifty IT|\bIT (stocks|shares|sector|index|majors|services)|tech stocks|software exporters/i, auto: /Nifty Auto|auto (stocks|shares|sales|sector)|automakers?|carmakers?|two-wheelers?/i,
  pharma: /Nifty Pharma|pharma|drugmakers?|USFDA|healthcare stocks/i, fmcg: /\bFMCG\b|consumer staples/i, metal: /Nifty Metal|metal (stocks|shares|prices)|\bsteel\b|aluminium|copper/i,
  energy: /Nifty Energy|crude|oil prices|\bOMCs?\b|power (stocks|demand)|energy stocks/i, realty: /\brealty\b|real estate|housing sales/i,
  infra: /infrastructure|\binfra\b|capex/i, media: /Nifty Media|media stocks|\bOTT\b|broadcasters?/i, vix: /India VIX|\bVIX\b|volatility index/i,
};
const IDX = () => D.indices || [];
const idxById = id => IDX().find(x => x.id === id);
const idxData = {};
async function loadIdx(id) {
  if (idxData[id]) return idxData[id];
  if (window.__DP_INDICES__?.[id]) return (idxData[id] = window.__DP_INDICES__[id]);
  const r = await fetch(`data/indices/${id}.json?t=${D.generated_at}`); if (!r.ok) throw new Error(r.status);
  return (idxData[id] = await r.json());
}
function idxNews(x) {
  const kw = IDX_KW[x.id], mem = new Set(x.members || []), seen = new Set(), out = [];
  for (const n of D.news) { if ((kw && kw.test(n.title)) || n.symbols.some(s => mem.has(s))) { if (!seen.has(n.id)) { seen.add(n.id); out.push(n); } } }
  return out;
}
const PULSE_IDX = { "NIFTY 50": "nifty50", "NIFTY BANK": "bank", "SENSEX": "sensex", "INDIA VIX": "vix" };
function indicesView() {
  const list = IDX();
  if (!list.length) return `<div class="fade"><h1 class="page">Indices</h1><div class="card"><div class="empty"><b>Index charts arrive with the next update</b>The data refreshes every 15 minutes during market hours.</div></div></div>`;
  const groups = [...new Set(list.map(x => x.group))];
  const row = x => { const vix = x.id === "vix", c = vix ? -x.change_pct : x.change_pct;
    return `<button class="row irow${sel === x.id ? " on" : ""}" data-isel="${x.id}"><div><div class="s">${esc(x.name)}</div><div class="n2">${x.members?.length ? `${x.members.length} tracked stocks` : vix ? "expected volatility" : "&nbsp;"}</div></div>
      ${sparkSvg(x.spark, vix ? (x.change_pct ?? 0) <= 0 : (x.change_pct ?? 0) >= 0)}<div class="p">${fmt(x.last, x.last >= 1000 ? 0 : 2)}<small class="${cls(c)}">${pct(x.change_pct)}</small></div></button>`; };
  let master = `<button class="row irow cmp${sel === "compare" || !sel ? " on" : ""}" data-isel="compare"><div><div class="s">Compare indices</div><div class="n2">Which index is leading? All on one chart</div></div><span></span><div class="p" style="font-size:18px">⇄</div></button>`;
  for (const g of groups) master += `<div class="grp">${esc(g)}</div>` + list.filter(x => x.group === g).map(row).join("");
  const detail = !sel || sel === "compare" ? compareDetail() : indexDetail(sel);
  return `<div class="md${sel ? " detail-open" : ""}">
    <section class="card master" aria-label="Indices"><div class="tools"><b style="font-family:var(--display);font-size:17px">Indices</b><span class="muted" style="font-size:12.5px">Live-ish: refreshed every 15 min in market hours</span></div><div class="list">${master}</div></section>
    <section class="card detail fade" id="detail">${detail}</section></div>`;
}
function indexDetail(id) {
  const x = idxById(id); if (!x) return `<div class="empty"><b>Index not found</b></div>`;
  const t = x.tech || {}, vix = id === "vix", mem = (x.members || []).map(s => S[s]).filter(Boolean);
  const up = mem.filter(s => s.change_pct > 0).length, dn = mem.filter(s => s.change_pct < 0).length;
  const news = idxNews(x).slice(0, 30);
  const sorted = [...mem].sort((a, b) => (b.change_pct ?? -99) - (a.change_pct ?? -99));
  const range = ui.irange;
  const stat = (l, v) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  const vsMa = ma => ma == null ? "–" : `${fmt(ma, 0)} <span class="${t.price > ma || x.last > ma ? "up" : "down"}" style="font-size:11px">${x.last > ma ? "above" : "below"}</span>`;
  return `<div class="head"><button class="btn sm back" data-back-idx>← All indices</button>
      <div><h2>${esc(x.name)} <span class="badge ${t.trend?.includes("up") ? "bullish" : t.trend === "Downtrend" || t.trend === "Weak" ? "bearish" : "neutral"}">${esc(t.trend || "–")}</span></h2><div class="co">${esc(x.group)}${x.pe ? ` · P/E ${fmt(x.pe, 1)}` : ""}${x.members_source ? ` · members: ${esc(x.members_source)}` : ""}</div></div>
      <div class="px"><div class="v">${fmt(x.last, 2)}</div><div class="num ${cls(vix ? -x.change_pct : x.change_pct)}" style="font-weight:700">${x.change != null ? (x.change >= 0 ? "+" : "−") + fmt(Math.abs(x.change), 2) + " " : ""}(${pct(x.change_pct)})</div></div>
    </div>
    <div class="sect"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><h3 style="margin:0">Chart</h3>
      <div class="seg">${[["1d", "1D"], ["21", "1M"], ["63", "3M"], ["126", "6M"], ["252", "1Y"], ["5y", "5Y"]].map(([k, l]) => `<button data-irange="${k}" class="${range === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="legend" id="ilegend"></div><div class="chart" id="ichart"><div class="skeleton" style="height:260px"></div></div></div>
    <div class="sect"><h3>Key numbers</h3><div class="stats">
      ${stat("1 week", `<span class="${cls(t.ret_1w)}">${pct(t.ret_1w)}</span>`)}${stat("1 month", `<span class="${cls(t.ret_1m)}">${pct(t.ret_1m)}</span>`)}${stat("3 months", `<span class="${cls(t.ret_3m)}">${pct(t.ret_3m)}</span>`)}${stat("1 year", `<span class="${cls(t.ret_1y)}">${pct(t.ret_1y)}</span>`)}
      ${stat("3 years", `<span class="${cls(t.ret_3y)}">${pct(t.ret_3y)}</span>`)}${stat("5 years", `<span class="${cls(t.ret_5y)}">${pct(t.ret_5y)}</span>`)}${stat("RSI (14)", fmt(t.rsi14, 0) + (t.rsi14 > 70 ? " · overbought" : t.rsi14 < 30 ? " · oversold" : ""))}${stat("MACD", t.macd_state ? `<span class="${t.macd_state === "bull" ? "up" : "down"}">${t.macd_state === "bull" ? "▲ bullish" : "▼ bearish"}</span>${t.macd_cross ? " · new" : ""}` : "–")}
      ${stat("50-day avg", vsMa(t.sma50))}${stat("200-day avg", vsMa(t.sma200))}${stat("52W high", fmt(t.high52, 0) + ` <span class="muted" style="font-size:11px">${pct(t.from_high_pct)}</span>`)}${stat("52W low", fmt(t.low52, 0))}
      ${stat("Support", t.support ? fmt(t.support, 0) : "–")}${stat("Resistance", t.resistance ? fmt(t.resistance, 0) : "none nearby")}${stat("Advances / declines", x.nse_adv != null ? `<span class="up">${x.nse_adv}</span> / <span class="down">${x.nse_dec}</span>` : mem.length ? `<span class="up">${up}</span> / <span class="down">${dn}</span>` : "–")}${stat("Golden / death cross", t.golden_cross ? '<span class="up">golden cross</span>' : t.death_cross ? '<span class="down">death cross</span>' : "none recently")}
    </div></div>
    ${mem.length ? `<div class="sect"><h3>Stocks in ${esc(x.name)} · ${mem.length}${x.members_total ? ` of ${x.members_total} tracked` : ""}</h3>
      <div class="breadth"><i class="u" style="width:0" data-w="${mem.length ? up / mem.length * 100 : 0}%"></i><i class="d" style="width:0" data-w="${mem.length ? dn / mem.length * 100 : 0}%"></i></div>
      <div class="muted" style="font-size:12.5px;margin:4px 0 10px">${up} up · ${dn} down today${mem.length - up - dn ? ` · ${mem.length - up - dn} flat` : ""}</div>
      <div class="smap">${sorted.map(s => `<button class="st" data-go="${esc(s.symbol)}" style="${heat(s.change_pct)}" title="${esc(s.name)}"><b>${esc(s.symbol)}</b><span>${pct(s.change_pct)}</span>${s.news_ids.length ? `<em class="nb" title="${s.news_ids.length} news">${s.news_ids.length}</em>` : ""}</button>`).join("")}</div>
      <div class="tblwrap" style="max-height:420px;margin-top:12px"><table class="tbl"><thead><tr><th class="l">Stock</th><th>Price</th><th>Day</th><th>1M</th><th class="l">Signal</th><th class="l">Latest news</th></tr></thead><tbody>
      ${sorted.map(s => { const n = NEWS[s.news_ids[0]]; return `<tr data-go="${esc(s.symbol)}"><td class="l"><span class="sym">${esc(s.symbol)}</span></td><td class="num">${px(s.price)}</td><td class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</td><td class="num ${cls(s.tech?.ret_1m)}">${pct(s.tech?.ret_1m)}</td><td class="l"><span class="badge ${s.insight.signal}">${esc(s.insight.label)}</span></td><td class="l hlc">${n ? `<span class="tdot ${n.tone}"></span>${esc(n.title.slice(0, 80))}${n.title.length > 80 ? "…" : ""} <span class="muted">${ago(n.published)}</span>` : '<span class="muted">–</span>'}</td></tr>`; }).join("")}
      </tbody></table></div></div>` : ""}
    <div class="sect" id="iothers"></div>
    <div class="sect"><h3>News for ${esc(x.name)} · ${news.length}</h3><p class="muted" style="font-size:12.5px;margin:-4px 0 8px">Headlines about the index itself or any of its stocks.</p>${news.map(newsItem).join("") || '<div class="muted">No recent headlines.</div>'}</div>`;
}
function compareDetail() {
  const pickable = IDX().filter(x => x.id !== "vix" && !x.nochart);
  ui.icmp = ui.icmp.filter(id => pickable.some(x => x.id === id));
  if (!ui.icmp.length) ui.icmp = ["nifty50", "bank", "it", "midcap", "smallcap"].filter(id => idxById(id));
  const range = ui.crange;
  const rows = pickable.map(x => ({ x, r: range === "21" ? x.tech.ret_1m : range === "63" ? x.tech.ret_3m : range === "126" ? x.tech.ret_6m : range === "252" ? x.tech.ret_1y : x.tech.ret_5y })).sort((a, b) => (b.r ?? -1e9) - (a.r ?? -1e9));
  const mx = Math.max(1, ...rows.map(r => Math.abs(r.r || 0)));
  return `<div class="head"><div><h2>Compare indices</h2><div class="co">Each line starts at 0% so you can see which index has done best. Pick up to 6.</div></div></div>
    <div class="sect"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px"><div class="ctrls" style="margin:0">${pickable.map((x, i) => { const on = ui.icmp.includes(x.id), ci = ui.icmp.indexOf(x.id); return `<button class="tog${on ? " on" : ""}" data-icmp="${x.id}"${on ? ` style="border-color:${CMP_COL[ci]};color:${CMP_COL[ci]};background:transparent"` : ""}>${on ? "● " : ""}${esc(x.id === "nifty50" ? "Nifty 50" : x.name.replace(/^Nifty /, ""))}</button>`; }).join("")}</div>
      <div class="seg">${[["21", "1M"], ["63", "3M"], ["126", "6M"], ["252", "1Y"], ["5y", "5Y"]].map(([k, l]) => `<button data-crange="${k}" class="${range === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="chart" id="cchart"><div class="skeleton" style="height:300px"></div></div></div>
    <div class="sect"><h3>Performance ranking · ${{ 21: "1 month", 63: "3 months", 126: "6 months", 252: "1 year", "5y": "5 years" }[range]}</h3>
      ${rows.map(({ x, r }) => `<button class="mv" data-isel="${x.id}"><span><b>${esc(x.name)}</b></span><span class="rk"><span class="rkbar"><i style="width:0;${r >= 0 ? "left:50%" : ""};background:${r >= 0 ? "var(--up)" : "var(--down)"}" data-w="${Math.abs(r || 0) / mx * 50}%" ${r < 0 ? `data-l="${50 - Math.abs(r) / mx * 50}%"` : ""}></i></span><b class="num ${cls(r)}">${pct(r)}</b></span></button>`).join("")}
    </div>
    <div class="sect"><h3>Today</h3><div class="heat">${IDX().map(x => `<button class="tile" data-isel="${x.id}" style="${heat(x.id === "vix" ? -x.change_pct : x.change_pct)}"><b>${esc(x.name)}</b><div class="v">${pct(x.change_pct)}</div><div class="m">${fmt(x.last, x.last >= 1000 ? 0 : 2)}</div></button>`).join("")}</div></div>`;
}
const CMP_COL = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--peacock)"];
function svgHover(svg, W, L, R, n, x, tipHtml) {
  const tip = svg.parentElement.querySelector(".tip"), xh = svg.querySelector(".xh");
  const move = cx => { const b = svg.getBoundingClientRect(), sx = (cx - b.left) / b.width * W, i = Math.max(0, Math.min(n - 1, Math.round((sx - L) / (W - L - R) * (n - 1))));
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible"); tip.hidden = false; tip.innerHTML = tipHtml(i);
    const lx = x(i) / W * b.width; tip.style.left = (lx > b.width - 190 ? lx - 180 : lx + 12) + "px"; tip.style.top = "6px"; };
  svg.onmousemove = e => move(e.clientX); svg.ontouchmove = e => move(e.touches[0].clientX);
  svg.onmouseleave = () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); };
}
async function drawIndexChart(id) {
  const box = $("#ichart"); if (!box) return;
  if (idxById(id)?.nochart) { box.innerHTML = '<div class="empty" style="padding:30px"><b>Chart not available in this update</b>The live value above is from NSE. The chart usually returns with the next refresh.</div>'; $("#ilegend").innerHTML = ""; return; }
  let d; try { d = await loadIdx(id); } catch { box.innerHTML = '<div class="muted">Chart unavailable.</div>'; return; }
  if (!$("#ichart") || sel !== id) return;
  const x0 = idxById(id), vix = id === "vix", range = ui.irange, intra = range === "1d";
  let pts;
  if (intra) { if (!d.intraday || d.intraday.pts.length < 2) { box.innerHTML = '<div class="empty" style="padding:30px"><b>No intraday data right now</b>Today\'s line appears once the market opens. Try 1M.</div>'; $("#ilegend").innerHTML = ""; return; } pts = d.intraday.pts.map(([t, c]) => ({ t: t * 1000, c })); }
  else if (range === "5y") pts = d.weekly.map(([t, c]) => ({ t: t * 1000, c }));
  else pts = d.daily.slice(-(+range)).map(([t, c, a, b]) => ({ t: t * 1000, c, s50: a, s200: b }));
  const prev = intra ? d.intraday.prev : null, W = 720, H = 280, L = 8, R = 62, T = 12, B = 24;
  const showMa = !intra && range !== "5y";
  const vals = pts.flatMap(p => [p.c, showMa ? p.s50 : null, showMa ? p.s200 : null]).filter(v => v != null); if (prev) vals.push(prev);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pd = (hi - lo) * 0.08 || 1; lo -= pd; hi += pd;
  const n = pts.length, x = i => L + i / (n - 1) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = k => { let s = "", on = false; pts.forEach((p, i) => { if (p[k] == null) { on = false; return; } s += (on ? "L" : "M") + x(i).toFixed(1) + " " + y(p[k]).toFixed(1); on = true; }); return s; };
  const last = pts[n - 1], base = prev ?? pts[0].c, chg = (last.c / base - 1) * 100, good = vix ? chg <= 0 : chg >= 0, col = good ? "var(--up)" : "var(--down)";
  const tf = t => intra ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(range === "5y" || +range > 130 ? { year: "2-digit" } : {}) });
  const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * (i + 0.5) / 4);
  $("#ilegend").innerHTML = `<span><i style="background:${col}"></i>${esc(x0.name)}</span>` + (showMa ? `<span><i style="background:var(--s2)"></i>50-day avg</span><span><i style="background:var(--s3)"></i>200-day avg</span>` : "") + (prev ? `<span><i style="background:var(--muted)"></i>Previous close ${fmt(prev, 2)}</span>` : "");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:270px" role="img" aria-label="${esc(x0.name)} chart">
    <defs><linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(g => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)"/><text x="${W - R + 7}" y="${y(g) + 4}" font-size="10.5" fill="var(--muted)">${fmt(g, g > 1000 ? 0 : 1)}</text>`).join("")}
    ${[0, Math.floor(n / 2), n - 1].map(i => `<text x="${x(i)}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${tf(pts[i].t)}</text>`).join("")}
    ${prev ? `<line x1="${L}" x2="${W - R}" y1="${y(prev)}" y2="${y(prev)}" stroke="var(--muted)" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ""}
    <path d="${line("c")}L${x(n - 1)} ${H - B}L${x(0)} ${H - B}Z" fill="url(#gi)"/>
    ${showMa ? `<path d="${line("s200")}" fill="none" stroke="var(--s3)" stroke-width="1.8" vector-effect="non-scaling-stroke"/><path d="${line("s50")}" fill="none" stroke="var(--s2)" stroke-width="1.8" vector-effect="non-scaling-stroke"/>` : ""}
    <path d="${line("c")}" fill="none" stroke="${col}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(n - 1)}" cy="${y(last.c)}" r="4" fill="${col}" stroke="var(--card)" stroke-width="2"/>
    <line class="xh" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
  </svg><div class="tip" hidden></div>
  <div class="muted" style="font-size:12.5px;margin-top:6px">${intra ? "Today vs previous close" : "Over this period"}: <b class="num ${good ? "up" : "down"}">${pct(chg)}</b> · ${fmt(last.c, 2)}${intra ? ` · as of ${tf(last.t)} IST` : ""}</div>`;
  svgHover($("#ichart svg"), W, L, R, n, x, i => { const p = pts[i]; return `<b>${intra ? tf(p.t) + " IST" : new Date(p.t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</b><br>${fmt(p.c, 2)} <span class="${cls((p.c / base - 1) * (vix ? -1 : 1))}">${pct((p.c / base - 1) * 100)}</span>${showMa && p.s50 ? `<br><span style="color:var(--s2)">■</span> 50-day ${fmt(p.s50, 0)}` : ""}${showMa && p.s200 ? `<br><span style="color:var(--s3)">■</span> 200-day ${fmt(p.s200, 0)}` : ""}`; });
  // members of the index we don't track
  const oth = d.others || [], ob = $("#iothers");
  if (ob) ob.innerHTML = oth.length ? `<h3>Also in ${esc(x0.name)} (not tracked here)</h3><div class="others">${oth.map(s => `<a href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(s)}" target="_blank" rel="noopener">${esc(s)} ↗</a>`).join("")}</div>` : "";
}
async function drawCompare() {
  const box = $("#cchart"); if (!box) return;
  const ids = ui.icmp.slice(0, 6), range = ui.crange;
  let ds; try { ds = await Promise.all(ids.map(loadIdx)); } catch { box.innerHTML = '<div class="muted">Chart unavailable.</div>'; return; }
  if (!$("#cchart")) return;
  const series = ids.map((id, k) => { const d = ds[k]; const raw = range === "5y" ? d.weekly : d.daily.slice(-(+range)); const b = raw[0][1]; return { id, name: idxById(id).name, col: CMP_COL[k], pts: raw.map(([t, c]) => [t * 1000, (c / b - 1) * 100]) }; });
  const ref = series.reduce((a, s) => s.pts.length > a.pts.length ? s : a, series[0]);
  const W = 720, H = 300, L = 8, R = 62, T = 12, B = 24, n = ref.pts.length;
  const vals = series.flatMap(s => s.pts.map(p => p[1])); let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const pd = (hi - lo) * 0.08 || 1; lo -= pd; hi += pd;
  const t0 = ref.pts[0][0], t1 = ref.pts[n - 1][0], xt = t => L + (t - t0) / (t1 - t0 || 1) * (W - L - R), x = i => xt(ref.pts[i][0]), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * (i + 0.5) / 4);
  const tf = t => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(range === "5y" || +range > 130 ? { year: "2-digit" } : {}) });
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:290px" role="img" aria-label="Index comparison">
    ${ticks.map(g => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)"/><text x="${W - R + 7}" y="${y(g) + 4}" font-size="10.5" fill="var(--muted)">${g > 0 ? "+" : ""}${fmt(g, 0)}%</text>`).join("")}
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line2)" stroke-width="1.5"/>
    ${[0, Math.floor(n / 2), n - 1].map(i => `<text x="${x(i)}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${tf(ref.pts[i][0])}</text>`).join("")}
    ${series.map(s => `<path d="${s.pts.map((p, i) => (i ? "L" : "M") + xt(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join("")}" fill="none" stroke="${s.col}" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${xt(s.pts.at(-1)[0])}" cy="${y(s.pts.at(-1)[1])}" r="3.5" fill="${s.col}" stroke="var(--card)" stroke-width="2"/>`).join("")}
    <line class="xh" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
  </svg><div class="tip" hidden></div>
  <div class="legend" style="margin-top:6px">${series.map(s => `<span><i style="background:${s.col}"></i>${esc(s.name)} <b class="num ${cls(s.pts.at(-1)[1])}">${pct(s.pts.at(-1)[1])}</b></span>`).join("")}</div>`;
  svgHover($("#cchart svg"), W, L, R, n, x, i => { const t = ref.pts[i][0]; return `<b>${new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</b>` + series.map(s => { let best = s.pts[0]; for (const p of s.pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; return `<br><span style="color:${s.col}">■</span> ${esc(s.name)} <b class="${cls(best[1])}">${pct(best[1])}</b>`; }).join(""); });
}

// ---------- NEWS POP-UPS ----------
let flashLog = store.get("dp-flashlog", []), flashUnread = 0;
const popPref = () => store.get("dp-pop", "all");
function newsFlash(first) {
  const pref = popPref(); if (!D) return;
  const seen = new Set(store.get("dp-popseen", []));
  const firstEver = !seen.size;
  const stockNewsList = D.news.filter(n => n.symbols.length && S[n.symbols[0]]);
  let fresh = stockNewsList.filter(n => !seen.has(n.id));
  if (firstEver) fresh = fresh.filter(n => Date.now() - Date.parse(n.published) < 60 * 60e3);
  if (pref === "mine") fresh = fresh.filter(n => n.symbols.some(isMine));
  fresh.sort((a, b) => b.published.localeCompare(a.published));
  store.set("dp-popseen", D.news.map(n => n.id).concat([...seen]).slice(0, 4000));
  if (pref === "off" || !fresh.length) return;
  const showN = first ? 3 : 4, show = fresh.slice(0, showN).reverse();
  flashLog = fresh.slice(0, 60).map(n => ({ id: n.id, at: Date.now() })).concat(flashLog.filter(f => !fresh.some(n => n.id === f.id))).slice(0, 60);
  store.set("dp-flashlog", flashLog);
  flashUnread += fresh.length; updateBell();
  show.forEach((n, i) => setTimeout(() => flashCard(n), i * 650));
  if (fresh.length > showN) setTimeout(() => flashMore(fresh.length - showN), show.length * 650);
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    const n = fresh[0], s = S[n.symbols[0]];
    try { new Notification(`${n.symbols.slice(0, 2).join(", ")} ${s ? pct(s.change_pct) : ""}`, { body: n.title, tag: n.id }); } catch {}
  }
}
function flashCard(n) {
  const box = $("#flash"); if (!box) return;
  const sym = n.symbols[0], s = S[sym] || {};
  const el = document.createElement("div");
  el.className = "fcard " + n.tone; el.setAttribute("role", "status");
  el.innerHTML = `<button class="fx" aria-label="Dismiss">✕</button>
    <div class="ft"><span class="fsym">${esc(sym)}</span>${n.symbols.slice(1, 3).map(x => `<span class="fsym sm">${esc(x)}</span>`).join("")}<span class="num">${px(s.price)}</span><b class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</b><span class="fnew">NEW</span></div>
    <div class="fh">${esc(n.title)}</div>
    <div class="fm"><span class="tdot ${n.tone}"></span>${n.tone === "positive" ? "positive tone" : n.tone === "negative" ? "negative tone" : "neutral tone"} · ${n.official ? "🏛 NSE filing" : esc(n.source)}${n.first_by_min >= 1 ? " ⚡ first" : ""} · ${ago(n.published)}<span class="fopen">Open ${esc(sym)} ›</span></div>
    <i class="fbar"></i>`;
  let timer = null, left = 14000, started = Date.now();
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 350); };
  const arm = () => { started = Date.now(); timer = setTimeout(close, left); el.querySelector(".fbar").style.animationPlayState = "running"; };
  el.onmouseenter = () => { clearTimeout(timer); left -= Date.now() - started; el.querySelector(".fbar").style.animationPlayState = "paused"; };
  el.onmouseleave = arm;
  el.onclick = e => { if (e.target.closest(".fx")) { close(); return; } close(); go(sym); };
  box.append(el); while (box.children.length > 5) box.firstElementChild.remove();
  arm();
}
function flashMore(k) {
  const box = $("#flash"); if (!box) return;
  const el = document.createElement("button"); el.className = "fmore"; el.textContent = `+ ${k} more stock headlines · open the news feed`;
  el.onclick = () => { el.remove(); openDrawer(); }; box.append(el); setTimeout(() => el.remove(), 15000);
}
function updateBell() { const b = $("#bellN"); if (!b) return; b.hidden = !flashUnread; b.textContent = flashUnread > 99 ? "99+" : flashUnread; }
function openDrawer() {
  flashUnread = 0; updateBell();
  const dr = $("#drawer"), pref = popPref();
  const items = flashLog.map(f => NEWS[f.id]).filter(Boolean);
  const latest = items.length ? items : D.news.filter(n => n.symbols.length).slice(0, 30);
  dr.innerHTML = `<div class="dh"><b>News flashes</b><button class="iconbtn" data-dclose aria-label="Close">✕</button></div>
    <div class="dset"><span class="muted">Pop-ups for</span><div class="seg">${[["all", "All stocks"], ["mine", "My stocks"], ["off", "Off"]].map(([k, l]) => `<button data-pop="${k}" class="${pref === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${"Notification" in window && Notification.permission !== "denied" && !SNAPSHOT ? `<button class="sy" id="notif2">${Notification.permission === "granted" ? "✓ Desktop alerts on" : "Also alert me when this tab is in the background"}</button>` : ""}</div>
    ${(D.news_speed || []).length ? `<div class="dspeed"><b>Who breaks stories first</b> <span class="muted">(stories carried by 2+ sites, last 3 days)</span><div>${D.news_speed.slice(0, 8).map((w, i) => `<span class="${i === 0 ? "top" : ""}">${esc(w.publisher)} <b>${w.first}</b>${w.avg_lead_min ? `<em>~${w.avg_lead_min} min ahead</em>` : ""}</span>`).join("")}</div></div>` : ""}
    <div class="dl">${latest.map(n => { const s = S[n.symbols[0]] || {}; return `<button class="di" data-go="${esc(n.symbols[0])}"><div class="ft"><span class="fsym">${esc(n.symbols[0])}</span><b class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</b><span class="muted" style="margin-left:auto;font-size:12px">${ago(n.published)}</span></div><div class="fh"><span class="tdot ${n.tone}"></span>${esc(n.title)}</div></button>`; }).join("") || '<div class="muted" style="padding:16px">No stock headlines yet.</div>'}</div>`;
  dr.hidden = false; requestAnimationFrame(() => dr.classList.add("open"));
}
function closeDrawer() { const dr = $("#drawer"); dr.classList.remove("open"); setTimeout(() => { dr.hidden = true; }, 250); }

// ---------- F&O ----------
const BU = { "Long build-up": ["bullish", "Price ↑ OI ↑", "Fresh buying: new long positions are being added."], "Short covering": ["watch", "Price ↑ OI ↓", "Shorts are closing positions, which pushes the price up."],
  "Short build-up": ["bearish", "Price ↓ OI ↑", "Fresh selling: new short positions are being added."], "Long unwinding": ["neutral", "Price ↓ OI ↓", "Longs are exiting, so the price drifts lower."] };
const trending = s => { const t = s.tech; if (!t) return false; return (t.above_50 && t.above_200) || (t.ret_1m > 3 && t.macd_state === "bull") || (t.rs_rating >= 70 && t.above_50); };
function foScore(s) { const t = s.tech || {}; return (s.insight.news_score || 0) * 0.5 + (s.insight.tech_score || 0) * 0.35 + ((t.rs_rating ?? 50) - 50) * 0.4 + (s.fo?.buildup === "Long build-up" ? 12 : s.fo?.buildup === "Short covering" ? 6 : 0) + Math.min(10, Math.max(-10, s.change_pct || 0)); }
function fnoView() {
  const fo = D.stocks.filter(s => s.fo);
  if (!fo.length) return `<div class="fade"><h1 class="page">F&O stocks</h1><div class="card"><div class="empty"><b>F&O data arrives with the next update</b>It refreshes every 15 minutes during market hours.</div></div></div>`;
  const hot = fo.filter(s => trending(s) && s.news_ids.length && s.insight.news_score > 15 && s.fo.buildup !== "Short build-up" && s.fo.buildup !== "Long unwinding").sort((a, b) => foScore(b) - foScore(a));
  const cnt = k => fo.filter(s => s.fo.buildup === k).length;
  const q = ui.fq.trim().toLowerCase(), f = ui.ff;
  const rows = fo.filter(s => (f === "all" || (f === "hot" ? hot.includes(s) : f === "trend" ? trending(s) : s.fo.buildup === f)) && (!q || s.symbol.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q)))
    .sort((a, b) => { const k = ui.fsort.k, v = x => k === "symbol" ? x.symbol : k === "oi" ? x.fo.oi_chg_pct : k === "score" ? foScore(x) : k === "news" ? x.insight.news_score ?? -999 : k === "change_pct" ? x.change_pct : k === "turnover" ? x.turnover_cr : x.tech?.[k];
      const A = v(a), B = v(b); return (typeof A === "string" ? A.localeCompare(B) : ((A ?? -1e9) - (B ?? -1e9))) * ui.fsort.d; });
  const th = (k, l, left) => `<th class="${left ? "l" : ""}"><button data-fsort="${k}">${l}${ui.fsort.k === k ? (ui.fsort.d > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  const buList = k => { const l = fo.filter(s => s.fo.buildup === k).sort((a, b) => Math.abs(b.fo.oi_chg_pct || 0) - Math.abs(a.fo.oi_chg_pct || 0)).slice(0, 8);
    return `<div class="card bu"><div class="hd"><h2><span class="badge ${BU[k][0]}">${k}</span></h2><span class="muted" style="font-size:12px">${BU[k][1]} · ${cnt(k)}</span></div><div class="bd" style="padding-top:2px"><p class="muted" style="font-size:12.5px;margin:6px 0">${BU[k][2]}</p>
      ${l.map(s => `<button class="mv" data-go="${esc(s.symbol)}"><span><b>${esc(s.symbol)}</b> ${s.news_ids.length ? `<span class="tdot ${s.insight.news_score > 15 ? "positive" : s.insight.news_score < -15 ? "negative" : "neutral"}" title="news"></span>` : ""}</span><span class="num"><b class="${cls(s.change_pct)}">${pct(s.change_pct)}</b> <span class="muted">OI</span> <b class="${cls(s.fo.oi_chg_pct)}">${pct(s.fo.oi_chg_pct)}</b></span></button>`).join("") || '<div class="muted">None today.</div>'}</div></div>`; };
  return `<div class="fade"><h1 class="page">F&O stocks</h1><p class="sub">All ${fo.length} stocks in the futures & options segment: which are trending with good news, and where traders are building positions (open interest, from NSE${fo[0].fo.date ? ", " + esc(fo[0].fo.date) : ""}).</p>
  <div class="kpis"><div class="card kpi"><div class="l">Trending + positive news</div><div class="v up">${hot.length}</div></div><div class="card kpi"><div class="l">Long build-up</div><div class="v up">${cnt("Long build-up")}</div></div>
    <div class="card kpi"><div class="l">Short build-up</div><div class="v down">${cnt("Short build-up")}</div></div><div class="card kpi"><div class="l">Short covering / long unwinding</div><div class="v">${cnt("Short covering")} / ${cnt("Long unwinding")}</div></div></div>
  <div class="card"><div class="hd"><h2>🔥 Trending with positive news</h2><span class="muted" style="font-size:12.5px">uptrend or strong momentum, and recent headlines lean positive</span></div><div class="bd">
    ${hot.length ? `<div class="hotfo">${hot.slice(0, 12).map(s => { const t = s.tech || {}, n = stockNews(s.symbol).find(x => x.tone === "positive") || stockNews(s.symbol)[0];
      return `<button class="fcardx" data-go="${esc(s.symbol)}"><div class="ft"><span class="fsym">${esc(s.symbol)}</span>${s.nifty50 ? '<span class="badge n50">N50</span>' : ""}<span class="num" style="margin-left:auto">${px(s.price)}</span><b class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</b></div>
        <div class="chips2"><span class="badge ${s.insight.signal}">${esc(s.insight.label)}</span>${s.fo.buildup ? `<span class="badge ${BU[s.fo.buildup][0]}" title="${esc(BU[s.fo.buildup][2])}">${esc(s.fo.buildup)}</span>` : ""}<span class="badge neutral">${esc(t.trend || "")}</span></div>
        <div class="fh"><span class="tdot ${n?.tone || "neutral"}"></span>${esc(n?.title || "")}</div>
        <div class="fm"><span>1M <b class="num ${cls(t.ret_1m)}">${pct(t.ret_1m)}</b></span><span>RS <b class="num">${t.rs_rating ?? "–"}</b></span><span>OI <b class="num ${cls(s.fo.oi_chg_pct)}">${pct(s.fo.oi_chg_pct)}</b></span><span>${s.news_ids.length} news · ${n ? ago(n.published) : ""}</span></div></button>`; }).join("")}</div>`
    : '<div class="empty"><b>No F&O stock is both trending and in positive news right now</b>Check back after the next update, or see the build-up lists below.</div>'}</div></div>
  <div class="grid g4" style="margin-top:16px">${Object.keys(BU).map(buList).join("")}</div>
  <div class="card" style="margin-top:16px"><div class="hd"><input class="field" id="fq" placeholder="Filter F&O stocks" value="${esc(ui.fq)}" style="flex:1;min-width:160px" aria-label="Filter F&O stocks">
    <div class="chips">${[["all", "All"], ["hot", "🔥 Trending + good news"], ["trend", "Trending"], ...Object.keys(BU).map(k => [k, k])].map(([k, l]) => `<button class="chip${ui.ff === k ? " on" : ""}" data-ff="${esc(k)}">${esc(l)}</button>`).join("")}</div><span class="muted num">${rows.length}</span></div>
  <div class="tblwrap"><table class="tbl"><thead><tr>${th("symbol", "Stock", 1)}${th("price", "Price")}${th("change_pct", "Day")}${th("oi", "OI change")}<th class="l">Build-up</th><th class="l">Trend</th>${th("rs_rating", "RS")}${th("ret_1m", "1M")}${th("news", "News tone")}${th("turnover", "Turnover ₹cr")}${th("score", "Score")}</tr></thead><tbody>
  ${rows.map(s => { const t = s.tech || {}; return `<tr data-go="${esc(s.symbol)}"><td class="l"><span class="sym">${esc(s.symbol)}</span> ${s.nifty50 ? '<span class="badge n50">N50</span>' : ""}</td><td class="num">${px(s.price)}</td><td class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</td>
    <td class="num ${cls(s.fo.oi_chg_pct)}">${pct(s.fo.oi_chg_pct)}</td><td class="l">${s.fo.buildup ? `<span class="badge ${BU[s.fo.buildup][0]}">${esc(s.fo.buildup)}</span>` : "–"}</td><td class="l muted">${esc(t.trend || "–")}</td>
    <td class="num ${t.rs_rating >= 70 ? "up" : t.rs_rating <= 30 ? "down" : ""}">${t.rs_rating ?? "–"}</td><td class="num ${cls(t.ret_1m)}">${pct(t.ret_1m)}</td>
    <td class="num ${cls(s.insight.news_score)}">${s.news_ids.length ? (s.insight.news_score > 0 ? "+" : "") + s.insight.news_score + ` <small class="muted">(${s.news_ids.length})</small>` : "–"}</td><td class="num">${s.turnover_cr == null ? "–" : fmt(s.turnover_cr, 0)}</td><td class="num">${Math.round(foScore(s))}</td></tr>`; }).join("")}
  </tbody></table></div></div>
  <div class="muted" style="font-size:12.5px;margin-top:10px">Open interest (OI) is the number of open futures & options contracts. Rising OI with a rising price usually means fresh buying; rising OI with a falling price usually means fresh selling. The score blends news tone, chart strength, relative strength, OI build-up and today's move. This is for information, not a trading call. F&O trading is high-risk.</div></div>`;
}

// ---------- TRENDING BUBBLES (by market) ----------
const BMKTS = [["fo", "F&O"], ["nifty50", "Nifty 50"], ["next50", "Next 50"], ["bank", "Bank"], ["it", "IT"], ["auto", "Auto"], ["pharma", "Pharma"], ["fmcg", "FMCG"], ["metal", "Metal"], ["energy", "Energy"], ["realty", "Realty"], ["fin", "Financial"], ["psubank", "PSU Bank"], ["midcap", "Midcap"]];
function bubbleMembers(m) {
  if (m === "fo") return D.stocks.filter(s => s.fo);
  if (m === "nifty50") return D.stocks.filter(s => s.nifty50);
  const x = idxById(m); return x ? (x.members || []).map(s => S[s]).filter(Boolean) : [];
}
function packCircles(items, W, H, tall) {
  // spiral placement: biggest first, each new circle goes to the closest free spot to the centre
  const placed = [], cx = W / 2, cy = H / 2;
  for (const it of items) {
    let best = null;
    if (!placed.length) best = { x: cx, y: cy };
    else for (let k = 0; k < 20000 && !best; k++) {
      const a = k * 0.22, rr = k * 0.3;
      const x = cx + rr * Math.cos(a) * (tall ? 0.8 : 1.35), y = cy + rr * Math.sin(a) * (tall ? 1.3 : 0.85);
      if (placed.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + it.r + 2)) best = { x, y };
    }
    placed.push({ ...it, ...(best || { x: cx, y: cy }) });
  }
  // fit into the box
  const minX = Math.min(...placed.map(p => p.x - p.r)), maxX = Math.max(...placed.map(p => p.x + p.r)), minY = Math.min(...placed.map(p => p.y - p.r)), maxY = Math.max(...placed.map(p => p.y + p.r));
  const k = Math.min((W - 8) / (maxX - minX), (H - 8) / (maxY - minY), 1.6);
  return placed.map(p => ({ ...p, x: (p.x - (minX + maxX) / 2) * k + W / 2, y: (p.y - (minY + maxY) / 2) * k + H / 2, r: p.r * k }));
}
function bubbleCard() {
  const m = ui.bm, size = ui.bsize;
  const mem = bubbleMembers(m).filter(s => s.price != null && s.change_pct != null);
  const val = s => size === "turnover" ? (s.turnover_cr || 0) : size === "move" ? Math.abs(s.change_pct || 0) + 0.15 : Math.max(0.2, s.tech?.vol_ratio || 0.2);
  const narrow = innerWidth < 700;
  let list = [...mem].sort((a, b) => val(b) - val(a)).slice(0, narrow ? 36 : 60);
  const up = mem.filter(s => s.change_pct > 0).length, dn = mem.filter(s => s.change_pct < 0).length;
  const W = narrow ? 400 : 900, H = narrow ? 600 : 460, mx = Math.max(1e-9, ...list.map(val));
  const items = list.map(s => ({ s, r: 12 + 58 * Math.sqrt(val(s) / mx) }));
  const circles = items.length ? packCircles(items, W, H, narrow) : [];
  const col = c => c > 0 ? `color-mix(in srgb, var(--up) ${Math.round(35 + Math.min(1, c / 3) * 60)}%, var(--card))` : c < 0 ? `color-mix(in srgb, var(--down) ${Math.round(35 + Math.min(1, -c / 3) * 60)}%, var(--card))` : "var(--line2)";
  const svg = circles.map((c, i) => { const s = c.s, fs = Math.max(7, Math.min(16, c.r / 3.1, (1.75 * c.r) / (Math.min(s.symbol.length, 10) * 0.64))), n = s.news_ids.length, big = c.r > 26;
    return `<g class="bub" data-go="${esc(s.symbol)}" style="animation-delay:${Math.min(i * 18, 700)}ms"><title>${esc(s.symbol)} · ${esc(s.name)}\n${pct(s.change_pct)} today · ₹${fmt(s.turnover_cr, 0)} cr traded${s.tech?.vol_ratio ? ` · volume ${fmt(s.tech.vol_ratio, 1)}× avg` : ""}${n ? `\n${n} news: ${NEWS[s.news_ids[0]]?.title || ""}` : ""}</title>
      <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r.toFixed(1)}" fill="${col(s.change_pct)}" stroke="var(--card)" stroke-width="2"/>
      ${n && c.r > 18 ? `<circle cx="${(c.x + c.r * 0.68).toFixed(1)}" cy="${(c.y - c.r * 0.68).toFixed(1)}" r="${Math.max(6, c.r * 0.16).toFixed(1)}" fill="var(--ink)"/><text x="${(c.x + c.r * 0.68).toFixed(1)}" y="${(c.y - c.r * 0.68 + 3.5).toFixed(1)}" text-anchor="middle" font-size="${Math.max(8, c.r * 0.17).toFixed(0)}" font-weight="800" fill="var(--card)">${n}</text>` : ""}
      ${c.r > 15 ? `<text x="${c.x.toFixed(1)}" y="${(c.y + (big ? -2 : 3)).toFixed(1)}" text-anchor="middle" font-size="${fs.toFixed(0)}" font-weight="800" fill="var(--ink)" style="font-family:var(--display)">${esc(s.symbol.length > 10 && c.r < 40 ? s.symbol.slice(0, 9) + "…" : s.symbol)}</text>` : ""}
      ${big ? `<text x="${c.x.toFixed(1)}" y="${(c.y + fs).toFixed(1)}" text-anchor="middle" font-size="${(fs * 0.8).toFixed(0)}" font-weight="700" fill="var(--ink)" style="font-family:var(--mono)">${pct(s.change_pct)}</text>` : ""}</g>`; }).join("");
  return `<div class="card"><div class="hd" style="flex-wrap:wrap"><h2>Trending now · by market</h2>
      <div class="seg">${[["turnover", "Most traded"], ["move", "Biggest moves"], ["vol", "Volume surge"]].map(([k, l]) => `<button data-bsize="${k}" class="${size === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="bd"><div class="bmk">${BMKTS.filter(([k]) => bubbleMembers(k).length).map(([k, l]) => `<button class="chip${m === k ? " on" : ""}" data-bm="${k}">${l}</button>`).join("")}</div>
      <div class="bubwrap">${circles.length ? `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bubble chart of trending stocks" style="max-height:${narrow ? 640 : 520}px">${svg}</svg>` : '<div class="empty">No data for this market yet.</div>'}</div>
      <div class="blegend"><span><i style="background:var(--up)"></i>up today</span><span><i style="background:var(--down)"></i>down today</span><span>deeper colour = bigger move</span><span>bubble size = ${size === "turnover" ? "value traded today" : size === "move" ? "size of today's move" : "volume vs 20-day average"}</span><span><b class="nbdot">3</b> = news count</span><span class="num"><b class="up">${up}▲</b> <b class="down">${dn}▼</b> of ${mem.length}</span></div></div></div>`;
}

// ---------- CIRCUITS ----------
const SERIES_TAG = { EQ: "", BE: "T2T", BZ: "BZ", SM: "SME", ST: "SME", SZ: "SME", GS: "Govt sec" };
function circuitsView() {
  const C = D.circuits;
  if (!C) return `<div class="fade"><h1 class="page">Circuit hits</h1><div class="card"><div class="empty"><b>Circuit data arrives with the next update</b>It refreshes every 15 minutes during market hours.</div></div></div>`;
  const base = x => ui.ccap === "all" || x.cap === ui.ccap || x.cap === "Large/Mid";
  const U = C.upper.filter(base), L = C.lower.filter(base), B = C.both.filter(base);
  const bands = [5, 10, 20, 2];
  const bandCount = (list, b) => list.filter(x => x.band === b).length;
  const src = ui.cside === "upper" ? U : ui.cside === "lower" ? L : B;
  const list = src.filter(x => ui.cband === "all" || x.band === +ui.cband)
    .sort((a, b) => ui.csort === "change" ? Math.abs(b.change_pct) - Math.abs(a.change_pct) : ui.csort === "price" ? b.ltp - a.ltp : ui.csort === "streak" ? (b.streak - a.streak) || (b.turnover_cr - a.turnover_cr) : b.turnover_cr - a.turnover_cr);
  const shown = list.slice(0, ui.climit);
  const nth = n => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  const card = x => { const up = ui.cside === "upper" || (ui.cside === "both" && x.change_pct >= 0), s = S[x.symbol], tag = SERIES_TAG[x.series] ?? x.series;
    const inner = `<div class="sc1"><div><b class="sym">${esc(x.symbol)}</b>${x.nifty50 ? ' <span class="badge n50">N50</span>' : ""}${x.cap ? ` <span class="badge ${x.cap === "Mid" ? "watch" : "bullish"}">${x.cap === "Large/Mid" ? "Large/Mid" : x.cap + " cap"}</span>` : ""}${tag ? ` <span class="badge neutral" title="Series ${esc(x.series)}">${esc(tag)}</span>` : ""}<div class="scn">${x.name && x.name !== x.symbol ? esc(x.name.replace(/ Limited$| Ltd\.?$/i, "")) : "&nbsp;"}</div></div>
        <div class="scp"><div class="num">₹${fmt(x.ltp, x.ltp >= 1000 ? 0 : 2)}</div><b class="num ${cls(x.change_pct)}">${pct(x.change_pct)}</b></div></div>
      <div class="ctags"><span class="cband ${up ? "u" : "d"}">${ui.cside === "both" ? "HIT BOTH BANDS" : up ? "▲ UPPER CIRCUIT" : "▼ LOWER CIRCUIT"} · ${x.band}%</span>${x.streak >= 2 ? `<span class="badge watch">🔥 ${nth(x.streak)} day in a row</span>` : ""}${x.at_52w_high ? '<span class="badge bullish">52W high</span>' : x.at_52w_low ? '<span class="badge bearish">52W low</span>' : ""}</div>
      <div class="sc3 c3"><span><em>Traded</em><b class="num">₹${fmt(x.turnover_cr, x.turnover_cr < 10 ? 2 : 0)} cr</b></span><span><em>Day range</em><b class="num">${fmt(x.low, x.low >= 100 ? 0 : 1)}–${fmt(x.high, x.high >= 100 ? 0 : 1)}</b></span><span><em>News</em><b class="num">${s ? s.news_ids.length || "–" : "–"}</b></span></div>
      <div class="muted" style="font-size:12px">${s ? "Tap for news, chart and insight" : "Opens on NSE ↗"}</div>`;
    return s ? `<button class="scard ccard ${up ? "u" : "d"}" data-go="${esc(x.symbol)}">${inner}</button>` : `<a class="scard ccard ${up ? "u" : "d"}" href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(x.symbol)}" target="_blank" rel="noopener">${inner}</a>`; };
  return `<div class="fade"><h1 class="page">Circuit hits today</h1><p class="sub">Large-cap (Nifty 100) and mid-cap (Nifty Midcap 150) stocks that hit their daily price limit (circuit) on NSE, by band. Small caps are left out. At an upper circuit there are only buyers left; at a lower circuit, only sellers. Updated every 15 minutes in market hours.</p>
  <div class="cbands">${bands.map(b => `<button class="card cbk${ui.cband === String(b) ? " on" : ""}" data-cband="${b}"><div class="l">${b}% circuit</div><div class="v"><span class="up">▲ ${bandCount(U, b)}</span><span class="down">▼ ${bandCount(L, b)}</span></div><div class="muted" style="font-size:12px">upper · lower</div></button>`).join("")}
    <button class="card cbk${ui.cband === "all" ? " on" : ""}" data-cband="all"><div class="l">All bands</div><div class="v"><span class="up">▲ ${U.length}</span><span class="down">▼ ${L.length}</span></div><div class="muted" style="font-size:12px">${B.length} hit both</div></button></div>
  <div class="stools">
    <div class="seg"><button data-cside="upper" class="${ui.cside === "upper" ? "on" : ""}">▲ Upper circuit · ${U.length}</button><button data-cside="lower" class="${ui.cside === "lower" ? "on" : ""}">▼ Lower circuit · ${L.length}</button><button data-cside="both" class="${ui.cside === "both" ? "on" : ""}">Hit both · ${B.length}</button></div>
    <div class="seg">${[["all", "All"], ...bands.map(b => [String(b), b + "%"])].map(([k, l]) => `<button data-cband="${k}" class="${ui.cband === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <label class="ssort"><span class="muted">Sort</span><select id="csort" aria-label="Sort circuits">${[["turnover", "Most traded"], ["change", "Biggest move"], ["streak", "Days in a row"], ["price", "Highest price"]].map(([k, l]) => `<option value="${k}"${ui.csort === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="seg">${[["all", "Large + mid cap"], ["Large", "Large cap"], ["Mid", "Mid cap"]].map(([k, l]) => `<button data-ccap="${k}" class="${ui.ccap === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <b class="num scount">${list.length} stock${list.length === 1 ? "" : "s"}</b>
  </div>
  ${list.length ? `<div class="sgrid">${shown.map(card).join("")}</div>` : `<div class="card"><div class="empty"><b>No ${ui.cside === "upper" ? "upper" : ui.cside === "lower" ? "lower" : ""} circuit hits here</b>Large and mid-cap stocks hit circuits much less often than small caps; on many days there are none. Try another band or side.</div></div>`}
  ${list.length > shown.length ? `<div style="text-align:center;margin-top:14px"><button class="btn" data-climit>Show ${Math.min(60, list.length - shown.length)} more of ${list.length - shown.length}</button></div>` : ""}
  <div class="muted" style="font-size:12.5px;margin-top:12px">NSE sets each stock's daily limit at 2%, 5%, 10% or 20% (there is no 30% band). F&O stocks have no fixed circuit, so large companies rarely appear here. ${C.hidden_small ? `${C.hidden_small.upper + C.hidden_small.lower} small-cap circuit hits today are hidden. ` : ""}T2T (trade-to-trade) stocks must be delivered, with no intraday trading. "Days in a row" counts from when this site started logging circuits. For information only, not investment advice.</div></div>`;
}

// ---------- OPTIONS ----------
const optData = {};
async function loadOpt(sym) {
  if (optData[sym]) return optData[sym];
  const r = await fetch(`data/options/${sym.replace(/[^A-Z0-9&-]/gi, "_")}.json?t=${D.generated_at}`); if (!r.ok) throw new Error(r.status);
  return (optData[sym] = await r.json());
}
const rs = (n, d = 0) => n == null ? "–" : "₹" + fmt(n, d);
function payoffSvg(i) {
  // payoff at expiry per share for a debit spread
  const [b, s] = i.legs, up = i.dir === "bullish", lo = Math.min(b.strike, s.strike, i.spot) * 0.93, hi = Math.max(b.strike, s.strike, i.spot) * 1.07;
  const pay = x => (up ? Math.min(Math.max(x - b.strike, 0), s.strike - b.strike) : Math.min(Math.max(b.strike - x, 0), b.strike - s.strike)) - i.debit;
  const W = 260, H = 90, xs = x => (x - lo) / (hi - lo) * W, mx = i.max_gain, mn = -i.max_loss, ys = y => 8 + (mx - y) / (mx - mn) * (H - 16);
  const pts = []; for (let k = 0; k <= 60; k++) { const x = lo + (hi - lo) * k / 60; pts.push([xs(x), ys(pay(x))]); }
  const d = pts.map((p, k) => (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="payoff" aria-label="Profit or loss at expiry"><line x1="0" x2="${W}" y1="${ys(0)}" y2="${ys(0)}" stroke="var(--line2)"/>
    <clipPath id="cu${esc(i.symbol)}"><rect x="0" y="0" width="${W}" height="${ys(0)}"/></clipPath><clipPath id="cd${esc(i.symbol)}"><rect x="0" y="${ys(0)}" width="${W}" height="${H}"/></clipPath>
    <path d="${d}L${W} ${ys(0)}L0 ${ys(0)}Z" fill="var(--up)" opacity=".18" clip-path="url(#cu${esc(i.symbol)})"/><path d="${d}L${W} ${ys(0)}L0 ${ys(0)}Z" fill="var(--down)" opacity=".18" clip-path="url(#cd${esc(i.symbol)})"/>
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.8"/>
    <line x1="${xs(i.spot)}" x2="${xs(i.spot)}" y1="0" y2="${H}" stroke="var(--s1)" stroke-dasharray="3 3"/><text x="${xs(i.spot) + 3}" y="10" font-size="9" fill="var(--s1)">now ${fmt(i.spot, 0)}</text>
    <text x="${xs(i.breakeven)}" y="${H - 1}" font-size="9" fill="var(--muted)" text-anchor="middle">BE ${fmt(i.breakeven, 0)}</text></svg>`;
}
function optionsView() {
  const O = D.options;
  if (!O) return `<div class="fade"><h1 class="page">Options</h1><div class="card"><div class="empty"><b>Option data arrives with the next update</b>It refreshes every few minutes during market hours.</div></div></div>`;
  const ideas = O.ideas.filter(i => ui.odir === "all" || i.dir === ui.odir);
  const idx = O.indices.map(x => { const lo = Math.min(x.range_lo ?? x.spot, x.put_wall ?? x.spot, x.max_pain ?? x.spot), hi = Math.max(x.range_hi ?? x.spot, x.call_wall ?? x.spot, x.max_pain ?? x.spot), p = v => v == null ? null : ((v - lo) / (hi - lo || 1) * 100).toFixed(1);
    return `<div class="card oidx"><div class="hd"><h2>${esc(x.symbol === "BANKNIFTY" ? "Bank Nifty" : "Nifty 50")}</h2><span class="muted" style="font-size:12.5px">expiry ${esc(x.expiry)} · ${x.days} days</span></div><div class="bd">
      <div class="oim"><div><div class="l">Spot</div><b class="num">${fmt(x.spot, 2)}</b></div><div><div class="l">Put-call ratio</div><b class="num ${x.pcr > 1.2 ? "up" : x.pcr < 0.8 ? "down" : ""}">${x.pcr ?? "–"}</b><div class="s">${x.pcr > 1.2 ? "put writers confident (support)" : x.pcr < 0.8 ? "call writers confident (cap)" : "balanced"}</div></div>
        <div><div class="l">Max pain</div><b class="num">${fmt(x.max_pain, 0)}</b></div><div><div class="l">ATM implied volatility</div><b class="num">${x.atm_iv ?? "–"}%</b></div></div>
      <div class="orange"><div class="bar"><i class="rng" style="left:${p(x.range_lo)}%;width:${(p(x.range_hi) - p(x.range_lo)).toFixed(1)}%"></i>
        ${x.put_wall ? `<em class="pw" style="left:${p(x.put_wall)}%" title="Biggest put open interest: support">▲ ${fmt(x.put_wall, 0)}</em>` : ""}${x.call_wall ? `<em class="cw" style="left:${p(x.call_wall)}%" title="Biggest call open interest: resistance">▼ ${fmt(x.call_wall, 0)}</em>` : ""}
        <b class="sp" style="left:${p(x.spot)}%" title="Now"></b></div>
        <div class="muted" style="font-size:12.5px;margin-top:22px">Options are pricing a move of about <b>±${fmt(x.exp_move, 0)} (${x.exp_move_pct}%)</b> by expiry: roughly <b class="num">${fmt(x.range_lo, 0)}–${fmt(x.range_hi, 0)}</b>. Support (largest put OI) ${fmt(x.put_wall, 0)}, resistance (largest call OI) ${fmt(x.call_wall, 0)}.</div></div>
      <button class="sy" data-osym="${esc(x.symbol)}">Open option chain →</button></div></div>`; }).join("");
  const ideaCard = i => { const [b, s] = i.legs;
    return `<div class="card oidea ${i.dir}"><div class="bd">
      <div class="oih"><button class="sy big" data-go="${esc(i.symbol)}">${esc(i.symbol)}</button><span class="badge ${i.dir}">${i.dir === "bullish" ? "▲ Bullish view" : "▼ Bearish view"}</span><span class="muted num" style="margin-left:auto">₹${fmt(i.spot, 2)}</span></div>
      <div class="ostrat">${esc(i.strategy)} <span class="muted">· expiry ${esc(i.expiry)} (${i.days} days)</span></div>
      <table class="olegs"><tr><td><b class="up">BUY</b></td><td class="num">${fmt(b.strike, 0)} ${b.type}</td><td class="num">@ ₹${fmt(b.price, 2)}</td></tr><tr><td><b class="down">SELL</b></td><td class="num">${fmt(s.strike, 0)} ${s.type}</td><td class="num">@ ₹${fmt(s.price, 2)}</td></tr></table>
      ${payoffSvg(i)}
      <div class="okpi"><div><em>Max loss</em><b class="down">${i.max_loss_lot != null ? rs(i.max_loss_lot) : "₹" + fmt(i.max_loss, 2) + "/sh"}</b>${i.lot ? `<small>1 lot = ${i.lot} sh</small>` : ""}</div><div><em>Max gain</em><b class="up">${i.max_gain_lot != null ? rs(i.max_gain_lot) : "₹" + fmt(i.max_gain, 2) + "/sh"}</b><small>reward ${fmt(i.rr, 1)}× risk</small></div>
        <div><em>Break-even</em><b class="num">${fmt(i.breakeven, 2)}</b></div><div><em>Chance of profit</em><b>${i.pop}%</b><small>full profit ~${i.p_full}%</small></div></div>
      <div class="popbar"><i style="width:0" data-w="${i.pop}%"></i></div>
      <div class="owhy">${i.why.map(w => `<span>✓ ${esc(w)}</span>`).join("")}</div></div></div>`; };
  const lot = O.lottery;
  return `<div class="fade"><h1 class="page">Options</h1>
  <div class="owarn"><b>⚠ Read first:</b> SEBI's study found about <b>9 in 10</b> individual F&O traders lost money. Most options bought expire worthless. Everything here comes from rules applied to NSE's live option chain: <b>ideas to study, not advice or a promise</b>. Only trade money you can afford to lose.</div>
  <div class="grid g2">${idx}</div>
  <div class="card" style="margin-top:16px"><div class="hd"><h2>Risk-limited setup ideas</h2><div class="seg">${[["all", "All"], ["bullish", "▲ Bullish"], ["bearish", "▼ Bearish"]].map(([k, l]) => `<button data-odir="${k}" class="${ui.odir === k ? "on" : ""}">${l}</button>`).join("")}</div></div><div class="bd">
    <p class="muted" style="font-size:13px;margin:0 0 12px">Only where trend, news, open-interest build-up and put-call ratio point the same way. Each idea is a <b>spread</b>: you buy one option and sell a further one, so <b>the most you can lose is what you pay</b>, and it costs less than buying the option alone. Prices use the current buy/sell quotes; chances come from the option's own implied volatility.</p>
    ${ideas.length ? `<div class="oideas">${ideas.slice(0, ui.olimit).map(ideaCard).join("")}</div>${ideas.length > ui.olimit ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-olimit>Show ${ideas.length - ui.olimit} more ideas</button></div>` : ""}` : '<div class="empty"><b>No clear setups right now</b>When signals disagree, the best trade is often no trade.</div>'}</div></div>
  <div class="card" style="margin-top:16px" id="ochainCard"><div class="hd"><h2>Option chain</h2>
    <select id="osel" aria-label="Choose underlying">${["NIFTY", "BANKNIFTY", ...O.stocks.map(x => x.symbol)].map(sy => `<option value="${esc(sy)}"${ui.osym === sy ? " selected" : ""}>${esc(sy === "BANKNIFTY" ? "Bank Nifty" : sy === "NIFTY" ? "Nifty 50" : sy)}</option>`).join("")}</select></div>
    <div class="bd" id="ochain"><div class="skeleton" style="height:300px"></div></div></div>
  <div class="card" style="margin-top:16px"><div class="hd"><h2>F&O stocks: options view</h2><span class="muted" style="font-size:12.5px">tap a row for its option chain</span></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th class="l">Stock</th><th>Spot</th><th class="l">View</th><th>Put-call ratio</th><th>Max pain</th><th>Support (put OI)</th><th>Resistance (call OI)</th><th>IV</th><th>Expected move</th><th class="l">Expiry</th></tr></thead><tbody>
    ${O.stocks.map(x => `<tr data-osym="${esc(x.symbol)}"><td class="l"><span class="sym">${esc(x.symbol)}</span></td><td class="num">${fmt(x.spot, 2)}</td><td class="l"><span class="badge ${x.view}">${x.view}</span></td><td class="num ${x.pcr > 1.2 ? "up" : x.pcr < 0.7 ? "down" : ""}">${x.pcr ?? "–"}</td><td class="num">${fmt(x.max_pain, 0)}</td><td class="num">${fmt(x.put_wall, 0)}</td><td class="num">${fmt(x.call_wall, 0)}</td><td class="num">${x.atm_iv ?? "–"}%</td><td class="num">±${x.exp_move_pct ?? "–"}%</td><td class="l muted">${esc(x.expiry)}</td></tr>`).join("")}
    </tbody></table></div></div>
  <div class="card olot" style="margin-top:16px"><div class="hd"><h2>🎲 Lottery-style: cheap far-away options with unusual volume</h2></div><div class="bd">
    <div class="owarn red"><b>High risk. This is where most money is lost.</b> These options are cheap because the stock would need a very big move before expiry. They hit big only rarely: the "estimated chance" column is usually in single digits, so they are much more likely to expire at zero. Unusual volume can mean someone expects news, or just speculation. Never put in more than you can lose completely.</div>
    ${lot.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th class="l">Option</th><th>Premium</th><th>Cost / lot</th><th>Volume</th><th>Open interest</th><th>Stock must move</th><th>Estimated chance of profit</th><th>Price needed for 10×</th><th class="l">Expiry</th></tr></thead><tbody>
      ${lot.map(x => `<tr data-osym="${esc(x.symbol)}"><td class="l"><span class="sym">${esc(x.symbol)}</span> <b class="${x.type === "CE" ? "up" : "down"}">${fmt(x.strike, 0)} ${x.type}</b></td><td class="num">₹${fmt(x.ltp, 2)}</td><td class="num">${x.cost_lot != null ? rs(x.cost_lot) : "–"}</td><td class="num">${fmt(x.vol, 0)}</td><td class="num">${fmt(x.oi, 0)}</td><td class="num">${x.type === "CE" ? "+" : "−"}${fmt(x.dist_pct, 1)}%</td>
        <td class="num"><b class="${x.p_profit < 5 ? "down" : ""}">${x.p_profit == null ? "–" : x.p_profit < 0.1 ? "&lt;0.1%" : x.p_profit + "%"}</b></td><td class="num">${fmt(x.x10_price, 0)}</td><td class="l muted">${esc(x.expiry)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="muted">No unusual far-away option activity right now.</div>'}
  </div></div>
  <div class="muted" style="font-size:12.5px;margin-top:12px">Data: NSE option chain (the nearest expiry at least 2 days away), updated every few minutes in market hours. Put-call ratio = put open interest ÷ call open interest. Max pain = the expiry price at which option buyers together lose the most. Chances assume prices move randomly with the volatility the market is pricing in, so they are estimates, not forecasts. Brokerage, taxes and slippage are not included. Updated ${ago(O.updated)}.</div></div>`;
}
async function drawChain() {
  const box = $("#ochain"); if (!box) return;
  const sym = ui.osym; let d;
  try { d = await loadOpt(sym); } catch { box.innerHTML = '<div class="muted">Option chain unavailable for this one.</div>'; return; }
  if (!$("#ochain") || ui.osym !== sym) return;
  const mxO = Math.max(1, ...d.chain.flatMap(r => [r.ce?.oi || 0, r.pe?.oi || 0]));
  const atm = d.atm;
  box.innerHTML = `<div class="ocsum"><span>Spot <b class="num">${fmt(d.spot, 2)}</b></span><span>Expiry <b>${esc(d.expiry)}</b> (${d.days} days)</span><span>Put-call ratio <b class="num">${d.pcr ?? "–"}</b></span><span>Max pain <b class="num">${fmt(d.max_pain, 0)}</b></span><span>ATM IV <b class="num">${d.atm_iv ?? "–"}%</b></span><span>Expected move <b class="num">±${d.exp_move_pct ?? "–"}%</b></span>${d.lot ? `<span>Lot <b class="num">${d.lot}</b></span>` : ""}</div>
    <div class="tblwrap" style="max-height:560px"><table class="tbl ochain"><thead><tr><th colspan="5" class="cehd">CALLS</th><th></th><th colspan="5" class="pehd">PUTS</th></tr>
      <tr><th>OI</th><th>Chg OI</th><th>Volume</th><th>IV</th><th>LTP</th><th class="stk">Strike</th><th>LTP</th><th>IV</th><th>Volume</th><th>Chg OI</th><th>OI</th></tr></thead><tbody>
    ${d.chain.map(r => { const itmC = r.k < d.spot, itmP = r.k > d.spot, c = r.ce || {}, p = r.pe || {};
      const tag = [r.k === d.call_wall ? '<i class="ot cw">resistance</i>' : "", r.k === d.put_wall ? '<i class="ot pw">support</i>' : "", r.k === d.max_pain ? '<i class="ot mp">max pain</i>' : ""].join("");
      return `<tr class="${r.k === atm ? "atm" : ""}"><td class="num oib ${itmC ? "itm" : ""}"><span style="width:${((c.oi || 0) / mxO * 100).toFixed(1)}%" class="ce"></span>${fmt(c.oi, 0)}</td><td class="num ${cls(c.chg)}">${fmt(c.chg, 0)}</td><td class="num ${itmC ? "itm" : ""}">${fmt(c.vol, 0)}</td><td class="num ${itmC ? "itm" : ""}">${c.iv || "–"}</td><td class="num ${itmC ? "itm" : ""}"><b>${fmt(c.ltp, 2)}</b></td>
        <td class="stk num"><b>${fmt(r.k, 0)}</b>${tag}</td>
        <td class="num ${itmP ? "itm" : ""}"><b>${fmt(p.ltp, 2)}</b></td><td class="num ${itmP ? "itm" : ""}">${p.iv || "–"}</td><td class="num ${itmP ? "itm" : ""}">${fmt(p.vol, 0)}</td><td class="num ${cls(p.chg)}">${fmt(p.chg, 0)}</td><td class="num oib ${itmP ? "itm" : ""}"><span style="width:${((p.oi || 0) / mxO * 100).toFixed(1)}%" class="pe"></span>${fmt(p.oi, 0)}</td></tr>`; }).join("")}
    </tbody></table></div><div class="muted" style="font-size:12px;margin-top:6px">Shaded cells are in-the-money. OI = open interest (contracts outstanding); Chg OI = change today. The highlighted row is at-the-money.</div>`;
  const a = box.querySelector("tr.atm"), w = box.querySelector(".tblwrap"); if (a && w) w.scrollTop = Math.max(0, a.offsetTop - w.clientHeight / 2); // centre the at-the-money row inside the table only
}

// ---------- SIGNALS (track record) ----------
function hitBar(v, base) {
  if (v == null) return "–";
  return `<div class="hb"><div class="bar"><i style="width:0;background:${v >= base + 3 ? "var(--up)" : v <= base - 3 ? "var(--down)" : "var(--accent)"}" data-w="${v}%"></i><em style="left:${base}%" title="An average day: ${base}%"></em></div><span class="num">${v}%</span></div>`;
}
function signals() {
  const B = D.backtest;
  if (!B) return `<div class="fade"><h1 class="page">Signal track record</h1><div class="card"><div class="empty"><b>Not ready yet</b>The track record is built with the next data update (every 15 minutes during market hours).</div></div></div>`;
  const h = ui.bh, base = B.baseline[h];
  const list = B.signals.filter(g => ui.bdir === "all" || g.dir === ui.bdir);
  const order = { "Worked well": 0, "Slight edge": 1, "No real edge": 2, "Worked the opposite way": 3, "Too few cases": 4 };
  list.sort((a, b) => order[a.verdict] - order[b.verdict] || (b.edge20 ?? -99) - (a.edge20 ?? -99));
  const total = B.signals.reduce((a, g) => a + (g.results[h]?.n || 0), 0);
  const best = [...B.signals].filter(g => g.results[20]?.n >= 30).sort((a, b) => (b.edge20 ?? -99) - (a.edge20 ?? -99))[0];
  const LR = D.live_record;
  const yr = d => new Date(d + "T00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  let html = `<div class="fade"><h1 class="page">Signal track record</h1>
  <p class="sub">Every signal this site shows, replayed on ${yr(B.from)}–${yr(B.to)} daily prices for ${B.stocks} stocks. Did it work, and what happened next?</p>
  <div class="kpis">
    <div class="card kpi"><div class="l">Signal cases scored</div><div class="v">${fmt(total, 0)}</div><div class="muted" style="font-size:12px">over ${h} trading days</div></div>
    <div class="card kpi"><div class="l">An average day (baseline)</div><div class="v ${cls(base.avg)}">${pct(base.avg)}</div><div class="muted" style="font-size:12px">stocks rose ${base.up}% of the time after ${h} days</div></div>
    <div class="card kpi"><div class="l">Best signal (20 days)</div><div class="v" style="font-size:17px;font-family:var(--display)">${best ? esc(best.name) : "–"}</div><div class="muted" style="font-size:12px">${best ? `${pct(best.edge20)} better than an average day` : ""}</div></div>
    <div class="card kpi"><div class="l">Signals firing now</div><div class="v">${B.recent.filter(e => e.ago < 5).length}</div><div class="muted" style="font-size:12px">in the last 5 sessions</div></div>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
    <div class="seg">${B.horizons.map(x => `<button data-bh="${x}" class="${h === x ? "on" : ""}">After ${x} days</button>`).join("")}</div>
    <div class="seg"><button data-bdir="all" class="${ui.bdir === "all" ? "on" : ""}">All signals</button><button data-bdir="up" class="${ui.bdir === "up" ? "on" : ""}">▲ Bullish</button><button data-bdir="down" class="${ui.bdir === "down" ? "on" : ""}">▼ Bearish</button></div>
  </div>
  <div class="card"><div class="tblwrap" style="max-height:none"><table class="tbl sigt"><thead><tr><th class="l">Signal</th><th>Cases</th><th class="l">Went the expected way</th><th>Avg return</th><th>Median</th><th>vs Nifty</th><th class="l">Verdict (20 days)</th></tr></thead><tbody>
  ${list.map(g => { const r = g.results[h] || {}; const b = g.dir === "down" ? 100 - base.up : base.up;
    return `<tr style="cursor:default"><td class="l"><div class="sn"><span class="${g.dir === "up" ? "up" : "down"}">${g.dir === "up" ? "▲" : "▼"}</span> <b>${esc(g.name)}</b></div><div class="muted sd">${esc(g.desc)}</div></td>
      <td class="num">${r.n ? fmt(r.n, 0) : "–"}</td><td class="l">${r.n ? hitBar(r.hit, b) : "–"}</td>
      <td class="num ${cls(r.avg)}">${r.n ? pct(r.avg) : "–"}</td><td class="num ${cls(r.med)}">${r.n ? pct(r.med) : "–"}</td><td class="num ${cls(r.vs_nifty)}">${r.n ? pct(r.vs_nifty) : "–"}</td>
      <td class="l">${verdictBadge(g.verdict)}</td></tr>`; }).join("")}
  </tbody></table></div>
  <div class="bd muted" style="font-size:12.5px;border-top:1px solid var(--line)">"Went the expected way" means the price rose after a ▲ signal or fell after a ▼ signal. The small mark on each bar is an average day, so a bar well past the mark means the signal added something. A verdict needs 30+ cases and compares the 20-day average return with an average day.</div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="hd"><h2>Fired in the last 10 sessions</h2><span class="muted" style="font-size:12.5px">${B.recent.length} signals</span></div><div class="bd" style="padding-top:4px;max-height:520px;overflow:auto">
      ${B.recent.map(e => { const g = btSig(e.s); if (!g) return ""; const r = g.results[20];
        return `<button class="mv" data-go="${esc(e.symbol)}"><span><b>${esc(e.symbol)}</b> <span class="${g.dir === "up" ? "up" : "down"}">${g.dir === "up" ? "▲" : "▼"}</span> ${esc(g.name)}</span><span class="num muted" style="font-size:12px">${e.ago === 0 ? "today" : e.ago === 1 ? "1 day ago" : e.ago + " days ago"}${r?.n ? ` · ${r.hit}% hit` : ""}</span></button>`; }).join("") || '<div class="muted" style="padding-top:12px">No signals in the last 10 sessions.</div>'}
    </div></div>
    <div class="card"><div class="hd"><h2>Live record of this site's calls</h2><span class="muted" style="font-size:12.5px">news + chart labels${LR?.started ? `, since ${new Date(LR.started + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}</span></div><div class="bd">
      <p style="margin:0 0 10px;font-size:13.5px;color:var(--ink2)">Old headlines can't be replayed, so the full labels (news tone plus chart) are recorded every trading day from now on and scored as the days pass.</p>
      ${LR && LR.labels.length ? `<div class="tblwrap" style="max-height:none"><table class="tbl"><thead><tr><th class="l">Label</th><th>Days</th><th>5d avg</th><th>Rose</th><th>20d avg</th><th>vs Nifty</th></tr></thead><tbody>
        ${LR.labels.map(l => `<tr style="cursor:default"><td class="l"><span class="badge ${l.signal}">${esc(l.label)}</span></td><td class="num">${fmt(l.n5 || 0, 0)}</td><td class="num ${cls(l.avg5)}">${l.n5 ? pct(l.avg5) : '<span class="muted">collecting</span>'}</td><td class="num">${l.n5 ? l.up5 + "%" : "–"}</td><td class="num ${cls(l.avg20)}">${l.n20 ? pct(l.avg20) : '<span class="muted">collecting</span>'}</td><td class="num ${cls(l.vs20)}">${l.n20 ? pct(l.vs20) : "–"}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="muted" style="font-size:12.5px;margin-top:8px">${LR.logged_days} trading day${LR.logged_days === 1 ? "" : "s"} logged. The first 5-day results appear after 5 trading days and the 20-day results after about a month.</div>`
      : '<div class="muted">Recording starts on the next trading day.</div>'}
    </div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="bd" style="font-size:13.5px;color:var(--ink2)"><b>How this is tested.</b> For every stock and every day, each rule is checked using only the prices known that day, with no peeking ahead. The return is then measured 5, 20 and 60 trading days later and compared with the Nifty 50 over the same days. Repeats of the same signal on the same stock within 10 sessions count once.
    <br><br><b>Keep in mind:</b> the test uses today's Nifty 200 members, so stocks that dropped out of the index are missing, which flatters results a little. Costs and taxes aren't included. A signal that worked in the past can stop working. Use this to judge how much weight a signal deserves, not as a promise.</div></div></div>`;
  return html;
}

// ---------- 52W ----------
function w52() {
  const w = D.w52, list = (ui.w52 === "highs" ? w.highs : w.lows).filter(x => ui.w52s === "all" || (ui.w52s === "n50" ? x.nifty50 : x.tracked));
  const strong = w.highs.length > w.lows.length;
  return `<div class="fade"><h1 class="page">52-week highs and lows</h1><p class="sub">${w.highs.length} stocks hit a new 52-week high and ${w.lows.length} a new low (${esc(w.source)}). ${strong ? "More highs than lows usually signals broad strength." : "More lows than highs usually signals broad weakness."}</p>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"><div class="seg"><button data-w52="highs" class="${ui.w52 === "highs" ? "on" : ""}">New highs · ${w.highs.length}</button><button data-w52="lows" class="${ui.w52 === "lows" ? "on" : ""}">New lows · ${w.lows.length}</button></div>
  <div class="seg"><button data-w52s="all" class="${ui.w52s === "all" ? "on" : ""}">All NSE</button><button data-w52s="tracked" class="${ui.w52s === "tracked" ? "on" : ""}">Nifty 200</button><button data-w52s="n50" class="${ui.w52s === "n50" ? "on" : ""}">Nifty 50</button></div></div>
  <div class="card"><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">Stock</th><th class="l">Company</th><th>Price</th><th>Day</th><th>New 52W ${ui.w52 === "highs" ? "high" : "low"}</th><th>Previous</th></tr></thead><tbody>
  ${list.map(x => `<tr ${x.tracked ? `data-go="${esc(x.symbol)}"` : ""}><td class="l"><span class="sym">${esc(x.symbol)}</span> ${x.nifty50 ? '<span class="badge n50">N50</span>' : ""}</td><td class="l muted">${x.tracked ? esc((x.name || "").slice(0, 40)) : `<a href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(x.symbol)}" target="_blank" rel="noopener">${esc((x.name || "").slice(0, 40))} ↗</a>`}</td>
    <td class="num">${px(x.ltp)}</td><td class="num ${cls(x.change_pct)}">${pct(x.change_pct)}</td><td class="num">${px(x.new_level)}</td><td class="num muted">${x.prev_level ? px(x.prev_level) + (x.prev_date ? " · " + esc(x.prev_date) : "") : "–"}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">None right now.</div></td></tr>`}
  </tbody></table></div></div></div>`;
}

// ---------- PORTFOLIO ----------
function portfolio() {
  const hs = my.holdings.map(h => { const s = S[h.symbol] || {}; const val = s.price != null ? s.price * h.qty : null; const cost = h.avg * h.qty;
    const day = s.price != null && s.change_pct != null ? s.price * h.qty * (1 - 1 / (1 + s.change_pct / 100)) : null; return { ...h, s, val, cost, pnl: val != null ? val - cost : null, day }; });
  const T = hs.reduce((a, h) => ({ val: a.val + (h.val || 0), cost: a.cost + h.cost, day: a.day + (h.day || 0) }), { val: 0, cost: 0, day: 0 });
  const mineNews = D.news.filter(n => n.symbols.some(isMine)).slice(0, 30);
  const canNotify = "Notification" in window && Notification.permission !== "denied" && !SNAPSHOT;
  let code = ""; try { code = btoa(unescape(encodeURIComponent(JSON.stringify(my)))); } catch {}
  return `<div class="fade"><h1 class="page">My portfolio</h1><p class="sub">Holdings, watchlist and alerts are saved privately in this browser, never uploaded. Search any stock at the top, then use "Add to portfolio" or ☆ Watch.</p>
  ${hs.length ? `<div class="kpis"><div class="card kpi"><div class="l">Current value</div><div class="v">${inr(T.val)}</div></div><div class="card kpi"><div class="l">Invested</div><div class="v">${inr(T.cost)}</div></div>
    <div class="card kpi"><div class="l">Total P&L</div><div class="v ${cls(T.val - T.cost)}">${inr(T.val - T.cost)}</div><div class="num ${cls(T.val - T.cost)}" style="font-weight:700">${pct(T.cost ? (T.val / T.cost - 1) * 100 : 0)}</div></div>
    <div class="card kpi"><div class="l">Today</div><div class="v ${cls(T.day)}">${inr(T.day)}</div></div></div>
  <div class="card"><div class="hd"><h2>Holdings</h2></div><div class="tblwrap"><table class="tbl"><thead><tr><th class="l">Stock</th><th>Qty</th><th>Avg</th><th>Price</th><th>Day</th><th>Value</th><th>P&L</th><th>Weight</th><th class="l">Signal</th></tr></thead><tbody>
    ${hs.map(h => `<tr data-go="${esc(h.symbol)}"><td class="l"><span class="sym">${esc(h.symbol)}</span></td><td class="num">${h.qty}</td><td class="num">${px(h.avg)}</td><td class="num">${px(h.s.price)}</td><td class="num ${cls(h.s.change_pct)}">${pct(h.s.change_pct)}</td>
      <td class="num">${inr(h.val)}</td><td class="num ${cls(h.pnl)}">${inr(h.pnl)} <small>${pct(h.cost ? (h.val / h.cost - 1) * 100 : null)}</small></td><td class="num">${T.val ? fmt((h.val || 0) / T.val * 100, 1) + "%" : "–"}</td>
      <td class="l">${h.s.insight ? `<span class="badge ${h.s.insight.signal}">${esc(h.s.insight.label)}</span>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`
  : `<div class="card"><div class="empty"><b>No holdings yet</b>Search a stock at the top (for example "HDFC Bank"), open it, and use "Add to portfolio" with your quantity and average price.</div></div>`}
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="hd"><h2>Watchlist and alerts</h2></div><div class="bd" style="padding-top:4px">${my.watch.length ? my.watch.map(sym => { const s = S[sym] || {}; return `<button class="mv" data-go="${esc(sym)}"><span><b>${esc(sym)}</b> ${s.insight ? `<span class="badge ${s.insight.signal}">${esc(s.insight.label)}</span>` : ""}</span><span class="num">${px(s.price)} <b class="${cls(s.change_pct)}">${pct(s.change_pct)}</b></span></button>`; }).join("") : '<div class="muted" style="padding-top:12px">Use ☆ Watch on any stock.</div>'}
      ${my.alerts.length ? `<div style="margin-top:14px">` + my.alerts.map(a => `<div style="font-size:13.5px;margin:5px 0"><b>${esc(a.symbol)}</b> ${a.type === "above" ? "rises to" : "falls to"} <span class="num">${px(a.price)}</span> · now <span class="num">${px(S[a.symbol]?.price)}</span> ${a.hit ? '<span class="up">✓ triggered</span>' : ""} <button class="sy" data-adel="${a.id}">remove</button></div>`).join("") + "</div>" : ""}
      ${canNotify ? `<div style="margin-top:14px"><button class="btn sm" id="notif">${Notification.permission === "granted" ? "✓ Pop-up alerts are on" : "Turn on pop-up alerts"}</button></div>` : ""}
    </div></div>
    <div class="card"><div class="hd"><h2>News on my stocks</h2></div><div class="bd" style="padding-top:0">${mineNews.map(newsItem).join("") || '<div class="muted" style="padding-top:12px">No recent news on your stocks.</div>'}</div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="bd"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><b>Move to another device</b><span class="muted" style="font-size:13.5px">Copy this code, then paste it into Restore on the other device.</span></div>
    <textarea class="code" id="bk" readonly aria-label="Backup code">${esc(code)}</textarea>
    <div class="form" style="margin-top:8px"><button class="btn sm" id="copyBk">Copy code</button><input id="rs" placeholder="Paste a code to restore" style="flex:1;min-width:200px" aria-label="Restore code"><button class="btn sm" id="doRs">Restore</button></div></div></div></div>`;
}

// ---------- CALENDAR ----------
function calendar() {
  const list = D.calendar.filter(e => ui.cal === "all" || (ui.cal === "mine" ? isMine(e.symbol) : e.tracked));
  let h = `<div class="fade"><h1 class="page">Results and corporate actions</h1><p class="sub">Upcoming board meetings (results), dividends, bonuses and splits, from NSE.</p>
  <div class="seg" style="margin-bottom:12px"><button data-cal="mine" class="${ui.cal === "mine" ? "on" : ""}">My stocks</button><button data-cal="tracked" class="${ui.cal === "tracked" ? "on" : ""}">Nifty 200</button><button data-cal="all" class="${ui.cal === "all" ? "on" : ""}">All NSE</button></div><div class="card"><div class="bd">`;
  if (!D.calendar.length) return h + '<div class="empty"><b>Calendar unavailable</b>NSE event data couldn\'t be loaded in this update.</div></div></div></div>';
  if (!list.length) return h + `<div class="empty"><b>Nothing coming up</b>${ui.cal === "mine" ? "No events for your stocks. Try Nifty 200 or All NSE." : ""}</div></div></div></div>`;
  let last = "";
  for (const e of list.slice(0, 400)) {
    if (e.date !== last) { last = e.date; h += `<h3 style="font-family:var(--body);font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em;margin:18px 0 6px">${new Date(e.date + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}</h3>`; }
    h += `<div style="padding:8px 0;border-bottom:1px solid var(--line)">${e.tracked ? `<button class="sy" style="font-size:14px" data-go="${esc(e.symbol)}">${esc(e.symbol)}</button>` : `<b class="num">${esc(e.symbol)}</b>`} <span class="badge ${e.type === "Results" ? "n50" : e.type === "Dividend" || e.type === "Bonus" ? "positive" : "neutral"}">${esc(e.type)}</span> ${isMine(e.symbol) ? '<span class="badge mine">★ mine</span>' : ""}
      <span class="muted" style="font-size:13.5px">${esc(e.name || "")}</span><div class="muted" style="font-size:13px">${esc(e.detail)}</div></div>`;
  }
  return h + "</div></div></div>";
}

// ---------- alerts ----------
function checkAlerts(first) {
  let changed = false; const fired = [];
  for (const a of my.alerts) {
    const p = S[a.symbol]?.price; if (p == null || a.hit) continue;
    if ((a.type === "above" && p >= a.price) || (a.type === "below" && p <= a.price)) { a.hit = new Date().toISOString(); changed = true; fired.push(`${a.symbol} ${a.type === "above" ? "rose to" : "fell to"} ${px(p)} (your alert: ${px(a.price)})`); }
  }
  if (changed) saveMy();
  for (const m of fired) { toast(m); if ("Notification" in window && Notification.permission === "granted") try { new Notification("Dalal Pulse", { body: m }); } catch {} }
}

// ---------- events ----------
document.addEventListener("click", async e => {
  const t = e.target;
  const n = t.closest("[data-nav]"); if (n) { nav(n.dataset.nav); return; }
  if (t.closest("#bell")) { const dr = $("#drawer"); if (dr.hidden) openDrawer(); else closeDrawer(); return; }
  if (t.closest("[data-dclose]")) { closeDrawer(); return; }
  const pp = t.closest("[data-pop]"); if (pp) { store.set("dp-pop", pp.dataset.pop); openDrawer(); toast(pp.dataset.pop === "off" ? "News pop-ups are off" : pp.dataset.pop === "mine" ? "Pop-ups only for your watchlist and holdings" : "Pop-ups for news on any stock"); return; }
  if (t.id === "notif2") { try { await Notification.requestPermission(); } catch {} openDrawer(); return; }
  const os = t.closest("[data-osym]"); if (os) { ui.osym = os.dataset.osym; const sl = $("#osel"); if (sl) sl.value = ui.osym; drawChain(); $("#ochainCard")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); return; }
  if (t.closest("[data-olimit]")) { ui.olimit += 12; render(); return; }
  const od = t.closest("[data-odir]"); if (od) { ui.odir = od.dataset.odir; render(); return; }
  const cs = t.closest("[data-cside]"); if (cs) { ui.cside = cs.dataset.cside; ui.climit = 60; render(); return; }
  const cc = t.closest("[data-ccap]"); if (cc) { ui.ccap = cc.dataset.ccap; render(); return; }
  const cb = t.closest("[data-cband]"); if (cb) { ui.cband = cb.dataset.cband; ui.climit = 60; render(); return; }
  if (t.closest("[data-climit]")) { ui.climit += 60; render(); return; }
  const fsb = t.closest("[data-fsort]"); if (fsb) { const k = fsb.dataset.fsort; ui.fsort = { k, d: ui.fsort.k === k ? -ui.fsort.d : (k === "symbol" ? 1 : -1) }; render(); return; }
  const ffb = t.closest("[data-ff]"); if (ffb) { ui.ff = ffb.dataset.ff; render(); return; }
  const bmb = t.closest("[data-bm]"); if (bmb) { ui.bm = bmb.dataset.bm; render(); return; }
  const bsb = t.closest("[data-bsize]"); if (bsb) { ui.bsize = bsb.dataset.bsize; render(); return; }
  if (t.closest("[data-btmin]")) { store.set("dp-bt-min", !store.get("dp-bt-min", false)); tickSig = ""; renderTicker(); return; }
  const mi = t.closest("[data-mmi]"); if (mi) { mmI = +mi.dataset.mmi; renderMM(); return; }
  const ix = t.closest("[data-idx]"); if (ix) { nav("indices", ix.dataset.idx); return; }
  const is = t.closest("[data-isel]"); if (is) { sel = is.dataset.isel; view = "indices"; if (!SNAPSHOT) history.replaceState(null, "", "#indices/" + sel); render(); if (innerWidth <= 900) window.scrollTo({ top: 0 }); return; }
  if (t.closest("[data-back-idx]")) { nav("indices"); return; }
  const ir = t.closest("[data-irange]"); if (ir) { ui.irange = ir.dataset.irange; document.querySelectorAll("[data-irange]").forEach(b => b.classList.toggle("on", b === ir)); drawIndexChart(sel); return; }
  const cr = t.closest("[data-crange]"); if (cr) { ui.crange = cr.dataset.crange; render(); return; }
  const ic = t.closest("[data-icmp]"); if (ic) { const id = ic.dataset.icmp; if (ui.icmp.includes(id)) { if (ui.icmp.length > 1) ui.icmp = ui.icmp.filter(x => x !== id); } else if (ui.icmp.length < 6) ui.icmp.push(id); else toast("Up to 6 indices at a time"); render(); return; }
  if (t.closest("a[href]")) return;
  const g = t.closest("[data-go]"); if (g) { $("#gsugg").hidden = true; if (g.closest("#drawer")) closeDrawer(); go(g.dataset.go); return; }
  const s = t.closest("[data-sel]"); if (s) { sel = s.dataset.sel; if (!SNAPSHOT) history.replaceState(null, "", "#news/" + encodeURIComponent(sel)); render(); if (innerWidth <= 900) window.scrollTo({ top: 0 }); return; }
  if (t.closest("[data-back]")) { nav("news"); return; }
  const nf = t.closest("[data-nf]"); if (nf) { ui.nf = nf.dataset.nf; render(); return; }
  const pr = t.closest("[data-preset]"); if (pr) { ui.preset = pr.dataset.preset; ui.slimit = 60; render(); return; }
  const sg = t.closest("[data-sgrp]"); if (sg) { ui.sgrp = sg.dataset.sgrp; const g = SGROUPS.find(x => x[0] === ui.sgrp); if (g && !g[1].includes(ui.preset)) ui.preset = g[1][0]; ui.slimit = 60; render(); return; }
  const su = t.closest("[data-suni]"); if (su) { ui.suni = su.dataset.suni; render(); return; }
  const sv = t.closest("[data-sview]"); if (sv) { ui.sview = sv.dataset.sview; render(); return; }
  if (t.closest("[data-sdir]")) { ui.sort.d = -ui.sort.d; render(); return; }
  if (t.closest("[data-smore]")) { ui.smore = !ui.smore; render(); return; }
  if (t.closest("[data-slimit]")) { ui.slimit += 60; render(); return; }
  const so = t.closest("[data-sort]"); if (so) { const k = so.dataset.sort; ui.sort = { k, d: ui.sort.k === k ? -ui.sort.d : (["symbol", "industry"].includes(k) ? 1 : -1) }; render(); return; }
  const w = t.closest("[data-w52]"); if (w) { ui.w52 = w.dataset.w52; render(); return; }
  const ws = t.closest("[data-w52s]"); if (ws) { ui.w52s = ws.dataset.w52s; render(); return; }
  const c = t.closest("[data-cal]"); if (c) { ui.cal = c.dataset.cal; render(); return; }
  const ov = t.closest("[data-ov]"); if (ov) { ui.ov[ov.dataset.ov] = !ui.ov[ov.dataset.ov]; ov.classList.toggle("on", ui.ov[ov.dataset.ov]); ov.setAttribute("aria-pressed", ui.ov[ov.dataset.ov]); drawChart(sel); return; }
  const sb = t.closest("[data-sub]"); if (sb) { ui.sub = sb.dataset.sub; document.querySelectorAll("[data-sub]").forEach(b => b.classList.toggle("on", b === sb)); drawChart(sel); return; }
  const hp = t.closest("[data-hp]"); if (hp) { ui.hp = hp.dataset.hp; render(); return; }
  const hm = t.closest("[data-hm]"); if (hm) { ui.hm = hm.dataset.hm; render(); return; }
  const bh = t.closest("[data-bh]"); if (bh) { ui.bh = +bh.dataset.bh; render(); return; }
  const bd = t.closest("[data-bdir]"); if (bd) { ui.bdir = bd.dataset.bdir; render(); return; }
  if (t.closest("[data-rs]")) { ui.preset = "rslead"; ui.sgrp = "Popular"; ui.suni = "all"; ui.sort = { k: "rs_rating", d: -1 }; nav("screener"); return; }
  const rg = t.closest("[data-range]"); if (rg) { ui.range = +rg.dataset.range; document.querySelectorAll("[data-range]").forEach(b => b.classList.toggle("on", b === rg)); drawChart(sel); return; }
  const st = t.closest("[data-star]"); if (st) { const sy = st.dataset.star; my.watch = my.watch.includes(sy) ? my.watch.filter(x => x !== sy) : [...my.watch, sy]; saveMy(); render(); toast(my.watch.includes(sy) ? `${sy} is on your watchlist` : `${sy} removed from your watchlist`); return; }
  const hs = t.closest("[data-hsave]"); if (hs) { const sy = hs.dataset.hsave, q = +$("#hq").value, a = +$("#ha").value; if (!(q > 0 && a > 0)) { toast("Enter the quantity and your average buy price"); return; }
    const h = my.holdings.find(x => x.symbol === sy); if (h) Object.assign(h, { qty: q, avg: a }); else my.holdings.push({ symbol: sy, qty: q, avg: a }); saveMy(); render(); toast(`${sy} saved to your portfolio`); return; }
  const hd = t.closest("[data-hdel]"); if (hd) { my.holdings = my.holdings.filter(x => x.symbol !== hd.dataset.hdel); saveMy(); render(); return; }
  const as = t.closest("[data-aset]"); if (as) { const p = +$("#ap").value; if (!(p > 0)) { toast("Enter the alert price"); return; }
    my.alerts.push({ id: Math.random().toString(36).slice(2, 9), symbol: as.dataset.aset, type: $("#at").value, price: p }); if (!isMine(as.dataset.aset)) my.watch.push(as.dataset.aset); saveMy(); render(); toast("Alert saved"); return; }
  const ad = t.closest("[data-adel]"); if (ad) { my.alerts = my.alerts.filter(a => a.id !== ad.dataset.adel); saveMy(); render(); return; }
  if (t.id === "notif") { try { await Notification.requestPermission(); } catch {} render(); return; }
  if (t.id === "copyBk") { const el = $("#bk"); try { await navigator.clipboard.writeText(el.value); toast("Code copied"); } catch { el.select(); toast("Press Ctrl+C to copy the selected code"); } return; }
  if (t.id === "doRs") { try { const v = JSON.parse(decodeURIComponent(escape(atob($("#rs").value.trim())))); my = { holdings: v.holdings || [], watch: v.watch || [], alerts: v.alerts || [] }; saveMy(); render(); toast("Portfolio restored"); } catch { toast("That code didn't work. Copy the whole code and try again."); } return; }
  if (!t.closest(".search")) $("#gsugg").hidden = true;
});
document.addEventListener("change", e => {
  if (e.target.id === "osel") { ui.osym = e.target.value; drawChain(); return; }
  if (e.target.id === "csort") { ui.csort = e.target.value; render(); return; }
  if (e.target.matches("[data-cmain]")) { ui.cmain = e.target.checked; render(); return; }
  if (e.target.matches("[data-cpenny]")) { ui.cpenny = e.target.checked; render(); return; }
  if (e.target.id === "ssort") { const k = e.target.value; ui.sort = { k, d: k === "symbol" ? 1 : -1 }; render(); } });
document.addEventListener("input", e => {
  const id = e.target.id; if (id !== "nq" && id !== "sq" && id !== "fq") return;
  ui[id === "nq" ? "q" : id === "sq" ? "sq" : "fq"] = e.target.value; const pos = e.target.selectionStart; render(); const el = $("#" + id); el.focus(); el.setSelectionRange(pos, pos);
});
let gi = -1;
$("#gsearch").addEventListener("input", () => {
  const q = $("#gsearch").value.trim().toLowerCase(), box = $("#gsugg"); gi = -1;
  if (!q || !D) { box.hidden = true; return; }
  const hits = D.stocks.filter(s => s.symbol.toLowerCase().startsWith(q)).concat(D.stocks.filter(s => !s.symbol.toLowerCase().startsWith(q) && (s.symbol.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q)))).slice(0, 8);
  box.innerHTML = hits.map(s => `<button data-go="${esc(s.symbol)}"><span><b>${esc(s.symbol)}</b> <span class="muted" style="font-size:12.5px">${esc(s.name)}</span></span><span class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</span></button>`).join("") || '<div class="muted" style="padding:10px 12px">Not tracked. The site covers the Nifty 200.</div>';
  box.hidden = false;
});
$("#gsearch").addEventListener("keydown", e => {
  const items = [...document.querySelectorAll("#gsugg [data-go]")]; if (!items.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); gi = (gi + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((x, i) => x.classList.toggle("on", i === gi)); }
  if (e.key === "Enter") { go((items[gi] || items[0]).dataset.go); $("#gsugg").hidden = true; $("#gsearch").value = ""; $("#gsearch").blur(); }
});
$("#theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("dp-theme", next); } catch {}
  if (sel && S[sel]) drawChart(sel);
});
if (!SNAPSHOT) window.addEventListener("hashchange", () => { readHash(); render(); });

if (!SNAPSHOT) readHash(); else { const h = location.hash.slice(1); if (["markets", "indices", "fno", "options", "circuits", "screener", "w52", "portfolio", "calendar"].includes(h)) view = h; }
tickClock(); setInterval(tickClock, 1000);
document.addEventListener("mouseover", e => { mmPaused = Boolean(e.target.closest("#mm")); });
load(true);
// auto-update: if a newer version of the site has been published, reload once to pick it up
async function checkVersion() {
  try {
    const mine = [...document.scripts].map(x => x.src).find(u => /app\.js\?v=/.test(u))?.match(/v=(\w+)/)?.[1]; if (!mine) return;
    const h = await fetch("./?nv=" + Date.now(), { cache: "no-store" }).then(r => r.text());
    const live = h.match(/app\.js\?v=(\w+)/)?.[1];
    if (live && live !== mine) { toast("A new version of Dalal Pulse is available: updating…"); setTimeout(() => location.reload(), 1500); }
  } catch {}
}
if (!SNAPSHOT) { setInterval(checkVersion, 5 * 60000); setTimeout(checkVersion, 8000); }
if (!SNAPSHOT) { setInterval(() => load(false), 60000); document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); }); }
setInterval(() => { if (D) { footer(); tickSig = ""; renderTicker(); } }, 60000);
})();
