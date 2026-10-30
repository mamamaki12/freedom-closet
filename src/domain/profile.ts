// 本人の体型とサイズ。買い足しのサイズの目安や、コーデの着こなしのひとことに使う。
import type { Category, GarmentInfo } from "./types";

export const FITS = ["mens", "womens"] as const;
export type Fit = (typeof FITS)[number];
export const FIT_LABELS: Record<Fit, string> = { mens: "メンズ", womens: "レディース" };

/** 服のサイズの並び（大きさを比べるのに使う） */
export const CLOTHING_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
/** 靴のサイズの候補（cm） */
export const SHOE_SIZES = ["22.5", "23", "23.5", "24", "24.5", "25", "25.5", "26", "26.5", "27", "27.5", "28", "28.5", "29"];

export type SizeGroup = "tops" | "bottoms" | "shoes";
export const SIZE_GROUP_LABELS: Record<SizeGroup, string> = { tops: "トップス・アウター", bottoms: "ボトムス", shoes: "靴" };

export interface Profile {
  heightCm?: number;
  weightKg?: number;
  /** サイズ表をメンズ・レディースのどちらで見るか */
  fit?: Fit;
  /** いつも着ているサイズ。服を登録するときに自動で入れる */
  usualSize?: Partial<Record<SizeGroup, string>>;
}

export function sizeGroup(category: Category): SizeGroup {
  if (category === "shoes") return "shoes";
  if (category === "bottoms") return "bottoms";
  return "tops";
}

/** 身長から見たサイズの目安（ユニクロ・GUのサイズ表のおおよその真ん中） */
const HEIGHT_CHART: Record<Fit, [number, (typeof CLOTHING_SIZES)[number]][]> = {
  mens: [
    [160, "XS"],
    [167, "S"],
    [174, "M"],
    [181, "L"],
    [188, "XL"],
  ],
  womens: [
    [150, "XS"],
    [156, "S"],
    [162, "M"],
    [168, "L"],
    [174, "XL"],
  ],
};

/**
 * 買うときのサイズの目安。いつものサイズがあればそれ、なければ身長と体重から出す。
 * 分からなければ undefined（靴は身長からは出さない）。
 */
export function recommendSize(profile: Profile, category: Category): { size: string; basis: "usual" | "body" } | undefined {
  const group = sizeGroup(category);
  const usual = profile.usualSize?.[group];
  if (usual) return { size: usual, basis: "usual" };
  if (group === "shoes" || !profile.fit || !profile.heightCm) return undefined;
  const chart = HEIGHT_CHART[profile.fit];
  let idx = chart.findIndex(([h]) => profile.heightCm! < h + 3.5);
  if (idx === -1) idx = chart.length;
  // 体重が身長に比べて重め・軽めなら1つずらす（BMI 25 以上・18.5 未満）
  if (profile.weightKg) {
    const bmi = profile.weightKg / (profile.heightCm / 100) ** 2;
    if (bmi >= 25) idx += 1;
    else if (bmi < 18.5) idx -= 1;
  }
  const sizes = CLOTHING_SIZES;
  return { size: sizes[Math.max(0, Math.min(sizes.length - 1, idx))], basis: "body" };
}

/** いつものサイズと比べて、何段大きいか（XS〜XXL 以外は比べられないので undefined） */
export function sizeDiff(garment: GarmentInfo, profile: Profile): number | undefined {
  const usual = profile.usualSize?.[sizeGroup(garment.category)];
  if (!garment.size || !usual || garment.category === "shoes") return undefined;
  const a = CLOTHING_SIZES.indexOf(garment.size.toUpperCase() as (typeof CLOTHING_SIZES)[number]);
  const b = CLOTHING_SIZES.indexOf(usual.toUpperCase() as (typeof CLOTHING_SIZES)[number]);
  return a === -1 || b === -1 ? undefined : a - b;
}

/** 身長の目安（メンズ・レディースが分からないときは間の値で見る） */
function heightBand(profile: Profile): "short" | "tall" | undefined {
  const h = profile.heightCm;
  if (!h) return undefined;
  const [short, tall] = profile.fit === "mens" ? [165, 180] : profile.fit === "womens" ? [153, 168] : [158, 175];
  return h < short ? "short" : h >= tall ? "tall" : undefined;
}

/** 体型とサイズから、着こなしのひとことを1〜2個 */
export function bodyTips(items: GarmentInfo[], profile: Profile): string[] {
  const tips: string[] = [];
  const top = items.find((g) => g.category === "tops");
  const bottom = items.find((g) => g.category === "bottoms");
  const outer = items.find((g) => g.category === "outer");
  const band = heightBand(profile);

  if (band === "short") {
    if (top && bottom) tips.push("トップスの裾を前だけ入れて腰の位置を高く見せると、脚が長く見えます。");
    else if (outer && /コート/.test(outer.subType)) tips.push("コートは膝より上の丈だと、重く見えにくいです。");
  } else if (band === "tall") {
    if (bottom && /ワイド|スカート/.test(bottom.subType)) tips.push(`背が高めなので、${bottom.subType}のゆったりしたシルエットがきれいに映えます。`);
    else if (outer && /コート/.test(outer.subType)) tips.push("背が高めなので、長めの丈のコートも着こなしやすいです。");
  }

  for (const g of items) {
    const d = sizeDiff(g, profile);
    if (d === undefined || d === 0) continue;
    tips.push(
      d > 0
        ? `${g.subType}はいつもより大きめ（${g.size}）なので、袖や裾を少しまくってゆったり着るとこなれて見えます。`
        : `${g.subType}はいつもより小さめ（${g.size}）なので、下に着るものは薄手にするとすっきりします。`,
    );
    break;
  }
  return tips.slice(0, 2);
}
