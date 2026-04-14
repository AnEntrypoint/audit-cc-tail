import fs from "fs";
import path from "path";
import os from "os";
import { getDb, migrate } from "./db.ts";
import { extractVec, familyOf } from "./features.ts";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const DEBOUNCE_MS = 50;
const READ_CONCURRENCY = 8;
const INSERT_BATCH = 200;

const db = getDb();
await migrate();

const seen = new Set<string>();
const tails = new Map<string, { fd: number | null; offset: number; partial: string }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// Pending inserts buffer — flushed periodically and at EOF
const pendingInserts: { sql: string; args: unknown[] }[] = [];

async function flushInserts() {
  if (!pendingInserts.length) return;
  const batch = pendingInserts.splice(0);
  for (let i = 0; i < batch.length; i += INSERT_BATCH) {
    await db.batch(batch.slice(i, i + INSERT_BATCH));
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushInserts();
  }, 100);
}

async function loadSeen() {
  const rows = await db.execute("SELECT id FROM responses");
  for (const row of rows.rows) seen.add(row.id as string);
  console.log(`loaded ${seen.size} existing responses`);
}

function processEntry(e: Record<string, unknown>) {
  if (e.type !== "assistant") return;
  const msg = e.message as Record<string, unknown> | undefined;
  if (!msg?.model || !msg?.usage || !msg?.id) return;
  const msgId = msg.id as string;
  if (seen.has(msgId)) return;
  const family = familyOf(msg.model as string);
  if (!family) return;
  const content = (msg.content as unknown[]) ?? [];
  const textBlocks = content.filter(
    (b): b is { type: "text"; text: string } =>
      typeof b === "object" && b !== null && (b as { type: string }).type === "text"
  );
  const text = textBlocks.map((b) => b.text).join(" ");
  const usage = msg.usage as Record<string, number>;
  const outTok = usage.output_tokens ?? 0;
  const inTok = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const stopReason = (msg.stop_reason as string | null) ?? null;
  const ts = typeof e.timestamp === "string" ? new Date(e.timestamp).getTime() : Date.now();
  const sessionId = (e.sessionId as string) ?? "";
  const vec = extractVec(text, outTok, inTok, cacheRead, cacheCreate, stopReason);

  seen.add(msgId);
  process.stdout.write(`+${family}(${msg.model}) `);

  pendingInserts.push(
    {
      sql: `INSERT OR IGNORE INTO responses
        (id, ts, session_id, family, model_str, output_tokens, input_tokens,
         cache_read_tokens, cache_create_tokens, stop_reason, text_len)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [msgId, ts, sessionId, family, msg.model as string, outTok, inTok, cacheRead, cacheCreate, stopReason, text.length],
    },
    {
      sql: `INSERT OR IGNORE INTO features (response_id, family, vec) VALUES (?,?,?)`,
      args: [msgId, family, JSON.stringify(vec)],
    }
  );
  scheduleFlush();
}

function readFileSync(fp: string) {
  let s = tails.get(fp);
  if (!s) { s = { fd: null, offset: 0, partial: "" }; tails.set(fp, s); }
  try {
    if (s.fd === null) s.fd = fs.openSync(fp, "r");
    const stat = fs.fstatSync(s.fd);
    if (stat.size <= s.offset) return;
    const buf = Buffer.allocUnsafe(stat.size - s.offset);
    const n = fs.readSync(s.fd, buf, 0, buf.length, s.offset);
    s.offset += n;
    const text = s.partial + buf.toString("utf8", 0, n);
    const lines: string[] = [];
    let start = 0, idx: number;
    while ((idx = text.indexOf("\n", start)) !== -1) { lines.push(text.slice(start, idx)); start = idx + 1; }
    s.partial = text.slice(start);
    for (const l of lines) {
      const line = l.trim();
      if (!line) continue;
      try { processEntry(JSON.parse(line)); } catch (_) {}
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    if (s.fd !== null) { try { fs.closeSync(s.fd); } catch (_) {} s.fd = null; }
  }
}

function debounce(fp: string) {
  const t = timers.get(fp);
  if (t) clearTimeout(t);
  timers.set(fp, setTimeout(async () => {
    timers.delete(fp);
    readFileSync(fp);
    await flushInserts();
  }, DEBOUNCE_MS));
}

function collectFiles(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  const result: string[] = [];
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, d.name);
      if (d.isFile() && d.name.endsWith(".jsonl")) result.push(fp);
      else if (d.isDirectory()) result.push(...collectFiles(fp, depth + 1));
    }
  } catch (_) {}
  return result;
}

async function scanParallel(dir: string) {
  const files = collectFiles(dir);
  console.log(`scanning ${files.length} jsonl files with concurrency ${READ_CONCURRENCY}…`);

  for (let i = 0; i < files.length; i += READ_CONCURRENCY) {
    const chunk = files.slice(i, i + READ_CONCURRENCY);
    await Promise.all(chunk.map((fp) => {
      return new Promise<void>((resolve) => {
        readFileSync(fp);
        resolve();
      });
    }));
    // Flush accumulated inserts every chunk to avoid unbounded memory
    await flushInserts();
  }
  await flushInserts();
}

await loadSeen();
await scanParallel(PROJECTS_DIR);
console.log("\n");

const watcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_, f) => {
  if (f && f.endsWith(".jsonl")) debounce(path.join(PROJECTS_DIR, f));
});
watcher.on("error", (e) => { throw e; });

console.log("ingestor running — watching", PROJECTS_DIR);

process.on("SIGINT", async () => {
  watcher.close();
  await flushInserts();
  process.stdout.write("\n");
  process.exit(0);
});
