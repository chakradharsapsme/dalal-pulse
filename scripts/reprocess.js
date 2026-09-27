// Re-runs matching, tone and insights on an existing latest.json (no network). Used for snapshots.
const fs = require("fs"), path = require("path");
const { KEYWORDS, compileMatchers, matchSymbols, deriveKeywords } = require("./lib/watchlist");
const { headlineTone, stockInsight, marketMood, trendingTopics } = require("./lib/insights");
const { isJunk } = require("./lib/news");
const file = process.argv[2], d = JSON.parse(fs.readFileSync(file, "utf8"));
const uni = {};
for (const s of d.stocks) {
  const kws = KEYWORDS[s.symbol] ? [...KEYWORDS[s.symbol]] : deriveKeywords(s.name);
  if (!KEYWORDS[s.symbol] && /^[A-Z]{3,}$/.test(s.symbol) && s.symbol.length <= 10) kws.push(s.symbol);
  uni[s.symbol] = { keywords: kws };
}
const m = compileMatchers(uni);
d.news = d.news.filter(n => !isJunk(n.title)).map(n => { const t = headlineTone(n.title, ""); return { ...n, symbols: matchSymbols(n.title, m), tone: t.tone, tone_score: t.score, words: t.words }; });
const by = {}; for (const n of d.news) for (const s of n.symbols) (by[s] ||= []).push(n);
for (const s of d.stocks) { const sn = by[s.symbol] || []; s.news_ids = sn.map(n => n.id); s.insight = stockInsight(s.symbol, s.name, s.tech, sn, s.events, s.change_pct); }
d.mood = marketMood({ rows: d.stocks, pulse: d.pulse, fii: d.fii_dii, news: d.news });
d.topics = trendingTopics(d.news, d.stocks.flatMap(s => [s.symbol, ...uni[s.symbol].keywords]));
fs.writeFileSync(file, JSON.stringify(d));
console.log("news", d.news.length, "stocks with news", Object.keys(by).length, "mood", d.mood.score, d.mood.label);
console.log("topics", d.topics.map(t => t.topic).join(", "));
console.log(Object.entries(by).sort((a, b) => b[1].length - a[1].length).slice(0, 10).map(([s, l]) => s + ":" + l.length).join(" "));
