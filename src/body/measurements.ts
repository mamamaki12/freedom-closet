// 読み取った体型（身長を1とした割合）から、巻き尺で測るような採寸値（cm）を見積もる。
// 画面に目安として出すのと、実在の人の体型データ（BodyM）で精度を測るのに使う（tools/scan）。
import type { BodyScan } from "./types";

export interface Measurements {
  /** 胸まわり（バスト） */
  chest: number;
  /** ウエスト（いちばん細いところ） */
  waist: number;
  /** ヒップ（いちばん太いところ） */
  hip: number;
  /** 太ももまわり（付け根のすぐ下） */
  thigh: number;
  /** ふくらはぎまわり */
  calf: number;
  /** 二の腕まわり */
  bicep: number;
  /** 手首まわり */
  wrist: number;
  /** 肩幅（左右の肩の骨のあいだ） */
  shoulder: number;
  /** 肩から股までの長さ */
  shoulderToCrotch: number;
  /** 股下（股から床まで） */
  legLength: number;
  /** 腕の長さ（肩から手首） */
  armLength: number;
}

export const MEASUREMENT_LABELS: Record<keyof Measurements, string> = {
  chest: "胸まわり",
  waist: "ウエスト",
  hip: "ヒップ",
  thigh: "太もも",
  calf: "ふくらはぎ",
  bicep: "二の腕",
  wrist: "手首",
  shoulder: "肩幅",
  shoulderToCrotch: "肩から股",
  legLength: "股下",
  armLength: "腕の長さ",
};

/** 幅 w・厚み d の楕円の周囲（ラマヌジャンの近似） */
export function ellipsePerimeter(w: number, d: number): number {
  const a = w / 2;
  const b = d / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

const minBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, b) => (f(b) < f(a) ? b : a));
const maxBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));

/** 身長（cm）を掛けて、採寸値（cm）にする */
export function estimateMeasurements(scan: BodyScan, heightCm: number): Measurements {
  const H = heightCm;
  const circ = (s: { width: number; depth: number }) => ellipsePerimeter(s.width, s.depth) * H;
  const t = scan.torso;
  const chest = maxBy(t.slice(0, 3), circ);
  const waist = minBy(t.slice(3, 7), circ);
  const hip = maxBy(t.slice(6), circ);
  const legs = scan.legs;
  const thigh = legs[0];
  const calf = maxBy(legs.slice(3, 7), circ);
  return {
    chest: circ(chest),
    waist: circ(waist),
    hip: circ(hip),
    thigh: circ(thigh),
    calf: circ(calf),
    bicep: Math.PI * scan.arm.upper * H,
    wrist: Math.PI * scan.arm.wrist * H,
    shoulder: scan.shoulder.width * H,
    shoulderToCrotch: (scan.crotchY - scan.shoulder.y) * H,
    legLength: (1 - scan.crotchY) * H,
    armLength: scan.arm.length * H,
  };
}
