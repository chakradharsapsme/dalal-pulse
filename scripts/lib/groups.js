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
  { id: "icici", name: "ICICI Group", who: "ICICI Bank and subsidiaries", members: ["ICICIBANK", "ICICIPRULI", "ICICIGI"] },
  { id: "adani", name: "Adani Group", who: "Gautam Adani", members: ["ADANIPORTS", "ADANIPOWER", "ADANIENT", "ADANIGREEN", "ADANIENSOL", "AMBUJACEM", "ATGL", "ACC", "AWL", "NDTV"] },
  { id: "bajaj", name: "Bajaj Group", who: "Bajaj family (Rahul/Sanjiv/Rajiv Bajaj)", members: ["BAJFINANCE", "BAJAJFINSV", "BAJAJ-AUTO", "BAJAJHFL", "BAJAJHLDNG", "MAHSCOOTER", "BAJAJELEC"] },
  { id: "sbi", name: "SBI Group", who: "State Bank of India and subsidiaries", members: ["SBIN", "SBILIFE", "SBICARD"] },
  { id: "birla", name: "Aditya Birla Group", who: "Kumar Mangalam Birla", members: ["ULTRACEMCO", "HINDALCO", "GRASIM", "ABCAPITAL", "IDEA", "ABSLAMC", "ABREL", "ABFRL", "ABLBL"] },
  { id: "lt", name: "L&T Group", who: "Larsen & Toubro", members: ["LT", "LTIM", "LTTS", "LTF"] },
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
  // 2) share counts (cached 5 days) + price for members outside the total-market list
  const cf = path.join(cacheDir, "group_shares.json"), cache = readJson(cf, {});
  const need = all.filter(s => !cache[s] || Date.now() - cache[s].t > 5 * 864e5 || (!tm[s] && !S[s]));
  const fresh = {}; let done = 0, t0 = Date.now();
  const worker = async () => { while (need.length && Date.now() - t0 < 60e3) { const s = need.shift();
    try { const q = await nse.nseGet(`/api/quote-equity?symbol=${encodeURIComponent(s)}`, `/get-quotes/equity?symbol=${encodeURIComponent(s)}`);
      const sh = Number(q?.securityInfo?.issuedSize) || null, pi = q?.priceInfo || {};
      if (sh) cache[s] = { sh, name: q?.info?.companyName || null, t: Date.now() };
      if (pi.lastPrice) fresh[s] = { price: +pi.lastPrice, chg: r2(+pi.pChange), hi: pi.weekHighLow?.max, lo: pi.weekHighLow?.min, name: q?.info?.companyName };
      done++; } catch (e) { /* unknown or delisted symbol: skipped */ } } };
  await Promise.all([worker(), worker(), worker(), worker()]);
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
      const mcap = sh ? sh * price / 1e7 : ffSh ? t.ffmc / 1e7 : null; // ₹ crore
      return { symbol: sym, name: (s?.name || t?.meta?.companyName || c?.name || f?.name || sym).replace(/\s+(Ltd\.?|Limited)$/i, ""), price: r2(price), chg,
        m1: t ? r2(t.perChange30d) : s?.tech?.ret_1m ?? null, y1: t ? r2(t.perChange365d) : s?.tech?.ret_1y ?? null,
        mcap_cr: mcap ? Math.round(mcap) : null, ff: !sh && !!ffSh, tracked: !!s };
    }).filter(Boolean).sort((a, b) => (b.mcap_cr || 0) - (a.mcap_cr || 0));
    const cap = rows.reduce((a, r) => a + (r.mcap_cr || 0), 0);
    const w = k => { const L = rows.filter(r => r[k] != null && r.mcap_cr); const tot = L.reduce((a, r) => a + r.mcap_cr, 0); return tot ? r2(L.reduce((a, r) => a + r[k] * r.mcap_cr, 0) / tot) : null; };
    return { id: g.id, name: g.name, who: g.who, mcap_cr: Math.round(cap), chg: w("chg"), m1: w("m1"), y1: w("y1"), up: rows.filter(r => r.chg > 0).length, n: rows.length, members: rows };
  }).filter(g => g.n).sort((a, b) => b.mcap_cr - a.mcap_cr);
  log(`[groups] ${groups.length} groups, ${groups.reduce((a, g) => a + g.n, 0)} companies (total-market ${Object.keys(tm).length}, share counts fetched ${done})`);
  return { updated: new Date().toISOString(), groups };
}

module.exports = { build, GROUPS };
