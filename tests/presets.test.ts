import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/domain/types";
import { PRESETS, applyPreset, presetFor } from "../src/domain/presets";

describe("presetFor", () => {
  it("名前が同じものを返す", () => {
    expect(presetFor("ニット")?.warmth).toBe(3);
  });
  it("前後に言葉が付いていても拾い、長い名前を優先する", () => {
    expect(presetFor("白シャツ")?.subType).toBe("シャツ");
    expect(presetFor("デニムジャケット")?.category).toBe("outer");
    expect(presetFor("ブルーデニム")?.category).toBe("bottoms");
  });
  it("カテゴリで絞れる", () => {
    expect(presetFor("デニム", "outer")).toBeUndefined();
  });
  it("知らない名前や空なら undefined", () => {
    expect(presetFor("ポロ")).toBeUndefined();
    expect(presetFor(null)).toBeUndefined();
  });
});

describe("PRESETS", () => {
  it("どのカテゴリにも選べる種類がある", () => {
    for (const c of CATEGORIES) expect(PRESETS.some((p) => p.category === c)).toBe(true);
  });
  it("applyPreset は季節・雰囲気・厚さまで入れ、ほかの値は残す", () => {
    const p = presetFor("ダウン")!;
    const r = applyPreset({ color: "black" as const, note: "メモ" }, p);
    expect(r).toMatchObject({ category: "outer", subType: "ダウン", seasons: ["winter"], warmth: 3, color: "black", note: "メモ" });
  });
});
