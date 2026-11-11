import { describe, expect, it } from "vitest";
import { suggestPurchasesLocal } from "../src/ai/local/purchases";
import { outfitGainLabel } from "../src/shop/labels";
import { g } from "./fixtures";

const closet = [
  g({ id: "t1", category: "tops", color: "white", subType: "Tシャツ" }),
  g({ id: "t2", category: "tops", color: "navy", subType: "シャツ", formality: "smart" }),
  g({ id: "b1", category: "bottoms", color: "blue", subType: "デニム" }),
];

describe("suggestPurchasesLocal", () => {
  it("コーデが増える服を最大5つ出し、検索語を付ける", () => {
    const res = suggestPurchasesLocal(closet, { avoidColors: [] }, []);
    expect(res.length).toBeGreaterThan(0);
    expect(res.length).toBeLessThanOrEqual(5);
    for (const s of res) {
      expect(s.newOutfitCount).toBeGreaterThan(0);
      expect(s.searchQuery).toContain(s.subType);
    }
  });
  it("避けたい色は出さない", () => {
    const res = suggestPurchasesLocal(closet, { avoidColors: ["black", "beige"] }, []);
    expect(res.some((s) => s.color === "black" || s.color === "beige")).toBe(false);
  });
  it("手持ちと同じ服は出さない", () => {
    const res = suggestPurchasesLocal(closet, { avoidColors: [] }, []);
    expect(res.some((s) => s.subType === "デニム" && s.color === "blue")).toBe(false);
  });
  it("同じ種類ばかりにならず、手持ちが少ないボトムスも入る", () => {
    const res = suggestPurchasesLocal(closet, { avoidColors: [] }, []);
    const kinds = res.slice(0, 3).map((s) => `${s.category}:${s.subType}`);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(res.some((s) => s.category === "bottoms")).toBe(true);
  });
  it("説明文には数を書かない（増えるコーデの数・合わせられる服の数は画面で別に出す）", () => {
    const res = suggestPurchasesLocal(closet, { avoidColors: [] }, []);
    for (const s of res) expect(s.reason).not.toMatch(/[0-9０-９]/);
    // 持っていない種類は、そのことを伝える
    const outer = res.find((s) => s.category === "outer");
    if (outer) expect(outer.reason).toContain("まだ持っていないアウター");
    const tops = res.find((s) => s.category === "tops");
    if (tops) expect(tops.reason).toMatch(/^手持ちの.+と合わせやすい色です。$/);
  });
});

describe("outfitGainLabel", () => {
  it("増えるコーデの数を「+14通り」と出し、100以上はまるめる", () => {
    expect(outfitGainLabel(14)).toBe("+14通り");
    expect(outfitGainLabel(591)).toBe("+100通り以上");
  });
});
