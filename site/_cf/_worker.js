// Cloudflare Pages front door for Dalal Pulse (free plan).
// Serves the live GitHub Pages site under the short address (e.g. dalalpulse.pages.dev).
// Data files are cached for 30 s, everything else for 5 min, so pages stay fresh and fast.
const ORIGIN = "https://chakradharsapsme.github.io/dalal-pulse";
export default {
  async fetch(request) {
    const url = new URL(request.url);
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
    headers.delete("x-github-request-id"); headers.delete("x-fastly-request-id");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
