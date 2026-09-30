// Daily technicals from Yahoo Finance prices (5 years, so signals can be back-tested).
// Moving averages, RSI, MACD, Bollinger Bands, support/resistance, breakouts, volume, returns, trend.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const RANGE = "5y";
const CHART_BARS = 252; // bars kept in each stock's chart file (1 year)

async function history(yahooSymbol, range = RANGE) {
  let lastErr;
  for (let a = 0; a < 3; a++) {
    const url = `https://query${a % 2 ? 2 : 1}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=1d`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) { const e = new Error("HTTP 404"); e.final = true; throw e; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.timestamp) throw new Error("no data");
      const q = res.indicators.quote[0];
      const rows = res.timestamp.map((t, i) => ({ t: t * 1000, o: q.open?.[i] ?? q.close[i], c: q.close[i], v: q.volume[i] || 0, h: q.high[i] ?? q.close[i], l: q.low[i] ?? q.close[i] })).filter(r => r.c != null);
      return { rows, meta: res.meta };
    } catch (e) { lastErr = e; if (e.final) break; await new Promise(r => setTimeout(r, 900 * (a + 1))); }
  }
  throw lastErr;
}

const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;

// ---------- indicator series (each value at i uses only data up to i: safe for back-testing) ----------
function smaSeries(x, n) {
  const out = new Array(x.length).fill(null); let s = 0;
  for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= n) s -= x[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
function emaSeries(x, n) {
  const out = new Array(x.length).fill(null), k = 2 / (n + 1); let e = null;
  for (let i = 0; i < x.length; i++) {
    if (x[i] == null) continue;
    if (e == null) { if (i >= n - 1 && x.slice(i - n + 1, i + 1).every(v => v != null)) e = avg(x.slice(i - n + 1, i + 1)); else continue; }
    else e = x[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}
function rsiSeries(c, n = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function stdSeries(x, n, mean) {
  const out = new Array(x.length).fill(null);
  for (let i = n - 1; i < x.length; i++) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += (x[j] - mean[i]) ** 2; out[i] = Math.sqrt(s / n); }
  return out;
}
function rollMax(x, n) { const out = new Array(x.length).fill(null); for (let i = 0; i < x.length; i++) { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (x[j] > m) m = x[j]; out[i] = m; } return out; }
function rollMin(x, n) { const out = new Array(x.length).fill(null); for (let i = 0; i < x.length; i++) { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (x[j] < m) m = x[j]; out[i] = m; } return out; }

function indicators(rows) {
  const c = rows.map(r => r.c), h = rows.map(r => r.h ?? r.c), l = rows.map(r => r.l ?? r.c), v = rows.map(r => r.v || 0);
  const s20 = smaSeries(c, 20), s50 = smaSeries(c, 50), s200 = smaSeries(c, 200);
  const e12 = emaSeries(c, 12), e26 = emaSeries(c, 26);
  const macd = c.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null);
  const sig = emaSeries(macd, 9);
  const sd20 = stdSeries(c, 20, s20);
  const bbU = s20.map((m, i) => m == null ? null : m + 2 * sd20[i]), bbL = s20.map((m, i) => m == null ? null : m - 2 * sd20[i]);
  const bw = s20.map((m, i) => m ? (bbU[i] - bbL[i]) / m : null);
  const vAvg20 = v.map((_, i) => i >= 21 ? avg(v.slice(i - 20, i)) : null); // previous 20 sessions, excluding today
  return { c, h, l, v, s20, s50, s200, macd, sig, rsi: rsiSeries(c), bbU, bbL, bw, vAvg20,
    hi20: rollMax(h, 20), hi252: rollMax(h, 252), lo252: rollMin(l, 252), cHi252: rollMax(c, 252), cLo252: rollMin(c, 252) };
}

// ---------- support / resistance from swing points ----------
function levels(ind, last, price) {
  const W = 5, from = Math.max(W, last - 180);
  const pts = [];
  for (let i = from; i <= last - W; i++) {
    let isH = true, isL = true;
    for (let j = i - W; j <= i + W; j++) { if (ind.h[j] > ind.h[i]) isH = false; if (ind.l[j] < ind.l[i]) isL = false; }
    if (isH) pts.push({ p: ind.h[i], i }); if (isL) pts.push({ p: ind.l[i], i });
  }
  // cluster swing points within 1.5%
  pts.sort((a, b) => a.p - b.p);
  const cl = [];
  for (const x of pts) {
    const k = cl[cl.length - 1];
    if (k && x.p / k.lo - 1 < 0.015) { k.sum += x.p; k.n++; k.hi = x.p; k.last = Math.max(k.last, x.i); }
    else cl.push({ sum: x.p, n: 1, lo: x.p, hi: x.p, last: x.i });
  }
  const lv = cl.map(k => ({ price: k.sum / k.n, touches: k.n, last: k.last }));
  const below = lv.filter(x => x.price < price * 0.995).sort((a, b) => b.price - a.price);
  const above = lv.filter(x => x.price > price * 1.005).sort((a, b) => a.price - b.price);
  const pick = arr => arr.find(x => x.touches >= 2) && Math.abs(arr.find(x => x.touches >= 2).price / price - 1) < 0.12 ? arr.find(x => x.touches >= 2) : arr[0];
  const s = pick(below), r = pick(above);
  return { support: s ? r2(s.price) : null, support_touches: s?.touches || 0, resistance: r ? r2(r.price) : null, resistance_touches: r?.touches || 0 };
}

function crossedUp(a, b, i) { return a[i - 1] != null && b[i - 1] != null && a[i] != null && b[i] != null && a[i - 1] <= b[i - 1] && a[i] > b[i]; }
function crossedDown(a, b, i) { return a[i - 1] != null && b[i - 1] != null && a[i] != null && b[i] != null && a[i - 1] >= b[i - 1] && a[i] < b[i]; }
function within(n, i, fn) { for (let j = Math.max(1, i - n + 1); j <= i; j++) if (fn(j)) return true; return false; }

// technical snapshot at bar i (used for today, and by the back-test for past days)
function snapshotAt(ind, i) {
  const { c } = ind, price = c[i];
  const back = n => i >= n ? (price / c[i - n] - 1) * 100 : null;
  const s50 = ind.s50[i], s200 = ind.s200[i];
  let trend = "Mixed";
  if (s50 && s200) {
    if (price > s50 && s50 > s200) trend = "Strong uptrend";
    else if (price > s200) trend = "Uptrend";
    else if (price < s50 && s50 < s200) trend = "Downtrend";
    else if (price < s200) trend = "Weak";
  }
  const hi = ind.hi252[i], lo = ind.lo252[i];
  return {
    price, sma20: ind.s20[i], sma50: s50, sma200: s200, rsi14: ind.rsi[i], trend,
    above_50: s50 ? price > s50 : null, above_200: s200 ? price > s200 : null,
    golden_cross: within(10, i, j => crossedUp(ind.s50, ind.s200, j)), death_cross: within(10, i, j => crossedDown(ind.s50, ind.s200, j)),
    ret_1w: back(5), ret_1m: back(21), ret_3m: back(63), ret_6m: back(126), ret_9m: back(189), ret_1y: back(Math.min(250, i)),
    high52: hi, low52: lo, from_high_pct: hi ? (price / hi - 1) * 100 : null, from_low_pct: lo ? (price / lo - 1) * 100 : null,
    vol_ratio: ind.vAvg20[i] ? ind.v[i] / ind.vAvg20[i] : null,
  };
}

function compute(rows, livePrice) {
  if (livePrice && rows.length) { rows = rows.slice(); const L = rows[rows.length - 1]; rows[rows.length - 1] = { ...L, c: livePrice, h: Math.max(L.h ?? livePrice, livePrice), l: Math.min(L.l ?? livePrice, livePrice) }; }
  const ind = indicators(rows), last = rows.length - 1, snap = snapshotAt(ind, last), price = snap.price;
  const bwWin = ind.bw.slice(Math.max(0, last - 125), last + 1).filter(x => x != null);
  const squeeze = bwWin.length > 60 && ind.bw[last] != null && ind.bw[last] <= Math.min(...bwWin) * 1.08;
  const macdCross = within(5, last, j => crossedUp(ind.macd, ind.sig, j)) ? "bull" : within(5, last, j => crossedDown(ind.macd, ind.sig, j)) ? "bear" : null;
  const bbPos = ind.bbU[last] != null && ind.bbU[last] !== ind.bbL[last] ? (price - ind.bbL[last]) / (ind.bbU[last] - ind.bbL[last]) : null;
  const prevHi20 = last >= 21 ? Math.max(...ind.h.slice(last - 20, last)) : null;
  const prevHi55 = last >= 56 ? Math.max(...ind.h.slice(last - 55, last)) : null;
  const dayChg = last ? (price / ind.c[last - 1] - 1) * 100 : null;
  const lv = levels(ind, last, price);
  return {
    price: r2(price), sma20: r2(snap.sma20), sma50: r2(snap.sma50), sma200: r2(snap.sma200), rsi14: r2(snap.rsi14),
    vol: ind.v[last], vol_avg20: ind.vAvg20[last] ? Math.round(ind.vAvg20[last]) : null, vol_ratio: r2(snap.vol_ratio),
    ret_1w: r2(snap.ret_1w), ret_1m: r2(snap.ret_1m), ret_3m: r2(snap.ret_3m), ret_6m: r2(snap.ret_6m), ret_9m: r2(snap.ret_9m), ret_1y: r2(snap.ret_1y),
    high52: r2(snap.high52), low52: r2(snap.low52), from_high_pct: r2(snap.from_high_pct), from_low_pct: r2(snap.from_low_pct),
    golden_cross: snap.golden_cross, death_cross: snap.death_cross, trend: snap.trend, above_50: snap.above_50, above_200: snap.above_200,
    // pro indicators
    macd: r2(ind.macd[last]), macd_signal: r2(ind.sig[last]), macd_hist: r2(ind.macd[last] != null && ind.sig[last] != null ? ind.macd[last] - ind.sig[last] : null),
    macd_state: ind.macd[last] == null || ind.sig[last] == null ? null : ind.macd[last] > ind.sig[last] ? "bull" : "bear", macd_cross: macdCross,
    bb_upper: r2(ind.bbU[last]), bb_lower: r2(ind.bbL[last]), bb_pos: r2(bbPos), bb_width: r2(ind.bw[last] != null ? ind.bw[last] * 100 : null), bb_squeeze: squeeze,
    breakout_20d: prevHi20 != null && price > prevHi20, breakout_55d: prevHi55 != null && price > prevHi55,
    vol_surge_up: snap.vol_ratio >= 2 && dayChg > 0, vol_surge_down: snap.vol_ratio >= 2 && dayChg < 0,
    ...lv,
    to_support_pct: lv.support ? r2((lv.support / price - 1) * 100) : null, to_resistance_pct: lv.resistance ? r2((lv.resistance / price - 1) * 100) : null,
  };
}

// Returns {tech, series, quote, rows, ind}; rows/ind stay in memory for the back-test (not written out)
async function analyse(nseSymbol) {
  const { rows, meta } = await history(nseSymbol + ".NS");
  if (rows.length < 30) throw new Error("not enough history");
  const tech = compute(rows, meta.regularMarketPrice);
  const ind = indicators(rows);
  const from = Math.max(0, rows.length - CHART_BARS);
  // chart rows: [time, close, 50dma, 200dma, bbUpper, bbLower, macd, macdSignal, rsi, volume, open, high, low]
  const series = [];
  for (let i = from; i < rows.length; i++) series.push([Math.round(rows[i].t / 1000), r2(rows[i].c), r2(ind.s50[i]), r2(ind.s200[i]), r2(ind.bbU[i]), r2(ind.bbL[i]),
    ind.macd[i] == null ? null : Math.round(ind.macd[i] * 1000) / 1000, ind.sig[i] == null ? null : Math.round(ind.sig[i] * 1000) / 1000, ind.rsi[i] == null ? null : Math.round(ind.rsi[i] * 10) / 10, rows[i].v || 0, r2(rows[i].o), r2(rows[i].h), r2(rows[i].l)]);
  // day change: if the last daily bar is today's session, compare with the bar before it
  const ist = ms => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
  const lastBarDay = ist(rows[rows.length - 1].t), liveDay = meta.regularMarketTime ? ist(meta.regularMarketTime * 1000) : lastBarDay;
  const prev = lastBarDay === liveDay ? rows[rows.length - 2]?.c : rows[rows.length - 1].c;
  const price = meta.regularMarketPrice ?? rows[rows.length - 1].c;
  const quote = { price: r2(price), prev_close: r2(prev), change_pct: prev ? r2((price / prev - 1) * 100) : null, as_of: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null };
  const weekly = toBars(rows, "w");
  return { tech, series, weekly, quote, rows, ind, updated: new Date().toISOString() };
}


// OHLCV bars grouped by IST week ("w") or month ("m"): [time, open, high, low, close, volume]
function toBars(rows, per) {
  const out = []; let cur = null, key = null;
  for (const r of rows) {
    const d = new Date(r.t + 5.5 * 3600e3);
    const k = per === "m" ? d.getUTCFullYear() * 12 + d.getUTCMonth() : Math.floor((d.getTime() / 864e5 + 3) / 7); // weeks start Monday
    if (k !== key) { if (cur) out.push(cur); key = k; cur = [Math.round(r.t / 1000), r2(r.o ?? r.c), r2(r.h), r2(r.l), r2(r.c), r.v || 0]; }
    else { cur[2] = r2(Math.max(cur[2], r.h)); cur[3] = r2(Math.min(cur[3], r.l)); cur[4] = r2(r.c); cur[5] += r.v || 0; }
  }
  if (cur) out.push(cur);
  return out;
}
// Full listed history as monthly bars (Yahoo "max"), cached for a day; refreshed a few dozen stocks per run
async function longHistory(symbols, cacheDir, log, budget = 45) {
  const fs = require("fs"), path = require("path"), dir = path.join(cacheDir, "maxhist"); fs.mkdirSync(dir, { recursive: true });
  const file = s => path.join(dir, s.replace(/[^A-Z0-9&-]/gi, "_") + ".json"), out = {}, need = [];
  for (const s of symbols) { try { const j = JSON.parse(fs.readFileSync(file(s), "utf8")); out[s] = j.bars; if (Date.now() - j.t > 20 * 3600e3) need.push(s); } catch { need.push(s); } }
  const todo = need.slice(0, budget); let ok = 0;
  const w = async () => { while (todo.length) { const s = todo.shift();
    try { const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s + ".NS")}?range=max&interval=1mo`;
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      const res = (await r.json())?.chart?.result?.[0]; const q = res?.indicators?.quote?.[0]; if (!q) continue;
      const bars = res.timestamp.map((t, i) => [t, r2(q.open[i] ?? q.close[i]), r2(q.high[i] ?? q.close[i]), r2(q.low[i] ?? q.close[i]), r2(q.close[i]), q.volume[i] || 0]).filter(b => b[4] != null);
      if (bars.length) { out[s] = bars; fs.writeFileSync(file(s), JSON.stringify({ t: Date.now(), bars })); ok++; } } catch {} } };
  await Promise.all([w(), w(), w(), w()]);
  log(`[maxhist] ${ok} refreshed, ${Object.keys(out).length}/${symbols.length} available`);
  return out;
}

async function analyseMany(symbols, log, concurrency = 6) {
  const out = {}; let failed = 0; const q = [...symbols];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (q.length) { const s = q.shift(); try { out[s] = await analyse(s); } catch { failed++; } }
  }));
  log(`[tech] technicals for ${Object.keys(out).length}/${symbols.length} stocks${failed ? ` (${failed} failed)` : ""}`);
  return out;
}

module.exports = { analyse, analyseMany, toBars, longHistory, compute, history, indicators, snapshotAt, crossedUp, crossedDown, CHART_BARS };
