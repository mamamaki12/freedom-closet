import { describe, expect, it } from "vitest";
import type { Garment } from "../src/domain/types";
import { dayKey, daysAgoLabel, idleGarments, lastWornMap, recentWears, wearSummaryLine } from "../src/domain/wear";

const now = new Date("2026-10-30T10:00:00");
const garment = (id: string, createdDaysAgo: number): Garment =>
  ({ id, category: "tops", subType: "", color: "black", seasons: [], formality: "casual", warmth: 2, photo: new Blob(), createdAt: now.getTime() - createdDaysAgo * 86_400_000 }) as Garment;

describe("着た記録", () => {
  it("dayKey は YYYY-MM-DD", () => {
    expect(dayKey(now)).toBe("2026-10-30");
  });
  it("recentWears は今日を除いて新しい順に最大3件", () => {
    const wears = ["2026-10-30", "2026-10-26", "2026-10-29", "2026-10-28", "2026-10-27"].map((day) => ({ day, garmentIds: [day], at: 0 }));
    expect(recentWears(wears, "2026-10-30").map((w) => w.day)).toEqual(["2026-10-29", "2026-10-28", "2026-10-27"]);
  });
  it("lastWornMap は服ごとの最後の日", () => {
    const m = lastWornMap([
      { day: "2026-10-01", garmentIds: ["a", "b"], at: 0 },
      { day: "2026-10-20", garmentIds: ["a"], at: 0 },
    ]);
    expect(m.get("a")).toBe("2026-10-20");
    expect(m.get("b")).toBe("2026-10-01");
  });
  it("しばらく着ていない服：記録がなければ空、あれば30日以上の服と、古くて記録のない服", () => {
    const garments = [garment("recent", 2), garment("old", 60), garment("worn-long-ago", 90), garment("worn-recently", 90)];
    expect(idleGarments(garments, [], now)).toEqual([]);
    const wears = [
      { day: "2026-08-01", garmentIds: ["worn-long-ago"], at: 0 },
      { day: "2026-10-25", garmentIds: ["worn-recently"], at: 0 },
    ];
    expect(idleGarments(garments, wears, now).map((g) => g.id)).toEqual(["old", "worn-long-ago"]);
  });
  it("しばらく着ていない服は、着ていない期間の長い順（記録なし→最後に着た日の古い順）", () => {
    const garments = [
      garment("worn-60", 200),
      garment("never-40", 40),
      garment("worn-120", 200),
      garment("never-90", 90),
      garment("worn-recently", 200),
    ];
    const wears = [
      { day: "2026-08-31", garmentIds: ["worn-60"], at: 0 },
      { day: "2026-07-02", garmentIds: ["worn-120"], at: 0 },
      { day: "2026-10-29", garmentIds: ["worn-recently"], at: 0 },
    ];
    expect(idleGarments(garments, wears, now).map((g) => g.id)).toEqual(["never-90", "never-40", "worn-120", "worn-60"]);
  });
  it("daysAgoLabel", () => {
    expect(daysAgoLabel("2026-10-30", now)).toBe("今日");
    expect(daysAgoLabel("2026-10-29", now)).toBe("昨日");
    expect(daysAgoLabel("2026-10-20", now)).toBe("10日前");
    expect(daysAgoLabel("2026-07-20", now)).toBe("3か月前");
  });
});

describe("服の詳細の着た記録", () => {
  it("最後に着た日と回数を1行で出す", () => {
    const wears = [
      { day: "2026-10-27", garmentIds: ["a", "b"], at: 0 },
      { day: "2026-10-20", garmentIds: ["a"], at: 0 },
      { day: "2026-10-29", garmentIds: ["b"], at: 0 },
    ];
    expect(wearSummaryLine("a", wears, now)).toBe("3日前に着た・2回");
    expect(wearSummaryLine("b", wears, now)).toBe("昨日に着た・2回");
  });
  it("記録が無ければ「まだ記録なし」", () => {
    expect(wearSummaryLine("x", [{ day: "2026-10-27", garmentIds: ["a"], at: 0 }], now)).toBe("まだ記録なし");
    expect(wearSummaryLine("x", [], now)).toBe("まだ記録なし");
  });
});
