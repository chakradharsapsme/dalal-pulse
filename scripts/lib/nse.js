// NSE data (same data as nseindia.com pages). NSE requires its site cookies, so we load the home page first.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
let cookie = "", cookieAt = 0;

async function getCookie(force) {
  if (!force && cookie && Date.now() - cookieAt < 20 * 60e3) return cookie;
  const r = await fetch("https://www.nseindia.com/", { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(15000) });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  cookie = sc.map(c => c.split(";")[0]).join("; ");
  cookieAt = Date.now();
  return cookie;
}

async function nseGet(apiPath, referer = "/", retry = true) {
  const r = await fetch("https://www.nseindia.com" + apiPath, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nseindia.com" + referer, Cookie: await getCookie() },
    signal: AbortSignal.timeout(15000),
  });
  if ((r.status === 401 || r.status === 403) && retry) { await getCookie(true); return nseGet(apiPath, referer, false); }
  if (!r.ok) throw new Error(`NSE ${apiPath.split("?")[0]} HTTP ${r.status}`);
  return r.json();
}

// ---- 52-week highs / lows for the whole market ----
async function getList(kind) {
  const j = await nseGet(`/api/live-analysis-data-52week${kind}stock`, `/market-data/52-week-${kind}-equity-market`);
  return (j.data || []).filter(x => x.symbol).map(x => ({
    symbol: x.symbol, name: x.comapnyName || x.companyName || x.symbol, series: x.series,
    ltp: Number(x.ltp), new_level: Number(x.new52WHL), prev_level: Number(x.prev52WHL), prev_date: x.prevHLDate,
    change_pct: Math.round(Number(x.pChange) * 100) / 100,
  }));
}
async function fetch52Week(log) {
  const [highs, lows] = await Promise.all([getList("high"), getList("low")]);
  log(`[52w] NSE: ${highs.length} stocks at 52-week high, ${lows.length} at 52-week low`);
  return { highs, lows, updated: new Date().toISOString() };
}

// ---- all indices (Nifty, Bank Nifty, VIX, sectors, breadth) ----
async function fetchIndices() {
  const j = await nseGet("/api/allIndices", "/market-data/index-performances");
  return (j.data || []).map(x => ({
    group: x.key, name: x.index, last: x.last, change: x.variation, change_pct: x.percentChange,
    advances: Number(x.advances) || 0, declines: Number(x.declines) || 0,
    year_high: x.yearHigh, year_low: x.yearLow, pe: x.pe, ch30d: x.perChange30d, ch365d: x.perChange365d,
  }));
}

// ---- FII / DII cash-market flows ----
async function fetchFiiDii() {
  const j = await nseGet("/api/fiidiiTradeReact", "/reports/fii-dii");
  return (Array.isArray(j) ? j : []).map(x => ({ category: x.category, date: x.date, buy: +x.buyValue, sell: +x.sellValue, net: +x.netValue }));
}

// ---- board meetings (results etc.) and corporate actions (dividend, bonus, split) ----
async function fetchCalendar() {
  const [events, actions] = await Promise.all([
    nseGet("/api/event-calendar", "/companies-listing/corporate-filings-event-calendar").catch(() => []),
    nseGet("/api/corporates-corporateActions?index=equities", "/companies-listing/corporate-filings-actions").catch(() => []),
  ]);
  const toIso = d => { const t = Date.parse(d); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10); };
  const list = [];
  for (const e of Array.isArray(events) ? events : []) list.push({ symbol: e.symbol, name: e.company, date: toIso(e.date), type: /result/i.test(e.purpose) ? "Results" : "Board meeting", detail: e.purpose + (e.bm_desc ? " — " + e.bm_desc : "") });
  for (const a of Array.isArray(actions) ? actions : []) list.push({ symbol: a.symbol, name: a.comp, date: toIso(a.exDate), type: /dividend/i.test(a.subject) ? "Dividend" : /bonus/i.test(a.subject) ? "Bonus" : /split/i.test(a.subject) ? "Split" : "Corporate action", detail: `${a.subject} (ex-date ${a.exDate})` });
  return list.filter(x => x.symbol && x.date).sort((a, b) => a.date.localeCompare(b.date));
}

// ---- master list of all NSE equities (for search / adding any stock) ----
async function fetchEquityList() {
  const r = await fetch("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("EQUITY_L HTTP " + r.status);
  const lines = (await r.text()).trim().split(/\r?\n/).slice(1);
  const out = [];
  for (const l of lines) {
    const c = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, "").replace(/^"|"$/g, "").trim());
    if (c[0] && (c[2] === "EQ" || c[2] === "BE")) out.push({ symbol: c[0], name: c[1] });
  }
  if (out.length < 500) throw new Error("unexpected EQUITY_L format");
  return out;
}

// ---- index constituents (Nifty 100 used as the screener universe) ----
async function fetchIndexList(file) {
  const r = await fetch(`https://nsearchives.nseindia.com/content/indices/${file}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${file} HTTP ${r.status}`);
  const lines = (await r.text()).trim().split(/\r?\n/);
  const head = lines[0].split(",").map(h => h.trim());
  const iSym = head.indexOf("Symbol"), iName = head.indexOf("Company Name"), iInd = head.indexOf("Industry");
  return lines.slice(1).map(l => l.split(",")).filter(c => c[iSym]).map(c => ({ symbol: c[iSym].trim(), name: (c[iName] || "").trim(), industry: (c[iInd] || "").trim() }));
}

// ---- F&O: every underlying with today's open-interest change (NSE "OI spurts") ----
const FO_INDEX = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "NIFTYFPI"]);
async function fetchFoOI() {
  const j = await nseGet("/api/live-analysis-oi-spurts-underlyings", "/market-data/oi-spurts");
  const items = (j.data || []).filter(x => x.symbol && !FO_INDEX.has(x.symbol)).map(x => ({
    symbol: x.symbol, oi: x.latestOI, prev_oi: x.prevOI, oi_chg: x.changeInOI,
    oi_chg_pct: x.prevOI ? Math.round(x.changeInOI / x.prevOI * 10000) / 100 : null, volume: x.volume, underlying: x.underlyingValue,
  }));
  if (items.length < 100) throw new Error("F&O list too short");
  return { date: j.timestamp, items };
}

// ---- circuit (price band) hitters: stocks locked at their upper / lower price band today ----
async function fetchBandHitters() {
  const j = await nseGet("/api/live-analysis-price-band-hitter", "/market-data/upper-band-hitters");
  const map = x => ({ symbol: x.symbol, series: x.series, ltp: +x.ltp, change_pct: Math.round(parseFloat(x.pChange) * 100) / 100, band: +x.priceBand,
    high: x.highPrice, low: x.lowPrice, year_high: x.yearHigh, year_low: x.yearLow, turnover_cr: Math.round((+x.turnover || 0)) / 100, volume_k: +x.totalTradedVol || 0 });
  return { upper: (j.upper?.AllSec?.data || []).map(map), lower: (j.lower?.AllSec?.data || []).map(map), both: (j.both?.AllSec?.data || []).map(map), count: j.count || null };
}

module.exports = { fetchBandHitters, fetch52Week, fetchIndices, fetchFiiDii, fetchCalendar, fetchEquityList, fetchIndexList, fetchFoOI, nseGet };
