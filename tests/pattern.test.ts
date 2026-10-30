import { describe, expect, it } from "vitest";
import { aggregate } from "../src/ai/local/classifier";
import { extractPalette } from "../src/ai/local/color";
import { mergeAnalysis } from "../src/ai/local/index";
import { recentWearPenalty, suggestOutfitsLocal } from "../src/ai/local/outfits";
import { garmentLabel, paletteOf, patternBalance, shortLabel } from "../src/domain/colors";
import { g } from "./fixtures";

/** 中央に服、まわりに背景。服の中は stripes 本の横じまにできる */
function image(w: number, h: number, bg: number[], fg: number[], stripe?: number[], stripes = 6) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x > w * 0.2 && x < w * 0.8 && y > h * 0.15 && y < h * 0.85;
      let c = bg;
      if (inside) c = stripe && Math.floor(((y - h * 0.15) / (h * 0.7)) * stripes) % 2 === 1 ? stripe : fg;
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return data;
}

describe("extractPalette", () => {
  it("無地の服は1色で、2色以上とはみなさない", () => {
    const p = extractPalette(image(48, 48, [245, 245, 240], [30, 45, 92]), 48, 48);
    expect(p.colors[0].name).toBe("navy");
    expect(p.multiColor).toBe(false);
  });
  it("白×紺のボーダーは、地の色と2色目を分けて取り、2色以上とみなす", () => {
    const p = extractPalette(image(48, 48, [120, 80, 50], [248, 248, 246], [30, 45, 92]), 48, 48);
    expect(p.multiColor).toBe(true);
    expect(p.colors.slice(0, 2).map((c) => c.name).sort()).toEqual(["navy", "white"]);
  });
  it("照明のムラ程度の差（濃いグレーと少し明るいグレー）は1色にまとめる", () => {
    const p = extractPalette(image(48, 48, [245, 245, 240], [60, 60, 62], [72, 72, 74]), 48, 48);
    expect(p.multiColor).toBe(false);
  });
});

describe("aggregate / mergeAnalysis", () => {
  const types = [
    { prompts: ["a", "b"], category: "tops" as const, subType: "シャツ" },
    { prompts: ["c"], category: "tops" as const, subType: "ブラウス" },
    { prompts: ["d"], category: "bottoms" as const, subType: "デニム" },
  ];
  it("言い方ごとの点数を種類ごとに合計して並べる", () => {
    const r = aggregate(types, [
      { label: "a", score: 0.3 },
      { label: "b", score: 0.2 },
      { label: "c", score: 0.4 },
      { label: "d", score: 0.1 },
    ]);
    expect(r[0].label.subType).toBe("シャツ");
    expect(r[0].score).toBeCloseTo(0.5);
  });
  const classified = (patternScores: Record<string, number>) => ({
    types: [
      { label: types[0], score: 0.5 },
      { label: types[1], score: 0.3 },
      { label: types[2], score: 0.2 },
    ],
    patterns: Object.entries(patternScores).map(([pattern, score]) => ({ pattern: pattern as "solid", score })),
  });
  const solidPalette = { colors: [{ name: "white" as const, hex: "#ffffff", rgb: [255, 255, 255] as [number, number, number], lab: [100, 0, 0], share: 1 }], multiColor: false };
  const twoTone = {
    colors: [
      { name: "white" as const, hex: "#ffffff", rgb: [255, 255, 255] as [number, number, number], lab: [100, 0, 0], share: 0.6 },
      { name: "navy" as const, hex: "#22305a", rgb: [34, 48, 90] as [number, number, number], lab: [20, 5, -30], share: 0.4 },
    ],
    multiColor: true,
  };
  it("CLIPが花柄を無地よりはっきり高く出せば花柄", () => {
    const a = mergeAnalysis(classified({ floral: 0.6, solid: 0.3, stripe: 0.1 }), solidPalette);
    expect(a.pattern).toBe("floral");
    expect(a.subType).toBe("シャツ");
    expect(a.confidence).toBeLessThan(0.8); // 同じカテゴリ 0.8 × 柄もの 0.85
  });
  it("CLIPが無地と言っても画素が2色以上なら「柄もの」にして2色目を入れる", () => {
    const a = mergeAnalysis(classified({ solid: 0.7, stripe: 0.2, floral: 0.1 }), twoTone);
    expect(a.pattern).toBe("print");
    expect(a.subColor).toBe("navy");
  });
  it("無地で1色なら pattern は solid、2色目なし", () => {
    const a = mergeAnalysis(classified({ solid: 0.8, stripe: 0.1, floral: 0.1 }), solidPalette);
    expect(a.pattern).toBe("solid");
    expect(a.subColor).toBeUndefined();
    expect(a.confidence).toBeCloseTo(0.8);
  });
});

describe("garmentLabel / paletteOf / patternBalance", () => {
  it("柄があれば柄を、2色目があれば色も並べる", () => {
    expect(garmentLabel(g({ category: "tops", color: "white", subType: "シャツ" }))).toBe("白のシャツ");
    expect(garmentLabel(g({ category: "tops", color: "white", subType: "シャツ", pattern: "floral" }))).toBe("白の花柄シャツ");
    expect(garmentLabel(g({ category: "tops", color: "white", subColor: "navy", subType: "Tシャツ", pattern: "stripe" }))).toBe("白×ネイビーのボーダーTシャツ");
    expect(shortLabel(g({ category: "bottoms", color: "red", subType: "パンツ", pattern: "check" }))).toBe("チェックパンツ");
  });
  it("柄の色がはっきりした色なら、色合わせの対象に数える", () => {
    expect(paletteOf([g({ category: "tops", color: "white", subColor: "red", pattern: "floral" })])).toEqual(["white", "red"]);
    expect(paletteOf([g({ category: "tops", color: "white", subColor: "black", pattern: "stripe" })])).toEqual(["white"]);
  });
  it("柄は1点なら加点、2点以上なら減点", () => {
    const one = patternBalance([g({ category: "tops", color: "white", subType: "シャツ", pattern: "floral" }), g({ category: "bottoms", color: "black" })]);
    const two = patternBalance([g({ category: "tops", color: "white", pattern: "floral" }), g({ category: "bottoms", color: "red", pattern: "check" })]);
    expect(one.score).toBeGreaterThan(0);
    expect(one.reasons[0]).toContain("花柄のシャツ");
    expect(two.score).toBeLessThan(0);
  });
});

describe("コーデ提案と柄・着た記録", () => {
  const closet = [
    g({ id: "t1", category: "tops", color: "white", subType: "シャツ", pattern: "floral", subColor: "green" }),
    g({ id: "t2", category: "tops", color: "white", subType: "Tシャツ" }),
    g({ id: "b1", category: "bottoms", color: "red", subType: "パンツ", pattern: "check", subColor: "black" }),
    g({ id: "b2", category: "bottoms", color: "black", subType: "ワイドパンツ" }),
  ];
  it("柄×柄より、柄×無地を上位にする", () => {
    const [first] = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 20 }, []);
    expect(first.garmentIds).not.toEqual(expect.arrayContaining(["t1", "b1"]));
  });
  it("案の名前に柄が入る", () => {
    const res = suggestOutfitsLocal(closet, { mustInclude: ["t1"], purpose: "everyday", temperatureC: 20 }, []);
    expect(res[0].title).toContain("花柄シャツ");
  });
  it("昨日着た服は後回しにする（靴は数えない）", () => {
    const items = [closet[1], closet[3], g({ id: "s1", category: "shoes", color: "white" })];
    expect(recentWearPenalty(items, [{ garmentIds: ["t2", "s1"], day: "2026-10-29" }])).toBeCloseTo(1);
    expect(recentWearPenalty(items, [{ garmentIds: ["x"], day: "2026-10-29" }, { garmentIds: ["b2"], day: "2026-10-28" }])).toBeCloseTo(0.6);
    const before = suggestOutfitsLocal(closet, { mustInclude: [], purpose: "everyday", temperatureC: 20 }, []);
    const after = suggestOutfitsLocal(
      closet,
      { mustInclude: [], purpose: "everyday", temperatureC: 20, recentlyWorn: [{ garmentIds: before[0].garmentIds, day: "2026-10-29" }] },
      [],
    );
    expect(after[0].key).not.toBe(before[0].key);
  });
});
