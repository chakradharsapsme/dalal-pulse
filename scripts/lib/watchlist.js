// Nifty 50 watchlist with news-matching keywords.
// On startup the list is refreshed from NSE's official CSV; if that fails, the bundled list is used.
const NSE_NIFTY50_CSV = "https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv";

// symbol -> keywords that identify the company in a headline (case-sensitive, whole words)
const KEYWORDS = {
  "ADANIENT": ["Adani Enterprises"],
  "ADANIPORTS": ["Adani Ports", "APSEZ"],
  "APOLLOHOSP": ["Apollo Hospitals"],
  "ASIANPAINT": ["Asian Paints"],
  "AXISBANK": ["Axis Bank"],
  "BAJAJ-AUTO": ["Bajaj Auto"],
  "BAJFINANCE": ["Bajaj Finance"],
  "BAJAJFINSV": ["Bajaj Finserv"],
  "BEL": ["Bharat Electronics", "BEL"],
  "BHARTIARTL": ["Bharti Airtel", "Airtel"],
  "CIPLA": ["Cipla"],
  "COALINDIA": ["Coal India"],
  "DRREDDY": ["Dr Reddy", "Dr. Reddy", "Dr Reddys"],
  "EICHERMOT": ["Eicher Motors", "Royal Enfield"],
  "ETERNAL": ["Eternal", "Zomato", "Blinkit"],
  "GRASIM": ["Grasim"],
  "HCLTECH": ["HCL Tech", "HCLTech", "HCL Technologies"],
  "HDFCBANK": ["HDFC Bank"],
  "HDFCLIFE": ["HDFC Life"],
  "HINDALCO": ["Hindalco"],
  "HINDUNILVR": ["Hindustan Unilever", "HUL"],
  "ICICIBANK": ["ICICI Bank"],
  "INDIGO": ["InterGlobe", "IndiGo"],
  "INFY": ["Infosys"],
  "ITC": ["ITC"],
  "JIOFIN": ["Jio Financial"],
  "JSWSTEEL": ["JSW Steel"],
  "KOTAKBANK": ["Kotak Mahindra Bank", "Kotak Bank"],
  "LT": ["Larsen & Toubro", "Larsen and Toubro", "L&T"],
  "M&M": ["Mahindra & Mahindra", "Mahindra and Mahindra", "M&M", "Mahindra"],
  "MARUTI": ["Maruti Suzuki", "Maruti"],
  "MAXHEALTH": ["Max Healthcare"],
  "NESTLEIND": ["Nestle India"],
  "NTPC": ["NTPC"],
  "ONGC": ["ONGC", "Oil and Natural Gas"],
  "POWERGRID": ["Power Grid"],
  "RELIANCE": ["Reliance Industries", "RIL", "Reliance Jio", "Reliance Retail", "Jio", "Mukesh Ambani"],
  "SBILIFE": ["SBI Life"],
  "SBIN": ["State Bank of India", "SBI"],
  "SHRIRAMFIN": ["Shriram Finance"],
  "SUNPHARMA": ["Sun Pharma", "Sun Pharmaceutical"],
  "TATACONSUM": ["Tata Consumer"],
  "TMPV": ["Tata Motors"],
  "TATASTEEL": ["Tata Steel"],
  "TCS": ["TCS", "Tata Consultancy"],
  "TECHM": ["Tech Mahindra"],
  "TITAN": ["Titan"],
  "TRENT": ["Trent", "Zudio"],
  "ULTRACEMCO": ["UltraTech Cement", "UltraTech"],
  "WIPRO": ["Wipro"],
  // stocks whose symbol is also a common market word
  "BSE": ["BSE Ltd", "BSE shares", "BSE stock", "BSE share price"],
  "NSE": ["NSE shares", "NSE IPO"],
  "IDEA": ["Vodafone Idea", "Vi"],
  "MCX": ["MCX shares", "Multi Commodity Exchange"],
  "CDSL": ["CDSL", "Central Depository Services"],
  "LICI": ["LIC", "Life Insurance Corporation"],
};

// Words that must NOT come right before a keyword ("Tech Mahindra" is not M&M)
const EXCLUDE_BEFORE = {
  "Mahindra": ["Tech", "Kotak"],
};

// Words that must NOT follow a keyword for it to count (avoids "SBI Life" matching SBIN)
const EXCLUDE_AFTER = {
  "SBI": ["Life", "Card", "Cards", "General", "Mutual", "MF", "Funds"],
  "Titan": ["Intech"],
  "Mahindra": ["Finance", "Lifespace", "Holidays", "Logistics", "Finserv", "&", "and"],
  "Jio": ["Financial", "BlackRock"],
  "L&T": ["Finance", "Technology", "Tech", "Mindtree"],
};

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function deriveKeywords(name) {
  const n = name.replace(/\([^)]*\)/g, "").replace(/\b(Limited|Ltd\.?|Company|Co\.?|Corporation of India|Corporation|Corpn\.?)(?=\s|$)/gi, "")
    .replace(/\s+/g, " ").replace(/^[\s.,]+|[\s.,]+$/g, "");
  return n ? [n] : [];
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(l => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, "").replace(/^"|"$/g, "").trim());
    return Object.fromEntries(head.map((h, i) => [h, cells[i] || ""]));
  });
}

async function loadWatchlist(log) {
  const base = Object.fromEntries(Object.entries(KEYWORDS).map(([s, k]) => [s, { name: k[0], keywords: k }]));
  try {
    const r = await fetch(NSE_NIFTY50_CSV, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const rows = parseCsv(await r.text());
    if (rows.length < 45 || !rows[0]["Symbol"]) throw new Error("unexpected CSV format");
    const fresh = {};
    for (const row of rows) {
      const sym = row["Symbol"], name = row["Company Name"];
      fresh[sym] = { name, industry: row["Industry"] || "", keywords: KEYWORDS[sym] || deriveKeywords(name) };
    }
    const added = Object.keys(fresh).filter(s => !base[s]), removed = Object.keys(base).filter(s => !fresh[s]);
    if (added.length || removed.length) log(`[watchlist] NSE list differs from bundled. Added: ${added.join(", ") || "-"}  Removed: ${removed.join(", ") || "-"}`);
    log(`[watchlist] Loaded ${Object.keys(fresh).length} Nifty 50 stocks from NSE`);
    return fresh;
  } catch (e) {
    log(`[watchlist] Could not refresh from NSE (${e.message}); using bundled list of ${Object.keys(base).length}`);
    return base;
  }
}

function compileMatchers(watchlist) {
  const out = {};
  for (const [sym, info] of Object.entries(watchlist)) {
    out[sym] = info.keywords.map(kw => {
      const excl = EXCLUDE_AFTER[kw];
      const neg = excl ? `(?!\\s+(?:${excl.map(esc).join("|")})(?![\\w]))` : "";
      const before = EXCLUDE_BEFORE[kw];
      const negB = before ? before.map(b => `(?<!${esc(b)}\\s)`).join("") : "";
      return new RegExp(`${negB}(?<![\\w&])${esc(kw)}(?![\\w&])${neg}`);
    });
  }
  return out;
}

function matchSymbols(text, matchers) {
  return Object.keys(matchers).filter(s => matchers[s].some(re => re.test(text)));
}

module.exports = { loadWatchlist, compileMatchers, matchSymbols, deriveKeywords, KEYWORDS };
