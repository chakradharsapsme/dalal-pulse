// Business groups: India's big business houses and their listed companies, with market cap, today's move and 1-year move.
// Prices come from NSE's "NIFTY TOTAL MARKET" list (750 stocks, one call); share counts (for full market cap) from NSE's
// quote page, cached for 5 days. Tracked stocks fall back to the site's own prices if NSE is unreachable.
const fs = require("fs"), path = require("path");
const nse = require("./nse");

const GROUPS = [
  { id: "tata", name: "Tata Group", who: "Tata Sons (Tata Trusts)", members: ["TCS", "TITAN", "TATASTEEL", "TMPV", "TMCV", "TRENT", "TATAPOWER", "TATACAP", "TATACONSUM", "INDHOTEL", "VOLTAS", "TATACOMM", "TATAELXSI", "TATACHEM", "TATATECH", "TATAINVEST", "TEJASNET", "NELCO", "RALLIS", "TTML"] },
  { id: "reliance", name: "Reliance Group", who: "Mukesh Ambani", members: ["RELIANCE", "JIOFIN", "NETWORK18", "ALOKINDS", "JUSTDIAL", "HATHWAY", "DEN", "RIIL"] },
  { id: "hdfc", name: "HDFC Group", who: "HDFC Bank and subsidiaries", members: ["HDFCBANK", "HDFCLIFE", "HDFCAMC", "HDBFS"] },
  { id: "bharti", name: "Bharti Group", who: "Sunil Mittal", members: ["BHARTIARTL", "BHARTIHEXA", "INDUSTOWER"] },
  { id: "icici", name: "ICICI Group", who: "ICICI Bank and subsidiaries", members: ["ICICIBANK", "ICICIAMC", "ICICIGI", "ICICIPRULI"] },
  { id: "adani", name: "Adani Group", who: "Gautam Adani", members: ["ADANIPORTS", "ADANIPOWER", "ADANIENT", "ADANIGREEN", "ADANIENSOL", "AMBUJACEM", "ATGL", "ACC", "AWL", "NDTV"] },
  { id: "bajaj", name: "Bajaj Group", who: "Bajaj family (Rahul/Sanjiv/Rajiv Bajaj)", members: ["BAJFINANCE", "BAJAJFINSV", "BAJAJ-AUTO", "BAJAJHFL", "BAJAJHLDNG", "MAHSCOOTER", "BAJAJELEC"] },
  { id: "sbi", name: "SBI Group", who: "State Bank of India and subsidiaries", members: ["SBIN", "SBILIFE", "SBICARD"] },
  { id: "birla", name: "Aditya Birla Group", who: "Kumar Mangalam Birla", members: ["ULTRACEMCO", "HINDALCO", "GRASIM", "ABCAPITAL", "IDEA", "ABSLAMC", "ABREL", "ABFRL", "ABLBL"] },
  { id: "lt", name: "L&T Group", who: "Larsen & Toubro", members: ["LT", "LTM", "LTF", "LTTS"] },
  { id: "mahindra", name: "Mahindra Group", who: "Anand Mahindra", members: ["M&M", "TECHM", "M&MFIN", "MAHLIFE", "MHRIL", "MAHLOG", "SWARAJENG"] },
  { id: "vedanta", name: "Vedanta Group", who: "Anil Agarwal", members: ["HINDZINC", "VEDL"] },
  { id: "jsw", name: "JSW Group", who: "Sajjan Jindal", members: ["JSWSTEEL", "JSWENERGY", "JSWINFRA", "JSWCEMENT", "JSWHL"] },
  { id: "jindal", name: "OP Jindal family", who: "Naveen, Ratan & Prithviraj Jindal", members: ["JINDALSTEL", "JSL", "JINDALSAW"] },
  { id: "murugappa", name: "Murugappa Group", who: "Murugappa family (Chennai)", members: ["CHOLAFIN", "TIINDIA", "COROMANDEL", "CHOLAHLDNG", "CARBORUNIV", "EIDPARRY", "SHANTIGEAR"] },
  { id: "godrej", name: "Godrej Group", who: "Godrej family", members: ["GODREJCP", "GODREJPROP", "GODREJIND", "GODREJAGRO"] },
  { id: "tvs", name: "TVS Group", who: "TVS family", members: ["TVSMOTOR", "SUNDARMFIN", "SUNDRMFAST", "TVSSCS", "TVSHLTD"] },
  { id: "hinduja", name: "Hinduja Group", who: "Hinduja family", members: ["ASHOKLEY", "INDUSINDBK", "GULFOILLUB", "HGS"] },
  { id: "wadia", name: "Wadia Group", who: "Nusli Wadia", members: ["BRITANNIA", "BBTC", "BOMDYEING"] },
  { id: "burman", name: "Burman Group (Dabur)", who: "Burman family", members: ["DABUR", "RELIGARE", "EVEREADY"] },
  { id: "rpsg", name: "RP-Sanjiv Goenka Group", who: "Sanjiv Goenka", members: ["CESC", "FSL", "PCBL", "SPENCERS"] },
  { id: "rpg", name: "RPG Group", who: "Harsh Goenka", members: ["CEATLTD", "KEC", "ZENSARTECH", "RPGLIFE"] },
  { id: "adag", name: "Reliance ADA Group", who: "Anil Ambani", members: ["RPOWER", "RELINFRA"] },
];


const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
async function yahooQuotes(symbols) {
  const r0 = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(10000) }).catch(() => null);
  const ck = (r0?.headers?.getSetCookie ? r0.headers.getSetCookie() : []).map(c => c.split(";")[0]).join("; ");
  const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: ck }, signal: AbortSignal.timeout(10000) });
  const crumb = (await cr.text()).trim(); if (!cr.ok || !crumb || crumb.length > 40 || /</.test(crumb)) throw new Error("no crumb (HTTP " + cr.status + ")");
  const out = [];
  for (let i = 0; i < symbols.length; i += 50) {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols.slice(i, i + 50).join(",")}&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: ck }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("quote HTTP " + r.status);
    out.push(...((await r.json())?.quoteResponse?.result || []));
  }
  return out;
}
// minimal ZIP reader (central directory + deflate), enough for NSE's archive files
function unzip(buf) {
  const zlib = require("zlib"), files = {};
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--; if (e < 0) throw new Error("not a zip");
  let p = buf.readUInt32LE(e + 16); const n = buf.readUInt16LE(e + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString();
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), data = buf.slice(ds, ds + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nl + xl + cl;
  }
  return files;
}
async function nseMcapFile() {
  const ist = new Date(Date.now() + 5.5 * 3600e3), errs = [];
  for (let back = 0; back < 8; back++) {
    const d = new Date(ist - back * 864e5); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), yy = String(d.getUTCFullYear()).slice(2);
    const url = `https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR${dd}${mm}${yy}.zip`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { errs.push(`${dd}${mm}: HTTP ${r.status}`); continue; }
      const files = unzip(Buffer.from(await r.arrayBuffer()));
      const fn = Object.keys(files).find(f => /mcap/i.test(f)); if (!fn) { errs.push("no MCAP file in " + Object.keys(files).join("|")); continue; }
      const lines = files[fn].toString("utf8").trim().split(/\r?\n/), split = l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, "").replace(/^"|"$/g, "").trim());
      const h = split(lines[0]).map(x => x.toLowerCase()), ix = re => h.findIndex(x => re.test(x));
      const iS = ix(/^symbol/), iSe = ix(/^series/), iN = ix(/security name|company/), iI = ix(/issue size|shares/), iC = ix(/close/);
      if (iS < 0 || iI < 0) throw new Error("MCAP columns: " + h.join("|"));
      const map = {};
      for (const l of lines.slice(1)) { const c = split(l); if (iSe >= 0 && c[iSe] && c[iSe] !== "EQ" && c[iSe] !== "BE") continue; const sh = Number(c[iI]); if (c[iS] && sh > 0) map[c[iS]] = { sh, name: c[iN] || null, close: Number(c[iC]) || null }; }
      if (Object.keys(map).length < 500) throw new Error("MCAP file too small");
      return { file: fn, map };
    } catch (e) { errs.push(`${dd}${mm}: ${e.message}`); }
  }
  throw new Error(errs.slice(0, 3).join("; "));
}

const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

async function build({ stocks, cacheDir, log }) {
  const S = Object.fromEntries((stocks || []).map(s => [s.symbol, s]));
  const all = [...new Set(GROUPS.flatMap(g => g.members))];
  // 1) prices for the whole market in one call
  let tm = {};
  try {
    const j = await nse.nseGet("/api/equity-stockIndices?index=NIFTY%20TOTAL%20MARKET", "/market-data/live-equity-market");
    for (const x of j.data || []) if (x.symbol && x.priority !== 1) tm[x.symbol] = x;
  } catch (e) { log("[groups] total market: " + e.message); }
  // keep the last good market list so a brief NSE outage still shows full groups (prices then come from the site's own data)
  const tf = path.join(cacheDir, "group_tm.json");
  if (Object.keys(tm).length > 300) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(tf, JSON.stringify(Object.fromEntries(all.filter(s => tm[s]).map(s => [s, { lastPrice: tm[s].lastPrice, pChange: tm[s].pChange, ffmc: tm[s].ffmc, perChange30d: tm[s].perChange30d, perChange365d: tm[s].perChange365d, meta: { companyName: tm[s].meta?.companyName } }])))); } catch {} }
  else { const old = readJson(tf, {}); for (const [s, x] of Object.entries(old)) if (!tm[s]) { const cur = S[s]; tm[s] = cur ? { ...x, lastPrice: cur.price, pChange: cur.change_pct, ffmc: x.ffmc && x.lastPrice ? x.ffmc / x.lastPrice * cur.price : x.ffmc } : x; } }
  // 2) share counts (cached 5 days) — three free sources, first that works wins; outcome kept in diag
  const cf = path.join(cacheDir, "group_shares.json"), cache = readJson(cf, {});
  const diag = { total_market: Object.keys(tm).length };
  const stale = s => !cache[s] || Date.now() - cache[s].t > 5 * 864e5;
  const fresh = {};
  // 2a) Yahoo Finance quote (one call for all members; needs a session cookie + crumb)
  try {
    const yq = await yahooQuotes(all.map(s => s.replace(/&/g, "%26") + ".NS"));
    let n = 0;
    for (const q of yq) { const sym = q.symbol.replace(/\.NS$/, "").replace(/%26/g, "&");
      if (q.sharesOutstanding) { cache[sym] = { sh: q.sharesOutstanding, name: q.longName || q.shortName || null, t: Date.now(), src: "yahoo" }; n++; }
      if (q.regularMarketPrice) fresh[sym] = { price: q.regularMarketPrice, chg: r2(q.regularMarketChangePercent), y1: r2(q.fiftyTwoWeekChangePercent), mcap: q.marketCap || null, name: q.longName || q.shortName }; }
    diag.yahoo = `${yq.length} quotes, ${n} share counts`;
  } catch (e) { diag.yahoo = "failed: " + e.message; }
  // 2a+) 1-month move for companies the site doesn't track (Yahoo daily chart, small and quick)
  try { const L = all.filter(s => !S[s]), t1 = Date.now(); let n = 0;
    const w = async () => { while (L.length && Date.now() - t1 < 25e3) { const s = L.shift();
      try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s + ".NS")}?range=1mo&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
        const c = (await r.json())?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
        if (c.length > 10) { fresh[s] = { ...(fresh[s] || {}), m1: r2((c[c.length - 1] / c[0] - 1) * 100) }; n++; } } catch {} } };
    await Promise.all([w(), w(), w(), w(), w(), w()]); diag.yahoo_1m = `${n} ok`; } catch (e) { diag.yahoo_1m = e.message; }
  // 2b) NSE end-of-day market-cap file (PRddmmyy.zip → MCAP*.csv: issue size for every listed company)
  if (all.some(stale)) {
    try { const m = await nseMcapFile(); let n = 0; for (const s of all) if (m.map[s] && stale(s)) { cache[s] = { sh: m.map[s].sh, name: m.map[s].name, t: Date.now(), src: "nse-pr" }; if (!fresh[s] && !tm[s] && !S[s]) fresh[s] = { price: m.map[s].close, chg: null }; n++; } diag.nse_pr = `${m.file}: ${Object.keys(m.map).length} rows, ${n} used`; }
    catch (e) { diag.nse_pr = "failed: " + e.message; }
  }
  // 2c) NSE quote page, a few at a time
  const need = all.filter(s => stale(s) || (!tm[s] && !S[s] && !fresh[s]));
  let done = 0, fails = 0; const t0 = Date.now();
  const worker = async () => { while (need.length && Date.now() - t0 < 40e3 && fails < 6) { const s = need.shift();
    try { const q = await nse.nseGet(`/api/quote-equity?symbol=${encodeURIComponent(s)}`, `/get-quotes/equity?symbol=${encodeURIComponent(s)}`);
      const sh = Number(q?.securityInfo?.issuedSize) || null, pi = q?.priceInfo || {};
      if (sh) cache[s] = { sh, name: q?.info?.companyName || null, t: Date.now(), src: "nse-quote" };
      if (pi.lastPrice && !fresh[s]) fresh[s] = { price: +pi.lastPrice, chg: r2(+pi.pChange), name: q?.info?.companyName };
      done++; } catch (e) { fails++; diag.nse_quote_err = e.message; } } };
  if (need.length) await Promise.all([worker(), worker(), worker()]);
  diag.nse_quote = `${done} ok, ${fails} failed`;
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cf, JSON.stringify(cache)); } catch {}
  // 3) assemble
  const groups = GROUPS.map(g => {
    const rows = g.members.map(sym => {
      const t = tm[sym], s = S[sym], f = fresh[sym], c = cache[sym];
      const price = t?.lastPrice ?? s?.price ?? f?.price; if (price == null) return null;
      const chg = t ? r2(t.pChange) : s?.change_pct ?? f?.chg ?? null;
      // sanity: issued shares can't be below free-float shares; if so the cache is stale (split/bonus) -> use free-float
      const ffSh = t?.ffmc && price ? t.ffmc / price : null;
      const sh = c?.sh && (!ffSh || c.sh >= ffSh * 0.98) ? c.sh : null;
      const mcap = sh ? sh * price / 1e7 : f?.mcap ? f.mcap / 1e7 : ffSh ? t.ffmc / 1e7 : null; // ₹ crore
      return { symbol: sym, name: (s?.name || t?.meta?.companyName || c?.name || f?.name || sym).replace(/\s+(Ltd\.?|Limited)$/i, ""), price: r2(price), chg,
        m1: t ? r2(t.perChange30d) : s?.tech?.ret_1m ?? f?.m1 ?? null, y1: t ? r2(t.perChange365d) : s?.tech?.ret_1y ?? f?.y1 ?? null,
        mcap_cr: mcap ? Math.round(mcap) : null, ff: !sh && !f?.mcap && !!ffSh, tracked: !!s };
    }).filter(Boolean).sort((a, b) => (b.mcap_cr || 0) - (a.mcap_cr || 0));
    const cap = rows.reduce((a, r) => a + (r.mcap_cr || 0), 0);
    const w = k => { const L = rows.filter(r => r[k] != null && r.mcap_cr); const tot = L.reduce((a, r) => a + r.mcap_cr, 0); return tot ? r2(L.reduce((a, r) => a + r[k] * r.mcap_cr, 0) / tot) : null; };
    return { id: g.id, name: g.name, who: g.who, mcap_cr: Math.round(cap), chg: w("chg"), m1: w("m1"), y1: w("y1"), up: rows.filter(r => r.chg > 0).length, n: rows.length, members: rows };
  }).filter(g => g.n).sort((a, b) => b.mcap_cr - a.mcap_cr);
  diag.with_mcap = `${groups.reduce((a, g) => a + g.members.filter(m => m.mcap_cr).length, 0)}/${groups.reduce((a, g) => a + g.n, 0)}`;
  log(`[groups] ${groups.length} groups · ${JSON.stringify(diag)}`);
  return { updated: new Date().toISOString(), diag, groups };
}

module.exports = { build, GROUPS };
