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
Top of every page: live index ticker; 2nd strip = Nifty 200 stocks at 52-week highs/lows; the band shows market-moving news for top stocks. Bottom bar = only high-priority breaking news (auto-advances every 9 s, pause by hovering). Bell icon = news pop-ups for stocks.
Tabs:
- News by stock: every tracked stock (Nifty 200 + F&O) with its news, tone, rule-based view (label + score), chart (price, 50/200-day averages, Bollinger, MACD, RSI, volume) and support/resistance "watch" levels. ⚡ = the source that published first; 🏛 = official NSE filing.
- Markets: market mood score, breadth, FII/DII flows, bubble map of stocks by market cap and move (HDFC-style), sector heatmap, relative-strength (RS) ranking.
- Indices: 18 NSE indices with charts, compare view and constituents.
- F&O: stocks trending with positive news, open-interest build-up (Long build-up = price up + OI up; Short build-up = price down + OI up; Short covering = price up + OI down; Long unwinding = price down + OI down).
- Options: index/stock option chain read (PCR, max pain, call/put walls, IV, expected move), defined-risk spread ideas, lottery list (cheap far options, mostly expire worthless), and the Options Expert planner (careful/balanced/bold risk sizing: 1/2/3% of capital per trade). "Buy on Kite" buttons open a Kite basket — the order is only placed after YOU confirm inside Kite.
- Circuits: large & mid caps hitting 2/5/10/20% price bands today (small caps hidden on purpose).
- Screener: ready-made screens (leaders, breakouts, pullbacks, oversold...) as cards or table.
- 52W high/low: quality stocks at yearly highs/lows.
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

// ---------- /agent: the Pulse Agent's AI brain (Cloudflare Workers AI, free daily allowance) ----------
// Agent loop: understand → plan (which data to read) → gather tools (live quotes, research files) → reason → answer.
const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-3.1-8b-instruct-fast", "@cf/meta/llama-3.1-8b-instruct"];
const PLANNER = ["@cf/meta/llama-3.1-8b-instruct-fast", "@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const AGENT_SYSTEM = `You are "Pulse Agent", the senior equity research analyst and trading mentor inside Dalal Pulse, an Indian stock-market website (NSE). You have 25+ years of experience in Indian cash, F&O and options markets. You think like a professional: top-down (market regime → sector → stock), risk first, evidence based.

RULES
- Use ONLY the DATA provided in this conversation (live quotes + Dalal Pulse research files). Never invent prices, levels, news, targets or numbers. If something is missing, say so plainly.
- Quote the live price and its IST time when you discuss a stock (write times like "25 Sep, 15:15 IST", never raw ISO timestamps). Mention if the market is closed.
- Respect the backtest: signals marked "No real edge" must not be the main reason for a call.
- Refer to the DESK QUANT MODEL as "our quant model" (never by its internal name). Use stock-specific fields for a stock; never attribute an index or sector figure (e.g. an index P/E) to a single company.
- Position size: quote the pre-computed "position size" lines from our quant model exactly (rupee risk, share quantity, cost). Never do your own division.
- When a DESK QUANT MODEL is provided, your rating must match it and your trade plan must use its exact entry/stop/target/reward:risk numbers (you may explain or add context, never change the arithmetic).
- Give a clear, decisive view with a rating from: Buy on dips / Accumulate / Hold / Reduce / Avoid (for stocks), or Bullish / Neutral / Bearish (for the market/indices).
- For any trade idea give: entry zone, stop-loss (below support/structure), target (next resistance), reward:risk, and what would invalidate it. Suggest position sizing as a % risk of capital (1–2%), never "all in".
- Options: prefer defined-risk spreads; warn that ~9 in 10 individual F&O traders lose money (SEBI) when relevant. Never suggest naked option selling.
- Keep continuity: use the conversation history; "it/this/that" refers to the stock being discussed.
- If the question is unclear or incomplete, ask ONE short clarifying question instead of guessing.
- Style: professional, calm, plain English, short paragraphs, Markdown with **bold** labels, bullet points, and small tables when comparing. 120–260 words unless the user asks for depth. No emojis. Indian number format (₹1,23,456).
- End with one line: "Information only, not investment advice."`;

function agentCors(req) {
  const o = req.headers.get("Origin") || "";
  const ok = /^https:\/\/(dalalpulse\.pages\.dev|[a-z0-9-]+\.dalalpulse\.pages\.dev|chakradharsapsme\.github\.io|(www\.)?dalalpulse\.com)$/.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return { ok, h: { "Access-Control-Allow-Origin": ok ? o : SITE.replace(/\/$/, ""), "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } };
}
const RATE = new Map();
async function runAI(env, models, messages, max_tokens) {
  let last = null;
  for (const m of models) {
    try {
      const r = await env.AI.run(m, { messages, max_tokens, temperature: 0.3 });
      const text = typeof r === "string" ? r : r?.response ?? r?.result?.response ?? r?.choices?.[0]?.message?.content ?? (typeof r?.output_text === "string" ? r.output_text : null);
      if (text && String(text).trim()) return { text: String(text).trim(), model: m };
    } catch (e) { last = e; }
  }
  throw last || new Error("no model answered");
}
function clip(t, n) { return !t ? "" : t.length > n ? t.slice(0, n) + "\n…(truncated)" : t; }
async function agent(request, env) {
  const c = agentCors(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: c.h });
  const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...c.h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return J({ error: "POST only" }, 405);
  if (!c.ok) return J({ error: "origin not allowed" }, 403);
  if (!env || !env.AI) return J({ error: "ai_not_configured" }, 503);
  const ip = request.headers.get("CF-Connecting-IP") || "x", now = Date.now(), win = (RATE.get(ip) || []).filter(t => now - t < 60e3);
  if (win.length >= 8) return J({ error: "Too many questions in a minute. Please wait a few seconds." }, 429);
  win.push(now); RATE.set(ip, win);
  let body; try { body = await request.json(); } catch { return J({ error: "bad json" }, 400); }
  const q = String(body.question || "").slice(0, 600).trim(); if (!q) return J({ error: "empty question" }, 400);
  const hist = (Array.isArray(body.history) ? body.history : []).slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 1200) }));
  const steps = [], t0 = Date.now(), step = (k, d) => steps.push({ k, d, ms: Date.now() - t0 });
  let syms = (Array.isArray(body.symbols) ? body.symbols : []).map(x => String(x).toUpperCase()).filter(x => /^[A-Z0-9&-]{1,20}$/.test(x)).slice(0, 4);
  const intent = String(body.intent || "").slice(0, 20);
  const desk = (Array.isArray(body.desk) ? body.desk : []).slice(0, 4).map(d => { const n = x => Number.isFinite(+x) ? +x : null; const e = n(d.entry), st = n(d.stop), tg = n(d.target);
    return /^[A-Z0-9&-]{1,20}$/.test(String(d.sym || "")) ? `${d.sym}: score ${n(d.score)}/100 → rating "${String(d.rating || "").slice(0, 40)}"${e && st && tg && e > st ? `; plan entry ₹${e}, stop ₹${st} (−${((1 - st / e) * 100).toFixed(1)}%), target ₹${tg} (+${((tg / e - 1) * 100).toFixed(1)}%), reward:risk ${((tg - e) / (e - st)).toFixed(1)}` : ""}${d.size ? `; position size: ${String(d.size).slice(0, 300)}` : ""}; for: ${String(d.pros || "").slice(0, 200)}; against: ${String(d.cons || "").slice(0, 200)}` : ""; }).filter(Boolean).join("\n");
  step("understand", syms.length ? `Question is about ${syms.join(", ")}` : "Reading your question");
  // PLAN: if the site's parser found no stock, let a small model resolve names from the conversation
  if (!syms.length && !/^(market|ideas|screen|sector|sectors|options|portfolio|open|help|events)$/.test(intent)) {
    try {
      const names = (await getText("names.txt")) || "";
      const pl = await runAI(env, PLANNER, [
        { role: "system", content: "You map a user's question about Indian stocks to NSE symbols from the provided list. Use the conversation to resolve 'it/this/that'. Reply with JSON only: {\"symbols\":[...up to 3],\"topic\":\"stock|market|sector|options|other\"}. Use [] if no specific company is meant." },
        { role: "user", content: `LIST (SYMBOL|Company):\n${names}\n\nCONVERSATION:\n${hist.map(m => `${m.role}: ${m.content.slice(0, 300)}`).join("\n")}\nuser: ${q}` }], 120);
      const m = pl.text.match(/\{[\s\S]*\}/); const j = m ? JSON.parse(m[0]) : {};
      const known = new Set(names.split("\n").map(l => l.split("|")[0]));
      syms = (j.symbols || []).map(x => String(x).toUpperCase()).filter(x => known.has(x)).slice(0, 3);
      step("plan", syms.length ? `Identified ${syms.join(", ")}` : `Topic: ${j.topic || "general"}`);
    } catch { step("plan", "Using the site's own parser"); }
  } else step("plan", `Plan: ${intent || "analyse"}${syms.length ? " → " + syms.join(", ") : ""}`);
  // TOOLS: live quotes + research files
  const liveSyms = [...new Set(syms.concat("NIFTY", /bank ?nifty/i.test(q) ? ["BANKNIFTY"] : []))].slice(0, 6);
  const [lq, market, ...stockDocs] = await Promise.all([
    Promise.all(liveSyms.map(async s => [s, await quote1(s)])),
    getText("market.txt"),
    ...syms.map(s => getText(`stock/${encodeURIComponent(s.replace(/[^A-Z0-9&-]/g, "_"))}.txt`)),
  ]);
  const live = Object.fromEntries(lq.filter(x => x[1]));
  step("live", `Live prices: ${Object.entries(live).map(([k, v]) => `${k} ${v.price}`).join(", ") || "unavailable"}`);
  const extra = [];
  if (/ideas|screen|sector|sectors|open/.test(intent) || /\b(idea|ideas|buy today|which stock|best|top|recommend|setup|sector|screen|list)\b/i.test(q)) { const t = await getText("ideas.txt"); if (t) extra.push(["IDEAS & SCREENS", clip(t, 9000)]); }
  if (/news|events/.test(intent) || /\b(news|result|results|dividend|event|filing|why (is|did).*(fall|rise|up|down))\b/i.test(q)) { const t = await getText("news.txt"); if (t) extra.push(["NEWS & EVENTS", clip(t, 6000)]); }
  if (!syms.length && /\b(stock|share|company)\b/i.test(q) && !extra.length) { const t = await getText("stocks.txt"); if (t) extra.push(["ALL TRACKED STOCKS (one line each)", clip(t, 9000)]); }
  step("research", `Read ${1 + stockDocs.filter(Boolean).length + extra.length} research file(s)`);
  const ist = new Date(Date.now() + 5.5 * 3600e3), hh = ist.getUTCHours() * 60 + ist.getUTCMinutes(), wd = ist.getUTCDay();
  const open = wd >= 1 && wd <= 5 && hh >= 555 && hh <= 930;
  const ctx = [
    `NOW: ${ist.toISOString().slice(0, 16).replace("T", " ")} IST · NSE market ${open ? "OPEN" : "CLOSED"}`,
    `LIVE QUOTES (exchange feed):\n${Object.entries(live).map(([k, v]) => `${k}: ₹${v.price} (${v.change_pct > 0 ? "+" : ""}${v.change_pct}% vs prev close ${v.prev}; day ${v.low}–${v.high}; as of ${v.time ? new Date(Date.parse(v.time) + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " IST" : "?"})`).join("\n") || "unavailable"}`,
    desk ? `DESK QUANT MODEL (pre-computed and arithmetically checked — use these exact numbers for rating and trade plan; do not recompute reward:risk):\n${desk}` : "",
    body.user ? `USER PROFILE: capital ₹${body.user.capital || "unknown"}, risk style ${body.user.risk || "balanced"}${body.user.holdings ? `; holdings: ${String(body.user.holdings).slice(0, 400)}` : ""}` : "",
    `MARKET BRIEF:\n${clip(market, 6500)}`,
    ...stockDocs.map((d, i) => d ? `STOCK RESEARCH ${syms[i]}:\n${clip(d, 3500)}` : `STOCK RESEARCH ${syms[i]}: not available`),
    ...extra.map(([h, t]) => `${h}:\n${t}`),
  ].filter(Boolean).join("\n\n");
  step("reason", "Analysing trend, strength, levels, news and risk");
  try {
    const out = await runAI(env, MODELS, [{ role: "system", content: AGENT_SYSTEM }, { role: "system", content: "DATA:\n" + ctx }, ...hist, { role: "user", content: q }], 900);
    step("answer", "Answer ready");
    return J({ answer: out.text, model: out.model.split("/").pop(), symbols: syms, live, steps, ms: Date.now() - t0 });
  } catch (e) { return J({ error: "ai_unavailable", detail: String(e && e.message || e).slice(0, 200), steps }, 503); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return mcp(request);
    if (url.pathname === "/quote") return quotes(request);
    if (url.pathname === "/agent") return agent(request, env);
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
