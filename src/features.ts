const STOP_CODES: Record<string, number> = {
  end_turn: 0,
  tool_use: 1,
  max_tokens: 2,
  stop_sequence: 3,
};

export function extractVec(
  text: string,
  outputTokens: number,
  _inputTokens: number,
  _cacheReadTokens: number,
  _cacheCreateTokens: number,
  stopReason: string | null
): number[] {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const chars = text.length;
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
  const punctCount = (text.match(/[.,;:!?'"()\[\]{}\-]/g) ?? []).length;
  const markdownCount = (text.match(/[*#`_~>|]/g) ?? []).length;
  const avgWordLen =
    words.reduce((s, w) => s + w.length, 0) / Math.max(words.length, 1);
  const sentLens = sentences.map(
    (s) => s.split(/\s+/).filter(Boolean).length
  );
  const meanSentLen =
    sentLens.reduce((s, v) => s + v, 0) / Math.max(sentLens.length, 1);
  const sentLenVar =
    sentLens.reduce((s, v) => s + (v - meanSentLen) ** 2, 0) /
    Math.max(sentLens.length, 1);
  const stopCode = STOP_CODES[stopReason ?? ""] ?? -1;

  return [
    Math.log1p(outputTokens),
    Math.log1p(chars),
    avgWordLen,
    chars > 0 ? punctCount / chars : 0,
    chars > 0 ? markdownCount / chars : 0,
    uniqueWords.size / Math.max(words.length, 1),
    Math.log1p(sentLenVar),
    stopCode,
  ];
}

export function familyOf(modelStr: string): string | null {
  if (modelStr.includes("haiku")) return "haiku";
  if (modelStr.includes("sonnet")) return "sonnet";
  if (modelStr.includes("opus")) return "opus";
  return null;
}
