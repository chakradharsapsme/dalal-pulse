// World markets, macro cues and policy news (for the "World Indexes" screen), plus company fundamentals
// (for the Stock Analyzer). All free sources: Yahoo Finance and Google News RSS. Fundamentals are cached a day.
const fs = require("fs"), path = require("path");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;

const WORLD = [
  // [yahoo symbol, name, region, kind]
  ["^GSPC", "S&P 500", "Americas"], ["^DJI", "Dow Jones", "Americas"], ["^IXIC", "Nasdaq", "Americas"], ["^RUT", "Russell 2000", "Americas"], ["^BVSP", "Brazil Bovespa", "Americas"],
  ["^FTSE", "UK FTSE 100", "Europe"], ["^GDAXI", "Germany DAX", "Europe"], ["^FCHI", "France CAC 40", "Europe"], ["^STOXX50E", "Euro Stoxx 50", "Europe"],
  ["^N225", "Japan Nikkei 225", "Asia"], ["^HSI", "Hong Kong Hang Seng", "Asia"], ["000001.SS", "China Shanghai", "Asia"], ["^KS11", "Korea KOSPI", "Asia"], ["^TWII", "Taiwan", "Asia"], ["^STI", "Singapore STI", "Asia"], ["^AXJO", "Australia ASX 200", "Asia"],
  ["^NSEI", "India Nifty 50", "India"], ["^BSESN", "India Sensex", "India"],
];
const MACRO = [
  // [yahoo symbol, name, key, unit, group]
  ["INR=X", "USD / INR", "inr", "₹", "Currency & rates"], ["DX-Y.NYB", "US Dollar index", "dollar", "", "Currency & rates"], ["^TNX", "US 10-year yield", "yield", "%", "Currency & rates"], ["^IRX", "US 3-month T-bill (tracks Fed rate)", "fed", "%", "Currency & rates"], ["EURINR=X", "EUR / INR", "eurinr", "₹", "Currency & rates"],
  ["GC=F", "Gold", "gold", "$", "Precious metals"], ["SI=F", "Silver", "silver", "$", "Precious metals"],
  ["BZ=F", "Brent crude", "crude", "$", "Energy"], ["CL=F", "WTI crude", "wti", "$", "Energy"], ["NG=F", "Natural gas", "natgas", "$", "Energy"],
  ["HG=F", "Copper", "copper", "$", "Industrial metals"], ["ALI=F", "Aluminium", "alu", "$", "Industrial metals"],
  ["^VIX", "US VIX (fear gauge)", "vix", "", "Risk gauges"], ["^INDIAVIX", "India VIX", "ivix", "", "Risk gauges"], ["BTC-USD", "Bitcoin (risk appetite)", "btc", "$", "Risk gauges"],
];

async function chart(sym) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const res = (await r.json())?.chart?.result?.[0]; const q = res?.indicators?.quote?.[0]; if (!q) continue;
      const rows = res.timestamp.map((t, i) => [t, q.close[i]]).filter(x => x[1] != null);
      if (rows.length < 5) continue;
      const m = res.meta, last = m.regularMarketPrice ?? rows[rows.length - 1][1];
      const lastDay = new Date((rows[rows.length - 1][0] + 19800) * 1000).toISOString().slice(0, 10), liveDay = m.regularMarketTime ? new Date((m.regularMarketTime + 19800) * 1000).toISOString().slice(0, 10) : lastDay;
      const prev = lastDay === liveDay ? rows[rows.length - 2]?.[1] : rows[rows.length - 1][1];
      const back = n => rows.length > n ? rows[rows.length - 1 - n][1] : rows[0][1];
      const ch = b => b ? r2((last / b - 1) * 100) : null;
      const sma = n => rows.length >= n ? rows.slice(-n).reduce((a, x) => a + x[1], 0) / n : null, s50 = sma(50), s200 = sma(200);
      return { price: r2(last), change_pct: ch(prev), w1: ch(back(5)), m1: ch(back(21)), m3: ch(back(63)), y1: ch(rows[0][1]),
        trend: s50 && s200 ? (last > s50 && s50 > s200 ? "Uptrend" : last < s50 && s50 < s200 ? "Downtrend" : "Sideways") : null,
        time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null, tz: m.exchangeTimezoneName || null,
        spark: rows.slice(-60).map(x => r2(x[1])) };
    } catch {}
  }
  return null;
}

// ---- policy & macro news (Google News RSS works from GitHub Actions) ----
const gnews = q => "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en-IN&gl=IN&ceid=IN:en";
const NEWSQ = [
  ["fed", "US Federal Reserve", "(\"Federal Reserve\" OR Fed OR Powell OR FOMC) (rate OR rates OR inflation) when:3d"],
  ["rbi", "RBI & rates", "(RBI OR \"Reserve Bank of India\" OR \"repo rate\" OR \"monetary policy\") when:5d"],
  ["govt", "Government of India decisions", "(\"Union Cabinet\" OR \"Finance Ministry\" OR \"Centre approves\" OR \"government approves\" OR GST OR SEBI OR \"PLI scheme\" OR tariff OR budget) India when:3d"],
  ["commod", "Gold, crude & commodities", "(gold OR \"crude oil\" OR Brent OR silver OR copper OR commodity OR OPEC) price when:2d"],
  ["global", "Global cues", "(\"global markets\" OR \"Wall Street\" OR \"crude oil\" OR \"dollar index\" OR \"bond yields\" OR tariffs) when:2d"],
];
const dec = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (b, n) => { const m = b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i")); return m ? dec(m[1]) : ""; };
const POS = /\b(cut|cuts|eases|easing|approves|boost|relief|stimulus|surge|rally|rallies|gains|record high|upgrade|lower inflation|cools|reform|incentive)\b/i;
const NEG = /\b(hike|hikes|raises|tighten|tightening|tariff|tariffs|sanction|war|slump|falls|plunge|selloff|sell-off|recession|downgrade|inflation rises|probe|ban|curbs|outflows)\b/i;
async function policyNews(log) {
  const out = {};
  await Promise.all(NEWSQ.map(async ([k, label, q]) => {
    try {
      const r = await fetch(gnews(q), { headers: { "User-Agent": UA, Accept: "application/rss+xml,text/xml,*/*" }, signal: AbortSignal.timeout(15000) });
      const xml = r.ok ? await r.text() : "";
      const seen = new Set();
      const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => { const b = m[0], src = tag(b, "source"); let t = tag(b, "title"); if (src && t.endsWith(" - " + src)) t = t.slice(0, -(src.length + 3));
        const d = Date.parse(tag(b, "pubDate")); return { title: t, link: tag(b, "link"), source: src || "News", published: isNaN(d) ? null : new Date(d).toISOString(), tone: POS.test(t) && !NEG.test(t) ? "positive" : NEG.test(t) && !POS.test(t) ? "negative" : "neutral" }; })
        .filter(i => i.title && i.published && !/profile and biography|live updates?:? *$/i.test(i.title))
        .filter(i => { const key = i.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50); if (seen.has(key)) return false; seen.add(key); return true; })
        .sort((a, b) => b.published.localeCompare(a.published)).slice(0, 10);
      out[k] = { label, items };
    } catch (e) { out[k] = { label, items: [], error: e.message }; }
  }));
  log(`[world] policy news: ${Object.entries(out).map(([k, v]) => `${k} ${v.items.length}`).join(", ")}`);
  return out;
}

// rule-based read of what the global picture means for Indian stocks
function readCues(idx, mac) {
  const g = n => idx.find(x => x.name === n), m = k => mac.find(x => x.key === k), lines = []; let score = 0;
  const us = ["S&P 500", "Nasdaq"].map(g).filter(Boolean), asia = ["Japan Nikkei 225", "Hong Kong Hang Seng", "Korea KOSPI", "Taiwan"].map(g).filter(Boolean);
  const avg = L => L.length ? L.reduce((a, x) => a + (x.change_pct || 0), 0) / L.length : 0;
  const u = avg(us), a = avg(asia);
  if (us.length) { score += u > 0.5 ? 1 : u < -0.5 ? -1 : 0; lines.push(`US markets ${u >= 0 ? "up" : "down"} ${Math.abs(u).toFixed(1)}% in the last session: ${u > 0.5 ? "a supportive lead for India" : u < -0.5 ? "a weak lead; expect caution at the open" : "no strong lead"}.`); }
  if (asia.length) { score += a > 0.5 ? 1 : a < -0.5 ? -1 : 0; lines.push(`Asian markets ${a >= 0 ? "up" : "down"} ${Math.abs(a).toFixed(1)}% on average: ${a > 0.5 ? "positive regional mood" : a < -0.5 ? "risk-off in the region" : "mixed"}.`); }
  const crude = m("crude"); if (crude?.m1 != null) { score += crude.m1 < -5 ? 1 : crude.m1 > 5 ? -1 : 0; lines.push(`Brent crude ${crude.m1 >= 0 ? "up" : "down"} ${Math.abs(crude.m1).toFixed(1)}% in a month: ${crude.m1 > 5 ? "costlier oil hurts India (imports ~85% of its oil): watch OMCs, paints, airlines, tyres" : crude.m1 < -5 ? "cheaper oil helps India's inflation and OMCs, paints, airlines" : "neutral for India"}.`); }
  const dxy = m("dollar"); if (dxy?.m1 != null) { score += dxy.m1 > 2 ? -1 : dxy.m1 < -2 ? 1 : 0; lines.push(`Dollar index ${dxy.m1 >= 0 ? "up" : "down"} ${Math.abs(dxy.m1).toFixed(1)}% in a month: ${dxy.m1 > 2 ? "a strong dollar pulls foreign money out of emerging markets like India" : dxy.m1 < -2 ? "a weaker dollar usually brings foreign money into India" : "stable"}.`); }
  const y10 = m("yield"); if (y10?.m1 != null) { score += y10.m1 > 5 ? -1 : y10.m1 < -5 ? 1 : 0; lines.push(`US 10-year yield at ${y10.price}% (${y10.m1 >= 0 ? "+" : ""}${y10.m1.toFixed(1)}% in a month): ${y10.m1 > 5 ? "rising US yields make Indian stocks less attractive to foreign investors (pressure on IT, banks)" : y10.m1 < -5 ? "falling US yields favour emerging markets and IT stocks" : "steady"}.`); }
  const fed = m("fed"); if (fed?.price != null) lines.push(`US 3-month T-bill at ${fed.price}%: a proxy for where markets expect the Fed policy rate${fed.m3 != null ? ` (${fed.m3 < -3 ? "falling: markets price Fed cuts" : fed.m3 > 3 ? "rising: markets price tighter Fed policy" : "little change in 3 months"})` : ""}.`);
  const inr = m("inr"); if (inr?.m1 != null) lines.push(`Rupee at ₹${inr.price} per dollar (${inr.m1 >= 0 ? "weaker" : "stronger"} by ${Math.abs(inr.m1).toFixed(1)}% in a month): ${inr.m1 > 1 ? "helps IT and pharma exporters, hurts importers" : inr.m1 < -1 ? "helps importers and oil companies" : "stable"}.`);
  const gold = m("gold"); if (gold?.m1 != null) lines.push(`Gold ${gold.m1 >= 0 ? "up" : "down"} ${Math.abs(gold.m1).toFixed(1)}% in a month: ${gold.m1 > 4 ? "investors are seeking safety (risk-off); supports gold-loan lenders and jewellers' inventory value" : gold.m1 < -4 ? "safe-haven demand is fading: usually a risk-on sign for equities" : "steady"}.`);
  const cu = m("copper"); if (cu?.m1 != null) lines.push(`Copper ${cu.m1 >= 0 ? "up" : "down"} ${Math.abs(cu.m1).toFixed(1)}% in a month: ${cu.m1 > 5 ? "strong global industrial demand: positive for metal stocks (Hindalco, Vedanta, Hindustan Copper)" : cu.m1 < -5 ? "weaker industrial demand: a drag on metal stocks" : "neutral for metals"}.`);
  const vix = m("vix"); if (vix?.price != null) { score += vix.price > 25 ? -1 : vix.price < 15 ? 1 : 0; lines.push(`US VIX ${vix.price}: ${vix.price > 25 ? "high fear worldwide" : vix.price < 15 ? "calm global markets" : "normal nerves"}.`); }
  const label = score >= 2 ? "Supportive" : score <= -2 ? "Negative" : "Mixed";
  return { score, label, lines };
}

async function build(log) {
  const idx = [], mac = [];
  const todo = WORLD.map(w => ["i", w]).concat(MACRO.map(m => ["m", m]));
  await Promise.all(Array.from({ length: 6 }, async () => { while (todo.length) { const [k, w] = todo.shift(); const c = await chart(w[0]);
    if (!c) continue; if (k === "i") idx.push({ sym: w[0], name: w[1], region: w[2], ...c }); else mac.push({ sym: w[0], name: w[1], key: w[2], unit: w[3], group: w[4], ...c }); } }));
  const ord = (L, src) => L.sort((a, b) => src.findIndex(x => x[0] === a.sym) - src.findIndex(x => x[0] === b.sym));
  ord(idx, WORLD); ord(mac, MACRO);
  const news = await policyNews(log);
  log(`[world] ${idx.length}/${WORLD.length} indices, ${mac.length}/${MACRO.length} macro`);
  return { updated: new Date().toISOString(), indices: idx, macro: mac, cues: readCues(idx, mac), news };
}

// ---------- fundamentals (Yahoo quoteSummary with a session crumb; cached ~1 day per stock) ----------
async function yahooSession() {
  const r0 = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(10000) }).catch(() => null);
  const ck = (r0?.headers?.getSetCookie ? r0.headers.getSetCookie() : []).map(c => c.split(";")[0]).join("; ");
  const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: ck }, signal: AbortSignal.timeout(10000) });
  const crumb = (await cr.text()).trim(); if (!cr.ok || !crumb || crumb.length > 40 || /</.test(crumb)) throw new Error("no crumb (HTTP " + cr.status + ")");
  return { ck, crumb };
}
const raw = v => v == null ? null : typeof v === "object" ? (v.raw ?? null) : v;
const pctv = v => raw(v) == null ? null : r2(raw(v) * 100);
async function summary(sym, ses) {
  const mods = "summaryDetail,defaultKeyStatistics,financialData,incomeStatementHistory,incomeStatementHistoryQuarterly,cashflowStatementHistory,earningsTrend,majorHoldersBreakdown,assetProfile";
  const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym + ".NS")}?modules=${mods}&crumb=${encodeURIComponent(ses.crumb)}`, { headers: { "User-Agent": UA, Cookie: ses.ck, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const q = (await r.json())?.quoteSummary?.result?.[0]; if (!q) throw new Error("empty");
  const sd = q.summaryDetail || {}, ks = q.defaultKeyStatistics || {}, fd = q.financialData || {}, ap = q.assetProfile || {}, mh = q.majorHoldersBreakdown || {};
  const yr = (q.incomeStatementHistory?.incomeStatementHistory || []).map(x => ({ y: raw(x.endDate) ? new Date(raw(x.endDate) * 1000).getUTCFullYear() : null, rev: raw(x.totalRevenue), np: raw(x.netIncome), op: raw(x.operatingIncome) })).filter(x => x.y && x.rev).reverse();
  const qt = (q.incomeStatementHistoryQuarterly?.incomeStatementHistory || []).map(x => ({ d: raw(x.endDate) ? new Date(raw(x.endDate) * 1000).toISOString().slice(0, 7) : null, rev: raw(x.totalRevenue), np: raw(x.netIncome) })).filter(x => x.d && x.rev).reverse();
  const cf = (q.cashflowStatementHistory?.cashflowStatements || []).map(x => ({ y: raw(x.endDate) ? new Date(raw(x.endDate) * 1000).getUTCFullYear() : null, ocf: raw(x.totalCashFromOperatingActivities), capex: raw(x.capitalExpenditures) })).filter(x => x.y).reverse();
  const cr = v => v == null ? null : Math.round(v / 1e7); // ₹ crore
  const eps = raw(ks.trailingEps), bvps = raw(ks.bookValue), roeY = pctv(fd.returnOnEquity) ?? (eps != null && bvps > 0 ? r2(eps / bvps * 100) : null);
  return {
    t: Date.now(), sector: ap.sector || null, industry: ap.industry || null, employees: ap.fullTimeEmployees || null, about: ap.longBusinessSummary ? String(ap.longBusinessSummary).slice(0, 600) : null,
    mcap_cr: cr(raw(sd.marketCap)), pe: r2(raw(sd.trailingPE)), fpe: r2(raw(sd.forwardPE) ?? raw(ks.forwardPE)), pb: r2(raw(ks.priceToBook)), ev_ebitda: r2(raw(ks.enterpriseToEbitda)), peg: r2(raw(ks.pegRatio)),
    eps: r2(raw(ks.trailingEps)), feps: r2(raw(ks.forwardEps)), bv: r2(raw(ks.bookValue)), divy: pctv(sd.dividendYield), payout: pctv(sd.payoutRatio), beta: r2(raw(sd.beta) ?? raw(ks.beta)),
    roe: roeY, roa: pctv(fd.returnOnAssets), npm: pctv(fd.profitMargins), opm: pctv(fd.operatingMargins), gpm: pctv(fd.grossMargins), ebitdam: pctv(fd.ebitdaMargins),
    rev_g: pctv(fd.revenueGrowth), earn_g: pctv(fd.earningsGrowth), rev_cr: cr(raw(fd.totalRevenue)), ebitda_cr: cr(raw(fd.ebitda)),
    debt_cr: cr(raw(fd.totalDebt)), cash_cr: cr(raw(fd.totalCash)), de: raw(fd.debtToEquity) != null ? r2(raw(fd.debtToEquity) / 100) : null, cur: r2(raw(fd.currentRatio)), qr: r2(raw(fd.quickRatio)),
    fcf_cr: cr(raw(fd.freeCashflow)), ocf_cr: cr(raw(fd.operatingCashflow)),
    target: r2(raw(fd.targetMeanPrice)), target_hi: r2(raw(fd.targetHighPrice)), target_lo: r2(raw(fd.targetLowPrice)), analysts: raw(fd.numberOfAnalystOpinions), reco: fd.recommendationKey || null, reco_mean: r2(raw(fd.recommendationMean)),
    insiders: pctv(mh.insidersPercentHeld ?? ks.heldPercentInsiders), inst: pctv(mh.institutionsPercentHeld ?? ks.heldPercentInstitutions),
    years: yr.map(x => ({ y: x.y, rev: cr(x.rev), np: cr(x.np), op: cr(x.op) })), quarters: qt.slice(-6).map(x => ({ d: x.d, rev: cr(x.rev), np: cr(x.np) })), cash: cf.map(x => ({ y: x.y, ocf: cr(x.ocf), capex: cr(x.capex) })),
  };
}
async function fundamentals(symbols, cacheDir, log, budget = 80) {
  const dir = path.join(cacheDir, "fund"); fs.mkdirSync(dir, { recursive: true });
  const file = s => path.join(dir, s.replace(/[^A-Z0-9&-]/gi, "_") + ".json"), out = {}, need = [];
  for (const s of symbols) { try { const j = JSON.parse(fs.readFileSync(file(s), "utf8")); out[s] = j; if (Date.now() - j.t > 20 * 3600e3) need.push(s); } catch { need.push(s); } }
  let ok = 0, fail = 0, err = "";
  if (need.length) {
    let ses = null; try { ses = await yahooSession(); } catch (e) { err = e.message; }
    if (ses) { const todo = need.slice(0, budget);
      await Promise.all(Array.from({ length: 5 }, async () => { while (todo.length && fail < 12) { const s = todo.shift();
        try { const f = await summary(s, ses); out[s] = f; fs.writeFileSync(file(s), JSON.stringify(f)); ok++; } catch (e) { fail++; err = e.message; } } })); }
  }
  log(`[fund] ${ok} refreshed, ${fail} failed${err ? " (" + err + ")" : ""}, ${Object.keys(out).length}/${symbols.length} available`);
  return out;
}

module.exports = { build, fundamentals, WORLD, MACRO };
