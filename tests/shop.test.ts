import { describe, expect, it } from "vitest";
import { findCurated, type CuratedItem } from "../src/shop/curated";
import { searchLinks } from "../src/shop/links";

describe("searchLinks", () => {
  it("ユニクロとGUの検索URLを作る", () => {
    const links = searchLinks("黒 ワイドパンツ");
    expect(links.map((l) => l.store)).toEqual(["UNIQLO", "GU"]);
    expect(links[0].url).toBe(`https://www.uniqlo.com/jp/ja/search?q=${encodeURIComponent("黒 ワイドパンツ")}`);
  });
});

describe("findCurated", () => {
  const items: CuratedItem[] = [
    { store: "GU", name: "テスト", category: "bottoms", colors: ["black"], subType: "ワイドパンツ", url: "https://example.test", checkedAt: "2026-10-24" },
  ];
  it("種類・色・名前が合うものだけ返す", () => {
    expect(findCurated({ category: "bottoms", color: "black", subType: "ワイドパンツ" }, items)).toHaveLength(1);
    expect(findCurated({ category: "bottoms", color: "white", subType: "ワイドパンツ" }, items)).toHaveLength(0);
  });
});
