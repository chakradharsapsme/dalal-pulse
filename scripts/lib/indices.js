// Index charts: daily (1 year + 5 years weekly) and today's intraday line for the main NSE/BSE indices,
// plus which tracked stocks belong to each index (from NSE's official lists, with an industry fallback).
const fs = require("fs");
const path = require("path");
const { history, compute, indicators } = require("./technicals");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;

// yahoo: symbols to try in order. csv: NSE constituent list. fb: fallback rule on (industry, name) when the list can't be downloaded.
const INDICES = [
  { id: "nifty50", name: "Nifty 50", group: "Broad market", yahoo: ["^NSEI"], nse: "NIFTY 50", csv: "ind_nifty50list.csv", fb: (i, n, s) => s.nifty50 },
  { id: "sensex", name: "Sensex", group: "Broad market", yahoo: ["^BSESN"], nse: null, csv: null,
    list: ["ADANIPORTS", "ASIANPAINT", "AXISBANK", "BAJFINANCE", "BAJAJFINSV", "BEL", "BHARTIARTL", "ETERNAL", "HCLTECH", "HDFCBANK", "HINDUNILVR", "ICICIBANK", "INFY", "ITC", "KOTAKBANK", "LT", "M&M", "MARUTI", "NTPC", "POWERGRID", "RELIANCE", "SBIN", "SUNPHARMA", "TMPV", "TATAMOTORS", "TATASTEEL", "TCS", "TECHM", "TITAN", "TRENT", "ULTRACEMCO"] },
  { id: "next50", name: "Nifty Next 50", group: "Broad market", yahoo: ["^NSMIDCP"], nse: "NIFTY NEXT 50", csv: "ind_niftynext50list.csv", fb: null },
  { id: "midcap", name: "Nifty Midcap 100", group: "Broad market", yahoo: ["NIFTY_MIDCAP_100.NS", "^CNXMIDCAP"], nse: "NIFTY MIDCAP 100", csv: "ind_niftymidcap100list.csv", fb: null },
  { id: "smallcap", name: "Nifty Smallcap 100", group: "Broad market", yahoo: ["^CNXSC", "NIFTY_SMLCAP_100.NS"], nse: "NIFTY SMALLCAP 100", csv: "ind_niftysmallcap100list.csv", fb: null },
  { id: "bank", name: "Nifty Bank", group: "Sectors", yahoo: ["^NSEBANK"], nse: "NIFTY BANK", csv: "ind_niftybanklist.csv", fb: (i, n) => /Financial/i.test(i) && /bank/i.test(n) },
  { id: "fin", name: "Nifty Financial Services", group: "Sectors", yahoo: ["NIFTY_FIN_SERVICE.NS", "^CNXFIN"], nse: "NIFTY FINANCIAL SERVICES", csv: "ind_niftyfinancelist.csv", fb: (i) => /Financial/i.test(i) },
  { id: "psubank", name: "Nifty PSU Bank", group: "Sectors", yahoo: ["^CNXPSUBANK"], nse: "NIFTY PSU BANK", csv: "ind_niftypsubanklist.csv", fb: (i, n) => /State Bank|Bank of Baroda|Bank of India|Punjab National|Canara|Union Bank|Indian Bank|Bank of Maharashtra|Indian Overseas|UCO Bank|Central Bank/i.test(n) },
  { id: "it", name: "Nifty IT", group: "Sectors", yahoo: ["^CNXIT"], nse: "NIFTY IT", csv: "ind_niftyitlist.csv", fb: (i) => /Information Technology/i.test(i) },
  { id: "auto", name: "Nifty Auto", group: "Sectors", yahoo: ["^CNXAUTO"], nse: "NIFTY AUTO", csv: "ind_niftyautolist.csv", fb: (i) => /Automobile/i.test(i) },
  { id: "pharma", name: "Nifty Pharma", group: "Sectors", yahoo: ["^CNXPHARMA"], nse: "NIFTY PHARMA", csv: "ind_niftypharmalist.csv", fb: (i) => /Healthcare/i.test(i) },
  { id: "fmcg", name: "Nifty FMCG", group: "Sectors", yahoo: ["^CNXFMCG"], nse: "NIFTY FMCG", csv: "ind_niftyfmcglist.csv", fb: (i) => /Fast Moving/i.test(i) },
  { id: "metal", name: "Nifty Metal", group: "Sectors", yahoo: ["^CNXMETAL"], nse: "NIFTY METAL", csv: "ind_niftymetallist.csv", fb: (i) => /Metals/i.test(i) },
  { id: "energy", name: "Nifty Energy", group: "Sectors", yahoo: ["^CNXENERGY"], nse: "NIFTY ENERGY", csv: "ind_niftyenergylist.csv", fb: (i) => /Oil Gas|Power/i.test(i) },
  { id: "realty", name: "Nifty Realty", group: "Sectors", yahoo: ["^CNXREALTY"], nse: "NIFTY REALTY", csv: "ind_niftyrealtylist.csv", fb: (i) => /Realty/i.test(i) },
  { id: "infra", name: "Nifty Infrastructure", group: "Sectors", yahoo: ["^CNXINFRA"], nse: "NIFTY INFRASTRUCTURE", csv: "ind_niftyinfralist.csv", fb: (i) => /Construction|Power|Telecommunication/i.test(i) },
  { id: "media", name: "Nifty Media", group: "Sectors", yahoo: ["^CNXMEDIA"], nse: "NIFTY MEDIA", csv: "ind_niftymedialist.csv", fb: (i) => /Media/i.test(i) },
  { id: "vix", name: "India VIX", group: "Volatility", yahoo: ["^INDIAVIX"], nse: "INDIA VIX", csv: null, fb: null },
];

async function intraday(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const res = (await r.json())?.chart?.result?.[0]; if (!res) throw new Error("no data");
  const q = res.indicators.quote[0], m = res.meta;
  const pts = (res.timestamp || []).map((t, i) => [t, r2(q.close[i])]).filter(p => p[1] != null);
  return { prev: r2(m.chartPreviousClose ?? m.previousClose), last: r2(m.regularMarketPrice), time: m.regularMarketTime, pts };
}

async function constituents(def, universe, cacheDir, log) {
  if (def.list) return { syms: def.list.filter(s => universe[s]), total: 30, source: "Sensex heavyweights (approximate list)" };
  if (def.csv) {
    const f = path.join(cacheDir, def.csv);
    let text = null;
    try {
      const r = await fetch(`https://nsearchives.nseindia.com/content/indices/${def.csv}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
      const t = await r.text();
      if (r.ok && t.includes("Symbol")) { text = t; fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(f, t); }
    } catch {}
    if (!text && fs.existsSync(f)) text = fs.readFileSync(f, "utf8");
    if (text) {
      const lines = text.trim().split(/\r?\n/), head = lines[0].split(",").map(h => h.trim()), iS = head.indexOf("Symbol");
      const all = lines.slice(1).map(l => l.split(",")[iS]?.replace(/"/g, "").trim()).filter(Boolean);
      return { syms: all.filter(s => universe[s]), total: all.length, source: "NSE index list", others: all.filter(s => !universe[s]) };
    }
  }
  if (def.fb) { const syms = Object.values(universe).filter(u => def.fb(u.industry || "", u.name || "", u)).map(u => u.symbol); return { syms, total: null, source: "matched by industry (approximate)" }; }
  return { syms: [], total: null, source: null };
}

async function loadIndices({ universe, nseIndices, outDir, cacheDir, log }) {
  fs.mkdirSync(outDir, { recursive: true });
  const byNse = Object.fromEntries((nseIndices || []).map(x => [x.name, x]));
  const out = [];
  await Promise.all(INDICES.map(async def => {
    let hist = null, used = null;
    for (const y of def.yahoo) { try { hist = await history(y, "5y"); used = y; break; } catch {} }
    if (!hist || hist.rows.length < 30) { log(`[indices] ${def.name}: no data`); return; }
    let intra = null; try { intra = await intraday(used); } catch {}
    const rows = hist.rows, ind = indicators(rows);
    const tech = compute(rows, hist.meta.regularMarketPrice);
    // daily for 1 year: [t, close, 50dma, 200dma]; weekly for 5 years: [t, close]
    const daily = [];
    for (let i = Math.max(0, rows.length - 252); i < rows.length; i++) daily.push([Math.round(rows[i].t / 1000), r2(rows[i].c), r2(ind.s50[i]), r2(ind.s200[i])]);
    const weekly = []; let wk = null;
    for (const r of rows) { const d = new Date(r.t), k = Math.floor((r.t / 86400000 + 3) / 7); if (k !== wk) { weekly.push([Math.round(r.t / 1000), r2(r.c)]); wk = k; } else weekly[weekly.length - 1] = [Math.round(r.t / 1000), r2(r.c)]; }
    const n = byNse[def.nse];
    const last = n?.last ?? intra?.last ?? hist.meta.regularMarketPrice ?? rows[rows.length - 1].c;
    const prev = intra?.prev ?? (rows.length > 1 ? rows[rows.length - 2].c : null);
    const change_pct = n ? n.change_pct : prev ? (last / prev - 1) * 100 : null;
    const cons = await constituents(def, universe, cacheDir, log);
    fs.writeFileSync(path.join(outDir, def.id + ".json"), JSON.stringify({ daily, weekly, intraday: intra ? { prev: intra.prev, pts: intra.pts } : null, others: cons.others || [] }));
    out.push({
      id: def.id, name: def.name, group: def.group, last: r2(last), change: n ? r2(n.change) : prev ? r2(last - prev) : null, change_pct: r2(change_pct), prev: r2(prev),
      nse_adv: n?.advances ?? null, nse_dec: n?.declines ?? null, pe: n?.pe ?? null,
      tech: { rsi14: tech.rsi14, sma20: tech.sma20, sma50: tech.sma50, sma200: tech.sma200, trend: tech.trend, above_50: tech.above_50, above_200: tech.above_200,
        high52: tech.high52, low52: tech.low52, from_high_pct: tech.from_high_pct, from_low_pct: tech.from_low_pct, macd_state: tech.macd_state, macd_cross: tech.macd_cross,
        golden_cross: tech.golden_cross, death_cross: tech.death_cross, support: tech.support, resistance: tech.resistance,
        ret_1w: tech.ret_1w, ret_1m: tech.ret_1m, ret_3m: tech.ret_3m, ret_6m: tech.ret_6m, ret_1y: tech.ret_1y,
        ret_3y: rows.length > 750 ? r2((last / rows[rows.length - 751].c - 1) * 100) : null, ret_5y: r2((last / rows[0].c - 1) * 100) },
      spark: intra && intra.pts.length > 5 ? intra.pts.filter((_, i, a) => i % Math.ceil(a.length / 40) === 0 || i === a.length - 1).map(p => p[1]) : daily.slice(-30).map(p => p[1]),
      spark_intraday: Boolean(intra && intra.pts.length > 5),
      members: cons.syms, members_total: cons.total, members_source: cons.source,
    });
  }));
  const order = Object.fromEntries(INDICES.map((d, i) => [d.id, i]));
  out.sort((a, b) => order[a.id] - order[b.id]);
  log(`[indices] ${out.length}/${INDICES.length} indices`);
  return out;
}

module.exports = { loadIndices, INDICES };
