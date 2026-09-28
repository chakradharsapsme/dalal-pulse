// Dalal Pulse "Expert Agent": rule-based advice generated on every data refresh (no AI model, no cost).
// It watches the whole site's data and raises short, actionable advice cards:
//   market stance changes, high-confluence stock setups (with entry / stop / target / size),
//   follow-up on earlier setups (target hit / stop hit), caution flags, options idea, key filings, results ahead.
// History is kept in .cache/advice.json so each piece of advice pops up only once and earlier setups are tracked.
"use strict";
const fs = require("fs");
const path = require("path");

const r2 = v => Math.round(v * 100) / 100;
const pct = v => (v > 0 ? "+" : "") + v.toFixed(1) + "%";
const rs = v => "₹" + (v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(2).replace(/\.00$/, ""));
const istDay = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

function run(out, cacheDir) {
  const file = path.join(cacheDir, "advice.json");
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(file, "utf8")).items || []; } catch {}
  const now = new Date().toISOString();
  const day = (out.backtest && out.backtest.to) || istDay(); // last trading day in the data → no repeats on weekends
  const stocks = (out.stocks || []).filter(s => s.tech && s.price);
  const S = Object.fromEntries(stocks.map(s => [s.symbol, s]));
  const ind = Object.fromEntries((out.industries || []).map(x => [x.name, x]));
  const verdict = Object.fromEntries(((out.backtest || {}).signals || []).map(x => [x.id, x.verdict]));
  const fresh = [];
  const add = a => { if (!hist.some(h => h.id === a.id) && !fresh.some(h => h.id === a.id)) fresh.push({ ...a, at: now, day }); };

  // ---------- 1. market stance ----------
  const n50 = (out.indices || []).find(x => x.id === "nifty50") || {};
  const t = n50.tech || {};
  const fii = ((out.fii_dii || []).find(x => /FII/.test(x.category)) || {}).net;
  const mood = (out.mood || {}).score;
  let stance = "mixed";
  if (t.above_50 && t.above_200) stance = "bull"; else if (t.above_50 === false && t.above_200 === false) stance = "bear";
  const stanceTxt = {
    bull: ["Market in an uptrend: normal position sizes are fine", "Nifty is above its 50- and 200-day averages. Favour leaders breaking out; keep stops below support."],
    bear: ["Market in a downtrend: trade smaller and be selective", "Nifty is below its 50- and 200-day averages. Use half your normal size, buy only the strongest stocks, keep stops tight, or wait in cash."],
    mixed: ["Market is mixed: be selective", "Nifty is between its 50- and 200-day averages. Take only high-confluence setups and book partial profits early."],
  }[stance];
  const mktWhy = [];
  if (n50.last) mktWhy.push(`Nifty ${Math.round(n50.last).toLocaleString("en-IN")} (${pct(n50.change_pct || 0)} today, 1M ${pct(t.ret_1m || 0)})`);
  if (fii != null) mktWhy.push(`FIIs ${fii >= 0 ? "bought" : "sold"} ₹${Math.abs(Math.round(fii)).toLocaleString("en-IN")} cr`);
  if (mood != null) mktWhy.push(`mood ${mood}/100`);
  if (t.rsi14 != null) mktWhy.push(`Nifty RSI ${t.rsi14.toFixed(0)}`);
  add({ id: `${day}-market-${stance}`, kind: "market", tone: stance === "bull" ? "positive" : stance === "bear" ? "negative" : "neutral", prio: "high",
    title: stanceTxt[0], text: stanceTxt[1], why: mktWhy });

  // ---------- 2. follow-up on open setups (target / stop) ----------
  for (const h of hist) {
    if (h.kind !== "long" || h.status !== "open") continue;
    const s = S[h.sym]; if (!s) continue;
    const ageDays = (Date.now() - Date.parse(h.at)) / 864e5;
    if (s.price >= h.plan.target) {
      h.status = "target";
      add({ id: `${h.id}-target`, kind: "exit", sym: h.sym, tone: "positive", prio: "high", title: `${h.sym} reached the target ${rs(h.plan.target)}`,
        text: `The setup from ${h.day} (entry ${rs(h.plan.entry)}) hit its target: ${pct((s.price / h.plan.entry - 1) * 100)}. Consider booking profit, or move the stop up to ${rs(h.plan.entry)} to protect it.`, why: [`now ${rs(s.price)}`] });
    } else if (s.price <= h.plan.stop) {
      h.status = "stopped";
      add({ id: `${h.id}-stop`, kind: "exit", sym: h.sym, tone: "negative", prio: "high", title: `${h.sym} fell below the stop ${rs(h.plan.stop)}`,
        text: `The setup from ${h.day} did not work (${pct((s.price / h.plan.entry - 1) * 100)}). The plan says exit: small losses keep the account safe.`, why: [`now ${rs(s.price)}`] });
    } else if (ageDays > 20) h.status = "expired";
  }

  // ---------- 3. high-confluence long setups ----------
  const openSyms = new Set(hist.filter(h => h.kind === "long" && h.status === "open").map(h => h.sym));
  const cands = [];
  for (const s of stocks) {
    const x = s.tech, i = s.insight || {}, why = [];
    if (openSyms.has(s.symbol)) continue;
    const trend = x.above_50 && x.above_200;
    const breakout = (x.breakout_20d || x.breakout_55d) && (x.vol_ratio || 0) >= 1.5 || x.vol_surge_up;
    const pullback = x.above_200 && x.rsi14 >= 36 && x.rsi14 <= 52 && x.to_support_pct != null && x.to_support_pct <= 0 && x.to_support_pct >= -3;
    if (!(breakout || pullback) || !x.above_200 || x.rsi14 > 74) continue;
    let pts = 0;
    if (trend) { pts++; why.push("uptrend (above 50- & 200-day averages)"); }
    if ((x.rs_rating || 0) >= 75) { pts++; why.push(`relative strength ${x.rs_rating} (a market leader)`); }
    const g = ind[s.industry];
    if (g && g.rs_avg >= 55) { pts++; why.push(`strong sector (${s.industry})`); }
    if (breakout) { pts++; why.push(x.breakout_55d ? "55-day breakout on volume" : x.breakout_20d ? "20-day breakout on volume" : `volume surge x${(x.vol_ratio || 0).toFixed(1)} with price up`); }
    if (pullback) { pts++; why.push(`pullback to support ${rs(x.support)} (RSI ${x.rsi14.toFixed(0)})`); }
    if (s.fo && (s.fo.buildup === "Long build-up" || s.fo.buildup === "Short covering")) { pts++; why.push(`F&O ${s.fo.buildup.toLowerCase()} (OI ${pct(s.fo.oi_chg_pct || 0)})`); }
    if ((i.news_score || 0) >= 15) { pts++; why.push("positive news flow"); }
    if (s.edge?.odds && s.edge.odds.win20 >= 60 && s.edge.odds.edge >= 1) { pts++; why.push(`history: this setup rose ${s.edge.odds.win20}% of the time over 20 sessions`); }
    if (s.edge?.odds?.grade === "Poor odds") pts--;
    if (s.deliv && /ccumulation/.test(s.deliv.tag || "")) { pts++; why.push(`smart money: ${s.deliv.tag.toLowerCase()} (delivery ${s.deliv.dp}% vs ${s.deliv.avg_dp}% avg)`); }
    if (s.deliv && /istribution/.test(s.deliv.tag || "")) pts--;
    if (s.fo && s.fo.buildup === "Short build-up") pts--;
    if ((i.news_score || 0) <= -15) pts--;
    if (pts < 4) continue;
    // plan
    const entry = s.price;
    let stop = x.support && x.support < entry && x.support > entry * 0.92 ? x.support * 0.985 : entry * 0.95;
    stop = Math.min(stop, entry * 0.985);
    const risk = entry - stop;
    let target = x.resistance && x.resistance > entry + 1.5 * risk ? x.resistance : entry + 2 * risk;
    if (x.high52 && target > x.high52 && entry < x.high52 * 0.97) target = Math.max(entry + 1.5 * risk, x.high52 * 0.995);
    const rr = (target - entry) / risk;
    if (rr < 1.5) continue;
    const ev = (s.events || []).find(e => /result/i.test(e.type) && (Date.parse(e.date) - Date.now()) / 864e5 <= 4 && Date.parse(e.date) >= Date.now() - 864e5);
    let conf = pts >= 6 ? 3 : pts >= 5 ? 2 : 1;
    if (stance === "bear") conf--;
    if (ev) conf--;
    if (conf < 1) continue;
    const notes = [];
    if (ev) notes.push(`Results on ${ev.date}: price can gap either way. Consider waiting or using half size.`);
    if (breakout && verdict.brk20v === "No real edge") notes.push("Breakouts alone had no real edge in the 5-year backtest, so the other reasons matter here.");
    if (stance === "bear") notes.push("The overall market is in a downtrend: use half size.");
    cands.push({ s, pts, conf, why, notes, plan: { entry: r2(entry), stop: r2(stop), target: r2(target), rr: r2(rr), risk_pct: r2(risk / entry * 100) }, setup: breakout ? "breakout" : "pullback" });
  }
  cands.sort((a, b) => b.pts - a.pts || (b.s.tech.rs_rating || 0) - (a.s.tech.rs_rating || 0));
  for (const c of cands.slice(0, stance === "bear" ? 3 : 5)) {
    const lvl = ["", "Low", "Medium", "High"][c.conf];
    add({ id: `${day}-long-${c.s.symbol}`, kind: "long", sym: c.s.symbol, tone: "positive", prio: c.conf >= 2 ? "high" : "medium", status: "open", conf: lvl,
      title: `${c.s.symbol}: ${c.setup === "breakout" ? "breakout" : "pullback-to-support"} setup (${lvl.toLowerCase()} confidence)`,
      text: `Buy zone near ${rs(c.plan.entry)}, stop ${rs(c.plan.stop)} (−${c.plan.risk_pct}%), target ${rs(c.plan.target)}, reward:risk ${c.plan.rr}. Size it so a stop-out costs ≤1–2% of your capital.`,
      why: c.why, notes: c.notes, plan: c.plan });
  }

  // ---------- 4. caution flags on big names ----------
  const caution = stocks.filter(s => (s.nifty50 || (s.turnover_cr || 0) > 300) && s.fo && s.fo.buildup === "Short build-up" && s.tech.above_50 === false && (s.insight || {}).news_score <= -15)
    .sort((a, b) => (a.change_pct || 0) - (b.change_pct || 0)).slice(0, 2);
  for (const s of caution) add({ id: `${day}-caution-${s.symbol}`, kind: "caution", sym: s.symbol, tone: "negative", prio: "medium",
    title: `${s.symbol}: avoid fresh buying for now`, text: `Fresh short positions, negative news and a weak chart. If you hold it, keep a strict stop near ${rs(s.tech.support || s.price * 0.95)}.`,
    why: [`${pct(s.change_pct || 0)} today`, `OI ${pct(s.fo.oi_chg_pct || 0)} (short build-up)`, "negative news tone", "below 50-day average"] });

  // ---------- 5. options idea of the day (defined risk) ----------
  const oi = ((out.options || {}).index_ideas || [])[0] || ((out.options || {}).ideas || [])[0];
  if (oi && oi.pop >= 35) add({ id: `${day}-opt-${oi.symbol}-${oi.strategy}`, kind: "options", sym: oi.symbol, tone: oi.dir === "bullish" ? "positive" : oi.dir === "bearish" ? "negative" : "neutral", prio: "medium",
    title: `${oi.symbol} ${oi.strategy.toLowerCase()} (defined risk)`,
    text: `${oi.legs.map(g => `${g.action} ${g.strike} ${g.type}`).join(" + ")} · expiry ${oi.expiry}. Max loss ₹${Math.round(oi.max_loss_lot).toLocaleString("en-IN")}/lot, max gain ₹${Math.round(oi.max_gain_lot).toLocaleString("en-IN")}/lot, chance of profit ~${oi.pop}%. Risk only what you can fully lose.`,
    why: oi.why || [], legs: oi.legs });

  // ---------- 6. key positive filings / order wins (last 3 hours, stock reacting) ----------
  const recent = (out.news || []).filter(n => n.official && n.tone === "positive" && (n.symbols || []).length === 1 && S[n.symbols[0]] && Date.now() - Date.parse(n.published) < 3 * 3600e3);
  for (const n of recent.slice(0, 2)) {
    const s = S[n.symbols[0]];
    add({ id: `news-${n.id}`, kind: "news", sym: s.symbol, tone: "positive", prio: (s.change_pct || 0) > 1 ? "medium" : "low",
      title: `${s.symbol}: positive NSE filing`, text: `${n.title.slice(0, 160)}. Check if the chart confirms (price above ${rs(s.tech.resistance || s.price)}) before acting on news alone.`,
      why: [`${pct(s.change_pct || 0)} today`, `trend ${s.tech.trend || "-"}`] });
  }

  // ---------- 7. results tomorrow for Nifty 50 names ----------
  const soon = (out.calendar || []).filter(e => e.nifty50 && /result/i.test(e.type) && (Date.parse(e.date) - Date.now()) / 864e5 <= 1.5 && Date.parse(e.date) >= Date.now() - 864e5).slice(0, 3);
  if (soon.length) add({ id: `${day}-results-${soon.map(e => e.symbol).join("-")}`, kind: "event", tone: "neutral", prio: "low",
    title: `Results due: ${soon.map(e => e.symbol).join(", ")}`, text: "Stocks can gap sharply after results. Avoid new option buys on them just before the announcement (IV drops after results).", why: soon.map(e => `${e.symbol} ${e.date}`) });

  // ---------- save history (3 trading days) ----------
  const all = fresh.concat(hist).filter(h => Date.now() - Date.parse(h.at) < 5 * 864e5 || (h.kind === "long" && h.status === "open")).slice(0, 200);
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ items: all })); } catch {}
  // follow-up status for display
  for (const a of all) if (a.kind === "long" && S[a.sym]) a.now = S[a.sym].price;
  return { generated_at: now, day, stance, new_ids: fresh.map(a => a.id), items: all.slice(0, 60) };
}

module.exports = { run };
