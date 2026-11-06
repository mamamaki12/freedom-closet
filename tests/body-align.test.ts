// 生地の見本を、写真の柄に重ねる計算（脇で写真から見本へ切り替えるときに、しまが二重にぼやけないように）
import { describe, expect, it } from "vitest";
import { alignGrid, gridAt } from "../src/body/align";
import type { Rgba } from "../src/body/tile";

function image(w: number, h: number, paint: (u: number, v: number) => number): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // 画素のまん中の座標（上が v = 1）
      const g = paint((x + 0.5) / w, 1 - (y + 0.5) / h);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

/** 見本1枚に4本の、横じま（ボーダー）の明るさ */
const stripe = (t: number) => 130 + 90 * Math.cos(2 * Math.PI * 4 * t);
/** 見本を取ったところで合わせた対応（写真の横半分・縦1/3 が見本1枚） */
const base = (u: number, v: number): [number, number] => [u * 2, v * 3];
const tile = image(64, 64, (_, v) => stripe(v));

describe("見本を写真の柄に重ねる", () => {
  it("写真のしまが少しずつ曲がっていても、左右の脇それぞれで、しまの位置を追いかけて見本を合わせる", () => {
    // 写真のしまが、上から下へ、左はしま1本分より大きく、右は逆向きにずれていく（まん中の高さではずれなし）
    const drift = (u: number, v: number) => (u < 0.5 ? 0.3 : -0.2) * (v - 0.5);
    const whole = image(256, 256, (u, v) => stripe(base(u, v)[1] + drift(u, v)));
    const g = alignGrid(whole, tile, base, [0.1, 0.9]);
    for (let j = 0; j < g.rows; j++) {
      const v = j / (g.rows - 1);
      for (const u of [0.15, 0.25, 0.75, 0.85]) {
        const [a, b] = gridAt(g, u, v);
        // ボーダーは横にずらしても変わらないので、横はずらさない
        expect(a).toBeCloseTo(base(u, v)[0], 6);
        expect(Math.abs(b - (base(u, v)[1] + drift(u, v)))).toBeLessThan(0.02);
      }
    }
  });

  it("柄がはっきりしない生地は、ずらさない（表のあいだや外は、となりの点から直線でつなぐ）", () => {
    const flat = image(64, 64, () => 128);
    const g = alignGrid(image(128, 128, () => 120), flat, base, [0.1, 0.9]);
    for (const [u, v] of [
      [0.5, 0.5],
      [0.01, 0.995],
      [0.63, 0.27],
      [0.999, 0.003],
    ]) {
      const [a, b] = gridAt(g, u, v);
      expect(a).toBeCloseTo(base(u, v)[0], 6);
      expect(b).toBeCloseTo(base(u, v)[1], 6);
    }
  });
});
