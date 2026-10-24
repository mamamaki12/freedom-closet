// 端末内での服の種類の判定。Transformers.js で CLIP 系モデルを動かし、
// 用意した英語の説明文のどれに一番近いかで種類を決める（ゼロショット分類）。
// モデルは初回だけダウンロードし、以後はブラウザのキャッシュから読む。
import type { Category } from "../../domain/types";
import type { AnalyzeOptions } from "../types";

export interface Label {
  prompt: string;
  category: Category;
  subType: string;
}

export const LABELS: Label[] = [
  { prompt: "a t-shirt", category: "tops", subType: "Tシャツ" },
  { prompt: "a button-up shirt", category: "tops", subType: "シャツ" },
  { prompt: "a blouse", category: "tops", subType: "ブラウス" },
  { prompt: "a knit sweater", category: "tops", subType: "ニット" },
  { prompt: "a sweatshirt", category: "tops", subType: "スウェット" },
  { prompt: "a hoodie", category: "tops", subType: "パーカー" },
  { prompt: "a cardigan", category: "outer", subType: "カーディガン" },
  { prompt: "a blazer jacket", category: "outer", subType: "ジャケット" },
  { prompt: "a denim jacket", category: "outer", subType: "デニムジャケット" },
  { prompt: "a coat", category: "outer", subType: "コート" },
  { prompt: "a down jacket", category: "outer", subType: "ダウン" },
  { prompt: "jeans", category: "bottoms", subType: "デニム" },
  { prompt: "wide-leg trousers", category: "bottoms", subType: "ワイドパンツ" },
  { prompt: "slim trousers", category: "bottoms", subType: "スラックス" },
  { prompt: "chino pants", category: "bottoms", subType: "チノパンツ" },
  { prompt: "shorts", category: "bottoms", subType: "ショートパンツ" },
  { prompt: "a skirt", category: "bottoms", subType: "スカート" },
  { prompt: "a dress", category: "onepiece", subType: "ワンピース" },
  { prompt: "sneakers", category: "shoes", subType: "スニーカー" },
  { prompt: "leather shoes", category: "shoes", subType: "革靴" },
  { prompt: "boots", category: "shoes", subType: "ブーツ" },
  { prompt: "sandals", category: "shoes", subType: "サンダル" },
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

export async function classifyGarment(
  photo: Blob,
  modelId: string,
  options?: AnalyzeOptions,
): Promise<{ label: Label; score: number }[]> {
  const classifier = await loadClassifier(modelId, options?.onProgress);
  options?.signal?.throwIfAborted();
  options?.onProgress?.({ message: "服の種類を判定中…" });
  const url = URL.createObjectURL(photo);
  try {
    const out = await classifier(
      url,
      LABELS.map((l) => l.prompt),
      { hypothesis_template: "a photo of {}, a piece of clothing" },
    );
    return out
      .map((o) => ({ label: LABELS.find((l) => l.prompt === o.label)!, score: o.score }))
      .sort((a, b) => b.score - a.score);
  } finally {
    URL.revokeObjectURL(url);
  }
}
