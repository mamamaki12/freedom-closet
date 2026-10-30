// 端末内AIの買い足し提案。定番アイテムの候補を1つずつ仮に足してみて、
// 増えるコーデの数・手持ちとの重複・避けたい色から順位を付ける。
import { colorLabel } from "../../domain/colors";
import type {
  Category,
  ColorName,
  Feedback,
  Formality,
  GarmentInfo,
  PurchaseRequest,
  PurchaseSuggestion,
  Season,
  Warmth,
} from "../../domain/types";
import { MAX_PURCHASES } from "../types";
import { buildCombos, indexFeedback, scoreCombo } from "./outfits";

interface Basic {
  category: Category;
  subType: string;
  colors: ColorName[];
  formality: Formality;
  warmth: Warmth;
  seasons: Season[];
}

/** ユニクロ・GUで見つけやすい定番の種類と色 */
const BASICS: Basic[] = [
  { category: "tops", subType: "Tシャツ", colors: ["white", "black", "gray", "navy"], formality: "casual", warmth: 1, seasons: ["spring", "summer", "autumn"] },
  { category: "tops", subType: "シャツ", colors: ["white", "lightblue", "navy"], formality: "smart", warmth: 2, seasons: ["spring", "summer", "autumn"] },
  { category: "tops", subType: "ニット", colors: ["beige", "gray", "navy", "black"], formality: "smart", warmth: 3, seasons: ["autumn", "winter"] },
  { category: "tops", subType: "スウェット", colors: ["gray", "navy", "green"], formality: "casual", warmth: 2, seasons: ["spring", "autumn", "winter"] },
  { category: "bottoms", subType: "ワイドパンツ", colors: ["black", "beige", "gray"], formality: "smart", warmth: 2, seasons: ["spring", "summer", "autumn", "winter"] },
  { category: "bottoms", subType: "デニム", colors: ["blue", "black"], formality: "casual", warmth: 2, seasons: ["spring", "summer", "autumn", "winter"] },
  { category: "bottoms", subType: "チノパンツ", colors: ["beige", "khaki", "navy"], formality: "casual", warmth: 2, seasons: ["spring", "summer", "autumn"] },
  { category: "bottoms", subType: "スラックス", colors: ["black", "gray", "navy"], formality: "formal", warmth: 2, seasons: ["spring", "autumn", "winter"] },
  { category: "outer", subType: "カーディガン", colors: ["navy", "beige", "black"], formality: "smart", warmth: 2, seasons: ["spring", "autumn"] },
  { category: "outer", subType: "ジャケット", colors: ["navy", "black", "beige"], formality: "formal", warmth: 2, seasons: ["spring", "autumn"] },
  { category: "outer", subType: "コート", colors: ["black", "beige", "navy"], formality: "smart", warmth: 3, seasons: ["winter"] },
  { category: "shoes", subType: "スニーカー", colors: ["white", "black"], formality: "casual", warmth: 2, seasons: ["spring", "summer", "autumn", "winter"] },
];

const GOOD_SCORE = 1.5;

function goodCombos(closet: GarmentInfo[], fb: ReturnType<typeof indexFeedback>, required?: GarmentInfo) {
  return buildCombos(closet, undefined, required).filter(
    (c) => scoreCombo(c.items, { mustInclude: [], purpose: "everyday" }, fb).score >= GOOD_SCORE,
  );
}

export function suggestPurchasesLocal(
  closet: GarmentInfo[],
  request: PurchaseRequest,
  feedback: Feedback[],
): PurchaseSuggestion[] {
  const fb = indexFeedback(feedback);
  const before = goodCombos(closet, fb).length;
  const hasShoes = closet.some((g) => g.category === "shoes");
  const results: (PurchaseSuggestion & { rank: number })[] = [];

  for (const basic of BASICS) {
    for (const color of basic.colors) {
      if (request.avoidColors.includes(color)) continue;
      const duplicate = closet.some(
        (g) => g.category === basic.category && g.color === color && (g.subType === basic.subType || !g.subType),
      );
      if (duplicate) continue;

      const virtual: GarmentInfo = { id: "__new__", ...basic, color };
      // 足しても今の組み合わせは減らないので、新しい服を含む組み合わせだけ数えれば増えた数になる。
      // ただし初めての靴は、靴なしの組み合わせを置きかえるので、その分を引く
      const withNewCombos = goodCombos([...closet, virtual], fb, virtual);
      const gained = withNewCombos.length - (basic.category === "shoes" && !hasShoes ? before : 0);
      if (gained <= 0) continue;

      const matches = withNewCombos
        .flatMap((c) => c.items.filter((g) => g.id !== "__new__" && g.category !== "shoes").map((g) => g.id));
      const matchesWith = [...new Set(matches)];

      const name = `${colorLabel(color)}の${basic.subType}`;
      const sameCategory = closet.filter((g) => g.category === basic.category).length;
      // 服が多いと「591通り」のような実感のない数になるので、大きい数はまるめる
      const more = gained >= 100 ? "100通り以上" : `${gained}通り`;
      const reason =
        sameCategory === 0
          ? `${name}があると、まだ持っていない種類が埋まり、コーデが${more}増えます。`
          : `手持ちの服${matchesWith.length}着と合わせられ、コーデが${more}増えます。`;

      results.push({
        category: basic.category,
        color,
        subType: basic.subType,
        searchQuery: `${colorLabel(color)} ${basic.subType}`,
        reason,
        newOutfitCount: gained,
        matchesWith,
        // 持っていない種類を優先し、同じ種類が多いほど下げる
        rank: gained + (sameCategory === 0 ? 3 : 0) - sameCategory * 0.5,
      });
    }
  }

  // 同じ種類が並びすぎないよう、カテゴリごとに1つ → 服の名前ごとに1つ → 残り、の順に取る
  results.sort((a, b) => b.rank - a.rank);
  const picked: typeof results = [];
  for (const keyOf of [(r: (typeof results)[number]) => r.category, (r: (typeof results)[number]) => `${r.category}:${r.subType}`]) {
    const seen = new Set(picked.map(keyOf));
    for (const r of results) {
      if (picked.includes(r) || seen.has(keyOf(r))) continue;
      seen.add(keyOf(r));
      picked.push(r);
    }
  }
  for (const r of results) if (!picked.includes(r)) picked.push(r);

  return picked.slice(0, MAX_PURCHASES).map(({ rank: _rank, ...s }) => s);
}
