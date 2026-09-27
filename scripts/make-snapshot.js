// Builds a single self-contained HTML page (site + embedded data) for a shareable snapshot link.
const fs = require("fs"), path = require("path");
const [,, dataDir, out] = process.argv;
const site = path.join(__dirname, "..", "site");
const html = fs.readFileSync(path.join(site, "index.html"), "utf8");
const body = html.split("<!--BODY-->")[1].split("<!--/BODY-->")[0];
const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const css = fs.readFileSync(path.join(site, "style.css"), "utf8");
const js = fs.readFileSync(path.join(site, "app.js"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(dataDir, "latest.json"), "utf8"));
const charts = {};
for (const s of data.stocks) { const f = path.join(dataDir, "charts", s.symbol.replace(/[^A-Z0-9&-]/gi, "_") + ".json"); if (fs.existsSync(f)) charts[s.symbol] = JSON.parse(fs.readFileSync(f, "utf8")); }
const safe = o => JSON.stringify(o).replace(/</g, "\\u003c");
const page = `<title>Dalal Pulse</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>${css}</style>
${body.replace(/<button class="iconbtn" id="theme"/, '<button class="iconbtn" id="theme" hidden')}
<script>window.__DP_DATA__=${safe(data)};window.__DP_CHARTS__=${safe(charts)};</script>
<script>${js}</script>
`;
fs.writeFileSync(out, page);
console.log("snapshot", out, (page.length / 1024 / 1024).toFixed(2) + " MB", Object.keys(charts).length, "charts");
