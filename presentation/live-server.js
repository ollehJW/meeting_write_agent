const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const url = require("node:url");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 9703);
const ROOT = __dirname;
const ENTRY = path.join(ROOT, "presentation.html");
const clients = new Set();

function sendReload() {
  for (const res of clients) {
    res.write("event: reload\n");
    res.write(`data: ${Date.now()}\n\n`);
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
  }[ext] || "application/octet-stream";
}

function injectLiveReload(html) {
  const script = `
<script>
(() => {
  const source = new EventSource("/__live_reload");
  source.addEventListener("reload", () => window.location.reload());
})();
</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${script}\n</body>`) : `${html}${script}`;
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(url.parse(req.url).pathname || "/");

  if (pathname === "/__live_reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const requested = pathname === "/" ? "/presentation.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-cache" });
    if (filePath === ENTRY) {
      res.end(injectLiveReload(data.toString("utf8")));
      return;
    }
    res.end(data);
  });
});

let reloadTimer = null;
fs.watch(ROOT, { recursive: false }, (_eventType, filename) => {
  if (!filename || filename.endsWith("~") || filename === "live-server.js") return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(sendReload, 100);
});

server.listen(PORT, HOST, () => {
  console.log(`Presentation server running at http://localhost:${PORT}/presentation.html`);
});
