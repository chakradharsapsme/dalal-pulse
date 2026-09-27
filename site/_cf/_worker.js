// Cloudflare Pages front door for Dalal Pulse (free plan).
// 1) Serves the live GitHub Pages site under the short address (dalalpulse.pages.dev).
//    Data files are cached for 30 s, everything else for 5 min.
// 2) /mcp — a free "Dalal Pulse" connector (Model Context Protocol, stateless Streamable HTTP)
//    so Claude can read the site's live rule-based data. Read-only: no orders, no accounts, no keys.
const ORIGIN = "https://chakradharsapsme.github.io/dalal-pulse";
const SITE = "https://dalalpulse.pages.dev/";
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DISCLAIMER = "Information only, not investment advice. Dalal Pulse is not SEBI-registered.";

const GUIDE = `DALAL PULSE — HOW TO USE THE WEBSITE (${SITE})
Top of every page: live index ticker; the band shows market-moving news for top stocks. Bottom bar = only high-priority breaking news (auto-advances every 9 s, pause by hovering). Bell icon = news pop-ups for stocks.
Tabs:
- News by stock: every tracked stock (Nifty 200 + F&O) with its news, tone, rule-based view (label + score), chart (price, 50/200-day averages, Bollinger, MACD, RSI, volume) and support/resistance "watch" levels. ⚡ = the source that published first; 🏛 = official NSE filing.
- Markets: market mood score, breadth, FII/DII flows, bubble map of stocks by market cap and move (HDFC-style), sector heatmap, relative-strength (RS) ranking.
- Indices: 18 NSE indices with charts, compare view and constituents.
- F&O: stocks trending with positive news, open-interest build-up (Long build-up = price up + OI up; Short build-up = price down + OI up; Short covering = price up + OI down; Long unwinding = price down + OI down).
- Options: index/stock option chain read (PCR, max pain, call/put walls, IV, expected move), defined-risk spread ideas, lottery list (cheap far options, mostly expire worthless), and the Options Expert planner (careful/balanced/bold risk sizing: 1/2/3% of capital per trade). "Buy on Kite" buttons open a Kite basket — the order is only placed after YOU confirm inside Kite.
- Circuits: large & mid caps hitting 2/5/10/20% price bands today (small caps hidden on purpose).
- Screener: ready-made screens (leaders, breakouts, pullbacks, oversold...) as cards or table.
- Portfolio: your holdings/watchlist kept in your browser only.
- Calendar: results, dividends, bonus, splits for tracked stocks.
Data refresh: every 5 min in market hours (09:15–15:30 IST, Mon–Fri), every 30 min otherwise. Signals are rule-based (no AI), with a 5-year backtest showing which signals actually had an edge.`;

const TOOLS = [
  { name: "market_overview", title: "Market overview", file: "market.txt",
    description: "Live Indian market brief from Dalal Pulse: market mood score, Nifty/Bank Nifty/sector indices with trend, RSI, support/resistance, FII/DII flows, industry strength, index option chain read (PCR, max pain, expected move) and the 5-year backtested track record of each technical signal. Call this first for any market question." },
  { name: "stock_ideas", title: "Stock & options ideas", file: "ideas.txt",
    description: "Rule-based shortlists from Dalal Pulse: strongest positive setups, relative-strength leaders, breakouts, pullbacks in uptrends, Bollinger squeezes, oversold/overbought, weakest stocks, F&O open-interest build-ups, positive/negative news flow, 52-week highs/lows, defined-risk option spreads (with max loss/gain per lot and probability) and a lottery list." },
  { name: "market_news", title: "Market news & events", file: "news.txt",
    description: "Newest stock-specific news and NSE filings for tracked Indian stocks with rule-based tone, other market headlines, and upcoming corporate events (results, dividends, bonus, splits)." },
  { name: "stock_details", title: "One stock in detail",
    description: "Full Dalal Pulse detail for one NSE stock: price, rule-based view and score, watch levels, technicals (moving averages, RSI, MACD, Bollinger, support/resistance, 52-week range, volume, returns and relative strength vs Nifty), F&O open interest, option-chain read and spread idea, recent news and filings, upcoming events, recent backtested signals. Use the NSE symbol, e.g. RELIANCE, HDFCBANK, M&M.",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "NSE symbol, e.g. TATAMOTORS or M&M (company names also work)" } }, required: ["symbol"] } },
  { name: "all_stocks", title: "All tracked stocks", file: "stocks.txt",
    description: "One line per tracked stock (Nifty 200 + F&O, ~225 stocks): price, day %, trend, RSI, relative-strength rating, 1-month return, distance from 52-week high, site view and F&O build-up. Use to scan or compare many stocks." },
  { name: "live_quote", title: "Live prices",
    description: "Live NSE prices right now (exchange feed, ~15 s cache): last price, % change vs previous close, day high/low and quote time in IST. Accepts up to 8 NSE symbols, plus NIFTY, BANKNIFTY, SENSEX, VIX. Call this first for any question about current prices or 'right now'.",
    inputSchema: { type: "object", properties: { symbols: { type: "string", description: "Comma-separated NSE symbols, e.g. RELIANCE,HDFCBANK,NIFTY" } }, required: ["symbols"] } },
  { name: "site_guide", title: "How to use Dalal Pulse",
    description: "Explains every section of the Dalal Pulse website and how to read it (tabs, icons, F&O build-up terms, options section, Kite buttons, refresh timing). Use when the user asks how to use the site or where to find something." },
].map(t => ({ ...t, inputSchema: t.inputSchema || { type: "object", properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } }));

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization", "Access-Control-Expose-Headers": "Mcp-Session-Id" };

async function getText(rel) {
  const r = await fetch(`${ORIGIN}/data/ai/${rel}`, { cf: { cacheEverything: true, cacheTtl: 60 } });
  return r.ok ? r.text() : null;
}

async function callTool(name, args = {}) {
  const t = TOOLS.find(x => x.name === name);
  if (!t) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  if (name === "site_guide") return GUIDE;
  if (name === "live_quote") {
    const syms = [...new Set(String(args.symbols || "NIFTY").toUpperCase().split(/[,\s]+/).map(x => x.replace(/\.NS$/, "")).filter(x => /^[A-Z0-9&^_-]{1,24}$/.test(x)))].slice(0, 8);
    const rows = await Promise.all(syms.map(async s => [s, await quote1(s)]));
    const ist = t => t ? new Date(Date.parse(t) + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " IST" : "?";
    const now = new Date(Date.now() + 5.5 * 3600e3), hm = now.getUTCHours() * 60 + now.getUTCMinutes(), open = now.getUTCDay() >= 1 && now.getUTCDay() <= 5 && hm >= 555 && hm <= 930;
    return `LIVE QUOTES (NSE via exchange feed) · now ${ist(new Date().toISOString())} · market ${open ? "OPEN" : "CLOSED"}\n` + rows.map(([s, q]) => q ? `${s}: ₹${q.price} (${q.change_pct > 0 ? "+" : ""}${q.change_pct}% vs prev close ₹${q.prev}) · day ${q.low}–${q.high} · as of ${ist(q.time)}` : `${s}: no quote (check the symbol)`).join("\n");
  }
  if (t.file) return (await getText(t.file)) || "Data is temporarily unavailable. Try again in a minute.";
  // stock_details
  const raw = String(args.symbol || "").trim();
  if (!raw) return "Please give an NSE symbol, e.g. RELIANCE.";
  const sym = raw.toUpperCase().replace(/\s+/g, "").replace(/\.NS$|\.BO$/, "");
  const key = s => s.replace(/[^A-Z0-9&-]/g, "_");
  const direct = await getText(`stock/${encodeURIComponent(key(sym))}.txt`);
  if (direct) return direct;
  // fall back: search symbols / company names
  const rows = ((await getText("names.txt")) || "").split("\n").map(l => l.split("|")).filter(r => r[0]);
  const norm = x => String(x).toUpperCase().replace(/\b(LTD|LIMITED|INDIA|CORPORATION|CORP|COMPANY|CO|THE|OF|AND)\b\.?/g, " ").replace(/[^A-Z0-9&]/g, "");
  const q = norm(raw), syms = rows.map(r => r[0]);
  const score = r => { const n = norm(r[1]);
    if (r[0] === sym || n === q) return 0;
    if (r[0].startsWith(sym)) return 1 + r[0].length / 100;
    if (q.length >= 3 && n.startsWith(q)) return 2 + n.length / 1000;
    if (q.length >= 3 && n.includes(q)) return 3 + n.length / 1000;
    return 9; };
  const cands = rows.map(r => [r, score(r)]).filter(x => x[1] < 9).sort((x, y) => x[1] - y[1]).map(x => x[0]).filter((r, i, a) => a.findIndex(z => z[0] === r[0]) === i);
  if (cands.length) {
    const t2 = await getText(`stock/${encodeURIComponent(key(cands[0][0]))}.txt`);
    const others = cands.slice(1, 6).map(r => `${r[0]} (${r[1]})`).join(", ");
    if (t2) return `(Best match for "${raw}": ${cands[0][0]}${others ? ` — other matches: ${others}; call stock_details again with the exact symbol if needed` : ""})\n\n` + t2;
  }
  return `"${raw}" is not in the Dalal Pulse universe (Nifty 200 + F&O stocks). Tracked symbols include: ${syms.slice(0, 60).join(", ")} … Call all_stocks for the full list.`;
}

async function handle(msg) {
  const { id, method, params = {} } = msg || {};
  const isNote = id === undefined || id === null;
  const ok = result => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id: isNote ? null : id, error: { code, message } });
  try {
    switch (method) {
      case "initialize": {
        const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[1];
        return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "dalal-pulse", title: "Dalal Pulse", version: "1.0.0", websiteUrl: SITE },
          instructions: `Live, rule-based Indian stock market data from Dalal Pulse (${SITE}): market overview, stock ideas/screens, news, per-stock detail, options reads, and a guide to the website. Data refreshes every 5 minutes in market hours. ${DISCLAIMER}` });
      }
      case "ping": return ok({});
      case "tools/list": return ok({ tools: TOOLS.map(({ file, ...t }) => t) });
      case "tools/call": {
        const text = await callTool(params.name, params.arguments || {});
        return ok({ content: [{ type: "text", text }], isError: false });
      }
      case "resources/list": return ok({ resources: [] });
      case "prompts/list": return ok({ prompts: [] });
      default:
        if (isNote) return null; // notifications/initialized etc.
        return err(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (method === "tools/call" && !e.code) return ok({ content: [{ type: "text", text: "Error: " + e.message }], isError: true });
    return err(e.code || -32603, e.message);
  }
}

async function mcp(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return new Response(JSON.stringify({ name: "Dalal Pulse MCP connector", url: SITE + "mcp", transport: "streamable-http (POST JSON-RPC)", tools: TOOLS.map(t => t.name) }, null, 1), { status: request.method === "GET" && !(request.headers.get("Accept") || "").includes("text/event-stream") ? 200 : 405, headers: { ...cors, "Content-Type": "application/json", Allow: "POST, OPTIONS" } });
  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } }); }
  const batch = Array.isArray(body);
  const out = (await Promise.all((batch ? body : [body]).map(handle))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202, headers: cors });
  return new Response(JSON.stringify(batch ? out : out[0]), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
}

// ---------- /quote: live prices at the moment of asking (Yahoo Finance, fetched server-side; cached 15 s) ----------
const YMAP = { NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK", SENSEX: "^BSESN", FINNIFTY: "NIFTY_FIN_SERVICE.NS", VIX: "^INDIAVIX" };
async function quote1(sym) {
  const y = YMAP[sym] || `${sym}.NS`;
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=1d&interval=5m`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, cf: { cacheEverything: true, cacheTtl: 15 } });
      if (!r.ok) continue;
      const j = await r.json(), m = j?.chart?.result?.[0]?.meta; if (!m || m.regularMarketPrice == null) continue;
      const prev = m.chartPreviousClose ?? m.previousClose;
      return { price: m.regularMarketPrice, prev, change_pct: prev ? Math.round((m.regularMarketPrice / prev - 1) * 10000) / 100 : null, high: m.regularMarketDayHigh, low: m.regularMarketDayLow, time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null };
    } catch {}
  }
  return null;
}
async function quotes(request) {
  const url = new URL(request.url);
  const syms = [...new Set((url.searchParams.get("s") || "").toUpperCase().split(",").map(x => x.trim()).filter(x => /^[A-Z0-9&_^.-]{1,24}$/.test(x)))].slice(0, 8);
  const out = {}; await Promise.all(syms.map(async s => { out[s] = await quote1(s); }));
  return new Response(JSON.stringify({ at: new Date().toISOString(), quotes: out }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}

// ---------- /agent: the built-in Pulse Agent (Cloudflare Workers AI free allowance; no billing possible) ----------
// Agent loop: 1) understand + plan (tool selection, clarification) → 2) tools: live quotes, research files,
// deterministic desk maths → 3) reason + answer with conversation memory. Falls back model-by-model.
const BIG = ["@cf/openai/gpt-oss-120b", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct-fast"];
const SMALL = ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/openai/gpt-oss-20b", "@cf/meta/llama-3.1-8b-instruct-fast", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const AGENT_SYSTEM = `You are "Pulse Agent", the senior equity research analyst and trading mentor built into Dalal Pulse, an Indian stock-market website (NSE). 25+ years of experience in Indian cash, F&O and options. You think like a professional: market regime → sector → stock, risk first, evidence based.

HOW TO ANSWER
- Understand plain, informal or mixed English/Hindi. Resolve "it/this/that/them" from the conversation.
- Use ONLY the DATA provided (live quotes, Dalal Pulse research files, desk calculations). Never invent prices, levels, news, targets or ratios. If something is missing, say so.
- Quote live prices with their IST time ("₹1,226 as of 25 Sep, 15:14 IST"); say if the market is closed.
- Ratings: stocks → Buy on dips / Accumulate / Hold / Reduce / Avoid; market → Bullish / Neutral / Bearish. Be decisive and explain why in 2–4 evidence points.
- Trade plans and position sizes: copy the DESK CALCULATIONS exactly (entry, stop, target, reward:risk, shares). Never do your own arithmetic. Mention what would invalidate the view.
- Respect the backtest: signals marked "No real edge" cannot be the main reason for a call.
- Options: defined-risk spreads only; note ~9 in 10 individual F&O traders lose money (SEBI) when relevant.
- Style: professional research-desk tone, plain English, Markdown with short headings (###), **bold** labels, bullets, a small table when comparing. 120–280 words unless asked for depth. No emojis. Indian number format.
- End with: "Information only, not investment advice."`;
const PLAN_SYSTEM = `You are the planning step of a stock-market research agent for Indian stocks (NSE). Read the conversation and the latest user message and decide what data to fetch.
Reply with ONE JSON object only, no prose:
{"symbols":[up to 3 NSE symbols from the LIST that the user means, resolving it/this/that from the conversation],
 "tools":[any of "market","ideas","news","all_stocks"],
 "task":"one short line describing what the user wants",
 "clarify":null or "one short clarifying question (only if the request is truly impossible to interpret)"}
Rules: company names, nicknames or misspellings map to the closest symbol in LIST. Use "market" for anything about the overall market, Nifty, sectors or 'today'. Use "ideas" for recommendations/what to buy/setups/best stocks/options ideas. Use "news" for news/results/events. Use "all_stocks" to scan or rank many stocks.`;
function agentCors(req) {
  const o = req.headers.get("Origin") || "";
  const ok = /^https:\/\/(dalalpulse\.pages\.dev|[a-z0-9-]+\.dalalpulse\.pages\.dev|chakradharsapsme\.github\.io|(www\.)?dalalpulse\.com)$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return { ok, h: { "Access-Control-Allow-Origin": ok ? o : SITE.replace(/\/$/, ""), "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } };
}
const RATE = new Map();
function aiText(r) {
  if (!r) return null; if (typeof r === "string") return r;
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  if (typeof r.output_text === "string") return r.output_text;
  const c = r.choices?.[0]?.message?.content; if (c) return c;
  if (Array.isArray(r.output)) { const t = r.output.filter(o => o.type === "message").flatMap(o => o.content || []).map(c => c.text || "").join(""); if (t) return t; }
  return r.result?.response || null;
}
async function runAI(env, models, messages, max_tokens) {
  let last = null;
  for (const m of models) {
    for (const shape of m.includes("gpt-oss") ? ["responses", "messages"] : ["messages"]) {
      try {
        const input = shape === "responses"
          ? { instructions: messages.filter(x => x.role === "system").map(x => x.content).join("\n\n"), input: messages.filter(x => x.role !== "system").map(x => ({ role: x.role, content: x.content })), max_output_tokens: max_tokens, reasoning: { effort: "low" } }
          : { messages, max_tokens, temperature: 0.2 };
        let t = aiText(await env.AI.run(m, input));
        if (t) t = String(t).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (t) return { text: t, model: m };
      } catch (e) { last = e; }
    }
  }
  throw last || new Error("no model answered");
}
function clip(t, n) { return !t ? "" : t.length > n ? t.slice(0, n) + "\n…(truncated)" : t; }
const numAfter = (t, re) => { const m = t && t.match(re); return m ? parseFloat(m[1].replace(/,/g, "")) : null; };
function deskFor(sym, doc, price, cap, given) {
  if (given && given.entry && given.stop && given.target) return given;
  if (!doc || !price) return null;
  const sup = numAfter(doc, /Support ₹([\d,.]+)/), res = numAfter(doc, /Resistance ₹([\d,.]+)/), s50 = numAfter(doc, /50D ₹([\d,.]+)/);
  let stop = sup && sup < price && sup > price * 0.9 ? sup * 0.985 : s50 && s50 < price && s50 > price * 0.9 ? s50 * 0.985 : price * 0.94;
  stop = Math.min(stop, price * 0.985); const risk = price - stop;
  const target = res && res > price + 1.5 * risk ? res : price + 2 * risk;
  const r2 = v => Math.round(v * 100) / 100;
  const view = (doc.match(/SITE VIEW: ([^|\n]+)\| overall score (-?\d+)/) || []);
  const size = [1, 2].map(r => { const raw = Math.floor(cap * r / 100 / risk), q = Math.max(0, Math.min(raw, Math.floor(cap * 0.25 / price))); return `${r}% risk (₹${Math.round(cap * r / 100).toLocaleString("en-IN")}) → ${q} shares ≈ ₹${Math.round(q * price).toLocaleString("en-IN")}, loss if stopped ≈ ₹${Math.round(q * risk).toLocaleString("en-IN")}${q < raw ? " (capped at 25% of capital)" : ""}`; }).join(" | ");
  return { sym, rating: view[1] ? `site view: ${view[1].trim()}` : "", score: view[2] || "", entry: r2(price), stop: r2(stop), target: r2(target), size };
}
async function agent(request, env) {
  const c = agentCors(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: c.h });
  const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...c.h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return J({ error: "POST only" }, 405);
  if (!c.ok) return J({ error: "origin not allowed" }, 403);
  if (!env || !env.AI) return J({ error: "ai_not_configured" }, 503);
  const ip = request.headers.get("CF-Connecting-IP") || "x", now = Date.now(), win = (RATE.get(ip) || []).filter(t => now - t < 60e3);
  if (win.length >= 6) return J({ error: "Too many questions in a minute. Please wait a few seconds." }, 429);
  win.push(now); RATE.set(ip, win);
  let body; try { body = await request.json(); } catch { return J({ error: "bad json" }, 400); }
  const q = String(body.question || "").slice(0, 700).trim(); if (!q) return J({ error: "empty question" }, 400);
  const hist = (Array.isArray(body.history) ? body.history : []).slice(-10).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 1400) }));
  const cap = Math.max(10000, Math.min(1e9, +(body.user?.capital) || 200000));
  const steps = [], t0 = Date.now(), step = d => steps.push({ d, ms: Date.now() - t0 });
  const hints = (Array.isArray(body.symbols) ? body.symbols : []).map(x => String(x).toUpperCase()).filter(x => /^[A-Z0-9&-]{1,20}$/.test(x)).slice(0, 3);
  const givenDesk = Object.fromEntries((Array.isArray(body.desk) ? body.desk : []).filter(d => d && /^[A-Z0-9&-]{1,20}$/.test(String(d.sym || ""))).map(d => [d.sym, { sym: d.sym, rating: String(d.rating || "").slice(0, 40), score: d.score, entry: +d.entry || null, stop: +d.stop || null, target: +d.target || null, size: String(d.size || "").slice(0, 320) }]));
  // 1) UNDERSTAND + PLAN
  const names = (await getText("names.txt")) || "", known = new Set(names.split("\n").map(l => l.split("|")[0]));
  let plan = { symbols: hints, tools: [], task: "", clarify: null };
  try {
    const pl = await runAI(env, SMALL, [{ role: "system", content: PLAN_SYSTEM },
      { role: "user", content: `LIST (SYMBOL|Company):\n${names}\n\nCONVERSATION SO FAR:\n${hist.map(m => `${m.role}: ${m.content.slice(0, 350)}`).join("\n") || "(none)"}\n\nSITE PARSER HINTS: symbols=${hints.join(",") || "none"}, intent=${String(body.intent || "").slice(0, 20) || "none"}\n\nLATEST USER MESSAGE: ${q}` }], 300);
    const m = pl.text.match(/\{[\s\S]*\}/); const j = m ? JSON.parse(m[0]) : {};
    plan.symbols = [...new Set((j.symbols || []).map(x => String(x).toUpperCase()).filter(x => known.has(x)).concat(hints))].slice(0, 3);
    plan.tools = (j.tools || []).filter(x => ["market", "ideas", "news", "all_stocks"].includes(x));
    plan.task = String(j.task || "").slice(0, 160); plan.clarify = j.clarify ? String(j.clarify).slice(0, 200) : null;
    step(`Understood: ${plan.task || "your question"}${plan.symbols.length ? ` (${plan.symbols.join(", ")})` : ""}`);
  } catch { step("Understood your question (site parser)"); }
  if (plan.clarify && !plan.symbols.length && !plan.tools.length) return J({ answer: plan.clarify, clarify: true, steps, model: "planner", ms: Date.now() - t0 });
  if (!plan.tools.includes("market")) plan.tools.unshift("market");
  step(`Plan: ${["live prices", ...plan.tools.map(t => ({ market: "market brief", ideas: "screens & ideas", news: "news & events", all_stocks: "all-stock scan" }[t])), ...plan.symbols.map(s => `${s} research`)].join(" → ")}`);
  // 2) TOOLS
  const liveSyms = [...new Set(plan.symbols.concat("NIFTY", /bank ?nifty|banknifty/i.test(q) ? ["BANKNIFTY"] : []))].slice(0, 6);
  const [lq, docs, files] = await Promise.all([
    Promise.all(liveSyms.map(async s => [s, await quote1(s)])),
    Promise.all(plan.symbols.map(s => getText(`stock/${encodeURIComponent(s.replace(/[^A-Z0-9&-]/g, "_"))}.txt`))),
    Promise.all(plan.tools.map(t => getText({ market: "market.txt", ideas: "ideas.txt", news: "news.txt", all_stocks: "stocks.txt" }[t]))),
  ]);
  const live = Object.fromEntries(lq.filter(x => x[1]));
  step(`Live prices: ${Object.entries(live).map(([k, v]) => `${k} ₹${v.price}`).join(", ") || "unavailable"}`);
  const desks = plan.symbols.map((s, i) => deskFor(s, docs[i], live[s]?.price, cap, givenDesk[s])).filter(Boolean);
  step(`Read ${docs.filter(Boolean).length + files.filter(Boolean).length} research file(s); computed ${desks.length} trade plan(s)`);
  const ist = new Date(Date.now() + 5.5 * 3600e3), hh = ist.getUTCHours() * 60 + ist.getUTCMinutes(), wd = ist.getUTCDay(), open = wd >= 1 && wd <= 5 && hh >= 555 && hh <= 930;
  const istT = t => t ? new Date(Date.parse(t) + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " IST" : "?";
  const lim = { market: 5500, ideas: 7000, news: 5000, all_stocks: 8000 };
  const ctx = [
    `NOW: ${ist.toISOString().slice(0, 16).replace("T", " ")} IST · NSE market ${open ? "OPEN" : "CLOSED"}`,
    `TASK: ${plan.task || q}`,
    `LIVE QUOTES:\n${Object.entries(live).map(([k, v]) => `${k}: ₹${v.price} (${v.change_pct > 0 ? "+" : ""}${v.change_pct}% vs prev close ₹${v.prev}; day ${v.low}–${v.high}; as of ${istT(v.time)})`).join("\n") || "unavailable"}`,
    `USER: capital ₹${cap.toLocaleString("en-IN")}, risk style ${String(body.user?.risk || "balanced").slice(0, 12)}${body.user?.holdings ? `; holdings: ${String(body.user.holdings).slice(0, 500)}` : ""}`,
    desks.length ? `DESK CALCULATIONS (exact, pre-computed — copy these numbers):\n${desks.map(d => `${d.sym}: ${d.rating ? `rating ${d.rating}${d.score !== "" ? ` (score ${d.score}/100)` : ""}; ` : ""}entry ₹${d.entry}, stop ₹${d.stop} (−${((1 - d.stop / d.entry) * 100).toFixed(1)}%), target ₹${d.target} (+${((d.target / d.entry - 1) * 100).toFixed(1)}%), reward:risk ${((d.target - d.entry) / (d.entry - d.stop)).toFixed(1)}; position size: ${d.size}`).join("\n")}` : "",
    ...plan.symbols.map((s, i) => `STOCK RESEARCH ${s}:\n${clip(docs[i], 3200) || "not available"}`),
    ...plan.tools.map((t, i) => files[i] ? `${t.toUpperCase()} FILE:\n${clip(files[i], lim[t])}` : ""),
  ].filter(Boolean).join("\n\n");
  // 3) REASON + ANSWER
  step("Reasoning over trend, strength, levels, news and risk");
  try {
    const out = await runAI(env, BIG, [{ role: "system", content: AGENT_SYSTEM }, { role: "system", content: "DATA:\n" + ctx }, ...hist, { role: "user", content: q }], 1100);
    step("Answer written");
    return J({ answer: out.text, model: out.model.split("/").pop(), symbols: plan.symbols, live, steps, ms: Date.now() - t0 });
  } catch (e) { return J({ error: "ai_unavailable", detail: String(e && e.message || e).slice(0, 200), steps }, 503); }
}
async function agentProbe(request, env) {
  const c = agentCors(request); if (!c.ok || !env?.AI) return new Response("no", { status: 403 });
  const res = {};
  for (const m of [...new Set(BIG.concat(SMALL))]) { const t0 = Date.now(); try { const r = await runAI(env, [m], [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: "Which is bigger, 9.11 or 9.9? Answer in one short sentence." }], 600); res[m] = `ok ${Date.now() - t0}ms: ${r.text.slice(0, 80)}`; } catch (e) { let raw = ""; try { raw = JSON.stringify(await env.AI.run(m, m.includes("gpt-oss") ? { input: "Say OK", max_output_tokens: 600 } : { messages: [{ role: "user", content: "Say OK" }], max_tokens: 600 })).slice(0, 300); } catch (e2) { raw = "raw err " + String(e2.message || e2).slice(0, 150); } res[m] = "ERR " + String(e.message || e).slice(0, 80) + " | " + raw; } }
  return new Response(JSON.stringify(res, null, 1), { headers: { ...c.h, "Content-Type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return mcp(request);
    if (url.pathname === "/quote") return quotes(request);
    if (url.pathname === "/agent") return agent(request, env);
    if (url.pathname === "/agent-probe") return agentProbe(request, env);
    if (url.pathname.startsWith("/_cf")) return new Response("Not found", { status: 404 });
    const target = ORIGIN + (url.pathname === "/" ? "/" : url.pathname) + url.search;
    const isData = url.pathname.startsWith("/data/");
    const upstream = await fetch(target, {
      headers: { "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0", Accept: request.headers.get("Accept") || "*/*" },
      redirect: "follow",
      cf: { cacheEverything: true, cacheTtl: isData ? 30 : 300 },
    });
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", isData ? "no-cache" : "public, max-age=300");
    if (url.pathname.endsWith(".txt")) { headers.set("Content-Type", "text/plain; charset=utf-8"); headers.set("Access-Control-Allow-Origin", "*"); }
    headers.delete("x-github-request-id"); headers.delete("x-fastly-request-id");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
