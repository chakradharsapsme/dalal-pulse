// AI briefs: small plain-text files an AI assistant (the "Dalal Pulse Expert" in Claude) can read quickly.
// Pure function: takes the site's latest.json object and returns { "relative/path.txt": "text", ... }.
// No AI or paid service is used here — it only re-formats the rule-based data the site already computes.
"use strict";

const f2 = v => (v == null || Number.isNaN(+v) ? "-" : (+v).toFixed(2).replace(/\.00$/, ""));
const pc = v => (v == null || Number.isNaN(+v) ? "-" : (v > 0 ? "+" : "") + (+v).toFixed(2) + "%");
const inr = v => (v == null ? "-" : "₹" + Math.round(+v).toLocaleString("en-IN"));
const px = v => (v == null ? "-" : "₹" + (+v >= 1000 ? Math.round(+v).toLocaleString("en-IN") : (+v).toFixed(2)));
const ist = iso => { try { return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " IST"; } catch { return iso; } };
const fileSym = s => String(s).toUpperCase().replace(/[^A-Z0-9&-]/g, "_");

const DISCLAIMER = "Information only, not investment advice. Dalal Pulse is not SEBI-registered. Rule-based data can be wrong or late; verify on NSE/your broker. SEBI studies show ~9 in 10 individual F&O traders lose money.";

function stockLine(s) {
  const t = s.tech || {}, i = s.insight || {}, fo = s.fo || {};
  return [
    s.symbol.padEnd(11), px(s.price).padStart(9), pc(s.change_pct).padStart(8),
    `trend:${t.trend || "-"}`, `RSI:${f2(t.rsi14)}`, `RS:${t.rs_rating ?? "-"}`,
    `1M:${pc(t.ret_1m)}`, `52wH:${pc(t.from_high_pct)}`,
    `view:${i.label || "-"}(${i.score ?? "-"})`,
    s.fo ? `F&O:${fo.buildup || "-"}` : "", s.nifty50 ? "N50" : "",
  ].filter(Boolean).join(" | ");
}

function build(d, opt = {}) {
  const site = (opt.siteUrl || "https://dalalpulse.pages.dev/").replace(/\/?$/, "/");
  const files = {};
  const stocks = d.stocks || [];
  const newsById = Object.fromEntries((d.news || []).map(n => [n.id, n]));
  const stamp = `Data generated ${ist(d.generated_at)} (${d.generated_at}).`;
  const bySym = Object.fromEntries(stocks.map(s => [s.symbol, s]));
  const optStock = Object.fromEntries(((d.options || {}).stocks || []).map(o => [o.symbol, o]));
  const optIdx = (d.options || {}).indices || [];
  const T = s => s.tech || {}, I = s => s.insight || {};

  // ---------- market.txt ----------
  {
    const L = [];
    L.push("DALAL PULSE — MARKET BRIEF", stamp, "");
    const m = d.mood || {};
    L.push(`MARKET MOOD: ${m.label || "-"} (score ${m.score ?? "-"}/100; 50 = neutral)`);
    for (const x of m.lines || []) L.push("- " + x);
    if (d.nifty_pe) L.push(`- Nifty 50 P/E: ${d.nifty_pe}`);
    const nr = d.nifty_returns || {};
    if (Object.keys(nr).length) L.push(`- Nifty returns: 1M ${pc(nr.m1)}, 3M ${pc(nr.m3)}, 6M ${pc(nr.m6)}, 1Y ${pc(nr.y1)}`);
    L.push("", "FII / DII (₹ crore, last session):");
    for (const x of d.fii_dii || []) L.push(`- ${x.category} ${x.date}: buy ${f2(x.buy)}, sell ${f2(x.sell)}, net ${f2(x.net)}`);
    L.push("", "INDICES (last, day %, trend, RSI, vs 50/200-day, 1M, 1Y, support/resistance):");
    for (const x of d.indices || []) {
      const t = x.tech || {};
      L.push(`- ${x.name}: ${f2(x.last)} ${pc(x.change_pct)} | ${t.trend || "-"} | RSI ${f2(t.rsi14)} | ${t.above_50 ? "above" : "below"} 50D, ${t.above_200 ? "above" : "below"} 200D | 1M ${pc(t.ret_1m)} | 1Y ${pc(t.ret_1y)} | S ${f2(t.support)} / R ${f2(t.resistance)}${x.pe ? " | PE " + x.pe : ""}`);
    }
    L.push("", "SECTOR INDICES TODAY (day %, 30-day %, 1-year %, adv/dec):");
    for (const x of [...(d.sectors || [])].sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0))) L.push(`- ${x.name}: ${pc(x.change_pct)} | 30D ${pc(x.ch30d)} | 1Y ${pc(x.ch365d)} | ${x.adv ?? "-"}/${x.dec ?? "-"}`);
    L.push("", "INDUSTRY GROUPS in the tracked universe (1W, 1M, 3M, avg RS rating, leaders / laggards):");
    for (const x of [...(d.industries || [])].sort((a, b) => (b.rs_avg ?? 0) - (a.rs_avg ?? 0))) L.push(`- ${x.name} (${x.count}): 1W ${pc(x.ret_1w)}, 1M ${pc(x.ret_1m)}, 3M ${pc(x.ret_3m)}, RS ${f2(x.rs_avg)} | top ${(x.top || []).join(", ")} | weak ${(x.bottom || []).join(", ")}`);
    if (optIdx.length) {
      L.push("", "INDEX OPTIONS READ (nearest expiry):");
      for (const o of optIdx) L.push(`- ${o.symbol} spot ${f2(o.spot)} exp ${o.expiry} (${o.days}d): PCR ${o.pcr}, max pain ${o.max_pain}, call wall ${o.call_wall}, put wall ${o.put_wall}, ATM IV ${o.atm_iv}%, expected move ±${f2(o.exp_move)} (${o.exp_move_pct}%) → range ${f2(o.range_lo)}–${f2(o.range_hi)}; view ${o.view} (${(o.view_why || []).join("; ")})`);
    }
    const bt = d.backtest || {};
    if (bt.signals) {
      L.push("", `SIGNAL TRACK RECORD — 5-year backtest on ${bt.stocks ?? "?"} stocks (${bt.from || "?"} to ${bt.to || "?"}), 20-session forward return vs baseline:`);
      const b = (bt.baseline || {})["20"] || {};
      L.push(`- Baseline (any stock, any day): avg ${pc(b.avg)}, up ${b.up ?? "-"}% of the time`);
      for (const s of bt.signals) { const r = (s.results || {})["20"] || {}; L.push(`- ${s.name} [${s.dir}]: n=${r.n ?? "-"}, avg ${pc(r.avg)}, hit ${r.hit ?? "-"}% → ${s.verdict}`); }
      L.push("Use this: signals marked 'No real edge' should not be trusted alone.");
    }
    const rot = (d.edge || {}).rotation;
    if (rot && rot.items?.length) { L.push("", "SECTOR ROTATION (weekly vs Nifty; clockwise Improving → Leading → Weakening → Lagging):"); for (const q of ["Leading", "Improving", "Weakening", "Lagging"]) L.push(`- ${q}: ${rot.items.filter(i => i.quad === q).map(i => i.name).join(", ") || "none"}`); }
    const c = d.circuits || {};
    L.push("", `CIRCUITS (large & mid caps only): upper ${(c.upper || []).map(x => x.symbol).join(", ") || "none"}; lower ${(c.lower || []).map(x => x.symbol).join(", ") || "none"}; small caps hidden ${JSON.stringify(c.hidden_small || {})}`);
    L.push("", "HOT TOPICS: " + (d.topics || []).map(t => `${t.topic} (${t.n})`).join(", "));
    L.push("", DISCLAIMER);
    files["market.txt"] = L.join("\n");
  }

  // ---------- ideas.txt (screens) ----------
  {
    const L = ["DALAL PULSE — IDEAS & SCREENS", stamp, "Each list is rule-based. Treat as a shortlist to research, never as a buy/sell call.", ""];
    const adv = ((d.advice || {}).items || []).slice(0, 15);
    if (adv.length) {
      L.push("## EXPERT AGENT ADVICE (site's rule-based pop-ups, newest first)");
      for (const a of adv) L.push(`- [${ist(a.at)}] ${a.title}${a.status && a.status !== "open" ? ` [${a.status}]` : ""}: ${a.text}${(a.why || []).length ? ` | why: ${a.why.join("; ")}` : ""}${(a.notes || []).length ? ` | note: ${a.notes.join(" ")}` : ""}`);
      L.push("");
    }
    const sec = (title, arr, n = 10, why = 0) => { L.push(`## ${title} (${arr.length})`); arr.slice(0, n).forEach((s, k) => L.push("- " + stockLine(s) + (k < why && I(s).summary ? `\n    why: ${I(s).summary}` : ""))); if (!arr.length) L.push("- none right now"); L.push(""); };
    const up = stocks.filter(s => T(s).above_200 && T(s).above_50);
    sec("Strongest positive setups (site's rule-based view, highest score)", [...stocks].filter(s => (I(s).score ?? 0) > 0).sort((a, b) => I(b).score - I(a).score), 12, 5);
    sec("Relative-strength leaders (RS ≥ 80, above 50 & 200-day averages)", up.filter(s => (T(s).rs_rating ?? 0) >= 80).sort((a, b) => T(b).rs_rating - T(a).rs_rating));
    sec("Breakouts (20/55-day high or volume surge up)", stocks.filter(s => T(s).breakout_20d || T(s).breakout_55d || T(s).vol_surge_up).sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0)));
    sec("Pullbacks in uptrends (above 200-day, RSI 35–50, within 3% of support)", up.concat(stocks.filter(s => T(s).above_200 && !T(s).above_50)).filter((s, i, a) => a.indexOf(s) === i && T(s).rsi14 >= 35 && T(s).rsi14 <= 50 && T(s).to_support_pct != null && Math.abs(T(s).to_support_pct) <= 3));
    sec("Bollinger squeeze (volatility coiled; direction unknown)", stocks.filter(s => T(s).bb_squeeze));
    sec("Oversold (RSI < 30)", stocks.filter(s => T(s).rsi14 < 30).sort((a, b) => T(a).rsi14 - T(b).rsi14));
    sec("Overbought (RSI > 72)", stocks.filter(s => T(s).rsi14 > 72).sort((a, b) => T(b).rsi14 - T(a).rsi14));
    sec("Weakest / avoid-for-now (most negative score)", [...stocks].filter(s => (I(s).score ?? 0) < 0).sort((a, b) => I(a).score - I(b).score), 10, 3);
    const fo = stocks.filter(s => s.fo && s.fo.buildup);
    for (const b of ["Long build-up", "Short build-up", "Short covering", "Long unwinding"]) sec(`F&O ${b} (OI change %)`, fo.filter(s => s.fo.buildup === b).sort((a, b2) => Math.abs(b2.fo.oi_chg_pct ?? 0) - Math.abs(a.fo.oi_chg_pct ?? 0)), 8);
    sec("Positive news flow (news tone positive)", stocks.filter(s => (I(s).news_score ?? 0) > 0).sort((a, b) => I(b).news_score - I(a).news_score));
    sec("Negative news flow", stocks.filter(s => (I(s).news_score ?? 0) < 0).sort((a, b) => I(a).news_score - I(b).news_score));
    const E = d.edge || {};
    if (E.board) { L.push(`## ODDS BOARD: setups that historically most often rose over 20 sessions (typical day: ${E.base?.win20}% up, typical ${pc(E.base?.med20)})`); for (const r of E.board.best.slice(0, 10)) L.push(`- ${r.symbol}: ${r.win20}% up, typical ${pc(r.med20)}, edge ${r.edge >= 0 ? "+" : ""}${r.edge} pts (${r.n} cases) → ${r.grade}`); L.push("## WEAKEST ODDS"); for (const r of E.board.worst.slice(0, 6)) L.push(`- ${r.symbol}: ${r.win20}% up, typical ${pc(r.med20)} → ${r.grade}`); L.push(""); }
    if (E.delivery) { const dl = E.delivery, f = x => `${x.symbol} (${x.tag}, deliv ${x.dp}% vs ${x.avg_dp}%, ${x.dq_ratio ?? "-"}x qty, price ${pc(x.chg)})`; L.push(`## SMART MONEY (NSE delivery ${dl.date})`, `- Accumulation: ${dl.accumulation.slice(0, 10).map(f).join("; ") || "none"}`, `- Distribution: ${dl.distribution.slice(0, 8).map(f).join("; ") || "none"}`, `- Speculative rallies (low delivery): ${dl.speculative.map(f).join("; ") || "none"}`, ""); }
    const w = d.w52 || {};
    L.push(`## 52-week highs among tracked quality stocks: ${(w.highs || []).filter(x => x.tracked).map(x => x.symbol).join(", ") || "none"}`);
    L.push(`## 52-week lows among tracked quality stocks: ${(w.lows || []).filter(x => x.tracked).map(x => x.symbol).join(", ") || "none"}`, "");
    const o = d.options || {};
    L.push("## OPTIONS IDEAS (defined-risk debit spreads; loss capped at the debit)");
    for (const x of [...(o.index_ideas || []), ...(o.ideas || [])]) {
      L.push(`- ${x.symbol} ${x.strategy} (${x.dir}) exp ${x.expiry}, spot ${f2(x.spot)}: ` + (x.legs || []).map(g => `${g.action} ${g.strike}${g.type} @${g.price} [${g.ts}]`).join(" + ") +
        ` | debit ${x.debit}, max loss/lot ${inr(x.max_loss_lot)}, max gain/lot ${inr(x.max_gain_lot)}, breakeven ${x.breakeven}, reward:risk ${x.rr}, chance of profit ~${x.pop}%, chance of full profit ~${x.p_full}% | why: ${(x.why || []).join("; ")}`);
    }
    if (!(o.ideas || []).length && !(o.index_ideas || []).length) L.push("- none right now");
    L.push("", "## LOTTERY-STYLE CHEAP OPTIONS (high chance of losing 100% — size tiny or skip)");
    for (const x of (o.lottery || []).slice(0, 8)) L.push(`- ${x.ts}: ltp ${x.ltp}, cost/lot ${inr(x.cost_lot)}, needs ${pc(x.dist_pct)} move, chance of any profit ~${f2(x.p_profit)}%, exp ${x.expiry}`);
    L.push("", DISCLAIMER);
    files["ideas.txt"] = L.join("\n");
  }

  // ---------- news.txt ----------
  {
    const L = ["DALAL PULSE — MARKET-MOVING NEWS (newest first; tone is rule-based)", stamp, ""];
    const news = [...(d.news || [])].sort((a, b) => new Date(b.published || b.seen_at) - new Date(a.published || a.seen_at));
    const tagged = news.filter(n => (n.symbols || []).length && (n.symbols || []).length <= 3);
    L.push("## Stock-specific news (tracked stocks)");
    for (const n of tagged.slice(0, 60)) L.push(`- [${ist(n.published || n.seen_at)}] ${n.symbols.join(",")} | ${n.tone}${n.official ? " | NSE FILING" : ""} | ${n.title} (${n.source})`);
    L.push("", "## Other market headlines");
    for (const n of news.filter(n => !tagged.includes(n)).slice(0, 30)) L.push(`- [${ist(n.published || n.seen_at)}] ${n.tone} | ${n.title} (${n.source})`);
    L.push("", "## Upcoming corporate events (tracked stocks, next 30 days)");
    for (const e of (d.calendar || []).filter(e => e.tracked).slice(0, 50)) L.push(`- ${e.date} ${e.symbol}: ${e.type} — ${e.detail}`);
    files["news.txt"] = L.join("\n");
  }

  // ---------- stocks.txt (one line each) ----------
  files["stocks.txt"] = ["DALAL PULSE — ALL TRACKED STOCKS (Nifty 200 + F&O). RS = relative-strength rating 1-99 vs the universe.", stamp, "",
    ...[...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(stockLine), "", "For full detail on one stock read stock/<SYMBOL>.txt", DISCLAIMER].join("\n");

  // ---------- names.txt (symbol|company name, for lookups by name) ----------
  files["names.txt"] = stocks.map(s => `${s.symbol}|${s.name || ""}`).join("\n");

  // ---------- stock/<SYM>.txt ----------
  for (const s of stocks) {
    const t = T(s), i = I(s), L = [];
    L.push(`${s.symbol} — ${s.name}`, `Industry: ${s.industry || "-"} | ${s.nifty50 ? "Nifty 50" : s.nifty200 ? "Nifty 200" : "F&O universe"}${s.fo ? " | F&O stock" : ""} | turnover ${f2(s.turnover_cr)} cr`, stamp, "");
    L.push(`PRICE ${px(s.price)} (${pc(s.change_pct)} today)`);
    L.push(`SITE VIEW: ${i.label || "-"} | overall score ${i.score ?? "-"} (tech ${i.tech_score ?? "-"}, news ${i.news_score ?? "-"})`);
    if (i.summary) L.push(`Summary: ${i.summary}`);
    for (const w of i.watch || []) L.push(`Watch: ${w}`);
    L.push("", "TECHNICALS");
    L.push(`Trend ${t.trend || "-"} | 20D ${px(t.sma20)} | 50D ${px(t.sma50)} (${t.above_50 ? "above" : "below"}) | 200D ${px(t.sma200)} (${t.above_200 ? "above" : "below"})${t.golden_cross ? " | GOLDEN CROSS" : ""}${t.death_cross ? " | DEATH CROSS" : ""}`);
    L.push(`RSI14 ${f2(t.rsi14)} | MACD ${t.macd_state || "-"}${t.macd_cross ? " (fresh " + t.macd_cross + " cross)" : ""} | Bollinger position ${f2(t.bb_pos)} (0=lower band, 1=upper) width ${f2(t.bb_width)}%${t.bb_squeeze ? " SQUEEZE" : ""}`);
    L.push(`Support ${px(t.support)} (${pc(t.to_support_pct)}, tested ${t.support_touches ?? "-"}x) | Resistance ${px(t.resistance)} (${pc(t.to_resistance_pct)}, tested ${t.resistance_touches ?? "-"}x)`);
    L.push(`52W high ${px(t.high52)} (${pc(t.from_high_pct)}) | 52W low ${px(t.low52)} (${pc(t.from_low_pct)})${t.breakout_20d ? " | 20D BREAKOUT" : ""}${t.breakout_55d ? " | 55D BREAKOUT" : ""}`);
    L.push(`Volume ${t.vol ?? "-"} vs 20D avg ${t.vol_avg20 ?? "-"} (x${f2(t.vol_ratio)})${t.vol_surge_up ? " SURGE UP" : ""}${t.vol_surge_down ? " SURGE DOWN" : ""}`);
    L.push(`Returns: 1W ${pc(t.ret_1w)}, 1M ${pc(t.ret_1m)}, 3M ${pc(t.ret_3m)}, 6M ${pc(t.ret_6m)}, 1Y ${pc(t.ret_1y)} | vs Nifty: 1M ${pc(t.rel_1m)}, 3M ${pc(t.rel_3m)}, 6M ${pc(t.rel_6m)}, 1Y ${pc(t.rel_1y)} | RS rating ${t.rs_rating ?? "-"}`);
    const e = s.edge;
    if (e && (e.own || e.all)) { const f = x => x ? `${x.n} cases, rose in 20 sessions ${x.win20}% of the time, typical ${pc(x.med20)}, worst ${pc(x.worst20)}, best ${pc(x.best20)}${x.n60 ? `; after 60 sessions ${x.win60}% up, typical ${pc(x.med60)}` : ""}` : "not enough cases";
      L.push("", `SETUP DÉJÀ-VU (historical analogs, no look-ahead): today's setup = ${e.label}`, `- ${s.symbol}'s own 5-year history: ${f(e.own)}`, `- same setup across all tracked stocks: ${f(e.all)}`, e.odds ? `- blended odds: ${e.odds.win20}% up, typical ${pc(e.odds.med20)}, edge ${e.odds.edge >= 0 ? "+" : ""}${e.odds.edge} pts vs a typical day → ${e.odds.grade}` : ""); }
    if (s.deliv) L.push(`SMART MONEY (NSE delivery): ${s.deliv.tag || "normal"} · delivery ${s.deliv.dp}% vs 20-day avg ${s.deliv.avg_dp}% · delivered qty ${s.deliv.dq_ratio ?? "-"}x normal · price ${pc(s.deliv.chg)}`);
    if (s.fo) L.push("", `F&O: open interest ${s.fo.oi ?? "-"} (${pc(s.fo.oi_chg_pct)}) → ${s.fo.buildup || "-"} (${s.fo.date || ""})`);
    const o = optStock[s.symbol];
    if (o) L.push(`OPTIONS (${o.expiry}, ${o.days}d): PCR ${o.pcr}, max pain ${o.max_pain}, call wall ${o.call_wall}, put wall ${o.put_wall}, ATM IV ${o.atm_iv}%, expected move ±${o.exp_move_pct}% → ${f2(o.range_lo)}–${f2(o.range_hi)}; options view ${o.view} (lot ${o.lot})`);
    const idea = [...((d.options || {}).ideas || [])].find(x => x.symbol === s.symbol);
    if (idea) L.push(`OPTIONS IDEA: ${idea.strategy} — ` + idea.legs.map(g => `${g.action} ${g.strike}${g.type} @${g.price}`).join(" + ") + ` | max loss/lot ${inr(idea.max_loss_lot)}, max gain/lot ${inr(idea.max_gain_lot)}, chance of profit ~${idea.pop}%`);
    const news = (s.news_ids || []).map(id => newsById[id]).filter(Boolean);
    L.push("", `NEWS (${news.length})`);
    for (const n of news.slice(0, 15)) L.push(`- [${ist(n.published || n.seen_at)}] ${n.tone}${n.official ? " | NSE FILING" : ""} | ${n.title} (${n.source})`);
    if (!news.length) L.push("- no fresh stories in the last few days");
    if ((s.events || []).length) { L.push("", "EVENTS"); for (const e of s.events) L.push(`- ${e.date}: ${e.type} — ${e.detail}`); }
    const recent = ((d.backtest || {}).recent || []).filter(r => r.symbol === s.symbol);
    if (recent.length) { const names = Object.fromEntries(((d.backtest || {}).signals || []).map(x => [x.id, `${x.name} (${x.verdict})`])); L.push("", "RECENT BACKTESTED SIGNALS"); for (const r of recent) L.push(`- ${r.d}: ${names[r.s] || r.s} at ${px(r.p)}`); }
    L.push("", `Chart & details: ${site}#news/${encodeURIComponent(s.symbol)}`, DISCLAIMER);
    files[`stock/${fileSym(s.symbol)}.txt`] = L.join("\n");
  }

  // ---------- groups.txt (business houses) ----------
  if (d.groups?.groups?.length) {
    const lc = v => v == null ? "-" : "₹" + (v / 1e5).toFixed(2) + " lakh cr";
    const L = ["DALAL PULSE — BUSINESS GROUPS (Tata, Reliance, Adani, ...). Market cap in ₹ lakh crore; group moves are market-cap weighted.", stamp, ""];
    for (const g of d.groups.groups) {
      L.push(`${g.name} (${g.who}) — ${g.n} listed cos, mcap ${lc(g.mcap_cr)}, today ${pc(g.chg)}, 1M ${pc(g.m1)}, 1Y ${pc(g.y1)}, ${g.up}/${g.n} up today`);
      for (const m of g.members) L.push(`  - ${m.symbol} ${m.name}: ${inr(m.price)} today ${pc(m.chg)}, 1Y ${pc(m.y1)}, mcap ${lc(m.mcap_cr)}${m.ff ? " (free-float)" : ""}`);
      L.push("");
    }
    files["groups.txt"] = L.join("\n");
  }
  // ---------- index.txt (guide for AI assistants) ----------
  files["index.txt"] = [
    "DALAL PULSE — DATA FOR AI ASSISTANTS", stamp, "",
    `Website: ${site}`,
    "Plain-text files (refresh every 5 min in market hours, every 30 min otherwise):",
    `- ${site}data/ai/market.txt  — mood, indices, FII/DII, sectors, index options, signal track record`,
    `- ${site}data/ai/ideas.txt   — screens: leaders, breakouts, pullbacks, F&O build-ups, options spreads`,
    `- ${site}data/ai/news.txt    — stock news, NSE filings, upcoming results/dividends`,
    `- ${site}data/ai/stocks.txt  — one line per tracked stock`,
    `- ${site}data/ai/groups.txt  — business groups (Tata, Reliance, Adani, Birla...) with every listed company, market cap and moves`,
    `- ${site}data/ai/stock/<SYMBOL>.txt — full detail for one stock (e.g. RELIANCE, M&M)`,
    `MCP connector: ${site}mcp`, "", DISCLAIMER,
  ].join("\n");
  return files;
}

module.exports = { build, fileSym };
