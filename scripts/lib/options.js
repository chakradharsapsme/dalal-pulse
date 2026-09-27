// Options analytics from NSE's live option chain: PCR, max pain, OI walls, implied volatility, expected move,
// plus rule-based, RISK-LIMITED setup ideas (debit spreads: the most you can lose is what you pay) and a clearly
// warned list of cheap far-out-of-the-money options with unusual volume. Informational only, never advice.
const fs = require("fs");
const path = require("path");
const { nseGet } = require("./nse");

const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;
const INDEX_LOTS = { NIFTY: 75, BANKNIFTY: 35, FINNIFTY: 65, MIDCPNIFTY: 140, NIFTYNXT50: 25 };
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const parseExp = s => { const m = String(s).match(/(\d+)-(\w{3})-(\d{4})/); return m ? Date.UTC(+m[3], MON[m[2].toUpperCase()], +m[1], 10, 0) : null; }; // 15:30 IST

// standard normal CDF
function N(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
// chance the price ends above K at expiry (lognormal, zero drift), using implied volatility
const probAbove = (S, K, iv, T) => { if (!(S > 0 && K > 0 && iv > 0 && T > 0)) return null; const s = iv / 100 * Math.sqrt(T); return N((Math.log(S / K) - s * s / 2) / s); };

async function lotSizes(cacheDir) {
  const f = path.join(cacheDir, "fo_lots.json");
  try {
    const r = await fetch("https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv", { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
    const t = await r.text();
    if (r.ok && /SYMBOL/i.test(t)) {
      const lots = {};
      for (const line of t.split(/\r?\n/).slice(1)) {
        const c = line.split(",").map(x => x.trim()); const sym = c[1]; const lot = c.slice(2).map(Number).find(n => n > 0);
        if (sym && lot) lots[sym] = lot;
      }
      if (Object.keys(lots).length > 50) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(lots)); return lots; }
    }
  } catch {}
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; }
}

async function chain(symbol, isIndex) {
  const info = await nseGet(`/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`, "/option-chain");
  const exps = (info.expiryDates || []).map(e => ({ e, t: parseExp(e) })).filter(x => x.t && x.t > Date.now());
  // nearest expiry that still has at least 2 days left (very short expiries are close to gambling)
  const pick = exps.find(x => x.t - Date.now() > 2 * 86400e3) || exps[0];
  if (!pick) throw new Error("no expiry");
  // monthly expiry = the last expiry in its calendar month (Zerodha writes monthly and weekly symbols differently)
  const ym = t => new Date(t).toISOString().slice(0, 7);
  pick.monthly = !exps.some(x => x.t > pick.t && ym(x.t) === ym(pick.t));
  const j = await nseGet(`/api/option-chain-v3?type=${isIndex ? "Indices" : "Equity"}&symbol=${encodeURIComponent(symbol)}&expiry=${pick.e}`, "/option-chain");
  const rows = (j.records?.data || []).filter(d => d.strikePrice);
  const spot = j.records?.underlyingValue || rows.find(d => d.CE?.underlyingValue)?.CE.underlyingValue;
  if (!spot || rows.length < 5) throw new Error("empty chain");
  return { symbol, expiry: pick.e, expiryT: pick.t, monthly: pick.monthly, spot, timestamp: j.records?.timestamp, rows };
}

function analyse(c, lot) {
  const T = Math.max(0.5, (c.expiryT - Date.now()) / 86400e3) / 365;
  const S = c.spot;
  const leg = (d, k) => { const o = d[k]; if (!o) return null; const bid = o.buyPrice1 || 0, ask = o.sellPrice1 || 0, ltp = o.lastPrice || 0;
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : ltp; return { ltp, bid, ask, mid, oi: o.openInterest || 0, chg: o.changeinOpenInterest || 0, vol: o.totalTradedVolume || 0, iv: o.impliedVolatility || 0 }; };
  const strikes = c.rows.map(d => ({ k: d.strikePrice, ce: leg(d, "CE"), pe: leg(d, "PE") })).sort((a, b) => a.k - b.k);
  const sum = f => strikes.reduce((a, s) => a + f(s), 0);
  const ceOI = sum(s => s.ce?.oi || 0), peOI = sum(s => s.pe?.oi || 0), ceChg = sum(s => s.ce?.chg || 0), peChg = sum(s => s.pe?.chg || 0);
  // max pain: expiry price at which option buyers collectively get the least
  let maxPain = null, best = Infinity;
  for (const x of strikes) { const pay = sum(s => (s.ce?.oi || 0) * Math.max(0, x.k - s.k) + (s.pe?.oi || 0) * Math.max(0, s.k - x.k)); if (pay < best) { best = pay; maxPain = x.k; } }
  const atmI = strikes.reduce((bi, s, i) => Math.abs(s.k - S) < Math.abs(strikes[bi].k - S) ? i : bi, 0), atm = strikes[atmI];
  const ivs = [atm.ce?.iv, atm.pe?.iv].filter(v => v > 0); let atmIV = ivs.length ? ivs.reduce((a, b) => a + b) / ivs.length : null;
  if (!atmIV) { const near = strikes.slice(Math.max(0, atmI - 3), atmI + 4).flatMap(s => [s.ce?.iv, s.pe?.iv]).filter(v => v > 0); atmIV = near.length ? near.reduce((a, b) => a + b) / near.length : null; }
  const callWall = strikes.filter(s => s.k >= S).reduce((m, s) => (s.ce?.oi || 0) > (m?.ce?.oi || 0) ? s : m, null);
  const putWall = strikes.filter(s => s.k <= S).reduce((m, s) => (s.pe?.oi || 0) > (m?.pe?.oi || 0) ? s : m, null);
  const move = atmIV ? S * atmIV / 100 * Math.sqrt(T) : null;
  const liquid = l => l && l.oi > 0 && (l.bid > 0 || l.ltp > 0);
  const window = strikes.slice(Math.max(0, atmI - 15), atmI + 16).map(s => ({ k: s.k, ce: s.ce && { ltp: r2(s.ce.ltp), oi: s.ce.oi, chg: s.ce.chg, vol: s.ce.vol, iv: r2(s.ce.iv) }, pe: s.pe && { ltp: r2(s.pe.ltp), oi: s.pe.oi, chg: s.pe.chg, vol: s.pe.vol, iv: r2(s.pe.iv) } }));
  return { und: c.symbol, expiryT: c.expiryT, monthly: c.monthly, S, T, days: Math.round(T * 365), strikes, atm, atmI, atmIV, move, lot, liquid,
    summary: { symbol: c.symbol, spot: r2(S), expiry: c.expiry, days: Math.round(T * 365 * 10) / 10, timestamp: c.timestamp, lot,
      pcr: ceOI ? r2(peOI / ceOI) : null, pcr_chg: ceChg ? r2(peChg / Math.abs(ceChg)) : null, ce_oi: ceOI, pe_oi: peOI, ce_chg: ceChg, pe_chg: peChg,
      max_pain: maxPain, call_wall: callWall?.k ?? null, put_wall: putWall?.k ?? null, atm: atm.k, atm_iv: r2(atmIV),
      exp_move: r2(move), exp_move_pct: move ? r2(move / S * 100) : null, range_lo: move ? r2(S - move) : null, range_hi: move ? r2(S + move) : null },
    window };
}

// Zerodha (Kite) trading symbol for an NFO option: monthly NIFTY26OCT23150PE, weekly NIFTY2610623150PE (YY + M + DD, M = 1-9,O,N,D)
const MONS3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function kiteSymbol(und, expiryT, monthly, strike, type) {
  const d = new Date(expiryT + 5.5 * 3600e3), yy = String(d.getUTCFullYear()).slice(2), m = d.getUTCMonth();
  const k = Number.isInteger(strike) ? String(strike) : String(+strike.toFixed(2));
  return monthly ? `${und}${yy}${MONS3[m]}${k}${type}` : `${und}${yy}${m < 9 ? m + 1 : "OND"[m - 9]}${String(d.getUTCDate()).padStart(2, "0")}${k}${type}`;
}

// view from everything we know about the stock: trend + news + OI build-up + PCR + where max pain sits
function view(a, stock) {
  let sc = 0; const why = [];
  const t = stock?.tech, ins = stock?.insight;
  if (ins?.tech_score != null) { sc += ins.tech_score / 100 * 2; if (Math.abs(ins.tech_score) >= 25) why.push(`chart ${ins.tech_score > 0 ? "strong" : "weak"} (${t?.trend || ""})`); }
  if (ins?.news_score != null && stock.news_ids?.length) { sc += ins.news_score / 100 * 1.2; if (Math.abs(ins.news_score) >= 15) why.push(`news tone ${ins.news_score > 0 ? "positive" : "negative"} (${stock.news_ids.length} stories)`); }
  if (stock?.fo?.buildup) { const b = stock.fo.buildup; const v = b === "Long build-up" ? 0.6 : b === "Short covering" ? 0.3 : b === "Short build-up" ? -0.6 : -0.3; sc += v; why.push(b.toLowerCase()); }
  const pcr = a.summary.pcr; if (pcr != null) { if (pcr > 1.2) { sc += 0.3; why.push(`put-call ratio ${pcr} (put writers confident)`); } else if (pcr < 0.7) { sc -= 0.3; why.push(`put-call ratio ${pcr} (call writers confident)`); } }
  if (t?.rs_rating != null) { if (t.rs_rating >= 75) { sc += 0.3; why.push(`relative strength ${t.rs_rating}`); } else if (t.rs_rating <= 25) { sc -= 0.3; why.push(`relative strength ${t.rs_rating}`); } }
  if (t?.macd_state) sc += t.macd_state === "bull" ? 0.2 : -0.2;
  return { score: r2(sc), dir: sc >= 1 ? "bullish" : sc <= -1 ? "bearish" : "neutral", why };
}

// risk-limited idea: debit spread (buy one option, sell a further one) so the maximum loss is the amount paid
function spreadIdea(a, v) {
  if (v.dir === "neutral" || !a.atmIV || !a.move) return null;
  const up = v.dir === "bullish", side = up ? "ce" : "pe", st = a.strikes;
  const buyI = a.atmI;
  const target = up ? a.S + a.move * 0.9 : a.S - a.move * 0.9;
  let sellI = null;
  for (let i = buyI + (up ? 1 : -1); i >= 0 && i < st.length; i += up ? 1 : -1) { sellI = i; if (up ? st[i].k >= target : st[i].k <= target) break; }
  if (sellI == null) return null;
  const B = st[buyI][side], Sx = st[sellI][side];
  if (!a.liquid(B) || !a.liquid(Sx)) return null;
  const pay = (B.ask > 0 ? B.ask : B.ltp), get = (Sx.bid > 0 ? Sx.bid : Sx.ltp); // realistic fills: pay the ask, receive the bid
  const debit = pay - get, width = Math.abs(st[sellI].k - st[buyI].k);
  if (!(debit > 0) || debit >= width) return null;
  const be = up ? st[buyI].k + debit : st[buyI].k - debit;
  const pAbove = probAbove(a.S, be, a.atmIV, a.T), pop = pAbove == null ? null : up ? pAbove : 1 - pAbove;
  const pMax = probAbove(a.S, st[sellI].k, a.atmIV, a.T), pFull = pMax == null ? null : up ? pMax : 1 - pMax;
  const rr = (width - debit) / debit;
  if (rr < 0.8 || pop == null || pop < 0.3) return null;
  const lot = a.lot || null;
  return { strategy: up ? "Bull call spread" : "Bear put spread", dir: v.dir,
    legs: [{ action: "BUY", type: up ? "CE" : "PE", strike: st[buyI].k, price: r2(pay), ts: kiteSymbol(a.und, a.expiryT, a.monthly, st[buyI].k, up ? "CE" : "PE") },
      { action: "SELL", type: up ? "CE" : "PE", strike: st[sellI].k, price: r2(get), ts: kiteSymbol(a.und, a.expiryT, a.monthly, st[sellI].k, up ? "CE" : "PE") }],
    debit: r2(debit), max_loss: r2(debit), max_gain: r2(width - debit), breakeven: r2(be), rr: r2(rr), pop: Math.round(pop * 100), p_full: pFull == null ? null : Math.round(pFull * 100),
    lot, max_loss_lot: lot ? Math.round(debit * lot) : null, max_gain_lot: lot ? Math.round((width - debit) * lot) : null, score: v.score, why: v.why };
}

// cheap far-out-of-the-money options with unusual volume: the "lottery tickets"
function lottery(a, symbol) {
  if (!a.atmIV || !a.move) return [];
  const out = [];
  for (const s of a.strikes) for (const side of ["ce", "pe"]) {
    const o = s[side]; if (!o || !o.ltp || !o.vol) continue;
    const dist = side === "ce" ? s.k - a.S : a.S - s.k; if (dist < a.move * 1.5) continue;
    if (o.ltp > Math.max(5, a.S * 0.004)) continue;
    const unusual = o.vol >= Math.max(3 * Math.max(o.oi, 1), 1) || (o.chg > 0 && o.chg >= o.oi * 0.5);
    if (!unusual) continue;
    const p = probAbove(a.S, s.k + (side === "ce" ? o.ltp : -o.ltp), a.atmIV, a.T); const pITM = p == null ? null : side === "ce" ? p : 1 - p;
    out.push({ symbol, ts: kiteSymbol(a.und, a.expiryT, a.monthly, s.k, side.toUpperCase()), type: side.toUpperCase(), strike: s.k, ltp: r2(o.ltp), vol: o.vol, oi: o.oi, oi_chg: o.chg, dist_pct: r2(dist / a.S * 100),
      p_profit: pITM == null ? null : r2(pITM * 100), lot: a.lot, cost_lot: a.lot ? Math.round(o.ltp * a.lot) : null,
      x10_price: r2(side === "ce" ? s.k + o.ltp * 10 : s.k - o.ltp * 10) }); // price the stock must reach by expiry for a 10x payoff
  }
  return out.sort((x, y) => y.vol - x.vol).slice(0, 4);
}

// index view: trend + momentum + put-call ratio + FII flows
function indexView(a, tech, fiiNet) {
  let sc = 0; const why = [];
  if (tech) {
    if (tech.above_50 && tech.above_200) { sc += 0.8; why.push("index above its 50- and 200-day averages"); } else if (tech.above_50 === false && tech.above_200 === false) { sc -= 0.8; why.push("index below its 50- and 200-day averages"); }
    if (tech.macd_state) { sc += tech.macd_state === "bull" ? 0.4 : -0.4; why.push(`MACD ${tech.macd_state === "bull" ? "bullish" : "bearish"}`); }
    if (tech.ret_1m != null && Math.abs(tech.ret_1m) > 2) { sc += tech.ret_1m > 0 ? 0.3 : -0.3; why.push(`1-month ${tech.ret_1m > 0 ? "+" : ""}${tech.ret_1m}%`); }
  }
  const pcr = a.summary.pcr; if (pcr != null) { if (pcr > 1.2) { sc += 0.4; why.push(`put-call ratio ${pcr}`); } else if (pcr < 0.75) { sc -= 0.4; why.push(`put-call ratio ${pcr}`); } }
  if (fiiNet != null && Math.abs(fiiNet) > 1500) { sc += fiiNet > 0 ? 0.3 : -0.3; why.push(`FIIs net ${fiiNet > 0 ? "buyers" : "sellers"} ₹${Math.round(Math.abs(fiiNet))} cr`); }
  return { score: r2(sc), dir: sc >= 1 ? "bullish" : sc <= -1 ? "bearish" : "neutral", why };
}

async function loadOptions({ stocks, indices, fiiNet, outDir, cacheDir, log }) {
  fs.mkdirSync(outDir, { recursive: true });
  const lots = await lotSizes(cacheDir);
  const S = Object.fromEntries(stocks.map(s => [s.symbol, s]));
  // which underlyings: the two big indices + the most active / most talked-about F&O stocks (keeps NSE requests modest)
  const heavy = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN", "BHARTIARTL", "ITC", "LT", "AXISBANK", "KOTAKBANK", "BAJFINANCE", "M&M", "TMPV", "MARUTI", "SUNPHARMA", "HINDUNILVR", "ADANIENT", "TATASTEEL", "HCLTECH"];
  const active = stocks.filter(s => s.fo).sort((a, b) => (Math.abs(b.fo.oi_chg_pct || 0) + (b.news_ids.length * 3) + Math.abs(b.change_pct || 0) * 4) - (Math.abs(a.fo.oi_chg_pct || 0) + (a.news_ids.length * 3) + Math.abs(a.change_pct || 0) * 4)).map(s => s.symbol);
  const list = [...new Set([...heavy.filter(s => S[s]?.fo), ...active])].slice(0, 36);
  const underlyings = [["NIFTY", true], ["BANKNIFTY", true], ...list.map(s => [s, false])];
  const out = { indices: [], stocks: [], ideas: [], index_ideas: [], lottery: [], failed: 0 };
  const q = [...underlyings];
  const worker = async () => {
    while (q.length) {
      const [sym, isIdx] = q.shift();
      try {
        const c = await chain(sym, isIdx);
        const a = analyse(c, isIdx ? INDEX_LOTS[sym] : lots[sym] || null);
        fs.writeFileSync(path.join(outDir, sym.replace(/[^A-Z0-9&-]/gi, "_") + ".json"), JSON.stringify({ ...a.summary, chain: a.window }));
        if (isIdx) {
          const pcr = a.summary.pcr;
          a.summary.mood = pcr == null ? "neutral" : pcr > 1.2 ? "bullish" : pcr < 0.8 ? "bearish" : "neutral";
          const it = (indices || []).find(x => x.id === (sym === "NIFTY" ? "nifty50" : "bank"));
          const v = indexView(a, it?.tech, fiiNet);
          a.summary.view = v.dir; a.summary.view_score = v.score; a.summary.view_why = v.why;
          out.indices.push(a.summary);
          const idea = spreadIdea(a, v); if (idea) out.index_ideas.push({ symbol: sym, index: true, spot: a.summary.spot, expiry: c.expiry, days: a.summary.days, iv: a.summary.atm_iv, ...idea });
        } else {
          const v = view(a, S[sym]);
          out.stocks.push({ ...a.summary, view: v.dir, view_score: v.score });
          const idea = spreadIdea(a, v); if (idea) out.ideas.push({ symbol: sym, spot: a.summary.spot, expiry: c.expiry, days: a.summary.days, iv: a.summary.atm_iv, ...idea });
        }
        out.lottery.push(...lottery(a, sym).map(x => ({ ...x, expiry: c.expiry, days: a.summary.days })));
      } catch (e) { out.failed++; }
      await new Promise(r => setTimeout(r, 200));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  out.ideas.sort((a, b) => (Math.abs(b.score) * (b.pop / 100) * Math.min(3, b.rr)) - (Math.abs(a.score) * (a.pop / 100) * Math.min(3, a.rr)));
  out.lottery.sort((a, b) => b.vol - a.vol); out.lottery = out.lottery.slice(0, 20);
  out.updated = new Date().toISOString();
  log(`[options] ${out.indices.length} indices, ${out.stocks.length} stocks, ${out.ideas.length} setup ideas, ${out.lottery.length} lottery-style, ${out.failed} failed`);
  return out;
}

module.exports = { loadOptions, probAbove, kiteSymbol };
