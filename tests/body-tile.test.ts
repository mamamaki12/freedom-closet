// 生地の見本を、つなぎ目なくくり返せる模様にする計算（柄の傾き・くり返しの長さ・つなぎ目）
import { describe, expect, it } from "vitest";
import { patternTilt, plainCloth, repeatLength, seamlessTile, softenWrinkles, type Rgba } from "../src/body/tile";

function image(w: number, h: number, paint: (x: number, y: number) => number | [number, number, number]): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = paint(x, y);
      const [r, g, b] = typeof v === "number" ? [v, v, v] : v;
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

/** 決まった種から作る乱数（テストの結果が毎回同じになるように） */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 花柄のような、くり返しのない模様（ぼかした乱数） */
function blotches(w: number, h: number, seed: number): Rgba {
  const rnd = random(seed);
  const spots = Array.from({ length: 60 }, () => ({
    x: rnd() * w,
    y: rnd() * h,
    r: 4 + rnd() * 9,
    c: [rnd() * 255, rnd() * 255, rnd() * 255],
  }));
  return image(w, h, (x, y) => {
    const c = [40, 50, 90];
    for (const s of spots) {
      const d = Math.hypot(x - s.x, y - s.y);
      const a = Math.max(0, 1 - d / s.r);
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - a) + s.c[k] * a;
    }
    return c as [number, number, number];
  });
}

const px = (img: Rgba, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** 横に並べたときの境目（右はしと左はし）の差と、ふつうのとなり合う列の差 */
function seams(img: Rgba): { wrap: number; inner: number } {
  const { width: w, height: h } = img;
  let wrap = 0;
  let inner = 0;
  for (let y = 0; y < h; y++) {
    wrap += d2(px(img, w - 1, y), px(img, 0, y));
    for (let x = 0; x < w - 1; x++) inner += d2(px(img, x, y), px(img, x + 1, y));
  }
  return { wrap: wrap / h, inner: inner / (h * (w - 1)) };
}

const deg = (r: number) => (r * 180) / Math.PI;

describe("柄の傾き", () => {
  it("右下がりに傾いたボーダーの傾きを測る", () => {
    const t = (6 * Math.PI) / 180;
    // 線の向きが (cos t, sin t)（画面の下向きが +y）
    const img = image(128, 128, (x, y) =>
      Math.sin(((y * Math.cos(t) - x * Math.sin(t)) / 10) * Math.PI * 2) > 0 ? 230 : 30,
    );
    expect(deg(patternTilt(img))).toBeCloseTo(6, 0);
  });

  it("左下がりに傾いたチェックの傾きを測る", () => {
    const t = (-4 * Math.PI) / 180;
    const img = image(128, 128, (x, y) => {
      const u = x * Math.cos(t) + y * Math.sin(t);
      const v = y * Math.cos(t) - x * Math.sin(t);
      return (Math.sin((u / 16) * Math.PI * 2) > 0.6 ? 120 : 0) + (Math.sin((v / 16) * Math.PI * 2) > 0.6 ? 120 : 0) + 10;
    });
    expect(deg(patternTilt(img))).toBeCloseTo(-4, 0);
  });

  it("花柄や斜めのストライプは、傾きを直さない", () => {
    expect(patternTilt(blotches(128, 128, 7))).toBe(0);
    const diag = image(128, 128, (x, y) => (Math.sin(((x + y) / 12) * Math.PI) > 0 ? 220 : 40));
    expect(patternTilt(diag)).toBe(0);
  });
});

describe("くり返しの長さ", () => {
  it("縦じまは、しまの幅の倍数で切る", () => {
    const img = image(128, 64, (x) => (x % 10 < 5 ? 220 : 40));
    const L = repeatLength(img);
    expect(L % 10).toBe(0);
    expect(L).toBeGreaterThanOrEqual(100);
  });
});

describe("つなぎ目のない模様", () => {
  it("くり返しのない柄でも、並べたときの境目がふつうの画素の差と変わらない", () => {
    const src = blotches(128, 128, 3);
    const before = seams(src);
    // そのまま並べると境目がはっきり出る
    expect(before.wrap).toBeGreaterThan(before.inner * 4);
    const tile = seamlessTile(src);
    expect(tile.width).toBeLessThan(128);
    expect(tile.width).toBeGreaterThan(80);
    expect(tile.height).toBeGreaterThan(80);
    expect(tile.data.length).toBe(tile.width * tile.height * 4);
    const after = seams(tile);
    expect(after.wrap).toBeLessThan(after.inner * 2.5);
    // 縦にも
    const rows = seams({
      width: tile.height,
      height: tile.width,
      data: (() => {
        const t = new Uint8ClampedArray(tile.data.length);
        for (let y = 0; y < tile.height; y++)
          for (let x = 0; x < tile.width; x++)
            for (let c = 0; c < 4; c++) t[(x * tile.height + y) * 4 + c] = tile.data[(y * tile.width + x) * 4 + c];
        return t;
      })(),
    });
    expect(rows.wrap).toBeLessThan(rows.inner * 2.5);
  });

  it("ボーダーは、しまがずれずにつながる", () => {
    const src = image(128, 128, (_x, y) => (y % 12 < 6 ? [30, 40, 90] : [240, 238, 230]));
    const tile = seamlessTile(src);
    expect(tile.height % 12).toBe(0);
    // 上はしの行と下はしの行の次（くり返した先）が、しまの同じところ
    for (let x = 0; x < tile.width; x += 7) {
      expect(px(tile, x, 0)).toEqual(px(src, x, 0));
      expect(d2(px(tile, x, tile.height - 1), px(src, x, 11))).toBeLessThan(10);
    }
  });
});

describe("無地の生地のしわ", () => {
  /** 灰色の無地に、ななめのしわ（やわらかい濃淡）と細かい織り目 */
  function wrinkled(w: number, h: number): Rgba {
    const rnd = random(5);
    const grain = Array.from({ length: w * h }, () => (rnd() - 0.5) * 10);
    return image(w, h, (x, y) => {
      const crease = Math.exp(-(((x * 0.8 + y * 0.6 - 60) / 5) ** 2)) * -28 + Math.exp(-(((x * 0.7 - y * 0.7 + 20) / 7) ** 2)) * -18;
      return 150 + crease + grain[y * w + x];
    });
  }
  const lowSpread = (img: Rgba) => {
    // 7画素四方でぼかした明るさのばらつき（しわの濃淡）と、となりの画素との差（織り目）
    const { width: w, height: h } = img;
    const L = (x: number, y: number) => px(img, ((x % w) + w) % w, ((y % h) + h) % h)[0];
    let s = 0;
    let s2 = 0;
    let fine = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let b = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) b += L(x + dx, y + dy);
        b /= 49;
        s += b;
        s2 += b * b;
        fine += Math.abs(L(x + 1, y) - L(x, y));
      }
    const n = w * h;
    return { low: Math.sqrt(s2 / n - (s / n) ** 2), fine: fine / n };
  };

  it("無地としわだけの見本を見分ける（柄・ボーダー・色のちがう柄は無地としない）", () => {
    expect(plainCloth(wrinkled(128, 128))).toBe(true);
    expect(plainCloth(image(128, 128, (_x, y) => (y % 12 < 6 ? 60 : 200)))).toBe(false);
    expect(plainCloth(blotches(128, 128, 3))).toBe(false);
  });

  it("しわの濃淡は弱め、細かい織り目は残す", () => {
    const tile = seamlessTile(wrinkled(128, 128));
    const before = lowSpread(tile);
    softenWrinkles(tile);
    const after = lowSpread(tile);
    expect(after.low).toBeLessThan(before.low * 0.55);
    expect(after.fine).toBeGreaterThan(before.fine * 0.8);
  });
});
