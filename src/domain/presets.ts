// よくある服の種類と、その初期値。種類を1回タップするだけで季節・雰囲気・厚さまで入るようにする。
import type { Category, Formality, GarmentInfo, Season, Warmth } from "./types";

export interface Preset {
  category: Category;
  subType: string;
  seasons: Season[];
  formality: Formality;
  warmth: Warmth;
}

const ALL: Season[] = ["spring", "summer", "autumn", "winter"];
const MILD: Season[] = ["spring", "autumn"];

export const PRESETS: Preset[] = [
  { category: "tops", subType: "Tシャツ", seasons: ["spring", "summer", "autumn"], formality: "casual", warmth: 1 },
  { category: "tops", subType: "シャツ", seasons: ["spring", "summer", "autumn"], formality: "smart", warmth: 2 },
  { category: "tops", subType: "ブラウス", seasons: ["spring", "summer", "autumn"], formality: "smart", warmth: 1 },
  { category: "tops", subType: "ニット", seasons: ["autumn", "winter"], formality: "smart", warmth: 3 },
  { category: "tops", subType: "スウェット", seasons: ["spring", "autumn", "winter"], formality: "casual", warmth: 2 },
  { category: "tops", subType: "パーカー", seasons: ["spring", "autumn", "winter"], formality: "casual", warmth: 2 },
  { category: "outer", subType: "カーディガン", seasons: MILD, formality: "smart", warmth: 2 },
  { category: "outer", subType: "ジャケット", seasons: MILD, formality: "formal", warmth: 2 },
  { category: "outer", subType: "デニムジャケット", seasons: MILD, formality: "casual", warmth: 2 },
  { category: "outer", subType: "コート", seasons: ["autumn", "winter"], formality: "smart", warmth: 3 },
  { category: "outer", subType: "ダウン", seasons: ["winter"], formality: "casual", warmth: 3 },
  { category: "bottoms", subType: "デニム", seasons: ALL, formality: "casual", warmth: 2 },
  { category: "bottoms", subType: "ワイドパンツ", seasons: ALL, formality: "smart", warmth: 2 },
  { category: "bottoms", subType: "スラックス", seasons: ALL, formality: "formal", warmth: 2 },
  { category: "bottoms", subType: "チノパンツ", seasons: ["spring", "summer", "autumn"], formality: "casual", warmth: 2 },
  { category: "bottoms", subType: "ショートパンツ", seasons: ["summer"], formality: "casual", warmth: 1 },
  { category: "bottoms", subType: "スカート", seasons: ALL, formality: "smart", warmth: 2 },
  { category: "onepiece", subType: "ワンピース", seasons: ["spring", "summer", "autumn"], formality: "smart", warmth: 2 },
  { category: "shoes", subType: "スニーカー", seasons: ALL, formality: "casual", warmth: 2 },
  { category: "shoes", subType: "革靴", seasons: ALL, formality: "formal", warmth: 2 },
  { category: "shoes", subType: "ブーツ", seasons: ["autumn", "winter"], formality: "smart", warmth: 3 },
  { category: "shoes", subType: "サンダル", seasons: ["summer"], formality: "casual", warmth: 1 },
];

/** 種類の名前から初期値を探す（「白シャツ」のように前後に言葉が付いていても拾う） */
export function presetFor(subType: string | null | undefined, category?: Category | null): Preset | undefined {
  if (!subType) return undefined;
  const pool = category ? PRESETS.filter((p) => p.category === category) : PRESETS;
  // 長い名前から順に見る（「デニムジャケット」を「デニム」と間違えない）
  return (
    pool.find((p) => p.subType === subType) ??
    [...pool].sort((a, b) => b.subType.length - a.subType.length).find((p) => subType.includes(p.subType))
  );
}

export function applyPreset<T extends Partial<GarmentInfo>>(g: T, p: Preset): T & Preset {
  return { ...g, category: p.category, subType: p.subType, seasons: p.seasons, formality: p.formality, warmth: p.warmth };
}
