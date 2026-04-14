import { getDb } from "./db.ts";

const db = getDb();
const FAMILIES = ["haiku", "sonnet", "opus"];
const REFRESH_MS = 5000;

function bar(value: number, width = 20): string {
  const filled = Math.round(value * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pkLine(pk: Record<string, number>): string {
  return Object.entries(pk)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `P(${k})=${(v * 100).toFixed(0)}%`)
    .join("  ");
}

async function renderFamily(family: string): Promise<string[]> {
  const [clusterRow, countRow, histRow] = await Promise.all([
    db.execute("SELECT k, weights, pk, updated_at FROM clusters WHERE family = ?", [family]),
    db.execute("SELECT COUNT(*) as n FROM responses WHERE family = ?", [family]),
    db.execute(
      "SELECT k, pk, ts FROM cluster_history WHERE family = ? ORDER BY ts DESC LIMIT 5",
      [family]
    ),
  ]);

  const total = Number(countRow.rows[0]?.n ?? 0);
  const lines: string[] = [];
  lines.push(`\x1b[1m${family.toUpperCase()}\x1b[0m  ${total} responses`);

  if (!clusterRow.rows.length) {
    lines.push("  (no cluster data yet — run: bun run cluster)");
    return lines;
  }

  const cluster = clusterRow.rows[0];
  const k = Number(cluster.k);
  const weights = JSON.parse(cluster.weights as string) as number[];
  const pk = JSON.parse(cluster.pk as string) as Record<string, number>;
  const updatedAt = new Date(Number(cluster.updated_at)).toLocaleTimeString();

  lines.push(`  Detected models: \x1b[33m${k}\x1b[0m  [updated ${updatedAt}]`);
  lines.push(`  Confidence: ${pkLine(pk)}`);
  lines.push("  Traffic distribution:");
  weights.forEach((w, i) => {
    lines.push(`    Model-${i + 1}  ${bar(w)}  ${(w * 100).toFixed(1)}%`);
  });

  if (histRow.rows.length > 1) {
    lines.push("  Recent history (k detected):");
    for (const row of histRow.rows) {
      const t = new Date(Number(row.ts)).toLocaleTimeString();
      lines.push(`    ${t}  k=${row.k}`);
    }
  }

  return lines;
}

async function render() {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("\x1b[1maudit-cc-tail\x1b[0m — Claude model fingerprint dashboard\n");
  process.stdout.write(`${new Date().toLocaleString()}\n\n`);

  for (const family of FAMILIES) {
    try {
      const lines = await renderFamily(family);
      process.stdout.write(lines.join("\n") + "\n\n");
    } catch (e) {
      process.stdout.write(`${family}: error — ${(e as Error).message}\n\n`);
    }
  }

  process.stdout.write("refresh every 5s  |  Ctrl+C to exit\n");
}

await render();
setInterval(render, REFRESH_MS);

process.on("SIGINT", () => {
  process.stdout.write("\x1b[?25h\n");
  process.exit(0);
});
