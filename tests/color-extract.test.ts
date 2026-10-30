import { describe, expect, it } from "vitest";
import { dominantColor } from "../src/ai/local/color";

function image(w: number, h: number, bg: number[], fg: number[]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x > w * 0.25 && x < w * 0.75 && y > h * 0.2 && y < h * 0.8;
      const c = inside ? fg : bg;
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return data;
}

describe("dominantColor", () => {
  it("白い背景の上の紺の服を紺と判定する", () => {
    expect(dominantColor(image(40, 40, [245, 245, 240], [30, 45, 92]), 40, 40).name).toBe("navy");
  });
  it("床の色（茶）を除いて服の色（白）を選ぶ", () => {
    expect(dominantColor(image(40, 40, [120, 80, 50], [248, 248, 246]), 40, 40).name).toBe("white");
  });
  it("服と背景が同じ色でも答えを返す", () => {
    expect(dominantColor(image(20, 20, [20, 20, 20], [20, 20, 20]), 20, 20).name).toBe("black");
  });
});
