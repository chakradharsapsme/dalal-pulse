// Rule-based insights engine. No AI model or API: transparent scoring rules that turn
// headlines + technicals into plain-English summaries. Informational only, never buy/sell advice.

// ---------- headline tone ----------
// weight: how strongly a phrase pushes the tone. Multi-word phrases are checked first.
const POS = {
  "record high": 2, "all-time high": 2, "hits 52-week high": 2, "52-week high": 1.5, "order win": 2, "bags order": 2, "wins order": 2,
  "wins contract": 2, "bags contract": 2, "secures order": 2, "upgrade": 2, "upgrades": 2, "raises target": 2, "target raised": 2,
  "outperform": 1.5, "overweight": 1.5, "buy rating": 2, "top pick": 1.5, "beats estimates": 2, "beats": 1.5, "profit rises": 2,
  "profit jumps": 2, "profit surges": 2, "net profit up": 2, "revenue rises": 1.5, "strong growth": 1.5, "margin expansion": 1.5,
  "surge": 1.5, "soar": 1.5, "jump": 1.2, "rallies": 1.2, "rally": 1, "gain": 0.8, "rise": 0.7, "climb": 0.8,
  "wins deal": 2, "bags deal": 2, "deal win": 2, "signs deal": 1, "record profit": 2, "hike": 0.3,
  "higher": 0.4, "bullish": 1.2, "upbeat": 1, "optimistic": 0.8, "dividend": 0.8, "bonus": 1, "buyback": 1.2, "stake buy": 1,
  "acquires": 0.6, "acquisition": 0.5, "expansion": 0.7, "capex": 0.3, "approval": 1, "approves": 0.6, "launches": 0.4, "partnership": 0.5,
  "fund inflow": 1, "fii buying": 1, "rebound": 1, "recovers": 0.8, "turnaround": 1, "beat": 1, "strong": 0.6, "robust": 0.8, "healthy": 0.5,
  "buy": 1, "accumulate": 1, "wins": 0.8, "win": 0.6,
};
const NEG = {
  "52-week low": 1.5, "hits 52-week low": 2, "downgrade": 2, "downgrades": 2, "cuts target": 2, "target cut": 2, "sell rating": 2,
  "underperform": 1.5, "underweight": 1.5, "misses estimates": 2, "misses": 1.5, "profit falls": 2, "profit drops": 2, "net loss": 2,
  "loss widens": 2, "revenue falls": 1.5, "margin pressure": 1.5, "sink": 1.3, "fall": 1, "drop": 1, "decline": 0.8, "slip": 0.7, "plunge": 1.8, "crash": 2, "tank": 1.8, "slump": 1.5, "tumble": 1.5,
  "breach": 1.2, "restrain": 1, "rattle": 1, "hit": 0.3, "curb": 0.8, "crackdown": 1.2, "warning": 0.8, "worst": 1, "lower": 0.4, "weak": 0.8, "weakens": 0.8, "bearish": 1.2,
  "probe": 1.5, "penalty": 1.5, "fine": 0.6, "fraud": 2.5, "raid": 2, "search operation": 1.5, "sebi order": 1, "bans": 1.5, "ban": 1.2,
  "resigns": 1.2, "exits": 0.6, "default": 2, "pledge": 1, "halt": 1.2, "halts": 1.2, "shutdown": 1.2, "recall": 1.2, "strike": 0.8,
  "lawsuit": 1.2, "sued": 1.2, "concern": 0.6, "concerns": 0.6, "worries": 0.8, "pressure": 0.6, "selloff": 1.5, "sell-off": 1.5,
  "fii selling": 1, "outflow": 1, "outflows": 1, "sell": 1, "loss": 1, "losses": 1, "cut": 0.5, "slowdown": 1, "delay": 0.7, "downturn": 1.2,
};
const NEGATORS = /\b(no|not|never|without|fails to|unlikely to)\s+(\w+\s+){0,3}$/i;

function phraseHits(text, dict) {
  let score = 0; const hits = [];
  const phrases = Object.keys(dict).sort((a, b) => b.length - a.length);
  let t = " " + text.toLowerCase().replace(/[^\w\s%'-]/g, " ") + " ";
  for (const p of phrases) {
    // allow simple word endings on the last word: fall/falls/fell? (not irregular), rise/rises/rising
    const re = new RegExp(`\\s${p.replace(/[-]/g, "[- ]")}(?:s|es|ed|d|ing)?\\s`, "g");
    let m;
    while ((m = re.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 40), m.index + 1);
      const w = NEGATORS.test(before) ? -dict[p] * 0.6 : dict[p];
      score += w; hits.push(p);
      t = t.slice(0, m.index) + " " + "_".repeat(m[0].length - 2) + " " + t.slice(m.index + m[0].length); // consume
      re.lastIndex = 0;
    }
  }
  return { score, hits };
}

function headlineTone(title, summary = "") {
  const text = title + " " + summary.slice(0, 200);
  const p = phraseHits(text, POS), n = phraseHits(text, NEG);
  const raw = p.score - n.score;
  const score = Math.max(-1, Math.min(1, raw / 3));
  const tone = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";
  return { score: Math.round(score * 100) / 100, tone, words: [...p.hits, ...n.hits].slice(0, 4) };
}

// ---------- per-stock ----------
const f1 = x => x == null ? "–" : (Math.round(x * 10) / 10).toString();
const inr = x => x == null ? "–" : "₹" + Number(x).toLocaleString("en-IN", { maximumFractionDigits: x > 1000 ? 0 : 2 });

function newsScore(news) {
  if (!news.length) return null;
  let wsum = 0, s = 0;
  for (const n of news) {
    const ageH = (Date.now() - Date.parse(n.published)) / 3600e3;
    const w = Math.exp(-ageH / 36); // recent headlines count more
    s += n.tone_score * w; wsum += w;
  }
  return wsum ? s / wsum : 0;
}

function techScore(t) {
  if (!t) return null;
  let s = 0;
  if (t.above_200) s += 0.3; else if (t.above_200 === false) s -= 0.3;
  if (t.above_50) s += 0.2; else if (t.above_50 === false) s -= 0.2;
  if (t.ret_1m != null) s += Math.max(-0.2, Math.min(0.2, t.ret_1m / 50));
  if (t.rsi14 != null) { if (t.rsi14 > 75) s -= 0.1; if (t.rsi14 < 25) s += 0.05; }
  if (t.golden_cross) s += 0.15; if (t.death_cross) s -= 0.15;
  if (t.from_high_pct != null && t.from_high_pct > -3) s += 0.1;
  return Math.max(-1, Math.min(1, s));
}

function stockInsight(sym, name, t, news, events, dayChange) {
  const ns = newsScore(news), ts = techScore(t);
  const pos = news.filter(n => n.tone === "positive").length, neg = news.filter(n => n.tone === "negative").length;
  const parts = [], watch = [];

  // news sentence
  if (news.length) {
    const mood = ns > 0.2 ? "mostly positive" : ns < -0.2 ? "mostly negative" : pos && neg ? "mixed" : "largely neutral";
    const themes = [...new Set(news.flatMap(n => n.words))].slice(0, 3);
    parts.push(`${news.length} ${news.length === 1 ? "story" : "stories"} in the last few days, ${mood}${themes.length ? ` (${themes.join(", ")})` : ""}.`);
  } else parts.push("No fresh Moneycontrol stories in the last few days.");

  // technical sentence
  if (t) {
    const tr = { "Strong uptrend": "is in a strong uptrend (above its 50- and 200-day averages)", "Uptrend": "is above its 200-day average (longer-term uptrend)",
      "Downtrend": "is in a downtrend (below its 50- and 200-day averages)", "Weak": "is below its 200-day average", "Mixed": "shows no clear trend" }[t.trend] || "shows no clear trend";
    let s = `The stock ${tr}`;
    if (t.from_high_pct != null) s += t.from_high_pct > -2 ? ", trading at or near its 52-week high" : t.from_low_pct != null && t.from_low_pct < 3 ? ", close to its 52-week low" : `, ${f1(-t.from_high_pct)}% below its 52-week high`;
    s += `. RSI is ${f1(t.rsi14)}${t.rsi14 > 70 ? " (overbought: a strong run, which can mean a pause)" : t.rsi14 < 30 ? " (oversold: a sharp fall, which can mean a bounce or further weakness)" : ""}.`;
    parts.push(s);
    if (t.vol_ratio >= 2) parts.push(`Volume is ${f1(t.vol_ratio)}× its 20-day average: unusual activity.`);
    if (t.macd_cross === "bull") parts.push("MACD just crossed above its signal line (momentum turning up).");
    else if (t.macd_cross === "bear") parts.push("MACD just crossed below its signal line (momentum turning down).");
    if (t.bb_squeeze) parts.push("Bollinger Bands are at their tightest in 6 months: a volatility squeeze that often comes before a big move.");
    else if (t.bb_pos != null && t.bb_pos > 1) parts.push("Price is above the upper Bollinger Band: stretched to the upside.");
    else if (t.bb_pos != null && t.bb_pos < 0) parts.push("Price is below the lower Bollinger Band: stretched to the downside.");
    if (t.breakout_55d) parts.push("It just closed above its 55-day high (a breakout).");
    if (t.golden_cross) parts.push("A golden cross formed recently (50-day average crossed above the 200-day).");
    if (t.death_cross) parts.push("A death cross formed recently (50-day average crossed below the 200-day).");
    // levels
    if (t.support) watch.push(`Support ${inr(t.support)} (${f1(Math.abs(t.to_support_pct))}% below${t.support_touches > 1 ? `, tested ${t.support_touches}×` : ""})`);
    if (t.resistance) watch.push(`Resistance ${inr(t.resistance)} (${f1(t.to_resistance_pct)}% above${t.resistance_touches > 1 ? `, tested ${t.resistance_touches}×` : ""})`);
    if (t.price && t.sma50) watch.push(`${t.price > t.sma50 ? "Support" : "Resistance"} near the 50-day average ${inr(t.sma50)}`);
    if (t.price && t.sma200) watch.push(`${t.price > t.sma200 ? "Support" : "Resistance"} near the 200-day average ${inr(t.sma200)}`);
    if (t.high52 && t.from_high_pct > -8) watch.push(`52-week high ${inr(t.high52)}: a close above it would be a breakout`);
    if (t.low52 && t.from_low_pct < 8) watch.push(`52-week low ${inr(t.low52)}: a close below it would be a breakdown`);
  }
  const dd = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  for (const e of (events || []).slice(0, 2)) watch.unshift(`${e.type} on ${dd(e.date)}${e.type === "Dividend" ? ` (${e.detail.split(" (")[0]})` : ""}`);

  // overall label
  const combo = (ns ?? 0) * 0.45 + (ts ?? 0) * 0.55;
  let signal, label;
  if (t && t.rsi14 < 30 && (ns ?? 0) >= -0.1) { signal = "watch"; label = "Oversold: watch for a bounce"; }
  else if (t && t.from_high_pct > -2 && t.above_200 && t.vol_ratio >= 1.3) { signal = "bullish"; label = "Breakout watch"; }
  else if (combo > 0.35) { signal = "bullish"; label = "Positive momentum"; }
  else if (combo > 0.12) { signal = "bullish"; label = "Leaning positive"; }
  else if (combo < -0.35) { signal = "bearish"; label = "Under pressure"; }
  else if (combo < -0.12) { signal = "bearish"; label = "Leaning negative"; }
  else { signal = "neutral"; label = "Mixed / wait-and-watch"; }

  return {
    signal, label, score: Math.round(combo * 100),
    news_score: ns == null ? null : Math.round(ns * 100), tech_score: ts == null ? null : Math.round(ts * 100),
    summary: parts.join(" "), watch: watch.slice(0, 5), pos, neg,
  };
}

// ---------- market-wide ----------
function marketMood({ rows, pulse, fii, news }) {
  const withT = rows.filter(r => r.tech);
  const adv = rows.filter(r => r.change_pct > 0).length, dec = rows.filter(r => r.change_pct < 0).length;
  const above200 = withT.length ? withT.filter(r => r.tech.above_200).length / withT.length : null;
  const vix = pulse.find(p => p.key === "INDIA VIX")?.last;
  const nifty = pulse.find(p => p.key === "NIFTY 50");
  const fiiNet = fii?.find(f => /FII/i.test(f.category))?.net, diiNet = fii?.find(f => /DII/i.test(f.category))?.net;
  const tone = news.length ? news.reduce((a, n) => a + n.tone_score, 0) / news.length : 0;

  let s = 50;
  if (adv + dec) s += ((adv - dec) / (adv + dec)) * 15;
  if (above200 != null) s += (above200 - 0.5) * 30;
  if (vix != null) s += vix < 13 ? 5 : vix > 20 ? -10 : vix > 16 ? -5 : 0;
  if (fiiNet != null) s += Math.max(-7, Math.min(7, fiiNet / 1000));
  s += tone * 20;
  if (nifty?.change_pct != null) s += Math.max(-8, Math.min(8, nifty.change_pct * 4));
  s = Math.round(Math.max(0, Math.min(100, s)));
  const label = s >= 70 ? "Bullish" : s >= 57 ? "Mildly bullish" : s > 43 ? "Neutral" : s > 30 ? "Mildly bearish" : "Bearish";

  const lines = [];
  if (nifty) lines.push(`Nifty 50 is ${nifty.change_pct >= 0 ? "up" : "down"} ${Math.abs(nifty.change_pct).toFixed(2)}% at ${inr(nifty.last)}.`);
  if (adv + dec) lines.push(`Breadth is ${adv > dec * 1.5 ? "strong" : dec > adv * 1.5 ? "weak" : "balanced"}: ${adv} of the tracked stocks are up and ${dec} are down.`);
  if (above200 != null) lines.push(`${Math.round(above200 * 100)}% of tracked stocks are above their 200-day average${above200 > 0.6 ? ", a healthy long-term backdrop" : above200 < 0.4 ? ", which shows broad long-term weakness" : ""}.`);
  if (vix != null) lines.push(`India VIX (expected volatility) is ${vix.toFixed(1)}: ${vix < 13 ? "calm" : vix > 20 ? "high, so expect big swings" : vix > 16 ? "elevated" : "normal"}.`);
  if (fiiNet != null) lines.push(`FIIs were net ${fiiNet >= 0 ? "buyers" : "sellers"} (₹${Math.abs(fiiNet).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr)${diiNet != null ? ` and DIIs net ${diiNet >= 0 ? "buyers" : "sellers"} (₹${Math.abs(diiNet).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr)` : ""} in the last session.`);
  lines.push(`Headline tone across ${news.length} stories is ${tone > 0.1 ? "positive" : tone < -0.1 ? "negative" : "neutral"}.`);
  return { score: s, label, lines, breadth: { adv, dec }, above200_pct: above200 == null ? null : Math.round(above200 * 100) };
}

// trending topics: frequent capitalised words/phrases across headlines, excluding stock names & stopwords
const STOP = new Set(("The A An And Or Of In On At To For From With By As Is Are Be Its It This That These Those After Before Over Under Into Up Down New Says Say Said Will May Can Could Should Than Vs How Why What When Where Who Which Here Today Week Year Month Day Q1 Q2 Q3 Q4 FY Rs Crore Lakh India Indian Stock Stocks Shares Share Market Markets Sensex Nifty Live Watch Top Key Big Buy Sell Hold Target Price Check Daily Voice Taking Stock Street Dalal Moneycontrol News Update Updates Report Ltd Limited Company Firm Group Sector Here's Heres Know Explained Why Date Details Lot Size Subscription Issue GMP Allotment Status Review January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday Photos Video Watch Latest First").split(" "));
function trendingTopics(headlines, stockNames) {
  const count = {};
  const skip = new Set(stockNames.map(s => s.toLowerCase()));
  for (const h of headlines) {
    const words = h.title.replace(/[‘’“”"':,;!?()|\[\]]/g, " ").split(/\s+/).filter(Boolean);
    const seen = new Set();
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!/^[A-Z][A-Za-z&.-]{2,}$/.test(w) || STOP.has(w) || skip.has(w.toLowerCase())) continue;
      let phrase = w; const nx = words[i + 1];
      if (nx && /^[A-Z][A-Za-z&.-]{2,}$/.test(nx) && !STOP.has(nx)) phrase = w + " " + nx;
      if (seen.has(phrase)) continue; seen.add(phrase);
      count[phrase] = (count[phrase] || 0) + 1;
    }
  }
  const out = [];
  for (const [topic, n] of Object.entries(count).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)) {
    const words = topic.toLowerCase().split(" ");
    if (out.some(o => o.topic.toLowerCase().split(" ").some(w => words.includes(w)))) continue; // "Gowda" vs "Bache Gowda" vs "Sharath Bache"
    out.push({ topic, n }); if (out.length >= 12) break;
  }
  return out;
}

module.exports = { headlineTone, stockInsight, marketMood, trendingTopics, techScore };
