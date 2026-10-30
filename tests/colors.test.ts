import { describe, expect, it } from "vitest";
import { colorHarmony, nearestColorName } from "../src/domain/colors";

describe("nearestColorName", () => {
  it("代表的な色を正しい色名にする", () => {
    expect(nearestColorName([10, 10, 10])).toBe("black");
    expect(nearestColorName([250, 250, 250])).toBe("white");
    expect(nearestColorName([30, 45, 90])).toBe("navy");
    expect(nearestColorName([200, 40, 50])).toBe("red");
    expect(nearestColorName([215, 195, 160])).toBe("beige");
  });
  it("実際の写真で出やすい色を取り違えない", () => {
    // サンプル写真から取った色
    expect(nearestColorName([207, 51, 108])).toBe("pink"); // 濃いピンクのワンピース
    expect(nearestColorName([41, 44, 57])).toBe("navy"); // 室内で暗く写ったネイビーのパンツ
    expect(nearestColorName([42, 50, 64])).toBe("navy"); // デニムシャツ
    expect(nearestColorName([44, 44, 46])).toBe("black"); // チャコールのニット
    expect(nearestColorName([22, 32, 39])).toBe("black"); // 黒のダウン
  });
});

describe("colorHarmony", () => {
  it("差し色1色はベーシックだけより高い", () => {
    expect(colorHarmony(["navy", "white", "red"]).score).toBeGreaterThan(colorHarmony(["navy", "white"]).score);
  });
  it("色数が多いと低い", () => {
    expect(colorHarmony(["red", "green", "purple"]).score).toBeLessThan(0);
  });
});
