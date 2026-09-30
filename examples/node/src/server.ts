import { createServer } from "node:http";

import { createMockKaitenClient } from "@kaitencloud/client/testing";

import { createCatalogClient, readCatalog } from "./catalog.ts";
import { configureFlags, isEnabled } from "./flags.ts";
import { handleWebhook } from "./webhooks.ts";

const apiUrl = process.env.KAITEN_API_URL; // your Kaiten API's URL, /api included
const token = process.env.KAITEN_API_TOKEN; // a read-only ksh_ token
const webhookSecret = process.env.KAITEN_WEBHOOK_SECRET; // the endpoint's whsec_ secret
const live = Boolean(apiUrl && token);

// Without credentials the example still runs: the catalog comes from a fake
// client, and the routes that need the API say what is missing.
const catalogClient = live ? createCatalogClient(apiUrl!, token!) : createMockKaitenClient();
if (live) await configureFlags(apiUrl!, token!);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/catalog") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(await readCatalog(catalogClient)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhooks/kaiten") {
    if (!webhookSecret) {
      res.writeHead(503).end("KAITEN_WEBHOOK_SECRET is not set");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const result = await handleWebhook(
      Buffer.concat(chunks).toString("utf8"),
      req.headers,
      webhookSecret,
    );
    res.writeHead(result.status).end(result.body);
    return;
  }

  const flag = /^\/flags\/([\w-]+)$/.exec(url.pathname);
  if (req.method === "GET" && flag) {
    if (!live) {
      res.writeHead(503).end("KAITEN_API_URL and KAITEN_API_TOKEN are not set");
      return;
    }
    const enabled = await isEnabled(flag[1], url.searchParams.get("user") ?? "anonymous");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ flag: flag[1], enabled }));
    return;
  }

  res.writeHead(404).end();
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`listening on http://localhost:${port} (${live ? "live API" : "demo data"})`);
});
