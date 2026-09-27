// Local preview: rebuilds the data every 15 minutes and serves the site at http://127.0.0.1:5050
const http = require("http"), fs = require("fs"), path = require("path"), { spawn, exec } = require("child_process");
const SITE = path.join(__dirname, "..", "site"), PORT = 5050;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
function build() {
  console.log(new Date().toLocaleTimeString(), "building data…");
  const p = spawn(process.execPath, [path.join(__dirname, "build-data.js")], { stdio: "inherit" });
  p.on("exit", c => console.log(new Date().toLocaleTimeString(), c === 0 ? "data ready" : "build failed"));
}
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(SITE, path.normalize(p).replace(/^([\\/]\.\.)+/, ""));
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, "127.0.0.1", () => { console.log(`Preview at http://127.0.0.1:${PORT}  (keep this window open)`); build(); setTimeout(() => exec(`start "" http://127.0.0.1:${PORT}`), 4000); });
setInterval(build, 15 * 60e3);
