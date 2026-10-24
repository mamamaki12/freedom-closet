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
});

describe("colorHarmony", () => {
  it("差し色1色はベーシックだけより高い", () => {
    expect(colorHarmony(["navy", "white", "red"]).score).toBeGreaterThan(colorHarmony(["navy", "white"]).score);
  });
  it("色数が多いと低い", () => {
    expect(colorHarmony(["red", "green", "purple"]).score).toBeLessThan(0);
  });
});
