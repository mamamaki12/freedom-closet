import type {
  Feedback,
  GarmentAnalysis,
  GarmentInfo,
  Outfit,
  OutfitRequest,
  PurchaseRequest,
  PurchaseSuggestion,
} from "../domain/types";

export type AIProviderId = "local" | "claude";

export interface AnalyzeOptions {
  signal?: AbortSignal;
  /** モデルの読み込み状況など。0〜1 が分かるときは progress に入る */
  onProgress?: (p: { message: string; progress?: number }) => void;
}

export interface OutfitInput {
  closet: GarmentInfo[];
  request: OutfitRequest;
  feedback: Feedback[];
}

export interface PurchaseInput {
  closet: GarmentInfo[];
  request: PurchaseRequest;
  feedback: Feedback[];
}

/**
 * アプリが使うAIの窓口。画面はこのインターフェースだけを呼ぶ。
 *
 * - local: 端末内で動く（Transformers.js＋独自の点数付け）
 * - claude: 中継サーバー経由で Claude API を呼ぶ（APIキーはサーバー側だけ）
 *
 * どちらも同じ型を返すので、設定を切り替えるだけで差し替えられる。
 */
export interface ClosetAI {
  readonly id: AIProviderId;
  readonly label: string;
  /** 服の写真を端末の外に送るか。設定画面の注意書きに使う */
  readonly sendsPhotosOffDevice: boolean;

  analyzeGarment(photo: Blob, options?: AnalyzeOptions): Promise<GarmentAnalysis>;
  /** コーデ案を最大3つ。服の写真は渡さず、登録済みの情報だけで考える */
  suggestOutfits(input: OutfitInput, options?: { signal?: AbortSignal }): Promise<Outfit[]>;
  suggestPurchases(input: PurchaseInput, options?: { signal?: AbortSignal }): Promise<PurchaseSuggestion[]>;
}

export const MAX_OUTFITS = 3;
export const MAX_PURCHASES = 5;
