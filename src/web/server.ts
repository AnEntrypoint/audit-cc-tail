import { fetchFamily, fetchGlobal } from "../dashboard-data.ts";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

const FAMILIES = new Set(["haiku", "sonnet", "opus"]);
const STATIC: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
};
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function serveStatic(name: string) {
  const file = join(here, name);
  if (!existsSync(file)) return new Response("not found", { status: 404 });
  const ext = name.slice(name.lastIndexOf("."));
  return new Response(readFileSync(file), { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } });
}

const port = Number(process.env.PORT ?? 7842);
const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (STATIC[p]) return serveStatic(STATIC[p]);
    if (p === "/api/health") return json({ ok: true, ts: Date.now() });
    if (p === "/api/global") return json(await fetchGlobal());
    if (p.startsWith("/api/family/")) {
      const fam = p.slice("/api/family/".length);
      if (!FAMILIES.has(fam)) return json({ error: "unknown family" }, 400);
      return json(await fetchFamily(fam));
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`audit-cc-tail dashboard: http://127.0.0.1:${server.port}/`);
