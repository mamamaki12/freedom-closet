import { describe, expect, it } from "vitest";
import { summarize, toCsv, type AnalysisRecord } from "../src/storage/analysisLog";

const rec = (p: Partial<AnalysisRecord["predicted"]>, f: Partial<AnalysisRecord["final"]>, extra: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
  id: Math.random().toString(),
  at: 0,
  provider: "local",
  elapsedMs: 1000,
  predicted: { category: "tops", subType: "シャツ", color: "white", confidence: 0.8, ...p },
  final: { category: "tops", subType: "シャツ", color: "white", ...f },
  ...extra,
});

describe("summarize", () => {
  it("AIごとに正解率と時間の中央値を出す", () => {
    const [s] = summarize([
      rec({}, {}),
      rec({ color: "gray" }, {}, { elapsedMs: 3000 }),
      rec({ category: null, subType: null }, {}, { elapsedMs: 2000 }),
      rec({ category: "outer", subType: "ジャケット" }, {}),
    ]);
    expect(s.total).toBe(4);
    expect(s.categoryRate).toBe(0.5);
    expect(s.colorRate).toBe(0.75);
    expect(s.failed).toBe(1);
    expect(s.medianMs).toBe(2000);
  });
  it("端末内とClaudeを分けて数える", () => {
    expect(summarize([rec({}, {}), rec({}, {}, { provider: "claude" })]).map((s) => s.provider)).toEqual(["local", "claude"]);
  });
});

describe("toCsv", () => {
  it("見出しと1行ずつ。カンマを含む値はくくる", () => {
    const csv = toCsv([rec({ subType: "シャツ,長袖" }, {})]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"シャツ,長袖"');
  });
});
