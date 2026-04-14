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
    .map(([k, v]) => {
      const pct = (v * 100).toFixed(0);
      const star = v >= 0.5 ? " ◀" : "";
      return `P(k=${k})=${pct}%${star}`;
    })
    .join("  ");
}

function sparkline(values: number[]): string {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const chars = "▁▂▃▄▅▆▇█";
  return values.map((v) => chars[Math.floor(((v - min) / range) * (chars.length - 1))]).join("");
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function pct(a: number, b: number): string {
  return b === 0 ? "0%" : `${((a / b) * 100).toFixed(1)}%`;
}

type Row = Record<string, unknown>;

async function renderFamily(family: string): Promise<string[]> {
  const [
    clusterRow,
    countRow,
    usableRow,
    histRow,
    tokenRow,
    stopRow,
    cacheRow,
    modelRow,
    dailyRow,
    recentRow,
  ] = await Promise.all([
    db.execute("SELECT k, weights, pk, updated_at FROM clusters WHERE family = ?", [family]),
    db.execute("SELECT COUNT(*) as n FROM responses WHERE family = ?", [family]),
    db.execute(
      "SELECT COUNT(*) as n FROM responses WHERE family = ? AND output_tokens > 10 AND text_len > 30",
      [family]
    ),
    db.execute(
      "SELECT k, pk, ts FROM cluster_history WHERE family = ? ORDER BY ts DESC LIMIT 20",
      [family]
    ),
    db.execute(
      `SELECT
         SUM(output_tokens) as total_out,
         SUM(input_tokens) as total_in,
         SUM(cache_read_tokens) as total_cache_read,
         SUM(cache_create_tokens) as total_cache_create,
         AVG(output_tokens) as avg_out,
         AVG(input_tokens) as avg_in,
         MAX(output_tokens) as max_out,
         MIN(ts) as first_ts,
         MAX(ts) as last_ts
       FROM responses WHERE family = ?`,
      [family]
    ),
    db.execute(
      `SELECT stop_reason, COUNT(*) as n FROM responses WHERE family = ? GROUP BY stop_reason ORDER BY n DESC`,
      [family]
    ),
    db.execute(
      `SELECT
         AVG(CAST(cache_read_tokens AS FLOAT) / NULLIF(input_tokens + cache_read_tokens, 0)) as cache_hit_rate,
         AVG(CAST(cache_create_tokens AS FLOAT) / NULLIF(output_tokens, 0)) as cache_create_rate
       FROM responses WHERE family = ? AND input_tokens > 0`,
      [family]
    ),
    db.execute(
      `SELECT model_str, COUNT(*) as n, AVG(output_tokens) as avg_out, MIN(ts) as first_seen, MAX(ts) as last_seen
       FROM responses WHERE family = ?
       GROUP BY model_str ORDER BY first_seen ASC`,
      [family]
    ),
    db.execute(
      `SELECT date(ts/1000, 'unixepoch') as day, COUNT(*) as n, SUM(output_tokens) as tokens
       FROM responses WHERE family = ?
       GROUP BY day ORDER BY day DESC LIMIT 14`,
      [family]
    ),
    db.execute(
      `SELECT ts, model_str, output_tokens FROM responses WHERE family = ?
       ORDER BY ts DESC LIMIT 5`,
      [family]
    ),
  ]);

  const total = Number(countRow.rows[0]?.n ?? 0);
  const usable = Number(usableRow.rows[0]?.n ?? 0);
  const lines: string[] = [];

  lines.push(`\x1b[1m\x1b[36m${"═".repeat(60)}\x1b[0m`);
  lines.push(`\x1b[1m\x1b[36m${family.toUpperCase()}\x1b[0m  \x1b[1m${fmtNum(total)}\x1b[0m responses  (${fmtNum(usable)} clusterable)`);
  lines.push(`\x1b[1m\x1b[36m${"═".repeat(60)}\x1b[0m`);

  // ── Token analytics ──────────────────────────────────────────
  const tok = tokenRow.rows[0] as Row;
  if (tok && total > 0) {
    const totalOut = Number(tok.total_out ?? 0);
    const totalIn = Number(tok.total_in ?? 0);
    const totalCR = Number(tok.total_cache_read ?? 0);
    const totalCC = Number(tok.total_cache_create ?? 0);
    const avgOut = Number(tok.avg_out ?? 0);
    const avgIn = Number(tok.avg_in ?? 0);
    const maxOut = Number(tok.max_out ?? 0);
    const firstTs = Number(tok.first_ts ?? 0);
    const lastTs = Number(tok.last_ts ?? 0);
    const spanDays = firstTs && lastTs ? ((lastTs - firstTs) / 86400000).toFixed(1) : "?";
    const cacheHit = cacheRow.rows[0] ? Number((cacheRow.rows[0] as Row).cache_hit_rate ?? 0) : 0;

    lines.push(`\x1b[33m  Tokens\x1b[0m`);
    lines.push(`    output: ${fmtNum(totalOut)} total  avg ${avgOut.toFixed(0)}/req  max ${fmtNum(maxOut)}`);
    lines.push(`    input:  ${fmtNum(totalIn)} total  avg ${avgIn.toFixed(0)}/req`);
    lines.push(`    cache read: ${fmtNum(totalCR)}  (${pct(totalCR, totalIn + totalCR)} hit rate)`);
    lines.push(`    cache create: ${fmtNum(totalCC)}`);
    lines.push(`    cache efficiency: ${bar(cacheHit, 20)}  ${(cacheHit * 100).toFixed(1)}%`);
    lines.push(`    span: ${spanDays} days  (${firstTs ? new Date(firstTs).toLocaleDateString() : "?"} → ${lastTs ? new Date(lastTs).toLocaleDateString() : "?"})`);
  }

  // ── Stop reason breakdown ─────────────────────────────────────
  if (stopRow.rows.length) {
    lines.push(`\x1b[33m  Stop reasons\x1b[0m`);
    for (const row of stopRow.rows as Row[]) {
      const n = Number(row.n ?? 0);
      const label = String(row.stop_reason ?? "null").padEnd(16);
      lines.push(`    ${label} ${bar(n / total, 16)}  ${fmtNum(n)}  (${pct(n, total)})`);
    }
  }

  // ── Model version progression ─────────────────────────────────
  if (modelRow.rows.length) {
    lines.push(`\x1b[33m  Model versions observed\x1b[0m`);
    const models = modelRow.rows as Row[];
    for (const m of models) {
      const n = Number(m.n ?? 0);
      const avgOut = Number(m.avg_out ?? 0);
      const firstSeen = m.first_seen ? new Date(Number(m.first_seen)).toLocaleDateString() : "?";
      const lastSeen = m.last_seen ? new Date(Number(m.last_seen)).toLocaleDateString() : "?";
      const active = String(m.last_seen) === String((tokenRow.rows[0] as Row)?.last_ts) ? " \x1b[32m●\x1b[0m" : "";
      lines.push(`    \x1b[36m${String(m.model_str)}\x1b[0m${active}`);
      lines.push(`      ${fmtNum(n)} reqs  avg ${avgOut.toFixed(0)} out-tok  ${firstSeen} → ${lastSeen}`);
    }
  }

  // ── Daily activity (last 14 days) ─────────────────────────────
  if (dailyRow.rows.length >= 3) {
    const days = (dailyRow.rows as Row[]).slice().reverse();
    const counts = days.map((d) => Number(d.n ?? 0));
    const tokens = days.map((d) => Number(d.tokens ?? 0));
    lines.push(`\x1b[33m  Daily activity (last ${days.length}d)\x1b[0m`);
    lines.push(`    requests: ${sparkline(counts)}  peak ${fmtNum(Math.max(...counts))}/day`);
    lines.push(`    tokens:   ${sparkline(tokens)}  peak ${fmtNum(Math.max(...tokens))}/day`);
  }

  // ── Clustering ────────────────────────────────────────────────
  if (!clusterRow.rows.length) {
    lines.push(`\x1b[33m  Clustering\x1b[0m`);
    lines.push("    (no cluster data yet — run: bun run src/index.ts cluster)");
    return lines;
  }

  const cluster = clusterRow.rows[0] as Row;
  const k = Number(cluster.k);
  const weights = JSON.parse(cluster.weights as string) as number[];
  const pk = JSON.parse(cluster.pk as string) as Record<string, number>;
  const updatedAt = new Date(Number(cluster.updated_at)).toLocaleTimeString();

  lines.push(`\x1b[33m  Clustering\x1b[0m`);
  lines.push(`    behavioral variants: \x1b[33m${k}\x1b[0m  [updated ${updatedAt}]`);
  lines.push(`    seed agreement: ${pkLine(pk)}`);
  lines.push(`    variant traffic shares:`);
  weights.forEach((w, i) => {
    lines.push(`      Variant-${i + 1}  ${bar(w)}  ${(w * 100).toFixed(1)}%`);
  });

  // ── k history with sparkline ──────────────────────────────────
  if (histRow.rows.length > 1) {
    const histRows = (histRow.rows as Row[]).slice().reverse();
    const kVals = histRows.map((r) => Number(r.k));
    const kSeq = kVals.join(" → ");
    const dates = histRows.map((r) => new Date(Number(r.ts)).toLocaleDateString());
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    lines.push(`    k history (${histRow.rows.length} snapshots, ${firstDate} → ${lastDate}):`);
    lines.push(`      ${sparkline(kVals)}  ${kSeq}`);

    // Show pk confidence trend for last 5
    const recent5 = histRows.slice(-5);
    if (recent5.length >= 2) {
      lines.push(`    recent confidence snapshots:`);
      for (const r of recent5) {
        const ts = new Date(Number(r.ts)).toLocaleString();
        const rpk = JSON.parse(r.pk as string) as Record<string, number>;
        lines.push(`      ${ts}  k=${r.k}  ${pkLine(rpk)}`);
      }
    }
  }

  return lines;
}

async function renderGlobal(): Promise<string[]> {
  const [totalRow, dailyRow] = await Promise.all([
    db.execute("SELECT COUNT(*) as n, SUM(output_tokens) as tokens FROM responses"),
    db.execute(
      `SELECT date(ts/1000, 'unixepoch') as day, COUNT(*) as n
       FROM responses GROUP BY day ORDER BY day DESC LIMIT 30`
    ),
  ]);

  const total = Number((totalRow.rows[0] as Row)?.n ?? 0);
  const totalTok = Number((totalRow.rows[0] as Row)?.tokens ?? 0);
  const lines: string[] = [];
  lines.push(`\x1b[1maudit-cc-tail\x1b[0m — Claude behavioral variant fingerprint`);
  lines.push(`${new Date().toLocaleString()}  |  ${fmtNum(total)} total responses  ${fmtNum(totalTok)} total output tokens`);

  if (dailyRow.rows.length >= 3) {
    const days = (dailyRow.rows as Row[]).slice().reverse();
    const counts = days.map((d) => Number(d.n ?? 0));
    lines.push(`activity (${days.length}d): ${sparkline(counts)}  peak ${fmtNum(Math.max(...counts))}/day`);
  }

  lines.push("");
  return lines;
}

async function render() {
  process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");

  const global = await renderGlobal();
  process.stdout.write(global.join("\n") + "\n");

  for (const family of FAMILIES) {
    try {
      const lines = await renderFamily(family);
      process.stdout.write(lines.join("\n") + "\n\n");
    } catch (e) {
      process.stdout.write(`${family}: error — ${(e as Error).message}\n\n`);
    }
  }

  process.stdout.write("\x1b[2mrefresh every 5s  |  Ctrl+C to exit\x1b[0m\n");
}

await render();
const timer = setInterval(render, REFRESH_MS);

process.on("SIGINT", () => {
  clearInterval(timer);
  process.stdout.write("\x1b[?25h\n");
  process.exit(0);
});
