#!/usr/bin/env node
/**
 * Minimal static file server for `storybook-static/`, used by the visual
 * regression suite (`tests/visual/`). No new runtime dependency — pure Node.
 *
 * Usage:  node scripts/serve-storybook.mjs [port]
 * Stops on SIGTERM / SIGINT, which is what Playwright's `webServer` sends.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "storybook-static");
const port = Number(process.env.PORT ?? process.argv[3] ?? 6007);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".webp": "image/webp",
};

function safeJoin(base, target) {
  const candidate = normalize(join(base, target));
  if (!candidate.startsWith(base)) return null;
  return candidate;
}

const server = createServer((req, res) => {
  const requested = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  let filePath = safeJoin(root, requested === "/" ? "/index.html" : requested);
  if (!filePath) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
  } catch {
    res.writeHead(404).end("Not found");
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("open", () => {
    res.writeHead(200, {
      "Content-Type": mime[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    stream.pipe(res);
  });
  stream.on("error", () => {
    res.writeHead(404).end("Not found");
  });
});

server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[serve-storybook] http://127.0.0.1:${port} (root: ${root})`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
