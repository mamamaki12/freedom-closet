// 端末内での服の種類と柄の判定。Transformers.js で CLIP 系モデルを動かし、
// 用意した英語の説明文のどれに一番近いかで決める（ゼロショット分類）。
// モデルは初回だけダウンロードし、以後はブラウザのキャッシュから読む。
//
// 精度のための工夫：
// - 1つの種類に言い方を複数用意し（"a t-shirt" / "a short-sleeve tee"…）、点数を合計する（プロンプトのアンサンブル）
// - 柄は種類とは別に、同じ写真で「無地／ボーダー／チェック／花柄／ドット／柄もの」を判定する
import type { Category, Pattern } from "../../domain/types";
import type { AnalyzeOptions } from "../types";

export interface Label {
  /** 同じ種類の言い方。先頭が代表 */
  prompts: string[];
  category: Category;
  subType: string;
}

export const LABELS: Label[] = [
  { prompts: ["a t-shirt", "a short-sleeve cotton tee", "a long-sleeve t-shirt"], category: "tops", subType: "Tシャツ" },
  { prompts: ["a polo shirt", "a collared knit polo"], category: "tops", subType: "ポロシャツ" },
  { prompts: ["a button-up shirt", "a collared dress shirt with buttons", "a short-sleeve open-collar shirt", "a flannel shirt"], category: "tops", subType: "シャツ" },
  { prompts: ["a blouse", "a women's blouse with a soft drape"], category: "tops", subType: "ブラウス" },
  { prompts: ["a knit sweater", "a wool pullover", "a turtleneck knit"], category: "tops", subType: "ニット" },
  { prompts: ["a sweatshirt", "a crewneck sweatshirt"], category: "tops", subType: "スウェット" },
  { prompts: ["a hoodie", "a hooded sweatshirt"], category: "tops", subType: "パーカー" },
  { prompts: ["a cardigan", "an open-front knit cardigan"], category: "outer", subType: "カーディガン" },
  { prompts: ["a blazer jacket", "a tailored suit jacket"], category: "outer", subType: "ジャケット" },
  { prompts: ["a denim jacket", "a jean jacket"], category: "outer", subType: "デニムジャケット" },
  { prompts: ["a nylon blouson jacket", "a windbreaker", "a bomber jacket", "a track jacket with a zipper"], category: "outer", subType: "ブルゾン" },
  { prompts: ["a coat", "a long wool overcoat", "a trench coat"], category: "outer", subType: "コート" },
  { prompts: ["a down jacket", "a puffer jacket"], category: "outer", subType: "ダウン" },
  { prompts: ["jeans", "blue denim pants"], category: "bottoms", subType: "デニム" },
  { prompts: ["wide-leg trousers", "loose wide pants"], category: "bottoms", subType: "ワイドパンツ" },
  { prompts: ["slim trousers", "slacks", "tapered dress pants"], category: "bottoms", subType: "スラックス" },
  { prompts: ["chino pants", "cotton twill pants"], category: "bottoms", subType: "チノパンツ" },
  { prompts: ["cargo pants with side pockets"], category: "bottoms", subType: "カーゴパンツ" },
  { prompts: ["sweatpants", "jogger pants with an elastic waist"], category: "bottoms", subType: "スウェットパンツ" },
  { prompts: ["shorts", "short pants"], category: "bottoms", subType: "ショートパンツ" },
  { prompts: ["a skirt", "a long skirt", "a pleated skirt"], category: "bottoms", subType: "スカート" },
  { prompts: ["a dress", "a one-piece dress", "a long dress"], category: "onepiece", subType: "ワンピース" },
  { prompts: ["sneakers", "a pair of sneakers", "running shoes"], category: "shoes", subType: "スニーカー" },
  { prompts: ["leather shoes", "a pair of leather dress shoes", "loafers"], category: "shoes", subType: "革靴" },
  { prompts: ["boots", "a pair of ankle boots"], category: "shoes", subType: "ブーツ" },
  { prompts: ["sandals", "a pair of sandals"], category: "shoes", subType: "サンダル" },
];

/** 柄の言い方。CLIP は柄の有無はよく見分けるが、細かい柄の種類は得意ではないので、言い方を具体的にする */
export const PATTERN_PROMPTS: { prompts: string[]; pattern: Pattern }[] = [
  { prompts: ["a plain solid-colored garment with no pattern", "a single-color piece of clothing"], pattern: "solid" },
  { prompts: ["a striped garment with horizontal or vertical stripes", "a border-striped shirt"], pattern: "stripe" },
  { prompts: ["a plaid checked garment", "a tartan or gingham check pattern on clothing"], pattern: "check" },
  { prompts: ["a floral print garment with flowers", "clothing with a botanical flower pattern"], pattern: "floral" },
  { prompts: ["a polka dot garment"], pattern: "dot" },
  { prompts: ["a garment with an all-over graphic print", "clothing with a colorful abstract or geometric pattern", "a shirt with a big logo or illustration print"], pattern: "print" },
];

export const DEFAULT_LOCAL_MODEL = "Xenova/clip-vit-base-patch32";

type Classifier = (image: string, labels: string[], opts: { hypothesis_template: string }) => Promise<{ label: string; score: number }[]>;

let loading: Promise<Classifier> | null = null;

async function loadClassifier(modelId: string, onProgress?: AnalyzeOptions["onProgress"]): Promise<Classifier> {
  if (!loading) {
    loading = (async () => {
      // 重いので、使うときに初めて読み込む
      const { pipeline } = await import("@huggingface/transformers");
      const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
      const create = (device: "webgpu" | "wasm") =>
        pipeline("zero-shot-image-classification", modelId, {
          device,
          dtype: device === "webgpu" ? "fp16" : "q8",
          progress_callback: (p: { status: string; progress?: number; file?: string }) => {
            if (p.status === "progress")
              onProgress?.({ message: "モデルを読み込み中…（初回のみ）", progress: (p.progress ?? 0) / 100 });
          },
        });
      try {
        return (await (hasWebGPU ? create("webgpu") : create("wasm"))) as unknown as Classifier;
      } catch (e) {
        // WebGPU で失敗する端末があるので CPU（wasm）でもう一度
        try {
          if (hasWebGPU) return (await create("wasm")) as unknown as Classifier;
        } catch {
          // 下でまとめて伝える
        }
        throw new Error(
          e instanceof TypeError ? "モデルをダウンロードできませんでした。通信を確認してください" : `モデルを使えませんでした: ${String(e)}`,
        );
      }
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** 言い方ごとの点数を、種類ごとに合計して並べる（純粋な計算なのでテストできる） */
export function aggregate<T extends { prompts: string[] }>(
  defs: T[],
  scores: { label: string; score: number }[],
): { label: T; score: number }[] {
  const byPrompt = new Map(scores.map((s) => [s.label, s.score]));
  return defs
    .map((def) => ({ label: def, score: def.prompts.reduce((sum, p) => sum + (byPrompt.get(p) ?? 0), 0) }))
    .sort((a, b) => b.score - a.score);
}

export interface Classified {
  types: { label: Label; score: number }[];
  patterns: { pattern: Pattern; score: number }[];
}

export async function classifyGarment(photo: Blob, modelId: string, options?: AnalyzeOptions): Promise<Classified> {
  const classifier = await loadClassifier(modelId, options?.onProgress);
  options?.signal?.throwIfAborted();
  options?.onProgress?.({ message: "服の種類を判定中…" });
  const url = URL.createObjectURL(photo);
  try {
    const typeScores = await classifier(
      url,
      LABELS.flatMap((l) => l.prompts),
      { hypothesis_template: "a photo of {}, a piece of clothing" },
    );
    options?.signal?.throwIfAborted();
    options?.onProgress?.({ message: "柄を判定中…" });
    const patternScores = await classifier(
      url,
      PATTERN_PROMPTS.flatMap((p) => p.prompts),
      { hypothesis_template: "a photo of {}" },
    );
    return {
      types: aggregate(LABELS, typeScores),
      patterns: aggregate(PATTERN_PROMPTS, patternScores).map((r) => ({ pattern: r.label.pattern, score: r.score })),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
