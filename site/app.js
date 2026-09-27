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
const ui = { nf: "withnews", q: "", preset: "all", sort: { k: "change_pct", d: -1 }, w52: "highs", w52s: "all", cal: "tracked", range: 252, sq: "" };
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
  renderTape(); renderBand(); render(); footer(); checkAlerts(first);
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
    h += `<div class="tk"><div class="l">${esc(p.label)}</div><div class="v">${fmt(p.last, p.last > 1000 ? 0 : 2)}</div><div class="c ${cls(c)}">${pct(p.change_pct)}</div></div>`;
  }
  for (const f of D.fii_dii || []) h += `<div class="tk" title="Net buying in the cash market, ₹ crore, ${esc(f.date)}"><div class="l">${esc(f.category.replace("/FPI", ""))} net · ₹ cr</div><div class="v ${cls(f.net)}">${f.net >= 0 ? "+" : "−"}${fmt(Math.abs(f.net), 0)}</div><div class="c muted">${esc(f.date)}</div></div>`;
  $("#band").innerHTML = h;
  countUp($("#band"));
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
  if (["news", "markets", "screener", "w52", "portfolio", "calendar"].includes(v)) { view = v; sel = s ? decodeURIComponent(s).toUpperCase() : null; }
}
const go = sym => nav("news", sym);

function render() {
  if (!D) return;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.nav === view));
  const keep = document.querySelector(".list")?.scrollTop;
  $("#view").innerHTML = view === "markets" ? markets() : view === "screener" ? screener() : view === "w52" ? w52() : view === "portfolio" ? portfolio() : view === "calendar" ? calendar() : newsView();
  if (keep && document.querySelector(".list")) document.querySelector(".list").scrollTop = keep;
  if (view === "news") { if (sel && S[sel]) drawChart(sel); document.querySelector(".row.on")?.scrollIntoView({ block: "nearest" }); }
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
      <div class="m"><span class="badge ${ins.signal}">${esc(ins.label)}</span>${news.length ? `<span>${news.length} ${news.length === 1 ? "story" : "stories"}</span><span class="tdots" title="Tone of recent headlines">${news.slice(0, 6).map(n => `<i class="${n.tone}"></i>`).join("")}</span><span>${ago(latest.published)}</span>` : "<span>No recent news</span>"}</div>
      ${latest ? `<div class="hl">${esc(latest.title)}</div>` : ""}</button>`;
  }).join("") || `<div class="empty"><b>No stocks here yet</b>${ui.nf === "mine" ? "Use ☆ Watch or Add to portfolio on any stock." : "Try another filter."}</div>`;
  const detail = sel ? (sel === "__MARKET" ? marketNewsDetail(general) : stockDetail(sel)) : glance();
  return `<div class="md${sel ? " detail-open" : ""}">
    <section class="card master" aria-label="Stocks">
      <div class="tools"><input class="field" id="nq" placeholder="Filter stocks or headlines" value="${esc(ui.q)}" aria-label="Filter stocks or headlines">
        <div class="chips">${chip("withnews", "In the news")}${chip("mine", "★ Mine")}${chip("n50", "Nifty 50")}${chip("pos", "Good news")}${chip("neg", "Bad news")}${chip("all", "All 200")}</div></div>
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
function glance() {
  const m = D.mood, top = D.stocks.filter(s => s.news_ids.length).sort((a, b) => b.news_ids.length - a.news_ids.length || Math.abs(b.change_pct) - Math.abs(a.change_pct)).slice(0, 6);
  return `<div class="sect"><h3>Today on Dalal Street</h3><div class="glance"><div class="gauge">${gaugeSvg(m.score, m.label)}</div><div>${m.lines.map(l => `<p>${esc(l)}</p>`).join("")}</div></div></div>
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
function newsItem(n) {
  return `<div class="news-item"><span class="tone ${n.tone}" title="${n.tone} tone${n.words.length ? ": " + esc(n.words.join(", ")) : ""}"></span><div>
    <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
    <div class="m"><span>${ago(n.published)}</span><span>${esc(n.source)}</span>${n.symbols.filter(s => s !== sel).slice(0, 4).map(s => `<button class="sy" data-go="${esc(s)}">${esc(s)}</button>`).join("")}${n.tone !== "neutral" ? `<span class="${n.tone === "positive" ? "up" : "down"}">${n.tone === "positive" ? "▲ positive" : "▼ negative"}</span>` : ""}</div></div></div>`;
}
function meter(label, v) {
  if (v == null) return `<div class="meter"><div class="l"><span>${label}</span><span>–</span></div><div class="bar"><b></b></div></div>`;
  const w = Math.min(50, Math.abs(v) / 2), left = v >= 0 ? 50 : 50 - w;
  return `<div class="meter"><div class="l"><span>${label}</span><span class="${cls(v)}">${v > 0 ? "+" : ""}${v}</span></div><div class="bar"><b></b><i style="left:50%;width:0;background:${v >= 0 ? "var(--up)" : "var(--down)"}" data-w="${w}%" data-l="${left}%"></i></div></div>`;
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
      <div class="muted" style="font-size:12px;margin-top:10px">Built from rules: headline tone words, trend, moving averages, RSI, volume and the 52-week range. Not investment advice.</div>
    </div>
    <div class="sect"><h3>News · ${news.length}</h3>${news.length ? news.map(newsItem).join("") : '<div class="muted">No Moneycontrol stories in the last few days.</div>'}</div>
    <div class="sect"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><h3 style="margin:0">Price chart</h3>
      <div class="seg">${[[21, "1M"], [63, "3M"], [126, "6M"], [252, "1Y"]].map(([n, l]) => `<button data-range="${n}" class="${ui.range === n ? "on" : ""}" aria-label="${range[n]}">${l}</button>`).join("")}</div></div>
      <div class="legend"><span><i style="background:var(--s1)"></i>Price</span><span><i style="background:var(--s2)"></i>50-day average</span><span><i style="background:var(--s3)"></i>200-day average</span></div>
      <div class="chart" id="chart"><div class="skeleton" style="height:230px"></div></div></div>
    <div class="sect"><h3>Key numbers</h3><div class="stats">
      ${[["Trend", esc(t.trend || "–")], ["RSI (14)", fmt(t.rsi14, 0) + (t.rsi14 > 70 ? " · overbought" : t.rsi14 < 30 ? " · oversold" : "")], ["Volume vs 20-day", t.vol_ratio == null ? "–" : fmt(t.vol_ratio, 1) + "×"],
         ["From 52W high", `<span class="${cls(t.from_high_pct)}">${pct(t.from_high_pct)}</span>`], ["50-day avg", vsMa(t.sma50)], ["200-day avg", vsMa(t.sma200)], ["52W high", px(t.high52)], ["52W low", px(t.low52)],
         ["1 week", `<span class="${cls(t.ret_1w)}">${pct(t.ret_1w)}</span>`], ["1 month", `<span class="${cls(t.ret_1m)}">${pct(t.ret_1m)}</span>`], ["3 months", `<span class="${cls(t.ret_3m)}">${pct(t.ret_3m)}</span>`], ["1 year", `<span class="${cls(t.ret_1y)}">${pct(t.ret_1y)}</span>`]]
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
async function drawChart(sym) {
  const box = $("#chart"); if (!box) return;
  try { if (!charts[sym]) { const r = await fetch(`data/charts/${sym.replace(/[^A-Z0-9&-]/gi, "_")}.json?t=${D.generated_at}`); charts[sym] = await r.json(); } }
  catch { box.innerHTML = '<div class="muted">Chart unavailable.</div>'; return; }
  if (!$("#chart") || sel !== sym) return;
  const pts = charts[sym].slice(-ui.range).map(([t, c, a, b]) => ({ t: t * 1000, c, s50: a, s200: b }));
  if (pts.length < 2) { $("#chart").innerHTML = '<div class="muted">Chart unavailable.</div>'; return; }
  const W = 720, H = 250, L = 8, R = 60, T = 12, B = 24;
  const vals = pts.flatMap(p => [p.c, p.s50, p.s200]).filter(v => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pd = (hi - lo) * 0.08 || 1; lo -= pd; hi += pd;
  const x = i => L + i / (pts.length - 1) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = k => { let d = "", on = false; pts.forEach((p, i) => { if (p[k] == null) { on = false; return; } d += (on ? "L" : "M") + x(i).toFixed(1) + " " + y(p[k]).toFixed(1); on = true; }); return d; };
  const last = pts[pts.length - 1], chg = (last.c / pts[0].c - 1) * 100;
  const lab = (k, c) => last[k] == null ? "" : `<circle cx="${x(pts.length - 1)}" cy="${y(last[k])}" r="3.5" fill="${c}" stroke="var(--card)" stroke-width="2"/>`;
  const dfmt = t => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(ui.range > 130 ? { year: "2-digit" } : {}) });
  const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * (i + 0.5) / 4);
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(sym)} price with 50 and 200 day averages">
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--s1)" stop-opacity=".22"/><stop offset="1" stop-color="var(--s1)" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(g => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)"/><text x="${W - R + 7}" y="${y(g) + 4}" font-size="10.5" fill="var(--muted)">${fmt(g, g > 1000 ? 0 : 1)}</text>`).join("")}
    ${[0, Math.floor(pts.length / 2), pts.length - 1].map(i => `<text x="${x(i)}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}">${dfmt(pts[i].t)}</text>`).join("")}
    <path d="${line("c")}L${x(pts.length - 1)} ${H - B}L${x(0)} ${H - B}Z" fill="url(#ga)"/>
    <path d="${line("s200")}" fill="none" stroke="var(--s3)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <path d="${line("s50")}" fill="none" stroke="var(--s2)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <path d="${line("c")}" fill="none" stroke="var(--s1)" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
    ${lab("s200", "var(--s3)")}${lab("s50", "var(--s2)")}${lab("c", "var(--s1)")}
    <line id="xh" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
  </svg><div class="tip" id="tip" hidden></div>
  <div class="muted" style="font-size:12.5px;margin-top:6px">Last ${{ 21: "month", 63: "3 months", 126: "6 months", 252: "year" }[ui.range]}: <b class="num ${cls(chg)}">${pct(chg)}</b> · price ${px(last.c)}${last.s50 ? ` · 50-day ${px(last.s50)}` : ""}${last.s200 ? ` · 200-day ${px(last.s200)}` : ""}</div>`;
  const svg = $("#chart svg"), tip = $("#tip"), xh = $("#xh");
  const move = cx => {
    const b = svg.getBoundingClientRect(), sx = (cx - b.left) / b.width * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((sx - L) / (W - L - R) * (pts.length - 1)))), p = pts[i];
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
    tip.hidden = false; tip.innerHTML = `<b>${new Date(p.t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</b><br>Price ${px(p.c)}${p.s50 ? `<br><span style="color:var(--s2)">■</span> 50-day ${px(p.s50)}` : ""}${p.s200 ? `<br><span style="color:var(--s3)">■</span> 200-day ${px(p.s200)}` : ""}`;
    const lx = x(i) / W * b.width; tip.style.left = (lx > b.width - 180 ? lx - 170 : lx + 12) + "px"; tip.style.top = "6px";
  };
  svg.onmousemove = e => move(e.clientX); svg.ontouchmove = e => move(e.touches[0].clientX);
  svg.onmouseleave = () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); };
}

// ---------- MARKETS ----------
function heat(c) { if (c == null) return "background:var(--paper2)"; const a = Math.min(1, Math.abs(c) / 3); return `background:color-mix(in srgb, ${c >= 0 ? "var(--up)" : "var(--down)"} ${Math.round(14 + a * 56)}%, var(--mid))`; }
function markets() {
  const m = D.mood, withP = D.stocks.filter(s => s.change_pct != null);
  const gain = [...withP].sort((a, b) => b.change_pct - a.change_pct).slice(0, 8), lose = [...withP].sort((a, b) => a.change_pct - b.change_pct).slice(0, 8);
  const mv = s => `<button class="mv" data-go="${esc(s.symbol)}"><span><b>${esc(s.symbol)}</b> <span class="muted" style="font-size:12.5px">${esc((s.name || "").slice(0, 28))}</span></span><span class="num"><span class="muted">${px(s.price)}</span> <b class="${cls(s.change_pct)}">${pct(s.change_pct)}</b></span></button>`;
  const maxF = Math.max(1, ...(D.fii_dii || []).map(f => Math.max(f.buy, f.sell)));
  return `<div class="fade"><h1 class="page">Markets today</h1><p class="sub">Mood, sectors, institutional flows and the biggest movers among ${D.stocks.length} Nifty 200 stocks.</p>
  <div class="grid g2">
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
  ${D.industries.length ? `<div class="card" style="margin-top:16px"><div class="hd"><h2>Nifty 200 by industry</h2><span class="muted" style="font-size:12.5px">average day change · tap a stock</span></div><div class="bd"><div class="heat">
    ${D.industries.map(g => `<div class="tile" style="${heat(g.change_pct)}"><b>${esc(g.name)}</b><div class="v">${pct(g.change_pct)}</div><div class="m">${g.count} stocks · ${g.top.map(s => `<button class="sy" data-go="${esc(s)}">${esc(s)}</button>`).join(" ")}</div></div>`).join("")}</div></div></div>` : ""}
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="hd"><h2>Top gainers</h2></div><div class="bd" style="padding-top:4px">${gain.map(mv).join("")}</div></div>
    <div class="card"><div class="hd"><h2>Top losers</h2></div><div class="bd" style="padding-top:4px">${lose.map(mv).join("")}</div></div>
  </div></div>`;
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
};
function screener() {
  const rows0 = D.stocks.filter(s => s.tech).map(s => ({ s, t: s.tech }));
  const [label, desc, f] = PRESETS[ui.preset], q = ui.sq.trim().toLowerCase();
  const val = (r, k) => k === "symbol" ? r.s.symbol : k === "industry" ? r.s.industry : k === "change_pct" ? r.s.change_pct : k === "signal" ? r.s.insight.score : k === "news" ? r.s.news_ids.length : r.t[k];
  const rows = rows0.filter(r => f(r) && (!q || r.s.symbol.toLowerCase().includes(q) || (r.s.name || "").toLowerCase().includes(q) || (r.s.industry || "").toLowerCase().includes(q)))
    .sort((a, b) => { const x = val(a, ui.sort.k), y = val(b, ui.sort.k); return (typeof x === "string" ? String(x).localeCompare(y || "") : ((x ?? -1e9) - (y ?? -1e9))) * ui.sort.d; });
  const th = (k, l, left) => `<th class="${left ? "l" : ""}"><button data-sort="${k}">${l}${ui.sort.k === k ? (ui.sort.d > 0 ? " ▲" : " ▼") : ""}</button></th>`;
  return `<div class="fade"><h1 class="page">Screener</h1><p class="sub">Scan ${rows0.length} stocks by trend, momentum and volume. Tap any row for its news, chart and insight.</p>
  <div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="chip${k === ui.preset ? " on" : ""}" data-preset="${k}">${p[0]}<span class="n">${rows0.filter(p[2]).length}</span></button>`).join("")}</div>
  <div class="explain"><b>${esc(label)}.</b> ${esc(desc)}</div>
  <div class="card"><div class="hd"><input class="field" id="sq" placeholder="Filter by name or industry" value="${esc(ui.sq)}" style="flex:1;min-width:180px" aria-label="Filter screener"><span class="muted num">${rows.length} stocks</span></div>
  <div class="tblwrap"><table class="tbl"><thead><tr>${th("symbol", "Stock", 1)}${th("industry", "Industry", 1)}${th("price", "Price")}${th("change_pct", "Day")}${th("signal", "Signal", 1)}${th("rsi14", "RSI")}${th("from_high_pct", "From 52W high")}${th("vol_ratio", "Volume")}${th("ret_1m", "1M")}${th("ret_1y", "1Y")}${th("news", "News")}</tr></thead><tbody>
  ${rows.map(({ s, t }) => `<tr data-go="${esc(s.symbol)}"><td class="l"><span class="sym">${esc(s.symbol)}</span> ${s.nifty50 ? '<span class="badge n50">N50</span>' : ""}</td><td class="l muted">${esc((s.industry || "").slice(0, 26))}</td>
    <td class="num">${px(s.price)}</td><td class="num ${cls(s.change_pct)}">${pct(s.change_pct)}</td><td class="l"><span class="badge ${s.insight.signal}">${esc(s.insight.label)}</span></td>
    <td class="num ${t.rsi14 < 30 ? "down" : t.rsi14 > 70 ? "up" : ""}">${fmt(t.rsi14, 0)}</td><td class="num">${pct(t.from_high_pct)}</td><td class="num ${t.vol_ratio >= 2 ? "up" : ""}">${t.vol_ratio == null ? "–" : fmt(t.vol_ratio, 1) + "×"}</td>
    <td class="num ${cls(t.ret_1m)}">${pct(t.ret_1m)}</td><td class="num ${cls(t.ret_1y)}">${pct(t.ret_1y)}</td><td class="num">${s.news_ids.length || ""}</td></tr>`).join("") || `<tr><td colspan="11"><div class="empty">No stocks match this scan right now.</div></td></tr>`}
  </tbody></table></div></div></div>`;
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
  const seen = new Set(store.get("dp-seen", []));
  if (!first) for (const n of D.news.filter(n => n.symbols.some(isMine) && !seen.has(n.id)).slice(0, 3)) fired.push(`${n.symbols.filter(isMine).join(", ")}: ${n.title}`);
  store.set("dp-seen", D.news.map(n => n.id));
  if (changed) saveMy();
  for (const m of fired) { toast(m); if ("Notification" in window && Notification.permission === "granted") try { new Notification("Dalal Pulse", { body: m }); } catch {} }
}

// ---------- events ----------
document.addEventListener("click", async e => {
  const t = e.target;
  const n = t.closest("[data-nav]"); if (n) { nav(n.dataset.nav); return; }
  if (t.closest("a[href]")) return;
  const g = t.closest("[data-go]"); if (g) { $("#gsugg").hidden = true; go(g.dataset.go); return; }
  const s = t.closest("[data-sel]"); if (s) { sel = s.dataset.sel; if (!SNAPSHOT) history.replaceState(null, "", "#news/" + encodeURIComponent(sel)); render(); if (innerWidth <= 900) window.scrollTo({ top: 0 }); return; }
  if (t.closest("[data-back]")) { nav("news"); return; }
  const nf = t.closest("[data-nf]"); if (nf) { ui.nf = nf.dataset.nf; render(); return; }
  const pr = t.closest("[data-preset]"); if (pr) { ui.preset = pr.dataset.preset; render(); return; }
  const so = t.closest("[data-sort]"); if (so) { const k = so.dataset.sort; ui.sort = { k, d: ui.sort.k === k ? -ui.sort.d : (["symbol", "industry"].includes(k) ? 1 : -1) }; render(); return; }
  const w = t.closest("[data-w52]"); if (w) { ui.w52 = w.dataset.w52; render(); return; }
  const ws = t.closest("[data-w52s]"); if (ws) { ui.w52s = ws.dataset.w52s; render(); return; }
  const c = t.closest("[data-cal]"); if (c) { ui.cal = c.dataset.cal; render(); return; }
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
document.addEventListener("input", e => {
  const id = e.target.id; if (id !== "nq" && id !== "sq") return;
  ui[id === "nq" ? "q" : "sq"] = e.target.value; const pos = e.target.selectionStart; render(); const el = $("#" + id); el.focus(); el.setSelectionRange(pos, pos);
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

if (!SNAPSHOT) readHash(); else { const h = location.hash.slice(1); if (["markets", "screener", "w52", "portfolio", "calendar"].includes(h)) view = h; }
tickClock(); setInterval(tickClock, 1000);
load(true);
if (!SNAPSHOT) { setInterval(() => load(false), 60000); document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); }); }
setInterval(() => { if (D) footer(); }, 30000);
})();
