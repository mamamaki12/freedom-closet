// 端末内AIのコーデ提案。種類・色・気温・目的・過去の評価から点数を付けて上位3案を選ぶ。
import { colorHarmony, colorLabel } from "../../domain/colors";
import type {
  Feedback,
  Formality,
  GarmentInfo,
  Outfit,
  OutfitRequest,
  Purpose,
  Season,
  Warmth,
} from "../../domain/types";
import { outfitKey } from "../../domain/types";
import { MAX_OUTFITS } from "../types";

const PURPOSE_FORMALITY: Record<Purpose, Formality[]> = {
  everyday: ["casual", "smart"],
  work: ["smart", "formal"],
  date: ["smart", "casual"],
  outdoor: ["casual"],
  formal: ["formal", "smart"],
};

/** 気温に合う季節と、トップス・アウターに求める暖かさ */
export function climateFor(temperatureC: number | undefined): {
  seasons: Season[];
  outer: "none" | "optional" | "required";
  warmth: Warmth;
} {
  if (temperatureC === undefined) return { seasons: [], outer: "optional", warmth: 2 };
  if (temperatureC >= 25) return { seasons: ["summer"], outer: "none", warmth: 1 };
  if (temperatureC >= 20) return { seasons: ["spring", "summer", "autumn"], outer: "none", warmth: 1 };
  if (temperatureC >= 15) return { seasons: ["spring", "autumn"], outer: "optional", warmth: 2 };
  if (temperatureC >= 10) return { seasons: ["spring", "autumn", "winter"], outer: "required", warmth: 2 };
  return { seasons: ["winter"], outer: "required", warmth: 3 };
}

interface Combo {
  items: GarmentInfo[];
}

/** 手持ちの服から、着られる組み合わせを全部作る（トップス×ボトムス or ワンピース、＋アウター、＋靴） */
export function buildCombos(closet: GarmentInfo[], temperatureC?: number): Combo[] {
  const by = (c: GarmentInfo["category"]) => closet.filter((g) => g.category === c);
  const tops = by("tops");
  const bottoms = by("bottoms");
  const onepieces = by("onepiece");
  const outers = by("outer");
  const shoes = by("shoes");
  const { outer } = climateFor(temperatureC);

  const bases: GarmentInfo[][] = [];
  for (const t of tops) for (const b of bottoms) bases.push([t, b]);
  for (const o of onepieces) bases.push([o]);

  const outerOptions: (GarmentInfo | null)[] =
    outer === "none" ? [null] : outer === "required" && outers.length > 0 ? outers : [null, ...outers];
  const shoeOptions: (GarmentInfo | null)[] = shoes.length > 0 ? shoes : [null];

  const combos: Combo[] = [];
  for (const base of bases)
    for (const o of outerOptions)
      for (const s of shoeOptions) {
        const items = [...base];
        if (o) items.push(o);
        if (s) items.push(s);
        combos.push({ items });
      }
  return combos;
}

interface FeedbackIndex {
  dislikedOutfits: Set<string>;
  likedOutfits: Set<string>;
  /** 服2着の組み合わせごとの好み（好き +1 / 好みじゃない -1 の合計） */
  pairs: Map<string, number>;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function indexFeedback(feedback: Feedback[]): FeedbackIndex {
  const idx: FeedbackIndex = { dislikedOutfits: new Set(), likedOutfits: new Set(), pairs: new Map() };
  for (const f of feedback) {
    (f.liked ? idx.likedOutfits : idx.dislikedOutfits).add(f.outfitKey);
    const ids = f.garmentIds;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = pairKey(ids[i], ids[j]);
        idx.pairs.set(k, (idx.pairs.get(k) ?? 0) + (f.liked ? 1 : -1));
      }
  }
  return idx;
}

export interface ScoredCombo {
  items: GarmentInfo[];
  score: number;
  reasons: string[];
}

export function scoreCombo(items: GarmentInfo[], request: OutfitRequest, fb: FeedbackIndex): ScoredCombo {
  const reasons: string[] = [];
  let score = 0;

  // 色
  const harmony = colorHarmony(items.map((g) => g.color));
  score += harmony.score;
  reasons.push(...harmony.reasons);

  // 季節・気温
  const climate = climateFor(request.temperatureC);
  if (climate.seasons.length > 0) {
    const off = items.filter(
      (g) => g.category !== "shoes" && g.seasons.length > 0 && !g.seasons.some((s) => climate.seasons.includes(s)),
    );
    score -= off.length * 1.5;
    const main = items.find((g) => g.category === "tops" || g.category === "onepiece");
    if (main) score -= Math.abs(main.warmth - climate.warmth) * 0.75;
    const outer = items.find((g) => g.category === "outer");
    if (outer && request.temperatureC !== undefined) {
      reasons.push(`気温${request.temperatureC}℃なので、${outer.subType || "アウター"}を重ねています。脱いでもまとまる組み合わせです。`);
    }
  }

  // 目的とのきれいめ度
  const wanted = PURPOSE_FORMALITY[request.purpose];
  for (const g of items) {
    if (g.formality === wanted[0]) score += 0.5;
    else if (!wanted.includes(g.formality)) score -= 1;
  }

  // 好みの記録
  const key = outfitKey(items.map((g) => g.id));
  if (fb.likedOutfits.has(key)) {
    score += 1.5;
    reasons.push("前に「好き」を付けた組み合わせです。");
  }
  let pairScore = 0;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) pairScore += fb.pairs.get(pairKey(items[i].id, items[j].id)) ?? 0;
  score += Math.max(-3, Math.min(3, pairScore * 0.5));

  // 自由記述の好み（端末内AIは簡単なキーワードだけ見る）
  const pref = request.preference ?? "";
  if (/明る|華やか|派手/.test(pref) && items.some((g) => !["black", "gray", "navy", "brown"].includes(g.color))) score += 0.5;
  if (/落ち着|シック|地味|モノトーン/.test(pref) && items.every((g) => ["black", "white", "gray", "navy"].includes(g.color)))
    score += 0.5;

  reasons.push(...stylingTips(items));
  return { items, score, reasons };
}

/** 袖・裾などの着こなしのコツ（種類の名前から判断） */
export function stylingTips(items: GarmentInfo[]): string[] {
  const tips: string[] = [];
  const top = items.find((g) => g.category === "tops");
  const bottom = items.find((g) => g.category === "bottoms");
  const outer = items.find((g) => g.category === "outer");
  const has = (g: GarmentInfo | undefined, re: RegExp) => !!g && re.test(g.subType);

  if (top && has(bottom, /ワイド|スカート|フレア/)) {
    tips.push(`ボトムスにボリュームがあるので、${top.subType || "トップス"}の裾は前だけ入れるとバランスが取りやすいです。`);
  } else if (top && has(bottom, /スキニー|スリム|テーパード/)) {
    tips.push(`細身のボトムスなので、${top.subType || "トップス"}は外に出してゆるさを足すと今っぽく見えます。`);
  }
  // 「Tシャツ」は袖をまくる対象にしない
  const shirt = /(?<![TＴ])シャツ|ブラウス/;
  if (has(top, shirt) && outer) {
    tips.push("アウターの袖を少しまくって、シャツの袖口をのぞかせると軽く見えます。");
  } else if (has(top, shirt)) {
    tips.push("シャツの袖を2回ほどまくると、こなれた印象になります。");
  }
  if (has(top, /ニット|セーター|スウェット|パーカー/) && bottom && bottom.formality !== "casual") {
    tips.push("カジュアルなトップスにきれいめのボトムスを合わせて、ほどよく大人っぽくしています。");
  }
  if (bottom && has(bottom, /デニム|ジーンズ/) && items.some((g) => g.category === "shoes")) {
    tips.push("デニムの裾は靴に少しかかる長さか、1回ロールアップすると足元がすっきりします。");
  }
  return tips;
}

function titleFor(items: GarmentInfo[]): string {
  const main = items.filter((g) => g.category !== "shoes").map((g) => `${colorLabel(g.color)}の${g.subType || "服"}`);
  return main.join(" × ");
}

/** 似た案ばかりにならないように、服がかぶる案は後回しにしながら上位を選ぶ */
export function pickDiverse(scored: ScoredCombo[], n: number): ScoredCombo[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const picked: ScoredCombo[] = [];
  const used = new Map<string, number>();
  const remaining = [...sorted];
  while (picked.length < n && remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const overlap = remaining[i].items
        .filter((g) => g.category !== "shoes")
        .reduce((s, g) => s + (used.get(g.id) ?? 0), 0);
      const val = remaining[i].score - overlap * 1.2;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    const [c] = remaining.splice(bestIdx, 1);
    picked.push(c);
    for (const g of c.items) used.set(g.id, (used.get(g.id) ?? 0) + 1);
  }
  return picked;
}

export function suggestOutfitsLocal(closet: GarmentInfo[], request: OutfitRequest, feedback: Feedback[]): Outfit[] {
  const fb = indexFeedback(feedback);
  const combos = buildCombos(closet, request.temperatureC)
    .filter((c) => request.mustInclude.every((id) => c.items.some((g) => g.id === id)))
    .filter((c) => !fb.dislikedOutfits.has(outfitKey(c.items.map((g) => g.id))));

  const scored = combos.map((c) => scoreCombo(c.items, request, fb));
  return pickDiverse(scored, MAX_OUTFITS).map((s) => {
    const ids = s.items.map((g) => g.id);
    return { key: outfitKey(ids), garmentIds: ids, title: titleFor(s.items), explanation: s.reasons, score: s.score };
  });
}
