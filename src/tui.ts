import { createInterface } from "readline";

const E = "\x1b[";
export const clr = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m", yellow: "\x1b[33m", green: "\x1b[32m", red: "\x1b[31m", white: "\x1b[37m", bgBlue: "\x1b[44m", bgDark: "\x1b[48;5;234m" };

export const ansi = {
  clear: () => process.stdout.write("\x1b[2J\x1b[H"),
  hideCursor: () => process.stdout.write("\x1b[?25l"),
  showCursor: () => process.stdout.write("\x1b[?25h"),
  moveTo: (r: number, c: number) => `${E}${r};${c}H`,
  clearLine: () => `${E}2K`,
};

export function termSize(): { cols: number; rows: number } {
  return { cols: process.stdout.columns ?? 180, rows: process.stdout.rows ?? 40 };
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function truncate(line: string, maxWidth: number): string {
  let visible = 0, i = 0, result = "";
  while (i < line.length) {
    if (line[i] === "\x1b") {
      const end = line.indexOf("m", i);
      if (end !== -1) { result += line.slice(i, end + 1); i = end + 1; continue; }
    }
    if (visible >= maxWidth) break;
    result += line[i++]; visible++;
  }
  return result + clr.reset;
}

export function pad(line: string, width: number): string {
  const vis = stripAnsi(line).length;
  return line + " ".repeat(Math.max(0, width - vis));
}

export function box(lines: string[], width: number, title = "", focused = false): string[] {
  const inner = width - 2;
  const borderColor = focused ? clr.cyan : clr.dim;
  const titleStr = title ? ` ${clr.bold}${clr.cyan}${title}${clr.reset}${borderColor} ` : "";
  const titleLen = title ? title.length + 3 : 0;
  const topLine = "─".repeat(Math.max(0, inner - titleLen));
  const top = `${borderColor}┌${titleStr}${topLine}┐${clr.reset}`;
  const bot = `${borderColor}└${"─".repeat(inner)}┘${clr.reset}`;
  const body = lines.map((l) => {
    const truncated = truncate(l, inner);
    return `${borderColor}│${clr.reset}${pad(truncated, inner)}${borderColor}│${clr.reset}`;
  });
  return [top, ...body, bot];
}

export function mergeColumns(cols: string[][], colWidth: number): string[] {
  const maxRows = Math.max(...cols.map((c) => c.length));
  const out: string[] = [];
  for (let r = 0; r < maxRows; r++) {
    const parts = cols.map((c) => {
      const line = c[r] ?? "";
      return pad(line, colWidth);
    });
    out.push(parts.join(" "));
  }
  return out;
}

export type KeyHandler = (str: string, key: { name: string; ctrl: boolean; shift: boolean }) => void;

export function enableKeypress(handler: KeyHandler): () => void {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return () => {};
  const rl = createInterface({ input: process.stdin });
  (createInterface as unknown as { emitKeypressEvents?: (s: NodeJS.ReadStream) => void }).emitKeypressEvents?.(process.stdin);
  try { (process.stdin as NodeJS.ReadStream & { setRawMode?: (b: boolean) => void }).setRawMode?.(true); } catch (_) {}
  process.stdin.on("keypress", handler as (...args: unknown[]) => void);
  return () => {
    try { (process.stdin as NodeJS.ReadStream & { setRawMode?: (b: boolean) => void }).setRawMode?.(false); } catch (_) {}
    process.stdin.removeListener("keypress", handler as (...args: unknown[]) => void);
    rl.close();
  };
}

export function statusBar(text: string, width: number): string {
  const padded = pad(text, width);
  return `${clr.bgDark}${clr.white}${padded}${clr.reset}`;
}

export function header(text: string, width: number): string {
  return `${clr.bgBlue}${clr.bold}${clr.white}${pad(" " + text, width)}${clr.reset}`;
}
