// Builds the website's data (site/data/*.json). Runs on GitHub Actions every 15 minutes, or locally via preview.bat.
// No npm packages needed (Node 18+).
const fs = require("fs");
const path = require("path");
const news = require("./lib/news");
const nse = require("./lib/nse");
const technicals = require("./lib/technicals");
const { KEYWORDS, compileMatchers, matchSymbols, deriveKeywords } = require("./lib/watchlist");
const { headlineTone, stockInsight, marketMood, trendingTopics } = require("./lib/insights");
const backtest = require("./lib/backtest");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "site", "data");
const CACHE = path.join(ROOT, ".cache");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const KEEP_H = cfg.keep_news_hours || 72;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const status = {};
const log = m => console.log(new Date().toISOString().slice(11, 19), m);
const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

async function attempt(name, fn, fallback) {
  try { const v = await fn(); status[name] = "ok"; return v; }
  catch (e) { status[name] = "failed: " + String(e.cause?.code || e.message).slice(0, 80); log(`[${name}] ${status[name]}`); return fallback; }
}

// ---------- universe ----------
function parseIndexCsv(text) {
  const lines = text.trim().split(/\r?\n/), head = lines[0].split(",").map(h => h.trim());
  const iS = head.indexOf("Symbol"), iN = head.indexOf("Company Name"), iI = head.indexOf("Industry");
  return lines.slice(1).map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, "").replace(/^"|"$/g, "").trim()))
    .filter(c => c[iS]).map(c => ({ symbol: c[iS], name: c[iN], industry: c[iI] }));
}
async function loadUniverse() {
  const file = cfg.universe_file || "ind_nifty200list.csv";
  const fromNse = await attempt("universe", async () => {
    const r = await fetch(`https://nsearchives.nseindia.com/content/indices/${file}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const list = parseIndexCsv(await r.text()); if (list.length < 40) throw new Error("bad csv"); return list;
  }, null);
  let list = fromNse || parseIndexCsv(fs.readFileSync(path.join(__dirname, "data", "universe.csv"), "utf8"));
  if (fromNse) fs.writeFileSync(path.join(__dirname, "data", "universe.csv"), "Company Name,Industry,Symbol\n" + list.map(x => `"${x.name}","${x.industry}",${x.symbol}`).join("\n"));
  await attempt("nifty50_list", async () => {
    const r = await fetch("https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const l = parseIndexCsv(await r.text()); if (l.length < 45) throw new Error("bad csv");
    fs.writeFileSync(path.join(__dirname, "data", "nifty50.csv"), "Company Name,Industry,Symbol\n" + l.map(x => `"${x.name}","${x.industry}",${x.symbol}`).join("\n"));
  });
  const n50list = parseIndexCsv(fs.readFileSync(path.join(__dirname, "data", "nifty50.csv"), "utf8"));
  const n50 = new Set(n50list.map(x => x.symbol));
  for (const x of n50list) if (!list.some(y => y.symbol === x.symbol)) list.push(x);
  const map = {};
  for (const x of list) map[x.symbol] = { ...x, nifty50: n50.has(x.symbol) };
  for (const s of cfg.extra_symbols || []) if (!map[s.symbol || s]) map[s.symbol || s] = { symbol: s.symbol || s, name: s.name || s.symbol || s, industry: s.industry || "", nifty50: false, extra: true };
  for (const x of Object.values(map)) {
    const kws = KEYWORDS[x.symbol] ? [...KEYWORDS[x.symbol]] : deriveKeywords(x.name);
    if (!KEYWORDS[x.symbol] && /^[A-Z]{3,}$/.test(x.symbol) && x.symbol.length <= 10) kws.push(x.symbol);
    x.keywords = kws;
  }
  return map;
}

// ---------- pulse ----------
const YAHOO_PULSE = [["NIFTY 50", "Nifty 50", "^NSEI"], ["NIFTY BANK", "Bank Nifty", "^NSEBANK"], ["SENSEX", "Sensex", "^BSESN"], ["INDIA VIX", "India VIX", "^INDIAVIX"],
  ["USDINR", "USD/INR", "INR=X"], ["BRENT", "Brent $", "BZ=F"], ["GOLD", "Gold $", "GC=F"]];
const YAHOO_SECTORS = [["IT", "^CNXIT"], ["BANK", "^NSEBANK"], ["AUTO", "^CNXAUTO"], ["PHARMA", "^CNXPHARMA"], ["FMCG", "^CNXFMCG"], ["METAL", "^CNXMETAL"],
  ["REALTY", "^CNXREALTY"], ["ENERGY", "^CNXENERGY"], ["MEDIA", "^CNXMEDIA"], ["PSU BANK", "^CNXPSUBANK"], ["INFRA", "^CNXINFRA"]];
async function yq(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  const m = (await r.json())?.chart?.result?.[0]?.meta; if (!m) throw new Error("no data");
  const prev = m.chartPreviousClose ?? m.previousClose;
  return { last: r2(m.regularMarketPrice), change: r2(m.regularMarketPrice - prev), change_pct: r2(prev ? (m.regularMarketPrice / prev - 1) * 100 : 0) };
}
async function loadPulse() {
  const idx = await attempt("nse_indices", () => nse.fetchIndices(), null);
  const items = [], byName = Object.fromEntries((idx || []).map(x => [x.name, x]));
  const ys = await Promise.all(YAHOO_PULSE.map(([, , s]) => yq(s).catch(() => null)));
  YAHOO_PULSE.forEach(([key, label], i) => {
    const n = byName[key];
    if (n) items.push({ key, label, last: n.last, change: r2(n.change), change_pct: r2(n.change_pct), adv: n.advances, dec: n.declines });
    else if (ys[i]) items.push({ key, label, ...ys[i] });
  });
  status.pulse = items.length ? `ok (${items.length})` : "failed";
  let sectors = (idx || []).filter(x => /SECTORAL/i.test(x.group)).map(x => ({ name: x.name.replace(/^NIFTY\s+/i, ""), last: x.last, change_pct: r2(x.change_pct), ch30d: x.ch30d, ch365d: x.ch365d, adv: x.advances, dec: x.declines }));
  if (!sectors.length) {
    const ss = await Promise.all(YAHOO_SECTORS.map(([, s]) => yq(s).catch(() => null)));
    sectors = YAHOO_SECTORS.map(([name], i) => ss[i] && { name, last: ss[i].last, change_pct: ss[i].change_pct }).filter(Boolean);
  }
  sectors.sort((a, b) => b.change_pct - a.change_pct);
  return { items, sectors, nifty_pe: byName["NIFTY 50"]?.pe || null };
}

// ---------- news (with history kept between runs) ----------
async function loadNews(universe) {
  const { items, status: st } = await news.fetchAll(log, universe);
  Object.assign(status, Object.fromEntries(Object.entries(st).map(([k, v]) => ["news: " + k, v])));
  fs.mkdirSync(CACHE, { recursive: true });
  const hist = readJson(path.join(CACHE, "news.json"), {});
  for (const it of items) if (!hist[it.id]) hist[it.id] = { ...it, seen_at: new Date().toISOString() };
  const cutoff = Date.now() - KEEP_H * 3600e3;
  const keep = Object.values(hist).filter(n => Date.parse(n.published) >= cutoff).sort((a, b) => b.published.localeCompare(a.published)).slice(0, 2500);
  fs.writeFileSync(path.join(CACHE, "news.json"), JSON.stringify(Object.fromEntries(keep.map(n => [n.id, n]))));
  return keep;
}

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(path.join(OUT, "charts"), { recursive: true });
  const universe = await loadUniverse();
  const syms = Object.keys(universe);
  log(`[universe] ${syms.length} stocks`);

  const [techs, pulse, fii, w52nse, calendar, newsList, nifty] = await Promise.all([
    technicals.analyseMany(syms, log, 8),
    loadPulse(),
    attempt("fii_dii", () => nse.fetchFiiDii(), []),
    attempt("nse_52w", () => nse.fetch52Week(log), null),
    attempt("calendar", () => nse.fetchCalendar(), []),
    loadNews(universe),
    attempt("nifty_history", () => technicals.history("^NSEI"), null),
  ]);
  status.technicals = `${Object.keys(techs).length}/${syms.length}`;

  // relative strength vs Nifty 50 + RS rating (1-99 percentile of weighted 3/6/9/12-month returns)
  const nRows = nifty?.rows || [];
  const nRet = n => nRows.length > n ? (nRows[nRows.length - 1].c / nRows[nRows.length - 1 - n].c - 1) * 100 : null;
  const nr = { m1: nRet(21), m3: nRet(63), m6: nRet(126), y1: nRet(250) };
  const perf = [];
  for (const [s, t] of Object.entries(techs)) {
    const x = t.tech, rel = (a, b) => a != null && b != null ? r2(a - b) : null;
    x.rel_1m = rel(x.ret_1m, nr.m1); x.rel_3m = rel(x.ret_3m, nr.m3); x.rel_6m = rel(x.ret_6m, nr.m6); x.rel_1y = rel(x.ret_1y, nr.y1);
    if (x.ret_3m != null && x.ret_6m != null) perf.push([s, 0.4 * x.ret_3m + 0.2 * x.ret_6m + 0.2 * (x.ret_9m ?? x.ret_6m) + 0.2 * (x.ret_1y ?? x.ret_6m)]);
  }
  perf.sort((a, b) => a[1] - b[1]).forEach(([s], i) => { techs[s].tech.rs_rating = Math.max(1, Math.min(99, Math.round((i + 1) / perf.length * 99))); });

  // signal track record (back-test over ~5 years of prices)
  const bt = await attempt("backtest", async () => backtest.run(techs, nRows, log), { summary: null, perStock: {} });

  // charts (one small file per stock, loaded when you open it): price rows + this stock's past signals
  for (const [s, t] of Object.entries(techs)) {
    fs.writeFileSync(path.join(OUT, "charts", s.replace(/[^A-Z0-9&-]/gi, "_") + ".json"), JSON.stringify({ v: 2, rows: t.series, ev: bt.perStock[s] || [] }));
  }

  // news: tone + symbol matching
  const matchers = compileMatchers(universe);
  const newsOut = newsList.map(n => {
    const tone = headlineTone(n.title, n.summary);
    return { id: n.id, title: n.title, link: n.link, source: n.source.replace(/^Google News: /, ""), published: n.published, seen_at: n.seen_at,
      symbols: matchSymbols(n.title + " " + (n.summary || ""), matchers), tone: tone.tone, tone_score: tone.score, words: tone.words };
  });
  const bySym = {};
  for (const n of newsOut) for (const s of n.symbols) (bySym[s] ||= []).push(n);

  // stocks
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (calendar || []).filter(e => e.date >= today);
  const stocks = syms.map(s => {
    const u = universe[s], t = techs[s], q = t?.quote || {};
    const sn = bySym[s] || [], ev = upcoming.filter(e => e.symbol === s);
    return { symbol: s, name: u.name, industry: u.industry, nifty50: u.nifty50, price: q.price ?? null, change_pct: q.change_pct ?? null,
      tech: t?.tech || null, news_ids: sn.map(n => n.id), events: ev.slice(0, 3),
      spark: t ? t.series.slice(-30).map(p => p[1]) : [],
      insight: stockInsight(s, u.name, t?.tech, sn, ev, q.change_pct) };
  });

  // 52-week: NSE live list if reachable, else computed from our universe
  let w52;
  if (w52nse) {
    const inU = x => ({ ...x, tracked: Boolean(universe[x.symbol]), nifty50: Boolean(universe[x.symbol]?.nifty50) });
    w52 = { source: "NSE (all stocks)", highs: w52nse.highs.map(inU), lows: w52nse.lows.map(inU) };
  } else {
    const mk = (r, lvl) => ({ symbol: r.symbol, name: r.name, ltp: r.price, change_pct: r.change_pct, new_level: lvl, tracked: true, nifty50: r.nifty50 });
    w52 = { source: `Computed from ${syms.length} tracked stocks`,
      highs: stocks.filter(r => r.tech && r.price >= r.tech.high52 * 0.995).map(r => mk(r, r.tech.high52)),
      lows: stocks.filter(r => r.tech && r.price <= r.tech.low52 * 1.005).map(r => mk(r, r.tech.low52)) };
  }

  const mood = marketMood({ rows: stocks, pulse: pulse.items, fii, news: newsOut });
  const topics = trendingTopics(newsOut.slice(0, 600), stocks.flatMap(s => [s.symbol, ...universe[s.symbol].keywords]));
  const industryAvg = {};
  for (const r of stocks) if (r.industry && r.change_pct != null) (industryAvg[r.industry] ||= []).push(r);
  const avgOf = (rs, k) => { const v = rs.map(r => r.tech?.[k]).filter(x => x != null); return v.length ? r2(v.reduce((a, x) => a + x, 0) / v.length) : null; };
  const industries = Object.entries(industryAvg).map(([name, rs]) => ({ name, change_pct: r2(rs.reduce((a, r) => a + r.change_pct, 0) / rs.length), count: rs.length,
    ret_1w: avgOf(rs, "ret_1w"), ret_1m: avgOf(rs, "ret_1m"), ret_3m: avgOf(rs, "ret_3m"), ret_1y: avgOf(rs, "ret_1y"), rs_avg: avgOf(rs, "rs_rating"),
    top: rs.sort((a, b) => b.change_pct - a.change_pct).slice(0, 3).map(r => r.symbol), bottom: rs.slice(-2).map(r => r.symbol) })).sort((a, b) => b.change_pct - a.change_pct);

  // live record of this site's own labels: logged once per trading day, scored as days pass
  const liveRecord = await attempt("live_record", async () => {
    const f = path.join(CACHE, "signal-log.json");
    let slog = readJson(f, null);
    if (!slog && process.env.GITHUB_REPOSITORY) { // cache lost: recover from the published site
      const [o, r] = process.env.GITHUB_REPOSITORY.split("/");
      try { const x = await fetch(`https://${o.toLowerCase()}.github.io/${r}/data/signal-log.json`, { signal: AbortSignal.timeout(15000) }); if (x.ok) slog = await x.json(); } catch {}
    }
    const today = backtest.dayKey(Date.now());
    const lastBar = nRows.length ? backtest.dayKey(nRows[nRows.length - 1].t) : null;
    if (lastBar === today) slog = backtest.updateLog(slog, stocks, today); // only on trading days
    if (slog) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, JSON.stringify(slog)); fs.writeFileSync(path.join(OUT, "signal-log.json"), JSON.stringify(slog)); }
    const closes = {};
    for (const [s, t] of Object.entries(techs)) closes[s] = { dates: t.rows.map(r => backtest.dayKey(r.t)), closes: t.rows.map(r => r.c) };
    const nIdx = {}; nRows.forEach((r, i) => { nIdx[backtest.dayKey(r.t)] = i; });
    return backtest.scoreLog(slog, closes, { idx: nIdx, closes: nRows.map(r => r.c) });
  }, null);

  const out = {
    generated_at: new Date().toISOString(), build_seconds: Math.round((Date.now() - t0) / 1000), status,
    pulse: pulse.items, sectors: pulse.sectors, industries, nifty_pe: pulse.nifty_pe, fii_dii: fii, mood, topics,
    nifty_returns: Object.fromEntries(Object.entries(nr).map(([k, v]) => [k, r2(v)])), backtest: bt.summary, live_record: liveRecord,
    stocks, news: newsOut, w52, calendar: upcoming.slice(0, 600).map(e => ({ ...e, tracked: Boolean(universe[e.symbol]), nifty50: Boolean(universe[e.symbol]?.nifty50) })),
  };
  fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(out));
  // cache-busting: stamp app.js / style.css links with a content hash so visitors always get the latest design
  try {
    const crypto = require("crypto"), site = path.join(ROOT, "site"), idx = path.join(site, "index.html");
    const ver = f => crypto.createHash("md5").update(fs.readFileSync(path.join(site, f))).digest("hex").slice(0, 8);
    const html = fs.readFileSync(idx, "utf8").replace(/(href|src)="(style\.css|app\.js)(\?v=\w+)?"/g, (m, a, f) => `${a}="${f}?v=${ver(f)}"`);
    fs.writeFileSync(idx, html);
  } catch (e) { log("[version] " + e.message); }
  log(`[done] ${stocks.length} stocks, ${newsOut.length} headlines (${Object.keys(bySym).length} stocks with news), mood ${mood.score} ${mood.label}, ${Math.round((Date.now() - t0) / 1000)}s`);
  log("[status] " + JSON.stringify(status));
}

main().catch(e => { console.error(e); process.exit(1); });
