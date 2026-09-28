// Edge Lab: evidence-based tools that most stock websites don't offer.
//  1) analogs()  — "Setup Déjà-vu": what happened after every past day a stock was in today's exact setup
//                  (its own 5-year history + the same setup across all tracked stocks), no look-ahead.
//  2) rotation() — Sector rotation map (relative-rotation style): RS-Ratio vs RS-Momentum of each sector vs Nifty.
//  3) delivery() — Smart-money tracker from NSE delivery % (real buying vs intraday speculation).
"use strict";
const fs = require("fs");
const path = require("path");

const r1 = v => Math.round(v * 10) / 10;
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function stats(list) {
  if (!list.length) return null;
  const f20 = list.map(x => x[0]), f60 = list.map(x => x[1]).filter(x => x != null);
  return { n: f20.length, win20: Math.round(f20.filter(x => x > 0).length / f20.length * 100), med20: r1(med(f20)), avg20: r1(f20.reduce((a, b) => a + b, 0) / f20.length),
    worst20: r1(Math.min(...f20)), best20: r1(Math.max(...f20)), n60: f60.length, win60: f60.length ? Math.round(f60.filter(x => x > 0).length / f60.length * 100) : null, med60: f60.length ? r1(med(f60)) : null };
}

// ---------- 1) Setup Déjà-vu ----------
const RB = [30, 40, 50, 60, 70], DB = [-8, -3, 0, 3, 8], MB = [-8, -2, 2, 8];
const bucket = (v, edges) => { let i = 0; while (i < edges.length && v >= edges[i]) i++; return i; };
const RL = ["RSI < 30", "RSI 30–40", "RSI 40–50", "RSI 50–60", "RSI 60–70", "RSI ≥ 70"];
const DL = ["> 8% below its 50-day avg", "3–8% below its 50-day avg", "0–3% below its 50-day avg", "0–3% above its 50-day avg", "3–8% above its 50-day avg", "> 8% above its 50-day avg"];
const ML = ["down > 8% in 20 days", "down 2–8% in 20 days", "flat over 20 days", "up 2–8% in 20 days", "up > 8% in 20 days"];
const TL = ["below 50- & 200-day avgs (downtrend)", "above 50-day, below 200-day", "below 50-day, above 200-day (pullback)", "above 50- & 200-day avgs (uptrend)"];
function stateAt(ind, i) {
  const c = ind.c[i], s50 = ind.s50[i], s200 = ind.s200[i], rsi = ind.rsi[i];
  if (c == null || s50 == null || s200 == null || rsi == null || i < 20 || ind.c[i - 20] == null) return null;
  const T = (c > s50 ? 1 : 0) + (c > s200 ? 2 : 0), R = bucket(rsi, RB), Dv = bucket((c / s50 - 1) * 100, DB), M = bucket((c / ind.c[i - 20] - 1) * 100, MB);
  return { T, R, D: Dv, M, key: `${T}|${R}|${Dv}|${M}`, loose: `${T}|${R}|${Dv}` };
}
function analogs(techs, log) {
  const pool = new Map(), poolLoose = new Map(), own = {}, all20 = [];
  for (const [sym, t] of Object.entries(techs)) {
    const ind = t.ind; if (!ind || !ind.c) continue;
    const n = ind.c.length, mine = [];
    let lastKey = {}, lastI = {};
    for (let i = 200; i < n - 20; i++) {
      const st = stateAt(ind, i); if (!st) continue;
      const f20 = (ind.c[i + 20] / ind.c[i] - 1) * 100, f60 = i + 60 < n ? (ind.c[i + 60] / ind.c[i] - 1) * 100 : null;
      if (!isFinite(f20)) continue;
      all20.push(f20);
      // cooldown: count a setup again only after 5 sessions, so one long streak isn't counted 20 times
      if (lastKey[st.key] != null && i - lastKey[st.key] < 5) continue;
      lastKey[st.key] = i;
      const rec = [f20, f60];
      mine.push([st, rec]);
      if (!pool.has(st.key)) pool.set(st.key, []); pool.get(st.key).push(rec);
      if (lastI[st.loose] == null || i - lastI[st.loose] >= 5) { lastI[st.loose] = i; if (!poolLoose.has(st.loose)) poolLoose.set(st.loose, []); poolLoose.get(st.loose).push(rec); }
    }
    own[sym] = mine;
  }
  const base = { win20: Math.round(all20.filter(x => x > 0).length / Math.max(1, all20.length) * 100), med20: r1(med(all20) || 0) };
  const perStock = {};
  for (const [sym, t] of Object.entries(techs)) {
    const ind = t.ind; if (!ind || !ind.c) continue;
    const st = stateAt(ind, ind.c.length - 1); if (!st) continue;
    let ownL = (own[sym] || []).filter(([s]) => s.key === st.key).map(x => x[1]), loose = false;
    if (ownL.length < 8) { ownL = (own[sym] || []).filter(([s]) => s.loose === st.loose).map(x => x[1]); loose = true; }
    let allL = pool.get(st.key) || []; let allLoose = false;
    if (allL.length < 40) { allL = poolLoose.get(st.loose) || []; allLoose = true; }
    perStock[sym] = { label: `${TL[st.T]}; ${RL[st.R]}; ${DL[st.D]}; ${ML[st.M]}`, short: `${["Downtrend", "Bounce", "Pullback", "Uptrend"][st.T]} · ${RL[st.R]} · ${ML[st.M]}`,
      own: stats(ownL), all: stats(allL), loose: loose || allLoose, base };
  }
  // Odds Board: blend own-history and all-stock odds (weights by sample size), rank by edge vs a typical day
  const rows = [];
  for (const [sym, e] of Object.entries(perStock)) {
    const a = e.all, o = e.own; if (!a || a.n < 40) continue;
    const wO = o && o.n >= 6 ? Math.min(0.5, o.n / 40) : 0;
    const win = (1 - wO) * a.win20 + wO * (o ? o.win20 : 0), md = (1 - wO) * a.med20 + wO * (o ? o.med20 : 0);
    e.odds = { win20: Math.round(win), med20: r1(md), edge: r1(md - base.med20), grade: win >= 62 && md - base.med20 >= 1 ? "Strong odds" : win >= 57 && md > base.med20 ? "Favourable" : win <= 45 && md < 0 ? "Poor odds" : "Average" };
    rows.push({ symbol: sym, win20: e.odds.win20, med20: e.odds.med20, edge: e.odds.edge, n: a.n, own_n: o ? o.n : 0, grade: e.odds.grade });
  }
  rows.sort((x, y) => y.edge - x.edge || y.win20 - x.win20);
  log(`[edge] analogs for ${Object.keys(perStock).length} stocks; ${pool.size} distinct setups; baseline win ${base.win20}% med ${base.med20}%`);
  return { perStock, base, board: { best: rows.slice(0, 15), worst: rows.slice(-10).reverse() } };
}

// ---------- 2) Sector rotation (relative-rotation style) ----------
const ROT = { bank: "Bank", fin: "Financial Services", psubank: "PSU Bank", it: "IT", auto: "Auto", pharma: "Pharma", fmcg: "FMCG", metal: "Metal", energy: "Energy", realty: "Realty", infra: "Infrastructure", media: "Media", midcap: "Midcap 100", smallcap: "Smallcap 100" };
function rotation(indicesDir, log) {
  const load = id => { try { return JSON.parse(fs.readFileSync(path.join(indicesDir, id + ".json"), "utf8")).weekly || []; } catch { return []; } };
  const nifty = load("nifty50"); if (nifty.length < 30) { log("[edge] rotation: no Nifty weekly data"); return null; }
  const wk = t => Math.floor((t / 86400 + 3) / 7), nMap = new Map(nifty.map(([t, c]) => [wk(t), c]));
  const items = [];
  for (const [id, name] of Object.entries(ROT)) {
    const w = load(id).filter(([t]) => nMap.has(wk(t))); if (w.length < 30) continue;
    const rs = w.map(([t, c]) => 100 * c / nMap.get(wk(t)));
    const rsr = rs.map((v, i) => { if (i < 9) return null; let s = 0; for (let k = i - 9; k <= i; k++) s += rs[k]; return 100 * v / (s / 10); });
    const pts = [];
    for (let i = rs.length - 7; i < rs.length; i++) { const a = rsr[i], b = rsr[i - 4]; if (a == null || b == null) continue; pts.push([r1(a), r1(a / b * 100)]); }
    if (!pts.length) continue;
    const [x, y] = pts[pts.length - 1];
    const quad = x >= 100 && y >= 100 ? "Leading" : x >= 100 ? "Weakening" : y >= 100 ? "Improving" : "Lagging";
    items.push({ id, name, x, y, quad, trail: pts });
  }
  log(`[edge] rotation: ${items.length} sectors`);
  return { items, note: "Weekly, vs Nifty 50. X = relative strength trend (RS-Ratio), Y = its momentum (RS-Momentum). Sectors usually rotate clockwise: Improving → Leading → Weakening → Lagging." };
}

// ---------- 3) Smart money: NSE delivery % ----------
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const dstr = d => `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${d.getUTCFullYear()}`;
async function delivery(symbols, cacheDir, log) {
  const dir = path.join(cacheDir, "deliv"); fs.mkdirSync(dir, { recursive: true });
  const want = new Set(symbols), nowIst = new Date(Date.now() + 5.5 * 3600e3);
  const days = []; let fetched = 0;
  for (let k = 0; k < 40 && days.length < 21; k++) {
    const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - k)); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const id = dstr(d), f = path.join(dir, id + ".json");
    let rec = null;
    if (fs.existsSync(f)) rec = JSON.parse(fs.readFileSync(f, "utf8"));
    const recent = k <= 1;
    if ((!rec || (rec.none && recent && Date.now() - rec.at > 30 * 60e3)) && fetched < 8) {
      fetched++;
      try {
        const r = await fetch(`https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${id}.csv`, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const lines = (await r.text()).split(/\r?\n/), hdr = (lines.shift() || "").split(",").map(x => x.trim());
          const ix = n => hdr.indexOf(n), iS = ix("SYMBOL"), iSe = ix("SERIES"), iC = ix("CLOSE_PRICE"), iP = ix("PREV_CLOSE"), iQ = ix("DELIV_QTY"), iD = ix("DELIV_PER"), iT = ix("TTL_TRD_QNTY");
          const data = {};
          for (const l of lines) { const c = l.split(",").map(x => x.trim()); if (c[iSe] !== "EQ" || !want.has(c[iS])) continue; const dp = parseFloat(c[iD]), dq = parseFloat(c[iQ]); if (!isFinite(dp)) continue; data[c[iS]] = [dp, dq, parseFloat(c[iC]), parseFloat(c[iP]), parseFloat(c[iT])]; }
          rec = Object.keys(data).length > 20 ? { date: d.toISOString().slice(0, 10), data } : { none: true, at: Date.now() };
        } else rec = { none: true, at: Date.now() };
      } catch { rec = rec || { none: true, at: Date.now() }; }
      if (!recent || !rec.none) fs.writeFileSync(f, JSON.stringify(rec)); else fs.writeFileSync(f, JSON.stringify(rec));
    }
    if (rec && !rec.none) days.push(rec);
  }
  // prune very old cache files
  try { for (const f of fs.readdirSync(dir)) { const m = f.match(/^(\d\d)(\d\d)(\d{4})\.json$/); if (m && Date.now() - Date.UTC(+m[3], +m[2] - 1, +m[1]) > 70 * 864e5) fs.unlinkSync(path.join(dir, f)); } } catch {}
  if (!days.length) { log("[edge] delivery: no NSE delivery files reachable"); return null; }
  const today = days[0], hist = days.slice(1, 21), perStock = {};
  for (const [sym, [dp, dq, c, p]] of Object.entries(today.data)) {
    const h = hist.map(d => d.data[sym]).filter(Boolean); if (h.length < 5) continue;
    const avgDp = h.reduce((a, x) => a + x[0], 0) / h.length, avgDq = h.reduce((a, x) => a + x[1], 0) / h.length;
    const chg = p ? (c / p - 1) * 100 : 0, ratio = avgDq ? dq / avgDq : null;
    const last5 = [today.data[sym], ...hist.slice(0, 4).map(d => d.data[sym])].filter(Boolean);
    const accDays = last5.filter(x => x[3] && x[2] > x[3] && x[0] > avgDp).length, distDays = last5.filter(x => x[3] && x[2] < x[3] && x[0] > avgDp).length;
    let tag = null;
    if (chg > 0.5 && ratio >= 1.5 && dp >= avgDp + 5) tag = "Accumulation";
    else if (chg < -0.5 && ratio >= 1.5 && dp >= avgDp + 5) tag = "Distribution";
    else if (chg > 2 && dp < avgDp - 8) tag = "Speculative rally";
    else if (accDays >= 4) tag = "Steady accumulation";
    else if (distDays >= 4) tag = "Steady distribution";
    perStock[sym] = { dp: r1(dp), avg_dp: r1(avgDp), dq_ratio: ratio ? r1(ratio) : null, chg: r1(chg), acc5: accDays, dist5: distDays, tag };
  }
  const list = tag => Object.entries(perStock).filter(([, v]) => v.tag === tag).sort((a, b) => (b[1].dq_ratio || 0) - (a[1].dq_ratio || 0)).map(([s, v]) => ({ symbol: s, ...v }));
  log(`[edge] delivery ${today.date}: ${Object.keys(perStock).length} stocks, ${hist.length} days of history`);
  return { date: today.date, days: hist.length + 1, perStock, accumulation: list("Accumulation").concat(list("Steady accumulation")).slice(0, 15), distribution: list("Distribution").concat(list("Steady distribution")).slice(0, 12), speculative: list("Speculative rally").slice(0, 8) };
}

module.exports = { analogs, rotation, delivery };
