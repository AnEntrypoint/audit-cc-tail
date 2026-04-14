import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getDb, migrate } from "./db.ts";

const PYTHON = "C:/Python312/python.exe";
const BGMM_SCRIPT = path.join(import.meta.dir, "bgmm.py");
const TMP_IN = path.join(import.meta.dir, "..", ".bgmm_in.json");
const FAMILIES = ["haiku", "sonnet", "opus"];
const MIN_SAMPLES = 6;

const db = getDb();
await migrate();

type BgmmResult = { k: number; weights: number[]; labels: number[]; pk: Record<string, number>; means: number[][] };

function runBgmmScript(payload: object): BgmmResult {
  fs.writeFileSync(TMP_IN, JSON.stringify(payload));
  const raw = execSync(`${PYTHON} ${BGMM_SCRIPT} ${TMP_IN}`, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }).toString().trim();
  return JSON.parse(raw) as BgmmResult;
}

async function clusterMode(family: string, mode: "text" | "tools"): Promise<void> {
  const table = mode === "tools" ? "tool_features" : "features";
  const rows = await db.execute(
    `SELECT f.response_id, f.vec
     FROM ${table} f
     JOIN responses r ON r.id = f.response_id
     WHERE f.family = ? AND r.output_tokens > 10`,
    [family]
  );
  if (rows.rows.length < MIN_SAMPLES) {
    console.log(`${family}/${mode}: ${rows.rows.length} samples — skipping (need ${MIN_SAMPLES})`);
    return;
  }

  const ids = rows.rows.map((r) => r.response_id as string);
  const vectors = rows.rows.map((r) => JSON.parse(r.vec as string) as number[]);
  const result = runBgmmScript({ family, vectors, mode });
  const now = Date.now();

  const [clusterTable, histTable] = mode === "tools"
    ? ["clusters_tool", "cluster_history_tool"]
    : ["clusters", "cluster_history"];

  await db.batch([
    {
      sql: `INSERT OR REPLACE INTO ${clusterTable} (family, k, weights, means, pk, updated_at) VALUES (?,?,?,?,?,?)`,
      args: [family, result.k, JSON.stringify(result.weights), JSON.stringify(result.means ?? []), JSON.stringify(result.pk), now],
    },
    {
      sql: `INSERT INTO ${histTable} (ts, family, k, pk) VALUES (?,?,?,?)`,
      args: [now, family, result.k, JSON.stringify(result.pk)],
    },
  ]);

  if (mode === "text") {
    const assignments = ids.map((id, i) => ({
      sql: `INSERT OR REPLACE INTO cluster_assignments (response_id, family, cluster_id, updated_at) VALUES (?,?,?,?)`,
      args: [id, family, result.labels[i], now],
    }));
    for (let i = 0; i < assignments.length; i += 100) await db.batch(assignments.slice(i, i + 100));
  }

  const pkStr = Object.entries(result.pk).map(([k, v]) => `P(${k})=${(v * 100).toFixed(0)}%`).join(" ");
  console.log(`${family}/${mode}: K=${result.k} n=${rows.rows.length} ${pkStr}`);
}

async function recomputeFeatures(): Promise<void> {
  const sample = await db.execute("SELECT vec FROM features LIMIT 1");
  if (!sample.rows.length) return;
  const sampleVec = JSON.parse(sample.rows[0].vec as string) as number[];
  if (sampleVec.length === 8) return;

  const rows = await db.execute(
    `SELECT f.response_id, f.family, f.vec, r.stop_reason FROM features f JOIN responses r ON r.id = f.response_id`
  );
  if (!rows.rows.length) return;
  console.log(`migrating ${rows.rows.length} feature vectors…`);

  const STOP_CODES: Record<string, number> = { end_turn: 0, tool_use: 1, max_tokens: 2, stop_sequence: 3 };
  const batches: { sql: string; args: unknown[] }[] = [];
  for (const row of rows.rows) {
    const old = JSON.parse(row.vec as string) as number[];
    if (old.length !== 10) continue;
    const [outTok, , , chars, avgWordLen, punctD, markD, uniqueW, sentVar] = old;
    const stopCode = STOP_CODES[(row.stop_reason as string) ?? ""] ?? -1;
    batches.push({ sql: `UPDATE features SET vec = ? WHERE response_id = ?`, args: [JSON.stringify([Math.log1p(outTok), Math.log1p(chars), avgWordLen, punctD, markD, uniqueW, Math.log1p(sentVar), stopCode]), row.response_id as string] });
  }
  for (let i = 0; i < batches.length; i += 200) await db.batch(batches.slice(i, i + 200));
  console.log("features migrated");
}

async function runAll() {
  await recomputeFeatures();
  for (const family of FAMILIES) {
    await Promise.allSettled([
      clusterMode(family, "text").catch((e) => console.error(`${family}/text error:`, (e as Error).message)),
      clusterMode(family, "tools").catch((e) => console.error(`${family}/tools error:`, (e as Error).message)),
    ]);
  }
  try { fs.unlinkSync(TMP_IN); } catch (_) {}
}

const [, , flag] = process.argv;
if (flag === "--watch") {
  await runAll();
  setInterval(runAll, 60 * 60 * 1000);
  console.log("cluster watcher running — recalibrates every hour");
} else {
  await runAll();
  process.exit(0);
}
