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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return mcp(request);
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
