import { describe, expect, it } from "vitest";
import { referenceLinks, referenceQuery } from "../src/shop/reference";

const items = [
  { category: "tops" as const, color: "navy" as const, subType: "シャツ" },
  { category: "bottoms" as const, color: "beige" as const, subType: "ワイドパンツ" },
  { category: "shoes" as const, color: "white" as const, subType: "スニーカー" },
];

describe("referenceQuery", () => {
  it("色と服の名前を並べ、靴は省く", () => {
    expect(referenceQuery(items)).toBe("ネイビー シャツ ベージュ ワイドパンツ コーデ");
  });
});

describe("referenceLinks", () => {
  it("検索語をURLに入れる", () => {
    const links = referenceLinks(items);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.url).toContain(encodeURIComponent("ネイビー シャツ"));
  });
});
