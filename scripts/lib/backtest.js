// Signal track record: replays every signal over ~5 years of daily prices for all tracked stocks
// and measures what actually happened 5, 20 and 60 trading days later (vs the Nifty 50 over the same days).
// Everything is computed only from data available on the signal day, so there is no look-ahead.
const { snapshotAt, crossedUp, crossedDown } = require("./technicals");
const { techScore } = require("./insights");

const HORIZONS = [5, 20, 60];
const COOLDOWN = 10; // ignore repeats of the same signal on the same stock within 10 sessions

// dir: "up" = the signal suggests strength (a hit is a rise); "down" = suggests weakness (a hit is a fall)
const SIGNALS = [
  { id: "golden", name: "Golden cross", dir: "up", desc: "50-day average crosses above the 200-day.", from: 201, fn: (d, i) => crossedUp(d.s50, d.s200, i) },
  { id: "death", name: "Death cross", dir: "down", desc: "50-day average crosses below the 200-day.", from: 201, fn: (d, i) => crossedDown(d.s50, d.s200, i) },
  { id: "above200", name: "Crosses above 200-day", dir: "up", desc: "Price closes back above its 200-day average.", from: 201, fn: (d, i) => crossedUp(d.c, d.s200, i) },
  { id: "below200", name: "Falls below 200-day", dir: "down", desc: "Price closes below its 200-day average.", from: 201, fn: (d, i) => crossedDown(d.c, d.s200, i) },
  { id: "high52", name: "New 52-week high", dir: "up", desc: "Closes at a new 52-week closing high.", from: 253, fn: (d, i) => d.c[i] >= d.cHi252[i] && d.c[i - 1] < d.cHi252[i - 1] },
  { id: "low52", name: "New 52-week low", dir: "down", desc: "Closes at a new 52-week closing low.", from: 253, fn: (d, i) => d.c[i] <= d.cLo252[i] && d.c[i - 1] > d.cLo252[i - 1] },
  { id: "brk20v", name: "20-day breakout on 2× volume", dir: "up", desc: "Closes above the previous 20-day high with volume at least twice its average.", from: 30, fn: (d, i) => d.c[i] > d.hi20[i - 1] && d.vAvg20[i] && d.v[i] >= 2 * d.vAvg20[i] },
  { id: "volup", name: "Volume surge, price up 3%+", dir: "up", desc: "Volume 2× average on a day the stock rises 3% or more.", from: 30, fn: (d, i) => d.vAvg20[i] && d.v[i] >= 2 * d.vAvg20[i] && d.c[i] / d.c[i - 1] >= 1.03 },
  { id: "voldn", name: "Volume surge, price down 3%+", dir: "down", desc: "Volume 2× average on a day the stock falls 3% or more.", from: 30, fn: (d, i) => d.vAvg20[i] && d.v[i] >= 2 * d.vAvg20[i] && d.c[i] / d.c[i - 1] <= 0.97 },
  { id: "macdup", name: "MACD bullish cross", dir: "up", desc: "MACD line crosses above its signal line.", from: 40, fn: (d, i) => crossedUp(d.macd, d.sig, i) },
  { id: "macddn", name: "MACD bearish cross", dir: "down", desc: "MACD line crosses below its signal line.", from: 40, fn: (d, i) => crossedDown(d.macd, d.sig, i) },
  { id: "rsios", name: "RSI oversold (< 30)", dir: "up", desc: "RSI drops below 30, tested as a bounce signal.", from: 20, fn: (d, i) => d.rsi[i - 1] != null && d.rsi[i - 1] >= 30 && d.rsi[i] < 30 },
  { id: "rsiob", name: "RSI overbought (> 70)", dir: "down", desc: "RSI rises above 70, tested as a 'pause likely' signal.", from: 20, fn: (d, i) => d.rsi[i - 1] != null && d.rsi[i - 1] <= 70 && d.rsi[i] > 70 },
  { id: "bbsq", name: "Bollinger squeeze breakout", dir: "up", desc: "Bands at their tightest in 6 months, then a close above the upper band.", from: 150,
    fn: (d, i) => { if (!(d.bbU[i] != null && d.c[i] > d.bbU[i] && d.c[i - 1] <= d.bbU[i - 1])) return false; let mn = Infinity; for (let j = i - 125; j < i - 5; j++) if (d.bw[j] != null && d.bw[j] < mn) mn = d.bw[j]; for (let j = i - 5; j <= i; j++) if (d.bw[j] != null && d.bw[j] <= mn * 1.05) return true; return false; } },
  { id: "pullback", name: "Dip in an uptrend", dir: "up", desc: "Above the 200-day, but below the 20-day with RSI 35–50 (same rule as the screener).", from: 201,
    fn: (d, i) => { const ok = j => d.s200[j] && d.c[j] > d.s200[j] && d.c[j] < d.s20[j] && d.rsi[j] >= 35 && d.rsi[j] <= 50; return ok(i) && !ok(i - 1); } },
  { id: "tsbull", name: "Site label: Positive momentum (chart part)", dir: "up", desc: "The technical half of this site's score rises above +35.", from: 253, score: true,
    fn: (d, i) => d._ts[i] != null && d._ts[i] > 0.35 && !(d._ts[i - 1] > 0.35) },
  { id: "tsbear", name: "Site label: Under pressure (chart part)", dir: "down", desc: "The technical half of this site's score falls below −35.", from: 253, score: true,
    fn: (d, i) => d._ts[i] != null && d._ts[i] < -0.35 && !(d._ts[i - 1] < -0.35) },
];

const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dayKey = ms => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);

function run(stocks, niftyRows, log = () => {}) {
  // Nifty close by date, for "vs Nifty" comparisons
  const nIdx = {}, nC = niftyRows ? niftyRows.map(r => r.c) : [];
  (niftyRows || []).forEach((r, i) => { nIdx[dayKey(r.t)] = i; });
  const niftyFwd = (t, k) => { const i = nIdx[dayKey(t)]; return i != null && i + k < nC.length ? (nC[i + k] / nC[i] - 1) * 100 : null; };

  const acc = {}; for (const s of SIGNALS) acc[s.id] = Object.fromEntries(HORIZONS.map(h => [h, { r: [], x: [] }]));
  const base = Object.fromEntries(HORIZONS.map(h => [h, { r: [], x: [] }]));
  const perStock = {}, recent = [];
  let firstDay = null, lastDay = null;

  for (const [sym, { rows, ind }] of Object.entries(stocks)) {
    if (!rows || rows.length < 60) continue;
    const d = ind, n = rows.length, events = [], lastAt = {};
    // the site's technical score at every bar (only needed from bar 253)
    d._ts = new Array(n).fill(null);
    for (let i = 252; i < n; i++) d._ts[i] = techScore(snapshotAt(d, i));
    // baseline: every day, sampled every 5 sessions
    for (let i = 252; i < n; i += 5) for (const h of HORIZONS) if (i + h < n) { const r = (d.c[i + h] / d.c[i] - 1) * 100; base[h].r.push(r); const nx = niftyFwd(rows[i].t, h); if (nx != null) base[h].x.push(r - nx); }
    for (const sg of SIGNALS) {
      for (let i = Math.max(sg.from, 1); i < n; i++) {
        let hit = false; try { hit = sg.fn(d, i); } catch {}
        if (!hit) continue;
        if (lastAt[sg.id] != null && i - lastAt[sg.id] < COOLDOWN) continue;
        lastAt[sg.id] = i;
        const ev = { d: dayKey(rows[i].t), s: sg.id, p: r2(d.c[i]) };
        for (const h of HORIZONS) if (i + h < n) {
          const r = (d.c[i + h] / d.c[i] - 1) * 100; ev["r" + h] = r2(r);
          acc[sg.id][h].r.push(r); const nx = niftyFwd(rows[i].t, h); if (nx != null) acc[sg.id][h].x.push(r - nx);
        }
        events.push(ev);
        if (!firstDay || ev.d < firstDay) firstDay = ev.d; if (!lastDay || ev.d > lastDay) lastDay = ev.d;
        if (n - 1 - i < 10) recent.push({ symbol: sym, ...ev, ago: n - 1 - i });
      }
    }
    events.sort((a, b) => b.d.localeCompare(a.d));
    perStock[sym] = events.filter(e => e.d >= dayKey(rows[Math.max(0, n - 504)].t)).slice(0, 40); // last ~2 years
    delete d._ts;
  }

  const summ = (bucket, dir) => {
    const r = bucket.r; if (!r.length) return { n: 0 };
    const hits = r.filter(x => dir === "down" ? x < 0 : x > 0).length;
    return { n: r.length, avg: r2(r.reduce((a, x) => a + x, 0) / r.length), med: r2(median(r)), hit: Math.round(hits / r.length * 100),
      up: Math.round(r.filter(x => x > 0).length / r.length * 100), vs_nifty: bucket.x.length ? r2(bucket.x.reduce((a, x) => a + x, 0) / bucket.x.length) : null };
  };
  const baseline = Object.fromEntries(HORIZONS.map(h => [h, summ(base[h], "up")]));
  const signals = SIGNALS.map(sg => {
    const res = Object.fromEntries(HORIZONS.map(h => [h, summ(acc[sg.id][h], sg.dir)]));
    // edge: how much better than an average day (in the signal's own direction), at 20 days
    const b = baseline[20], s = res[20];
    const edge = s.n && b.n ? r2(sg.dir === "down" ? b.avg - s.avg : s.avg - b.avg) : null;
    const hitEdge = s.n && b.n ? (sg.dir === "down" ? s.hit - (100 - b.up) : s.hit - b.up) : null;
    let verdict = "Too few cases";
    if (s.n >= 30) verdict = edge >= 1 && hitEdge >= 3 ? "Worked well" : edge >= 0.3 && hitEdge >= 0 ? "Slight edge" : edge <= -0.5 ? "Worked the opposite way" : "No real edge";
    return { id: sg.id, name: sg.name, dir: sg.dir, desc: sg.desc, results: res, edge20: edge, hit_edge20: hitEdge, verdict };
  });
  recent.sort((a, b) => a.ago - b.ago || a.symbol.localeCompare(b.symbol));
  log(`[backtest] ${signals.reduce((a, s) => a + (s.results[20].n || 0), 0)} signal cases scored across ${Object.keys(perStock).length} stocks (${firstDay} → ${lastDay})`);
  return { summary: { horizons: HORIZONS, from: firstDay, to: lastDay, stocks: Object.keys(perStock).length, baseline, signals, recent: recent.slice(0, 150) }, perStock };
}

// ---------- live record of this site's own labels (news + chart), logged once per trading day ----------
function updateLog(log, stocks, dateIST) {
  log = log || { started: dateIST, days: {} };
  log.days[dateIST] = Object.fromEntries(stocks.filter(s => s.price != null && s.insight).map(s => [s.symbol, [s.insight.label, s.insight.signal, s.price]]));
  const keys = Object.keys(log.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete log.days[k]; // keep ~18 months
  return log;
}
function scoreLog(log, closesByDate, niftyByDate) {
  // closesByDate: {sym: {dates:[...], closes:[...]}}; returns per label, forward returns after 5 and 20 sessions
  const out = {};
  if (!log) return { started: null, labels: [] };
  for (const [day, m] of Object.entries(log.days)) {
    for (const [sym, [label, signal, price]] of Object.entries(m)) {
      const cs = closesByDate[sym]; if (!cs) continue;
      const i = cs.dates.indexOf(day); if (i < 0) continue;
      const o = out[label] ||= { label, signal, days: new Set(), r5: [], r20: [], x5: [], x20: [] };
      o.days.add(day);
      for (const h of [5, 20]) if (i + h < cs.closes.length) {
        const r = (cs.closes[i + h] / cs.closes[i] - 1) * 100; o["r" + h].push(r);
        const nx = niftyByDate && niftyByDate.idx[day] != null && niftyByDate.idx[day] + h < niftyByDate.closes.length ? (niftyByDate.closes[niftyByDate.idx[day] + h] / niftyByDate.closes[niftyByDate.idx[day]] - 1) * 100 : null;
        if (nx != null) o["x" + h].push(r - nx);
      }
    }
  }
  const m = a => a.length ? r2(a.reduce((s, x) => s + x, 0) / a.length) : null;
  const labels = Object.values(out).map(o => ({ label: o.label, signal: o.signal, days: o.days.size,
    n5: o.r5.length, avg5: m(o.r5), up5: o.r5.length ? Math.round(o.r5.filter(x => x > 0).length / o.r5.length * 100) : null, vs5: m(o.x5),
    n20: o.r20.length, avg20: m(o.r20), up20: o.r20.length ? Math.round(o.r20.filter(x => x > 0).length / o.r20.length * 100) : null, vs20: m(o.x20) }));
  const order = { bullish: 0, watch: 1, neutral: 2, bearish: 3 };
  labels.sort((a, b) => (order[a.signal] ?? 9) - (order[b.signal] ?? 9) || (b.avg20 ?? b.avg5 ?? -99) - (a.avg20 ?? a.avg5 ?? -99));
  return { started: log.started, logged_days: Object.keys(log.days).length, labels };
}

module.exports = { run, SIGNALS, updateLog, scoreLog, dayKey };
