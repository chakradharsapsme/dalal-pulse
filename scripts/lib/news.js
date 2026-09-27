// News: Moneycontrol RSS feeds, plus Google News (moneycontrol.com only) as fallback.
const crypto = require("crypto");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const MONEYCONTROL_FEEDS = {
  "MC Latest": "https://www.moneycontrol.com/rss/latestnews.xml",
  "MC Buzzing Stocks": "https://www.moneycontrol.com/rss/buzzingstocks.xml",
  "MC Market Reports": "https://www.moneycontrol.com/rss/marketreports.xml",
  "MC Business": "https://www.moneycontrol.com/rss/business.xml",
  "MC Results": "https://www.moneycontrol.com/rss/results.xml",
};
const gnews = q => "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en-IN&gl=IN&ceid=IN:en";
// Several Google News views of moneycontrol.com, so stock-specific stories are not crowded out by general news
const GOOGLE_FEEDS = {
  "Google News: MC all": gnews("site:moneycontrol.com when:1d"),
  "Google News: MC shares": gnews("site:moneycontrol.com shares when:1d"),
  "Google News: MC markets": gnews("site:moneycontrol.com/news/business/markets when:2d"),
  "Google News: MC earnings": gnews("site:moneycontrol.com/news/business/earnings when:3d"),
  "Google News: MC companies": gnews("site:moneycontrol.com/news/business/companies when:2d"),
};
const isGoogle = name => name.startsWith("Google News");

// Words that often signal a price-moving story. Used only to highlight, never to trade.
const SIGNAL_WORDS = {
  positive: ["upgrade", "upgrades", "buy", "target", "order win", "bags order", "wins order", "record high", "beats", "surges",
    "jumps", "rallies", "profit rises", "dividend", "bonus", "buyback", "outperform", "overweight", "approval"],
  negative: ["downgrade", "downgrades", "sell", "falls", "slumps", "plunges", "misses", "loss", "probe", "penalty",
    "underperform", "underweight", "resigns", "raid", "fraud", "cuts target"],
};

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
}
function clean(s) {
  s = (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decode(s);                       // entity-encoded HTML inside descriptions
  s = s.replace(/<[^>]+>/g, " ");
  return decode(s).replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    items.push({
      title: clean(tag(b, "title")),
      link: clean(tag(b, "link")),
      summary: clean(tag(b, "description")).slice(0, 400),
      pubDate: clean(tag(b, "pubDate")),
    });
  }
  return items;
}

function signals(text) {
  const low = text.toLowerCase();
  return Object.entries(SIGNAL_WORDS)
    .filter(([, words]) => words.some(w => new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`).test(low)))
    .map(([k]) => k);
}

async function fetchFeed(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const items = parseRss(await r.text());
  if (!items.length) throw new Error("no RSS items (site returned a consent/login page)");
  return items;
}

// Targeted searches: Moneycontrol stories naming watchlist companies, 10 companies per query.
function stockQueries(watchlist) {
  const names = Object.values(watchlist || {}).map(w => w.keywords[0]).filter(Boolean);
  const out = {};
  for (let i = 0; i < names.length; i += 10) {
    const group = names.slice(i, i + 10).map(n => `"${n}"`).join(" OR ");
    out[`Google News: MC stocks ${i / 10 + 1}`] = gnews(`site:moneycontrol.com (${group}) when:2d`);
  }
  return out;
}

// Skip stock-quote pages and section pages that Google News lists as "articles"
function isJunk(title) {
  const t = title.trim();
  return t.split(/\s+/).length < 5 ||
    /\b(Ltd\.?|Limited)$/i.test(t) ||
    /^(-\s*)?Moneycontrol/i.test(t) ||
    /(Latest News|Business News|Market News|Stock Market News|Moneycontrol Pro Desktop)\b.*\|/i.test(t) ||
    /^(Business News|Share\/Stock Market News)/i.test(t) ||
    /\s>>\s/.test(t) ||
    /IPO (Date|Details|GMP)|Lot Size|Subscription Status|Allotment Status|Share Price Live|Stock Price Today|IFSC Code|Branch Details|Bank Holiday List/i.test(t);
}

async function fetchAll(log, watchlist) {
  const status = {}, items = [];
  const add = (entries, source) => {
    for (const e of entries) {
      let title = e.title;
      if (!title) continue;
      if (isGoogle(source)) title = title.replace(/\s+-\s+Moneycontrol(\.com)?$/i, "");
      if (isJunk(title)) continue;
      const d = new Date(e.pubDate);
      items.push({
        id: crypto.createHash("sha1").update(title.toLowerCase()).digest("hex").slice(0, 16),
        title, summary: e.summary, link: e.link, source,
        published: (isNaN(d) ? new Date() : d).toISOString(),
        signals: signals(title + " " + e.summary),
      });
    }
  };
  const all = { ...MONEYCONTROL_FEEDS, ...GOOGLE_FEEDS, ...stockQueries(watchlist) };
  const results = await Promise.allSettled(Object.values(all).map(fetchFeed));
  let mcOk = false;
  Object.keys(all).forEach((name, i) => {
    const res = results[i];
    if (res.status === "fulfilled") {
      add(res.value, name);
      status[name] = `ok (${res.value.length})`;
      if (!isGoogle(name)) mcOk = true;
    } else {
      status[name] = "failed: " + String(res.reason?.cause?.code || res.reason?.message || res.reason).slice(0, 80);
    }
  });
  if (!mcOk) log("[news] Moneycontrol's direct feeds show a consent page to UK/EU visitors; using Google News for Moneycontrol articles");
  const seen = new Set();
  return { items: items.filter(it => !seen.has(it.id) && seen.add(it.id)), status };
}

// Diagnostics for check.bat: what does Moneycontrol actually return?
async function debugMoneycontrol() {
  const r = await fetch(MONEYCONTROL_FEEDS["MC Latest"], { headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(15000) });
  const body = await r.text();
  return `status ${r.status}\nfinal url ${r.url}\nredirected ${r.redirected}\nset-cookie ${r.headers.get("set-cookie")}\ncontent-type ${r.headers.get("content-type")}\n\n${body.slice(0, 6000)}`;
}

module.exports = { fetchAll, parseRss, signals, debugMoneycontrol, isJunk };
