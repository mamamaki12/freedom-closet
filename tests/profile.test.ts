import { describe, expect, it } from "vitest";
import { suggestOutfitsLocal } from "../src/ai/local/outfits";
import { garmentInfoSchema, outfitsRequestSchema } from "../src/ai/schemas";
import { bodyTips, recommendSize, sizeDiff, sizeGroup } from "../src/domain/profile";
import { g } from "./fixtures";

describe("sizeGroup", () => {
  it("アウターはトップスと同じサイズで見る", () => {
    expect(sizeGroup("outer")).toBe("tops");
    expect(sizeGroup("bottoms")).toBe("bottoms");
    expect(sizeGroup("shoes")).toBe("shoes");
  });
});

describe("recommendSize", () => {
  it("いつものサイズがあればそれを使う", () => {
    expect(recommendSize({ usualSize: { tops: "L" }, heightCm: 160, fit: "mens" }, "outer")).toEqual({ size: "L", basis: "usual" });
  });
  it("身長からサイズを出す", () => {
    expect(recommendSize({ heightCm: 172, fit: "mens" }, "tops")?.size).toBe("M");
    expect(recommendSize({ heightCm: 158, fit: "womens" }, "tops")?.size).toBe("S");
    expect(recommendSize({ heightCm: 195, fit: "mens" }, "tops")?.size).toBe("XXL");
  });
  it("体重が重めなら1つ大きく、軽めなら1つ小さく", () => {
    expect(recommendSize({ heightCm: 172, weightKg: 80, fit: "mens" }, "tops")?.size).toBe("L");
    expect(recommendSize({ heightCm: 172, weightKg: 52, fit: "mens" }, "tops")?.size).toBe("S");
  });
  it("メンズ・レディースが分からない、または靴なら出さない", () => {
    expect(recommendSize({ heightCm: 172 }, "tops")).toBeUndefined();
    expect(recommendSize({ heightCm: 172, fit: "mens" }, "shoes")).toBeUndefined();
  });
});

describe("sizeDiff", () => {
  it("いつものサイズとの差を出す", () => {
    const profile = { usualSize: { tops: "M" } };
    expect(sizeDiff(g({ category: "tops", color: "white", size: "XL" }), profile)).toBe(2);
    expect(sizeDiff(g({ category: "outer", color: "white", size: "s" }), profile)).toBe(-1);
    expect(sizeDiff(g({ category: "tops", color: "white", size: "F" }), profile)).toBeUndefined();
    expect(sizeDiff(g({ category: "bottoms", color: "white", size: "L" }), profile)).toBeUndefined();
  });
});

describe("bodyTips", () => {
  const top = g({ category: "tops", color: "white", subType: "シャツ", size: "L" });
  const wide = g({ category: "bottoms", color: "navy", subType: "ワイドパンツ" });
  it("背が低めならトップスの裾のひとこと", () => {
    expect(bodyTips([top, wide], { heightCm: 160, fit: "mens" })[0]).toMatch(/裾を前だけ/);
  });
  it("背が高めならワイドパンツが映える", () => {
    expect(bodyTips([top, wide], { heightCm: 183, fit: "mens" })[0]).toMatch(/ワイドパンツ/);
  });
  it("いつもより大きいサイズの服にひとこと", () => {
    expect(bodyTips([top, wide], { usualSize: { tops: "M" } })).toEqual([expect.stringMatching(/大きめ（L）/)]);
  });
  it("何も設定していなければ何も言わない", () => {
    expect(bodyTips([top, wide], {})).toEqual([]);
  });
});

describe("体型を使った提案", () => {
  it("ローカルのコーデ提案の説明に体型のひとことが入る", () => {
    const closet = [
      g({ id: "t1", category: "tops", color: "white", subType: "シャツ" }),
      g({ id: "b1", category: "bottoms", color: "navy", subType: "ワイドパンツ" }),
      g({ id: "s1", category: "shoes", color: "white", subType: "スニーカー" }),
    ];
    const [o] = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 20 }, [], { heightCm: 158, fit: "mens" });
    expect(o.explanation.join("")).toMatch(/脚が長く/);
  });
  it("サイズと体型は送ってもよい（なくてもよい）", () => {
    expect(garmentInfoSchema.safeParse({ ...g({ category: "tops", color: "white" }), size: "M" }).success).toBe(true);
    const base = { closet: [], request: { mustInclude: [], purpose: "everyday" }, feedback: [] };
    expect(outfitsRequestSchema.safeParse(base).success).toBe(true);
    expect(outfitsRequestSchema.safeParse({ ...base, profile: { heightCm: 170, fit: "mens", usualSize: { tops: "M" } } }).success).toBe(true);
    expect(outfitsRequestSchema.safeParse({ ...base, profile: { heightCm: 5 } }).success).toBe(false);
  });
});
