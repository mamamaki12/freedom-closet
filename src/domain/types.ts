// アプリ全体で使う服・コーデのデータ型。
// AIの実装（端末内 / Claude API）が変わっても、画面とストレージはこの型だけを見る。

export const CATEGORIES = ["tops", "outer", "bottoms", "onepiece", "shoes"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  tops: "トップス",
  outer: "アウター",
  bottoms: "ボトムス",
  onepiece: "ワンピース",
  shoes: "シューズ",
};

export const COLOR_NAMES = [
  "black",
  "white",
  "gray",
  "navy",
  "blue",
  "lightblue",
  "beige",
  "brown",
  "khaki",
  "green",
  "red",
  "pink",
  "yellow",
  "orange",
  "purple",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABELS: Record<Season, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

export const FORMALITIES = ["casual", "smart", "formal"] as const;
export type Formality = (typeof FORMALITIES)[number];

export const FORMALITY_LABELS: Record<Formality, string> = {
  casual: "カジュアル",
  smart: "きれいめ",
  formal: "フォーマル",
};

/** 1=薄手 2=普通 3=厚手 */
export type Warmth = 1 | 2 | 3;

export const PURPOSES = ["everyday", "work", "date", "outdoor", "formal"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const PURPOSE_LABELS: Record<Purpose, string> = {
  everyday: "普段・買い物",
  work: "仕事・学校",
  date: "デート・食事",
  outdoor: "アウトドア",
  formal: "式・改まった場",
};

/** 写真を除いた服の情報。AIに渡すのはこちら（写真は端末から出さない）。 */
export interface GarmentInfo {
  id: string;
  category: Category;
  /** 「シャツ」「ワイドパンツ」など。自動判定か本人の入力 */
  subType: string;
  color: ColorName;
  seasons: Season[];
  formality: Formality;
  warmth: Warmth;
  /** 「M」「L」「26.5」など。服を登録するときは、いつものサイズを自動で入れる */
  size?: string;
  note?: string;
}

export interface Garment extends GarmentInfo {
  photo: Blob;
  createdAt: number;
}

/** 写真から推定した結果。登録前に本人が修正できる。 */
export interface GarmentAnalysis {
  /** 種類を判定できなかったとき（モデルを読み込めないなど）は null。色だけ使う */
  category: Category | null;
  subType: string | null;
  color: ColorName;
  /** 写真から取った代表色（表示用） */
  colorHex?: string;
  /** 0〜1。低いときは画面で確認をうながす */
  confidence: number;
  /** 種類の候補（上位から） */
  candidates: { category: Category; subType: string; score: number }[];
  /** 一部だけ判定できたときの説明 */
  warning?: string;
}

export interface OutfitRequest {
  /** 必ず使いたい服のID */
  mustInclude: string[];
  temperatureC?: number;
  purpose: Purpose;
  /** 「明るめ」「楽な服」など自由記述（主にClaude用。端末内AIは一部のキーワードだけ見る） */
  preference?: string;
  /** 「ほかの案」用。もう見せた組み合わせ（Outfit.key）は出さない */
  exclude?: string[];
}

export interface Outfit {
  /** 服IDを並べ替えて連結したもの。評価の記録に使う */
  key: string;
  garmentIds: string[];
  title: string;
  /** 色合わせ・袖や裾の扱いなどの説明 */
  explanation: string[];
  /** 並べ替え用の点数（実装ごとの尺度） */
  score: number;
}

export interface Feedback {
  outfitKey: string;
  garmentIds: string[];
  liked: boolean;
  at: number;
}

export interface PurchaseRequest {
  avoidColors: ColorName[];
  preference?: string;
  /** 予算（円）。商品価格は持たないので、Claude向けのヒントとして渡すだけ */
  budgetYen?: number;
}

export interface PurchaseSuggestion {
  category: Category;
  color: ColorName;
  subType: string;
  /** 「黒のワイドパンツ」など、ショップ検索にそのまま使える言葉 */
  searchQuery: string;
  reason: string;
  /** 買うと増えるコーデの数（目安） */
  newOutfitCount: number;
  /** 合わせられる手持ちの服のID */
  matchesWith: string[];
}

export function outfitKey(garmentIds: string[]): string {
  return [...garmentIds].sort().join("+");
}

export function toInfo(g: Garment): GarmentInfo {
  const { photo: _photo, createdAt: _createdAt, ...info } = g;
  return info;
}
