import { ansi, clr, box, mergeColumns, pad, statusBar, header, enableKeypress, termSize } from "./tui.ts";
import { fetchFamily, fetchGlobal, type FamilyData } from "./dashboard-data.ts";

const FAMILIES = ["haiku", "sonnet", "opus"];
const REFRESH_MS = 5000;

const state = { focus: 0, scrolls: [0, 0, 0], lastRender: 0, running: true };

function fmtNum(n: number) { return n.toLocaleString(); }
function pct(a: number, b: number) { return b === 0 ? "0%" : `${((a / b) * 100).toFixed(1)}%`; }
function sparkline(vals: number[]) {
  if (!vals.length) return "";
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const chars = "▁▂▃▄▅▆▇█";
  return vals.map((v) => chars[Math.floor(((v - min) / range) * (chars.length - 1))]).join("");
}
function bar(v: number, w = 18) { const f = Math.round(v * w); return "█".repeat(f) + "░".repeat(w - f); }
function pkLine(pk: Record<string, number>) {
  return Object.entries(pk).sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `P(k=${k})=${(v * 100).toFixed(0)}%${v >= 0.5 ? "◀" : ""}`).join("  ");
}

function renderFamily(d: FamilyData, colWidth: number): string[] {
  const inner = colWidth - 2;
  const lines: string[] = [];

  lines.push(`${clr.bold}${fmtNum(d.total)}${clr.reset} responses  ${clr.dim}(${fmtNum(d.usable)} clusterable)${clr.reset}`);

  const typeMap = Object.fromEntries(d.typeCounts.map((t) => [t.type, t.n]));
  lines.push(`${clr.dim}text:${clr.reset}${fmtNum(typeMap.text ?? 0)}  ${clr.dim}tool_use:${clr.reset}${fmtNum(typeMap.tool_use ?? 0)}  ${clr.dim}mixed:${clr.reset}${fmtNum(typeMap.mixed ?? 0)}`);
  lines.push("");

  lines.push(`${clr.yellow}Tokens${clr.reset}`);
  lines.push(` out ${fmtNum(d.totalOut)}  avg ${d.avgOut.toFixed(0)}  max ${fmtNum(d.maxOut)}`);
  lines.push(` in  ${fmtNum(d.totalIn)}  avg ${d.avgIn.toFixed(0)}`);
  lines.push(` cache read:   ${fmtNum(d.totalCR)}  ${pct(d.totalCR, d.totalIn + d.totalCR)}`);
  lines.push(` cache create: ${fmtNum(d.totalCC)}`);
  lines.push(` ${bar(d.cacheHitRate)}  ${(d.cacheHitRate * 100).toFixed(1)}% cache hit`);
  const span = d.firstTs && d.lastTs ? ((d.lastTs - d.firstTs) / 86400000).toFixed(1) : "?";
  lines.push(` ${span}d span  ${d.firstTs ? new Date(d.firstTs).toLocaleDateString() : "?"} → ${d.lastTs ? new Date(d.lastTs).toLocaleDateString() : "?"}`);
  lines.push("");

  if (d.stopReasons.length) {
    lines.push(`${clr.yellow}Stop reasons${clr.reset}`);
    for (const s of d.stopReasons) {
      lines.push(` ${s.reason.padEnd(14)} ${bar(s.n / Math.max(d.total, 1), 12)}  ${fmtNum(s.n)} ${pct(s.n, d.total)}`);
    }
    lines.push("");
  }

  if (d.models.length) {
    lines.push(`${clr.yellow}Model versions${clr.reset}`);
    for (const m of d.models) {
      const active = m.lastSeen === d.lastTs ? ` ${clr.green}●${clr.reset}` : "";
      lines.push(` ${clr.cyan}${m.model}${clr.reset}${active}`);
      lines.push(`   ${fmtNum(m.n)} reqs  avg ${m.avgOut.toFixed(0)} tok  ${new Date(m.firstSeen).toLocaleDateString()} → ${new Date(m.lastSeen).toLocaleDateString()}`);
    }
    lines.push("");
  }

  if (d.daily.length >= 3) {
    lines.push(`${clr.yellow}Daily activity (${d.daily.length}d)${clr.reset}`);
    lines.push(` req: ${sparkline(d.daily.map((x) => x.n))}  peak ${fmtNum(Math.max(...d.daily.map((x) => x.n)))}`);
    lines.push(` tok: ${sparkline(d.daily.map((x) => x.tokens))}  peak ${fmtNum(Math.max(...d.daily.map((x) => x.tokens)))}`);
    lines.push("");
  }

  const renderClusterSection = (label: string, cl: FamilyData["cluster"], hist: FamilyData["kHistory"]) => {
    if (!cl) { lines.push(`${clr.yellow}${label}${clr.reset}`); lines.push(" (no data yet)"); lines.push(""); return; }
    lines.push(`${clr.yellow}${label}${clr.reset}  k=${clr.bold}${cl.k}${clr.reset}  [${new Date(cl.updatedAt).toLocaleTimeString()}]`);
    lines.push(` ${pkLine(cl.pk)}`);
    for (let i = 0; i < cl.weights.length; i++) {
      lines.push(` V${i + 1} ${bar(cl.weights[i])}  ${(cl.weights[i] * 100).toFixed(1)}%`);
    }
    if (hist.length > 1) {
      const kVals = hist.map((h) => h.k);
      lines.push(` k: ${sparkline(kVals)}  ${kVals.join("→")}`);
      const last3 = hist.slice(-3);
      for (const h of last3) {
        lines.push(`  ${clr.dim}${new Date(h.ts).toLocaleString()}${clr.reset} k=${h.k} ${pkLine(h.pk)}`);
      }
    }
    lines.push("");
  };

  renderClusterSection("Text clusters", d.cluster, d.kHistory);
  renderClusterSection("Tool clusters", d.clusterTool, d.kHistoryTool);

  return lines.map((l) => " " + l);
}

async function render() {
  const { cols, rows } = termSize();
  const GAP = 1;
  const colWidth = Math.max(40, Math.floor((cols - GAP * (FAMILIES.length - 1)) / FAMILIES.length));
  const bodyRows = rows - 3;

  const [global, ...familyData] = await Promise.all([
    fetchGlobal(),
    ...FAMILIES.map((f) => fetchFamily(f).catch(() => null)),
  ]);

  const buf: string[] = [];
  const now = new Date().toLocaleString();
  const dailySpark = global.daily.length >= 3 ? sparkline(global.daily.map((d) => d.n)) : "";
  buf.push(header(`audit-cc-tail  ${now}  |  ${fmtNum(global.total)} responses  ${fmtNum(global.totalTok)} out-tokens  ${dailySpark}`, cols));

  const cols3 = FAMILIES.map((f, i) => {
    const d = familyData[i];
    const lines = d ? renderFamily(d, colWidth) : [" (loading…)"];
    const offset = state.scrolls[i];
    const visible = lines.slice(offset, offset + bodyRows);
    const scrollIndicator = offset > 0 ? ` ${clr.dim}↑${offset}${clr.reset}` : "";
    return box(visible, colWidth, f.toUpperCase() + scrollIndicator, state.focus === i);
  });

  const merged = mergeColumns(cols3, colWidth);
  buf.push(...merged.slice(0, bodyRows + 2));

  const focusedData = familyData[state.focus];
  const totalLines = focusedData ? renderFamily(focusedData, colWidth).length : 0;
  buf.push(statusBar(` [tab] switch panel  [j/k] scroll  [q] quit  |  focused: ${FAMILIES[state.focus].toUpperCase()}  scroll: ${state.scrolls[state.focus]}/${Math.max(0, totalLines - bodyRows)}  |  refresh in ${Math.ceil((REFRESH_MS - (Date.now() - state.lastRender)) / 1000)}s`, cols));

  process.stdout.write(ansi.moveTo(1, 1));
  process.stdout.write(buf.join("\n") + "\n");
  state.lastRender = Date.now();
}

async function fullRender() {
  ansi.clear();
  ansi.hideCursor();
  await render();
}

const cleanup = enableKeypress((_, key) => {
  if (!key) return;
  const { name, ctrl } = key as { name: string; ctrl: boolean };
  if (ctrl && name === "c") { cleanup(); process.stdout.write(ansi.showCursor()); process.exit(0); }
  if (name === "q") { cleanup(); process.stdout.write(ansi.showCursor()); process.exit(0); }
  if (name === "tab") { state.focus = (state.focus + 1) % FAMILIES.length; render(); }
  if (name === "j" || name === "down") { state.scrolls[state.focus]++; render(); }
  if (name === "k" || name === "up") { state.scrolls[state.focus] = Math.max(0, state.scrolls[state.focus] - 1); render(); }
  if (name === "g") { state.scrolls[state.focus] = 0; render(); }
});

process.on("SIGWINCH", () => fullRender());
process.on("SIGINT", () => { cleanup(); process.stdout.write(ansi.showCursor()); process.exit(0); });

await fullRender();
const timer = setInterval(render, REFRESH_MS);

process.on("exit", () => { clearInterval(timer); process.stdout.write(ansi.showCursor()); });
