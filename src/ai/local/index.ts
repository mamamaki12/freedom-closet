import type { GarmentAnalysis } from "../../domain/types";
import type { AnalyzeOptions, ClosetAI, OutfitInput, PurchaseInput } from "../types";
import { classifyGarment, DEFAULT_LOCAL_MODEL } from "./classifier";
import { dominantColor, readPixels } from "./color";
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
    const color = dominantColor(data, width, height);
    let ranked: Awaited<ReturnType<typeof classifyGarment>>;
    try {
      ranked = await classifyGarment(photo, this.modelId, options);
    } catch (e) {
      if (options?.signal?.aborted) throw e;
      // 種類が分からなくても、色は写真から取れているので返す
      return {
        category: null,
        subType: null,
        color: color.name,
        colorHex: color.hex,
        confidence: 0,
        candidates: [],
        warning: `種類の判定モデルを読み込めませんでした。色だけ入れたので、種類は手で選んでください。（${e instanceof Error ? e.message : String(e)}）`,
      };
    }

    // 上位の候補を、種類（カテゴリ）ごとに合計して確からしさを出す
    const top = ranked[0];
    const sameCategory = ranked.filter((r) => r.label.category === top.label.category).reduce((s, r) => s + r.score, 0);
    return {
      category: top.label.category,
      subType: top.label.subType,
      color: color.name,
      colorHex: color.hex,
      confidence: Math.min(1, sameCategory),
      candidates: ranked.slice(0, 5).map((r) => ({ category: r.label.category, subType: r.label.subType, score: r.score })),
    };
  }

  async suggestOutfits(input: OutfitInput) {
    return suggestOutfitsLocal(input.closet, input.request, input.feedback, input.profile);
  }

  async suggestPurchases(input: PurchaseInput) {
    return suggestPurchasesLocal(input.closet, input.request, input.feedback);
  }
}
