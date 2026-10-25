import { describe, expect, it } from "vitest";
import { buildCombos, suggestOutfitsLocal } from "../src/ai/local/outfits";
import { outfitKey } from "../src/domain/types";
import { g } from "./fixtures";

const closet = [
  g({ id: "t1", category: "tops", color: "white", subType: "シャツ", seasons: ["spring", "autumn"] }),
  g({ id: "t2", category: "tops", color: "black", subType: "Tシャツ", seasons: ["summer"], warmth: 1 }),
  g({ id: "t3", category: "tops", color: "red", subType: "ニット", seasons: ["winter"], warmth: 3 }),
  g({ id: "b1", category: "bottoms", color: "navy", subType: "ワイドパンツ", formality: "smart" }),
  g({ id: "b2", category: "bottoms", color: "blue", subType: "デニム" }),
  g({ id: "o1", category: "outer", color: "beige", subType: "コート", seasons: ["winter"], warmth: 3 }),
  g({ id: "s1", category: "shoes", color: "white", subType: "スニーカー" }),
];

describe("buildCombos", () => {
  it("トップス×ボトムス×靴の組み合わせを作る", () => {
    expect(buildCombos(closet, 22)).toHaveLength(3 * 2);
  });
  it("寒い日はアウターを必ず入れる", () => {
    expect(buildCombos(closet, 5).every((c) => c.items.some((x) => x.category === "outer"))).toBe(true);
  });
});

describe("suggestOutfitsLocal", () => {
  it("最大3案で、使いたい服が必ず入る", () => {
    const res = suggestOutfitsLocal(closet, { mustInclude: ["t3"], purpose: "everyday", temperatureC: 5 }, []);
    expect(res.length).toBeGreaterThan(0);
    expect(res.length).toBeLessThanOrEqual(3);
    expect(res.every((o) => o.garmentIds.includes("t3"))).toBe(true);
    expect(res.every((o) => o.explanation.length > 0)).toBe(true);
  });

  it("「ほかの案」では、もう見せた組み合わせを出さない", () => {
    const first = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 22 }, []);
    const shown = first.map((o) => o.key);
    const next = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 22, exclude: shown }, []);
    expect(next.length).toBeGreaterThan(0);
    expect(next.some((o) => shown.includes(o.key))).toBe(false);
  });

  it("夏は夏服を上位にする", () => {
    const [first] = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 30 }, []);
    expect(first.garmentIds).toContain("t2");
  });

  it("好みじゃないと評価した組み合わせは出さない", () => {
    const before = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday" }, []);
    const disliked = before[0];
    const after = suggestOutfitsLocal(
      closet,
      { mustInclude: [], purpose: "everyday" },
      [{ outfitKey: disliked.key, garmentIds: disliked.garmentIds, liked: false, at: 0 }],
    );
    expect(after.map((o) => o.key)).not.toContain(disliked.key);
  });

  it("好きと評価した組み合わせは順位が上がる", () => {
    const all = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 22 }, []);
    const last = all[all.length - 1];
    const fb = [{ outfitKey: last.key, garmentIds: last.garmentIds, liked: true, at: 0 }];
    const again = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 22 }, fb);
    expect(again.findIndex((o) => o.key === last.key)).toBeLessThanOrEqual(all.findIndex((o) => o.key === last.key));
  });

  it("3案はなるべく違う服を使う", () => {
    const res = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 22 }, []);
    expect(new Set(res.map((o) => outfitKey(o.garmentIds))).size).toBe(res.length);
    const tops = res.map((o) => o.garmentIds.find((id) => id.startsWith("t")));
    expect(new Set(tops).size).toBeGreaterThan(1);
  });

  it("組み合わせが作れないときは空", () => {
    expect(suggestOutfitsLocal([closet[0]], { mustInclude: [], purpose: "everyday" }, [])).toEqual([]);
  });
});
