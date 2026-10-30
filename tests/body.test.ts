import { describe, expect, it } from "vitest";
import { buildScan, defaultScan, fitClothes, measureFront, sane, ScanError, type Landmark, type Mask } from "../src/body/measure";

// 400x1000 の画像に、棒人間のような体の切り抜きを描く（身長 900px：y=50〜950）
const W = 400;
const H = 1000;
function person(opts: { waist?: number; armsTouching?: boolean; legsTouching?: boolean } = {}): { mask: Mask; lm: Landmark[] } {
  const data = new Float32Array(W * H);
  const fill = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * W + x] = 1;
  };
  fill(170, 230, 50, 170); // 頭（幅60＝身長の約0.067）
  fill(185, 215, 170, 205); // 首
  const waist = opts.waist ?? 140;
  fill(200 - waist / 2, 200 + waist / 2, 205, 500); // 胴（股は y=500）
  fill(140, 190, 500, 950); // 左脚（幅50）
  fill(210, 260, 500, 950); // 右脚
  if (opts.legsTouching) fill(190, 210, 500, 700); // 太ももがくっついている（すき間はひざの近くから）
  // 腕：体から離して（または体につけて）下ろす
  const ax = opts.armsTouching ? 200 - waist / 2 - 30 : 200 - waist / 2 - 45;
  fill(ax, ax + 30, 215, 520);
  fill(400 - ax - 30, 400 - ax, 215, 520);
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
  const set = (i: number, x: number, y: number) => (lm[i] = { x: x / W, y: y / H, visibility: 0.99 });
  set(0, 200, 120); // 鼻
  set(11, ax + 15, 215); // 肩
  set(12, 400 - ax - 15, 215);
  set(13, ax + 15, 360); // ひじ
  set(14, 400 - ax - 15, 360);
  set(15, ax + 15, 500); // 手首
  set(16, 400 - ax - 15, 500);
  set(23, 165, 480); // 腰
  set(24, 235, 480);
  set(25, 165, 700); // ひざ
  set(26, 235, 700);
  set(27, 165, 910); // 足首
  set(28, 235, 910);
  for (const i of [29, 31]) set(i, 165, 950);
  for (const i of [30, 32]) set(i, 235, 950);
  return { mask: { width: W, height: H, data }, lm };
}

describe("measureFront", () => {
  it("身長を1として、胴・脚・股の高さを測る", () => {
    const { mask, lm } = person();
    const m = measureFront(mask, lm);
    expect(m.crotchY).toBeCloseTo(450 / 900, 1);
    expect(m.torso[4].width).toBeCloseTo(140 / 900, 2);
    expect(m.legs[3].width).toBeCloseTo(50 / 900, 2);
    expect(m.arm.upper).toBeCloseTo(30 / 900, 2);
    expect(m.armsTouching).toBe(false);
  });
  it("胴が太い人は太く測れる", () => {
    const thin = measureFront(person().mask, person().lm);
    const wide = person({ waist: 200 });
    expect(measureFront(wide.mask, wide.lm).torso[4].width).toBeGreaterThan(thin.torso[4].width * 1.3);
  });
  it("太ももがくっついていても、股を腰とひざの位置から見積もった高さより下にしない", () => {
    const p = person({ legsTouching: true });
    const m = measureFront(p.mask, p.lm);
    // 腰の点 y=480、ひざ y=700 → 股は 480 + 220 × 0.12 ≈ 506（すき間が出る y=700 ではない）
    expect(m.crotchY).toBeCloseTo((506 - 50) / 900, 1);
    expect(m.crotchY).toBeLessThan((600 - 50) / 900);
  });
  it("腕が胴についていたら、そう知らせる", () => {
    const p = person({ armsTouching: true });
    expect(measureFront(p.mask, p.lm).armsTouching).toBe(true);
  });
  it("足が写っていなければ撮り直しをお願いする", () => {
    const { mask, lm } = person();
    lm[27] = { ...lm[27], visibility: 0.1 };
    expect(() => measureFront(mask, lm)).toThrow(ScanError);
  });
});

describe("buildScan", () => {
  it("横の写真がなければ、厚みは幅から見積もる", () => {
    const { mask, lm } = person();
    const scan = buildScan(measureFront(mask, lm), undefined, 1);
    expect(scan.views).toEqual(["front"]);
    for (const t of scan.torso) expect(t.depth).toBeLessThan(t.width);
  });
  it("横の写真で測った厚みを使う（ありえない値は使わない）", () => {
    const front = measureFront(person().mask, person().lm);
    const side = { torso: front.torso.map((t, i) => (i === 0 ? 5 : t.width * 0.9)), legs: front.legs.map((l) => l.width), head: front.head.width };
    const scan = buildScan(front, side, 1);
    expect(scan.views).toEqual(["front", "side"]);
    expect(scan.torso[3].depth).toBeCloseTo(front.torso[3].width * 0.9, 5);
    expect(scan.torso[0].depth).toBeLessThan(front.torso[0].width);
  });
});

describe("sane / defaultScan", () => {
  it("ありえない値を人の体の範囲に収める", () => {
    const s = sane({ ...defaultScan({}), crotchY: 0.9, shoulder: { y: 0.18, width: 2 } });
    expect(s.crotchY).toBe(0.6);
    expect(s.shoulder.width).toBe(0.34);
  });
  it("体重が重めなら、おなかまわりが太い標準体型になる", () => {
    const a = defaultScan({ heightCm: 170, weightKg: 60, fit: "mens" });
    const b = defaultScan({ heightCm: 170, weightKg: 95, fit: "mens" });
    expect(b.torso[5].width).toBeGreaterThan(a.torso[5].width * 1.2);
    expect(b.shoulder.width / a.shoulder.width).toBeLessThan(b.torso[5].width / a.torso[5].width);
  });
});

describe("fitClothes（服を着た写真の分をさし引く）", () => {
  const profile = { heightCm: 170, weightKg: 62, fit: "mens" as const };
  it("下着の体型（標準体型に近い）はそのまま", () => {
    const scan = defaultScan(profile);
    const r = fitClothes(scan, profile);
    expect(r.loose).toBe(false);
    expect(r.scan.torso.map((t) => t.width)).toEqual(scan.torso.map((t) => t.width));
  });
  it("コートのように全体がずっと太ければ、想定の太さに寄せて「ゆったり」と知らせる", () => {
    const base = defaultScan(profile);
    const coat = { ...base, torso: base.torso.map((t) => ({ ...t, width: t.width * 1.6, depth: t.depth * 1.6 })), legs: base.legs.map((l) => ({ ...l, width: l.width * 1.5 })) };
    const r = fitClothes(coat, profile);
    expect(r.loose).toBe(true);
    r.scan.torso.forEach((t, i) => expect(t.width).toBeCloseTo(base.torso[i].width * 1.2, 5));
    r.scan.legs.forEach((l, i) => expect(l.width).toBeCloseTo(base.legs[i].width * 1.2, 5));
    // 骨格で決まる長さはそのまま
    expect(r.scan.crotchY).toBe(coat.crotchY);
    expect(r.scan.shoulder).toEqual(coat.shoulder);
  });
  it("やせている人の細さはそのまま", () => {
    const base = defaultScan(profile);
    const thin = { ...base, torso: base.torso.map((t) => ({ ...t, width: t.width * 0.8 })) };
    expect(fitClothes(thin, profile).scan.torso[4].width).toBeCloseTo(base.torso[4].width * 0.8, 5);
  });
  it("身長か体重が未登録なら、想定が立てられないので何もしない", () => {
    const base = defaultScan(profile);
    const coat = { ...base, torso: base.torso.map((t) => ({ ...t, width: t.width * 1.6 })) };
    const r = fitClothes(coat, { fit: "mens" });
    expect(r.loose).toBe(false);
    expect(r.scan).toBe(coat);
  });
});
