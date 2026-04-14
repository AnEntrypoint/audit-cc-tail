import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getDb, migrate } from "./db.ts";

const PYTHON = "C:/Python312/python.exe";
const BGMM_SCRIPT = path.join(import.meta.dir, "bgmm.py");
const TMP_IN = path.join(import.meta.dir, "..", ".bgmm_in.json");
const TMP_OUT = path.join(import.meta.dir, "..", ".bgmm_out.json");
const FAMILIES = ["haiku", "sonnet", "opus"];
const MIN_SAMPLES = 6;

const db = getDb();
await migrate();

async function runBgmm(family: string): Promise<void> {
  const rows = await db.execute(
    "SELECT response_id, vec FROM features WHERE family = ?",
    [family]
  );
  if (rows.rows.length < MIN_SAMPLES) {
    console.log(`${family}: ${rows.rows.length} samples — skipping (need ${MIN_SAMPLES})`);
    return;
  }
  const ids = rows.rows.map((r) => r.response_id as string);
  const vectors = rows.rows.map((r) => JSON.parse(r.vec as string) as number[]);

  fs.writeFileSync(TMP_IN, JSON.stringify({ family, vectors }));
  const raw = execSync(`${PYTHON} ${BGMM_SCRIPT} ${TMP_IN}`, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }).toString().trim();
  const result = JSON.parse(raw) as { k: number; weights: number[]; labels: number[]; pk: Record<string, number>; means: number[][] };

  const now = Date.now();

  await db.batch([
    {
      sql: `INSERT OR REPLACE INTO clusters (family, k, weights, means, pk, updated_at)
            VALUES (?,?,?,?,?,?)`,
      args: [family, result.k, JSON.stringify(result.weights), JSON.stringify(result.means ?? []), JSON.stringify(result.pk), now],
    },
    {
      sql: `INSERT INTO cluster_history (ts, family, k, pk) VALUES (?,?,?,?)`,
      args: [now, family, result.k, JSON.stringify(result.pk)],
    },
  ]);

  const assignments = ids.map((id, i) => ({
    sql: `INSERT OR REPLACE INTO cluster_assignments (response_id, family, cluster_id, updated_at) VALUES (?,?,?,?)`,
    args: [id, family, result.labels[i], now],
  }));
  for (let i = 0; i < assignments.length; i += 100) {
    await db.batch(assignments.slice(i, i + 100));
  }

  const pkStr = Object.entries(result.pk).map(([k, v]) => `P(${k})=${(v * 100).toFixed(0)}%`).join(" ");
  console.log(`${family}: K=${result.k} samples=${rows.rows.length} ${pkStr}`);
}

async function runAll() {
  for (const family of FAMILIES) {
    try { await runBgmm(family); } catch (e) { console.error(`${family} error:`, (e as Error).message); }
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
