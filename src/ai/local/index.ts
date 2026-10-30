import type { GarmentAnalysis, Pattern } from "../../domain/types";
import type { AnalyzeOptions, ClosetAI, OutfitInput, PurchaseInput } from "../types";
import { classifyGarment, DEFAULT_LOCAL_MODEL, type Classified } from "./classifier";
import { extractPalette, readPixels, type Palette } from "./color";
import { suggestOutfitsLocal } from "./outfits";
import { suggestPurchasesLocal } from "./purchases";

/** 端末内だけで動くAI。写真も服の情報も端末の外に出さない。 */
export class LocalAI implements ClosetAI {
  readonly id = "local" as const;
  readonly label = "端末内AI";
  readonly sendsPhotosOffDevice = false;

  constructor(private readonly modelId: string = DEFAULT_LOCAL_MODEL) {}

  async analyzeGarment(photo: Blob, options?: AnalyzeOptions): Promise<GarmentAnalysis> {
    const { data, width, height } = await readPixels(photo);
    const palette = extractPalette(data, width, height);
    let classified: Classified;
    try {
      classified = await classifyGarment(photo, this.modelId, options);
    } catch (e) {
      if (options?.signal?.aborted) throw e;
      // 種類が分からなくても、色は写真から取れているので返す
      const { color, colorHex, subColor, pattern } = combine(palette);
      return {
        category: null,
        subType: null,
        color,
        colorHex,
        subColor,
        pattern,
        confidence: 0,
        candidates: [],
        warning: `種類の判定モデルを読み込めませんでした。色だけ入れたので、種類は手で選んでください。（${e instanceof Error ? e.message : String(e)}）`,
      };
    }
    return mergeAnalysis(classified, palette);
  }

  async suggestOutfits(input: OutfitInput) {
    return suggestOutfitsLocal(input.closet, input.request, input.feedback, input.profile);
  }

  async suggestPurchases(input: PurchaseInput) {
    return suggestPurchasesLocal(input.closet, input.request, input.feedback);
  }
}

/** 色の分析だけから分かること（モデルなしでも使う） */
function combine(palette: Palette): Pick<GarmentAnalysis, "color" | "colorHex" | "subColor" | "pattern"> {
  const [first, second] = palette.colors;
  return {
    color: first.name,
    colorHex: first.hex,
    subColor: palette.multiColor && second ? second.name : undefined,
    pattern: palette.multiColor ? "print" : undefined,
  };
}

/** 柄だと言い切るのに必要な点数（CLIPの点数は言い方の数で変わるので、無地との差で見る） */
const PATTERN_MARGIN = 0.1;

/**
 * 種類（CLIP）と色（画素）と柄（CLIP＋画素）を1つの判定にまとめる（純粋な計算なのでテストできる）。
 * - 柄：CLIPが無地以外を無地よりはっきり高く出せばその柄。CLIPが無地と言っても画素が2色以上なら「柄もの」
 * - 2番目の色：画素で2色以上のときだけ入れる
 * - 確からしさ：同じ種類（カテゴリ）の候補の合計。柄ものは色の判定が揺れやすいので少し下げる
 */
export function mergeAnalysis(classified: Classified, palette: Palette): GarmentAnalysis {
  const { types, patterns } = classified;
  const top = types[0];
  const sameCategory = types.filter((r) => r.label.category === top.label.category).reduce((s, r) => s + r.score, 0);

  const solid = patterns.find((p) => p.pattern === "solid")?.score ?? 0;
  const bestPattern = patterns.find((p) => p.pattern !== "solid");
  let pattern: Pattern | undefined;
  if (bestPattern && bestPattern.score - solid >= PATTERN_MARGIN) pattern = bestPattern.pattern;
  else if (palette.multiColor) pattern = "print";
  else pattern = "solid";

  const [first, second] = palette.colors;
  const subColor = second && (palette.multiColor || pattern !== "solid") && second.name !== first.name ? second.name : undefined;

  const confidence = Math.min(1, sameCategory) * (pattern !== "solid" ? 0.85 : 1);
  return {
    category: top.label.category,
    subType: top.label.subType,
    color: first.name,
    colorHex: first.hex,
    pattern,
    subColor,
    confidence,
    candidates: types.slice(0, 5).map((r) => ({ category: r.label.category, subType: r.label.subType, score: r.score })),
  };
}
