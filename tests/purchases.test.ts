import { describe, expect, it } from "vitest";
import { suggestPurchasesLocal } from "../src/ai/local/purchases";
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
});
