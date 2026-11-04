// 服の写真から模様を作る計算（切り抜きのならし・生地の見本の選び方・胴の範囲）
import { describe, expect, it } from "vitest";
import {
  bodyRange,
  cleanMask,
  dilate,
  erode,
  hangingTags,
  palette,
  pickSquare,
  planSwatches,
  type Shot,
} from "../src/body/photoMask";

type RGB = [number, number, number];

/** 合成の写真。paint(x, y) が色を返す */
function shot(w: number, h: number, paint: (x: number, y: number) => RGB): Shot {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

function maskOf(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = inside(x, y) ? 1 : 0;
  return m;
}

const count = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** T シャツの形：胴（x 30〜69、y 10〜89）と、肩から出る袖（y 10〜34） */
const tee = (x: number, y: number) =>
  (x >= 30 && x <= 69 && y >= 10 && y <= 89) || (x >= 10 && x <= 89 && y >= 10 && y <= 34);

describe("切り抜きのならし", () => {
  it("けずる・ふくらませる・小さなかけらを捨てる", () => {
    const w = 30;
    const sq = maskOf(w, w, (x, y) => x >= 5 && x < 15 && y >= 5 && y < 15);
    expect(count(erode(sq, w, w, 1))).toBe(8 * 8);
    expect(count(dilate(sq, w, w, 1))).toBe(12 * 12);
    const withSpeck = sq.slice();
    withSpeck[25 * w + 25] = 1;
    const clean = cleanMask(withSpeck, w, w, 1);
    expect(clean[25 * w + 25]).toBe(0);
    expect(clean[10 * w + 10]).toBe(1);
  });
});

describe("胴の範囲", () => {
  it("T シャツの胴（袖を除いた部分）を見つける", () => {
    const m = maskOf(100, 100, tee);
    const [u0, u1] = bodyRange(m, 100, 10, 89, 10, 89);
    // 胴は服の範囲（x 10〜89）の 20/80〜60/80
    expect(u0).toBeCloseTo(20 / 80, 1);
    expect(u1).toBeCloseTo(60 / 80, 1);
  });

  it("片方の袖が胴にくっついて写っていても、胴の中心はずれない", () => {
    // 左の袖が下まで垂れて、胴と見分けがつかない
    const m = maskOf(100, 100, (x, y) => tee(x, y) || (x >= 18 && x <= 29 && y >= 10 && y <= 80));
    const [u0, u1] = bodyRange(m, 100, 10, 89, 10, 89);
    const center = (u0 + u1) / 2;
    expect(center).toBeCloseTo(0.5, 1);
    expect(u1 - u0).toBeLessThan(0.62);
  });
});

describe("生地の見本の選び方", () => {
  const NAVY: RGB = [30, 40, 90];
  const WHITE: RGB = [240, 240, 236];

  it("ボーダーの服は、2色とも地の色として見つける", () => {
    const img = shot(80, 80, (_x, y) => (Math.floor(y / 4) % 2 ? NAVY : WHITE));
    const m = maskOf(80, 80, (x, y) => x >= 10 && x < 70 && y >= 10 && y < 70);
    const pal = palette(m, img, [10, 69, 10, 69])!;
    const mains = pal.centers.filter((_, i) => pal.main[i]);
    expect(mains.some((c) => dist(c, NAVY) < 30)).toBe(true);
    expect(mains.some((c) => dist(c, WHITE) < 30)).toBe(true);
  });

  it("胸の大きなプリントを避けて、無地のところを取る", () => {
    const BLUE: RGB = [60, 90, 140];
    const RED: RGB = [200, 40, 40];
    const print = (x: number, y: number) => x >= 35 && x < 65 && y >= 30 && y < 60;
    const img = shot(100, 100, (x, y) => (print(x, y) ? RED : tee(x, y) ? BLUE : WHITE));
    const m = maskOf(100, 100, tee);
    const sq = pickSquare(m, img, [10, 89, 10, 89], [30, 24, 18, 12], {
      allow: (x) => x >= 30 && x <= 69,
      background: WHITE,
    })!;
    expect(sq).toBeDefined();
    expect(dist(sq.mean, BLUE)).toBeLessThan(15);
    // 四角がプリントと重ならない
    const h = sq.side / 2;
    const overlaps = sq.cx + h > 35 && sq.cx - h < 65 && sq.cy + h > 30 && sq.cy - h < 60;
    expect(overlaps).toBe(false);
  });

  it("切り抜きが少し太くて背景が服に入っていても、背景の色をまぜない", () => {
    const GRAY: RGB = [120, 120, 126];
    // 服は x 20〜59 だが、切り抜きは右に 4 画素はみ出している
    const img = shot(80, 100, (x, y) => (x >= 20 && x < 60 && y >= 5 && y < 95 ? GRAY : WHITE));
    const m = maskOf(80, 100, (x, y) => x >= 20 && x < 64 && y >= 5 && y < 95);
    const sq = pickSquare(m, img, [20, 63, 5, 94], [40, 30, 20], { background: WHITE })!;
    expect(dist(sq.mean, GRAY)).toBeLessThan(6);
  });
});

describe("模様づくりの計画", () => {
  const WHITE: RGB = [242, 242, 240];

  it("ボーダーの T シャツは、袖も同じ生地として扱う（袖の見本を別に取らない）", () => {
    const NAVY: RGB = [30, 40, 90];
    const img = shot(100, 100, (x, y) => (!tee(x, y) ? WHITE : Math.floor(y / 5) % 2 ? NAVY : [235, 232, 225]));
    const plan = planSwatches(img, maskOf(100, 100, tee), "upper");
    expect(plan.body).toBeDefined();
    expect(plan.sleeve).toBeUndefined();
  });

  it("袖だけ色が違う服は、袖の見本を別に取る", () => {
    const CREAM: RGB = [225, 215, 190];
    const BLACK: RGB = [25, 25, 28];
    const img = shot(100, 100, (x, y) => (!tee(x, y) ? WHITE : x >= 30 && x <= 69 ? CREAM : BLACK));
    const plan = planSwatches(img, maskOf(100, 100, tee), "upper");
    expect(dist(plan.body!.mean, CREAM)).toBeLessThan(15);
    expect(plan.sleeve).toBeDefined();
    expect(dist(plan.sleeve!.mean, BLACK)).toBeLessThan(15);
  });

  it("切り抜きがなくても、写真の真ん中あたりから見本を取る", () => {
    const img = shot(60, 60, () => [90, 120, 80]);
    const plan = planSwatches(img, undefined, "lower");
    expect(plan.body).toBeDefined();
    expect(plan.bodyU).toEqual([0, 1]);
  });
});

describe("えりから垂れ下がる値札", () => {
  // 紺に細い白い線のチェック（線は 1 画素、12 画素おき）
  const NAVY: RGB = [28, 38, 80];
  const LINE: RGB = [225, 225, 220];
  const check = (x: number, y: number): RGB => (x % 12 === 0 || y % 12 === 0 ? LINE : NAVY);
  const W = 120;
  const H = 160;
  const cloth = shot(W, H, check);
  /** えりのところ（上から 20 画素まで） */
  const seed = Float32Array.from({ length: W * H }, (_, i) => (Math.floor(i / W) < 20 ? 1 : 0));
  /** 調べる範囲（上半分） */
  const region = maskOf(W, H, (_, y) => y < 80);
  const has = (m: Uint8Array, x: number, y: number) => m[y * W + x] === 1;

  it("えりにつながる白い値札は見つけ、胸の白いワッペンと、下まで続く白い前立ては残す", () => {
    const photo = shot(W, H, (x, y) => {
      // 値札：えりから胸へ垂れ下がる（y 12〜45）
      if (x >= 50 && x <= 62 && y >= 12 && y <= 45) return [240, 238, 232];
      // 胸のワッペン（えりにつながっていない）
      if (x >= 85 && x <= 100 && y >= 40 && y <= 55) return [240, 238, 232];
      // 前立て：えりから下まで続く
      if (x >= 20 && x <= 26 && y >= 10) return [240, 238, 232];
      return check(x, y);
    });
    const tags = hangingTags(photo, cloth, seed, region);
    expect(has(tags, 56, 30)).toBe(true);
    expect(has(tags, 56, 44)).toBe(true);
    expect(has(tags, 92, 47)).toBe(false);
    expect(has(tags, 23, 50)).toBe(false);
    // チェックの白い線は生地のうち
    expect(has(tags, 36, 60)).toBe(false);
  });

  it("値札のない服では、何も見つけない", () => {
    const tags = hangingTags(shot(W, H, check), cloth, seed, region);
    expect(count(tags)).toBe(0);
  });
});
