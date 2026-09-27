// Daily technicals from 1 year of Yahoo Finance prices: moving averages, RSI, volume, returns, trend.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function history(yahooSymbol, range = "1y") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const res = (await r.json())?.chart?.result?.[0];
  if (!res?.timestamp) throw new Error("no data");
  const q = res.indicators.quote[0];
  const rows = res.timestamp.map((t, i) => ({ t: t * 1000, c: q.close[i], v: q.volume[i], h: q.high[i], l: q.low[i] })).filter(r => r.c != null);
  return { rows, meta: res.meta };
}

const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
function smaAt(closes, n, end) { return end + 1 >= n ? avg(closes.slice(end + 1 - n, end + 1)) : null; }
function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;

function compute(rows, livePrice) {
  const closes = rows.map(r => r.c), vols = rows.map(r => r.v || 0);
  if (livePrice && closes.length) closes[closes.length - 1] = livePrice;
  const last = closes.length - 1, price = closes[last];
  const s20 = smaAt(closes, 20, last), s50 = smaAt(closes, 50, last), s200 = smaAt(closes, 200, last);
  // crosses within the last 10 sessions
  let golden = false, death = false;
  for (let i = Math.max(200, last - 9); i <= last; i++) {
    const a1 = smaAt(closes, 50, i - 1), b1 = smaAt(closes, 200, i - 1), a2 = smaAt(closes, 50, i), b2 = smaAt(closes, 200, i);
    if ([a1, b1, a2, b2].every(x => x != null)) { if (a1 <= b1 && a2 > b2) golden = true; if (a1 >= b1 && a2 < b2) death = true; }
  }
  const back = n => closes.length > n ? (price / closes[last - n] - 1) * 100 : (price / closes[0] - 1) * 100;
  const hi = Math.max(...rows.map(r => r.h ?? r.c)), lo = Math.min(...rows.map(r => r.l ?? r.c));
  const vAvg = vols.length > 21 ? avg(vols.slice(-21, -1)) : null;
  let trend = "Mixed";
  if (s50 && s200) {
    if (price > s50 && s50 > s200) trend = "Strong uptrend";
    else if (price > s200) trend = "Uptrend";
    else if (price < s50 && s50 < s200) trend = "Downtrend";
    else if (price < s200) trend = "Weak";
  }
  return {
    price: r2(price), sma20: r2(s20), sma50: r2(s50), sma200: r2(s200), rsi14: r2(rsi(closes)),
    vol: vols[last], vol_avg20: vAvg ? Math.round(vAvg) : null, vol_ratio: vAvg ? r2(vols[last] / vAvg) : null,
    ret_1w: r2(back(5)), ret_1m: r2(back(21)), ret_3m: r2(back(63)), ret_1y: r2(back(Math.min(250, last))),
    high52: r2(hi), low52: r2(lo), from_high_pct: r2((price / hi - 1) * 100), from_low_pct: r2((price / lo - 1) * 100),
    golden_cross: golden, death_cross: death, trend,
    above_50: s50 ? price > s50 : null, above_200: s200 ? price > s200 : null,
  };
}

// Returns {tech, series}; series is [{t, c}] for charting (with 50/200 DMA)
async function analyse(nseSymbol) {
  const { rows, meta } = await history(nseSymbol + ".NS");
  if (rows.length < 30) throw new Error("not enough history");
  const tech = compute(rows, meta.regularMarketPrice);
  const closes = rows.map(r => r.c);
  const series = rows.map((r, i) => ({ t: r.t, c: r2(r.c), s50: r2(smaAt(closes, 50, i)), s200: r2(smaAt(closes, 200, i)) }));
  // day change: if the last daily bar is today's session, compare with the bar before it
  const ist = ms => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
  const lastBarDay = ist(rows[rows.length - 1].t), liveDay = meta.regularMarketTime ? ist(meta.regularMarketTime * 1000) : lastBarDay;
  const prev = lastBarDay === liveDay ? rows[rows.length - 2]?.c : rows[rows.length - 1].c;
  const price = meta.regularMarketPrice ?? rows[rows.length - 1].c;
  const quote = { price: r2(price), prev_close: r2(prev), change_pct: prev ? r2((price / prev - 1) * 100) : null, as_of: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null };
  return { tech, series, quote, updated: new Date().toISOString() };
}

async function analyseMany(symbols, log, concurrency = 6) {
  const out = {}; let failed = 0; const q = [...symbols];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (q.length) { const s = q.shift(); try { out[s] = await analyse(s); } catch { failed++; } }
  }));
  log(`[tech] technicals for ${Object.keys(out).length}/${symbols.length} stocks${failed ? ` (${failed} failed)` : ""}`);
  return out;
}

module.exports = { analyse, analyseMany, compute, history };
