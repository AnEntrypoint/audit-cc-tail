import { getDb } from "./db.ts";

const db = getDb();
type Row = Record<string, unknown>;

export type FamilyData = {
  family: string;
  total: number;
  usable: number;
  totalOut: number; totalIn: number; totalCR: number; totalCC: number;
  avgOut: number; avgIn: number; maxOut: number;
  firstTs: number; lastTs: number; cacheHitRate: number;
  stopReasons: { reason: string; n: number }[];
  models: { model: string; n: number; avgOut: number; firstSeen: number; lastSeen: number }[];
  daily: { day: string; n: number; tokens: number }[];
  cluster: { k: number; weights: number[]; pk: Record<string, number>; updatedAt: number } | null;
  clusterTool: { k: number; weights: number[]; pk: Record<string, number>; updatedAt: number } | null;
  kHistory: { ts: number; k: number; pk: Record<string, number> }[];
  kHistoryTool: { ts: number; k: number; pk: Record<string, number> }[];
  typeCounts: { type: string; n: number }[];
};

export type GlobalData = { total: number; totalTok: number; daily: { day: string; n: number }[] };

export async function fetchFamily(family: string): Promise<FamilyData> {
  const [clRow, countRow, usableRow, histRow, histToolRow, tokRow, stopRow, cacheRow, modelRow, dailyRow, clToolRow, typeRow] = await Promise.all([
    db.execute("SELECT k, weights, pk, updated_at FROM clusters WHERE family=?", [family]),
    db.execute("SELECT COUNT(*) as n FROM responses WHERE family=?", [family]),
    db.execute("SELECT COUNT(*) as n FROM responses WHERE family=? AND output_tokens>10 AND text_len>30", [family]),
    db.execute("SELECT k, pk, ts FROM cluster_history WHERE family=? ORDER BY ts DESC LIMIT 20", [family]),
    db.execute("SELECT k, pk, ts FROM cluster_history_tool WHERE family=? ORDER BY ts DESC LIMIT 20", [family]),
    db.execute(`SELECT SUM(output_tokens) as to_, SUM(input_tokens) as ti, SUM(cache_read_tokens) as tcr, SUM(cache_create_tokens) as tcc, AVG(output_tokens) as ao, AVG(input_tokens) as ai, MAX(output_tokens) as mo, MIN(ts) as ft, MAX(ts) as lt FROM responses WHERE family=?`, [family]),
    db.execute("SELECT stop_reason, COUNT(*) as n FROM responses WHERE family=? GROUP BY stop_reason ORDER BY n DESC", [family]),
    db.execute("SELECT AVG(CAST(cache_read_tokens AS FLOAT)/NULLIF(input_tokens+cache_read_tokens,0)) as chr FROM responses WHERE family=? AND input_tokens>0", [family]),
    db.execute("SELECT model_str, COUNT(*) as n, AVG(output_tokens) as ao, MIN(ts) as fs, MAX(ts) as ls FROM responses WHERE family=? GROUP BY model_str ORDER BY fs ASC", [family]),
    db.execute("SELECT date(ts/1000,'unixepoch') as day, COUNT(*) as n, SUM(output_tokens) as tokens FROM responses WHERE family=? GROUP BY day ORDER BY day DESC LIMIT 14", [family]),
    db.execute("SELECT k, weights, pk, updated_at FROM clusters_tool WHERE family=?", [family]),
    db.execute("SELECT response_type, COUNT(*) as n FROM responses WHERE family=? GROUP BY response_type", [family]),
  ]);

  const t = tokRow.rows[0] as Row ?? {};
  const cr = clRow.rows[0] as Row | undefined;
  const ct = clToolRow.rows[0] as Row | undefined;

  return {
    family,
    total: Number(countRow.rows[0]?.n ?? 0),
    usable: Number(usableRow.rows[0]?.n ?? 0),
    totalOut: Number(t.to_ ?? 0), totalIn: Number(t.ti ?? 0),
    totalCR: Number(t.tcr ?? 0), totalCC: Number(t.tcc ?? 0),
    avgOut: Number(t.ao ?? 0), avgIn: Number(t.ai ?? 0), maxOut: Number(t.mo ?? 0),
    firstTs: Number(t.ft ?? 0), lastTs: Number(t.lt ?? 0),
    cacheHitRate: Number((cacheRow.rows[0] as Row)?.chr ?? 0),
    stopReasons: (stopRow.rows as Row[]).map((r) => ({ reason: String(r.stop_reason ?? "null"), n: Number(r.n) })),
    models: (modelRow.rows as Row[]).map((r) => ({ model: String(r.model_str), n: Number(r.n), avgOut: Number(r.ao ?? 0), firstSeen: Number(r.fs), lastSeen: Number(r.ls) })),
    daily: (dailyRow.rows as Row[]).slice().reverse().map((r) => ({ day: String(r.day), n: Number(r.n), tokens: Number(r.tokens) })),
    cluster: cr ? { k: Number(cr.k), weights: JSON.parse(cr.weights as string), pk: JSON.parse(cr.pk as string), updatedAt: Number(cr.updated_at) } : null,
    clusterTool: ct ? { k: Number(ct.k), weights: JSON.parse(ct.weights as string), pk: JSON.parse(ct.pk as string), updatedAt: Number(ct.updated_at) } : null,
    kHistory: (histRow.rows as Row[]).slice().reverse().map((r) => ({ ts: Number(r.ts), k: Number(r.k), pk: JSON.parse(r.pk as string) })),
    kHistoryTool: (histToolRow.rows as Row[]).slice().reverse().map((r) => ({ ts: Number(r.ts), k: Number(r.k), pk: JSON.parse(r.pk as string) })),
    typeCounts: (typeRow.rows as Row[]).map((r) => ({ type: String(r.response_type), n: Number(r.n) })),
  };
}

export async function fetchGlobal(): Promise<GlobalData> {
  const [totRow, dailyRow] = await Promise.all([
    db.execute("SELECT COUNT(*) as n, SUM(output_tokens) as tok FROM responses"),
    db.execute("SELECT date(ts/1000,'unixepoch') as day, COUNT(*) as n FROM responses GROUP BY day ORDER BY day DESC LIMIT 30"),
  ]);
  return {
    total: Number((totRow.rows[0] as Row)?.n ?? 0),
    totalTok: Number((totRow.rows[0] as Row)?.tok ?? 0),
    daily: (dailyRow.rows as Row[]).slice().reverse().map((r) => ({ day: String(r.day), n: Number(r.n) })),
  };
}
