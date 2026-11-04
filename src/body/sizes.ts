// 写真で測った体型と身長・体重から、胸囲・ウエスト・ヒップなどの目安（cm）を出す。
// 式は Amazon 公開の体型データ BodyM（2018人の写真のシルエットと実測値）で合わせた（tools/body-eval/fit.py → sizeModel.json）。
// 写真だけ・身長体重だけよりも、両方を組み合わせたほうがよく当たる（別の400人で確かめた。docs/body-scan.md）。
import type { Profile } from "../domain/profile";
import model from "./sizeModel.json";
import type { BodyScan, ScanMarks } from "./types";

export const SIZE_KEYS = ["chest", "waist", "hip", "thigh", "calf", "shoulder"] as const;
export type SizeKey = (typeof SIZE_KEYS)[number];

export const SIZE_LABELS: Record<SizeKey, string> = {
  chest: "胸囲",
  waist: "ウエスト",
  hip: "ヒップ",
  thigh: "太もも",
  calf: "ふくらはぎ",
  shoulder: "肩幅",
};

/** 画面に出す目安。error は別の400人（BodyM testB）で確かめた平均のずれ（cm） */
export interface SizeEstimate {
  key: SizeKey;
  cm: number;
  error: number;
}

type Coef = number[];
interface Model {
  rho: Record<"chest" | "waist" | "hip", number>;
  models: Record<string, { hw: Coef; h?: Coef }>;
  /** testB で確かめた平均のずれ（cm）。[体重あり, 体重なし] */
  error: Record<SizeKey, [number, number]>;
}
const M = model as unknown as Model;

/** 人の体としてありえる範囲（cm） */
const RANGE: Record<SizeKey, [number, number]> = {
  chest: [60, 160],
  waist: [50, 160],
  hip: [65, 170],
  thigh: [30, 90],
  calf: [22, 60],
  shoulder: [25, 55],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** だ円の周の長さ（ラマヌジャンの近似） */
export function ellipse(w: number, d: number) {
  const a = w / 2;
  const b = d / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/**
 * どの式を使うか。ヒップは横の写真の厚みを使わない（下ろした手が重なって厚く出やすく、
 * BodyM では正面の幅だけのほうがよく当たった）
 */
function variant(marks: ScanMarks, key: SizeKey): string {
  if (key === "chest" || key === "waist") return `${key}.${marks[key].depth ? "side" : "front"}`;
  if (key === "hip") return "hip.front";
  return `${key}.side`;
}

/** 写真で測った値を、式に入れる形（身長を1とした周の長さ・幅）にする */
function photoValue(marks: ScanMarks, key: SizeKey): number {
  if (key === "chest" || key === "waist" || key === "hip") {
    const s = marks[key];
    const d = key !== "hip" ? s.depth : undefined;
    return ellipse(s.width, d ?? s.width * M.rho[key]);
  }
  if (key === "thigh" || key === "calf") return Math.PI * marks[key];
  return marks.shoulder;
}

/** レディースを選んでいれば1、メンズなら0、未設定なら0.5（男女の真ん中） */
function femaleness(profile: Profile) {
  return profile.fit === "womens" ? 1 : profile.fit === "mens" ? 0 : 0.5;
}

function dot(c: Coef, x: number[]) {
  return x.reduce((s, v, i) => s + v * c[i], c[x.length]);
}

/** ひとつの項目の目安（cm）。withWeight=false なら体重を使わない式 */
function estimate(marks: ScanMarks, profile: Profile, key: SizeKey, withWeight: boolean): number | undefined {
  const h = profile.heightCm;
  if (!h) return undefined;
  const m = M.models[variant(marks, key)];
  const x = photoValue(marks, key) * h;
  const f = femaleness(profile);
  const w = profile.weightKg;
  const v = withWeight && w ? dot(m.hw, [h, w, w / (h / 100) ** 2, f, x]) : m.h ? dot(m.h, [h, f, x]) : undefined;
  return v === undefined ? undefined : clamp(v, ...RANGE[key]);
}

/**
 * 胸囲・ウエスト・ヒップなどの目安。身長が未登録か、古い保存データ（写真で測った値がない）なら undefined。
 * 体重も登録されていれば、写真と身長・体重を組み合わせた式を使う（よく当たる）。
 */
export function estimateSizes(scan: BodyScan, profile: Profile): SizeEstimate[] | undefined {
  const marks = scan.marks;
  if (!marks || !profile.heightCm) return undefined;
  const withWeight = !!profile.weightKg;
  const out: SizeEstimate[] = [];
  for (const key of SIZE_KEYS) {
    const cm = estimate(marks, profile, key, withWeight);
    if (cm !== undefined) out.push({ key, cm, error: M.error[key][withWeight ? 0 : 1] });
  }
  return out;
}

/** 身長・体重だけから出す、腕の太さ（cm の周）。写真の腕の太さはほとんど当たらなかったため */
function priorOnly(key: "upperArm" | "wrist", profile: Profile): number | undefined {
  const { heightCm: h, weightKg: w } = profile;
  if (!h || !w) return undefined;
  return dot(M.models[key].hw, [h, w, w / (h / 100) ** 2, femaleness(profile)]);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 3Dの体型を、写真と身長・体重を組み合わせた目安に合わせる。
 * 写真だけで測った太さは、写り方（姿勢・服・切り抜き）で数%ずれるので、胸・ウエスト・ヒップ・太もも・ふくらはぎ・肩の
 * それぞれで「組み合わせた目安 ÷ 写真だけの目安」の倍率を掛ける（あいだの高さはなめらかにつなぐ）。
 * 体重か身長が未登録、または写真で測った値がない（古い保存データ）なら、何もしない。
 */
export function calibrateScan(scan: BodyScan, profile: Profile): BodyScan {
  const marks = scan.marks;
  if (!marks || !profile.heightCm || !profile.weightKg) return scan;
  const k = (key: SizeKey) => {
    const both = estimate(marks, profile, key, true);
    const photo = estimate(marks, profile, key, false);
    // 大きく変えすぎない（写真で測った形はなるべく残す）
    return both && photo ? clamp(both / photo, 0.85, 1.15) : 1;
  };
  const anchors: [number, number][] = [
    [marks.chest.y, k("chest")],
    [marks.waist.y, k("waist")],
    [marks.hip.y, k("hip")],
  ].sort((a, b) => a[0] - b[0]) as [number, number][];
  const torsoK = (y: number) => {
    if (y <= anchors[0][0]) return anchors[0][1];
    for (let i = 1; i < anchors.length; i++) {
      const [y0, k0] = anchors[i - 1];
      const [y1, k1] = anchors[i];
      if (y <= y1) return lerp(k0, k1, (y - y0) / (y1 - y0 || 1));
    }
    return anchors[anchors.length - 1][1];
  };
  const kThigh = k("thigh");
  const kCalf = k("calf");
  // 太ももの倍率は股から脚の半分まで、ふくらはぎの倍率はそこから下
  const legK = (t: number) => (t <= 0.35 ? kThigh : t >= 0.6 ? kCalf : lerp(kThigh, kCalf, (t - 0.35) / 0.25));
  const h = profile.heightCm;
  const upper = priorOnly("upperArm", profile);
  const wrist = priorOnly("wrist", profile);
  return {
    ...scan,
    shoulder: { ...scan.shoulder, width: scan.shoulder.width * k("shoulder") },
    torso: scan.torso.map((t) => {
      const f = torsoK(t.y);
      return { ...t, width: t.width * f, depth: t.depth * f };
    }),
    legs: scan.legs.map((l) => {
      const f = legK(l.t);
      return { ...l, width: l.width * f, depth: l.depth * f };
    }),
    arm: {
      ...scan.arm,
      upper: upper ? clamp(upper / Math.PI / h, 0.03, 0.09) : scan.arm.upper,
      wrist: wrist ? clamp(wrist / Math.PI / h, 0.02, 0.05) : scan.arm.wrist,
    },
  };
}
