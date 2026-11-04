// 端末内での服の種類と柄の判定。Transformers.js で CLIP の「写真側」のモデルだけを動かし、
// 用意した英語の説明文のどれに一番近いかで決める（ゼロショット分類）。
// モデルは初回だけダウンロードし、以後はブラウザのキャッシュから読む。
//
// スマホで軽く・速く動かすための工夫：
// - 説明文側の数値（テキスト埋め込み）は開発時に計算して textEmbeddings.json に同梱する（scripts/text-embeddings.ts）。
//   端末では写真側のモデルだけを読み込めばよく、文章側のモデル（約64MB）のダウンロードも、
//   写真1枚ごとに70文以上を読ませ直す計算もいらなくなる
// - 写真1枚につきモデルを1回だけ動かし、その結果から種類と柄の両方を決める
//
// 精度のための工夫：
// - 1つの種類に言い方を複数用意し（"a t-shirt" / "a short-sleeve tee"…）、点数を合計する（プロンプトのアンサンブル）
// - 文のひな型（"a product photo of {}" など）も複数用意して平均する
// - 帽子・バッグなど服でないものの言い方も用意し、それが1位なら「種類は分からない」と答えて選んでもらう
// - 柄は種類とは別に、同じ写真で「無地／ボーダー／チェック／花柄／ドット／柄もの」を判定する
import type { Category, Pattern } from "../../domain/types";
import type { AnalyzeOptions } from "../types";

export interface Label {
  /** 同じ種類の言い方。先頭が代表 */
  prompts: string[];
  /** null は服でないもの（帽子・バッグなど）。これが1位なら種類は分からないと答える */
  category: Category | null;
  subType: string;
}

// 長袖のトップスをカーディガンやブルゾン（アウター）と見やすかったので、トップスの言い方に「長袖」を足した
// （clothing-dataset-small の test 372枚で 94.6%→96.5%。前処理の変更や左右反転の平均は効かなかった）
export const LABELS: Label[] = [
  { prompts: ["a t-shirt", "a short-sleeve cotton tee", "a long-sleeve t-shirt", "a long-sleeve top"], category: "tops", subType: "Tシャツ" },
  { prompts: ["a polo shirt", "a collared knit polo", "a long-sleeve rugby shirt"], category: "tops", subType: "ポロシャツ" },
  { prompts: ["a button-up shirt", "a collared dress shirt with buttons", "a short-sleeve open-collar shirt", "a flannel shirt", "a long-sleeve shirt"], category: "tops", subType: "シャツ" },
  { prompts: ["a blouse", "a women's blouse with a soft drape", "a long-sleeve blouse"], category: "tops", subType: "ブラウス" },
  { prompts: ["a knit sweater", "a wool pullover", "a turtleneck knit", "a pullover sweater with no buttons or zipper", "a long-sleeve knit top"], category: "tops", subType: "ニット" },
  { prompts: ["a sweatshirt", "a crewneck sweatshirt", "a long-sleeve sweatshirt top"], category: "tops", subType: "スウェット" },
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
  { prompts: ["shorts", "short pants", "denim shorts", "sweat shorts"], category: "bottoms", subType: "ショートパンツ" },
  { prompts: ["a skirt", "a long skirt", "a pleated skirt", "a midi skirt", "a mini skirt", "a flared skirt"], category: "bottoms", subType: "スカート" },
  { prompts: ["a dress", "a one-piece dress", "a long dress", "a sleeveless summer dress", "a maxi dress", "a shirt dress"], category: "onepiece", subType: "ワンピース" },
  { prompts: ["sneakers", "a pair of sneakers", "running shoes"], category: "shoes", subType: "スニーカー" },
  { prompts: ["leather shoes", "a pair of leather dress shoes", "loafers"], category: "shoes", subType: "革靴" },
  { prompts: ["boots", "a pair of ankle boots"], category: "shoes", subType: "ブーツ" },
  { prompts: ["sandals", "a pair of sandals"], category: "shoes", subType: "サンダル" },
  // 服でないもの。これが1位なら「服ではなさそう」と伝えて、種類を選んでもらう（帽子を「ニット」と言い切らないため）
  {
    prompts: ["a hat", "a baseball cap", "a knit beanie hat", "a handbag", "a backpack", "a belt", "a scarf", "socks", "sunglasses", "a wristwatch"],
    category: null,
    subType: "服ではないもの",
  },
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

/**
 * 種類の文のひな型。実写真713枚（clothing-dataset-small）で試し、3つを平均すると
 * 1つだけのときより種類の正解率が約92%→約94.5%に上がった
 */
export const TYPE_TEMPLATES = ["a product photo of {}", "a photo of {}, a type of clothing", "a photo of {} laid flat"];
export const PATTERN_TEMPLATES = ["a photo of {}"];
/** CLIP の学習済みの温度（OpenAI の CLIP は 100）。点数の付き方が変わるので変えない */
export const LOGIT_SCALE = 100;
export const DEFAULT_LOCAL_MODEL = "Xenova/clip-vit-base-patch32";

export const fillTemplate = (template: string, prompt: string): string => template.replace("{}", prompt);
export const typePrompts = (): string[] => LABELS.flatMap((l) => l.prompts);
export const patternPrompts = (): string[] => PATTERN_PROMPTS.flatMap((p) => p.prompts);

// ---- 説明文の数値（テキスト埋め込み）----

/** 説明文を数値にしたもの。vectors は長さ1に正規化済みで、prompts と同じ並び */
export interface PromptBank {
  prompts: string[];
  templates: string[];
  vectors: Float32Array[];
}

export interface BankJson {
  templates: string[];
  prompts: string[];
  /** int16 で量子化した数値を base64 にしたもの（prompts.length × dim 個） */
  data: string;
}

/** textEmbeddings.json の形 */
export interface TextEmbeddingsJson {
  model: string;
  dim: number;
  scale: number;
  logitScale: number;
  types: BankJson;
  patterns: BankJson;
}

/** 量子化の倍率。長さ1のベクトルの成分は -1〜1 なので int16 に収まる（誤差は 0.00003 程度で判定は変わらない） */
export const QUANT_SCALE = 32767;

export function encodeVectors(vectors: Float32Array[], scale = QUANT_SCALE): string {
  const dim = vectors[0]?.length ?? 0;
  const int16 = new Int16Array(vectors.length * dim);
  vectors.forEach((v, i) => v.forEach((x, j) => (int16[i * dim + j] = Math.max(-scale, Math.min(scale, Math.round(x * scale))))));
  const bytes = new Uint8Array(int16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeVectors(base64: string, dim: number, scale = QUANT_SCALE): Float32Array[] {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out: Float32Array[] = [];
  for (let i = 0; i + dim <= int16.length; i += dim) {
    const v = new Float32Array(dim);
    for (let j = 0; j < dim; j++) v[j] = int16[i + j] / scale;
    out.push(v);
  }
  return out;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 同梱の数値が、いまの言い方・ひな型・モデルと一致していれば返す（ずれていれば null → 端末で計算し直す） */
export function bankFromJson(
  json: TextEmbeddingsJson,
  key: "types" | "patterns",
  prompts: string[],
  templates: string[],
  modelId: string,
): PromptBank | null {
  const b = json[key];
  if (json.model !== modelId || !sameList(b.prompts, prompts) || !sameList(b.templates, templates)) return null;
  const vectors = decodeVectors(b.data, json.dim, json.scale);
  if (vectors.length !== prompts.length) return null;
  return { prompts, templates, vectors };
}

// ---- 点数 ----

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length);
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function softmax(xs: number[]): number[] {
  const max = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - max));
  const sum = exps.reduce((s, e) => s + e, 0);
  return exps.map((e) => e / sum);
}

/** 写真の数値と説明文の数値の近さを、CLIP と同じ計算（温度つき softmax）で 0〜1 の点数にする */
export function scorePrompts(image: Float32Array, bank: PromptBank): { label: string; score: number }[] {
  const logits = bank.vectors.map((v) => {
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += image[i] * v[i];
    return LOGIT_SCALE * dot;
  });
  const probs = softmax(logits);
  return bank.prompts.map((label, i) => ({ label, score: probs[i] }));
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

export interface Banks {
  types: PromptBank;
  patterns: PromptBank;
}

/** 写真の数値（長さ1に正規化済み）から、種類と柄の点数を出す（純粋な計算なのでテストできる） */
export function classifyEmbedding(image: Float32Array, banks: Banks): Classified {
  return {
    types: aggregate(LABELS, scorePrompts(image, banks.types)),
    patterns: aggregate(PATTERN_PROMPTS, scorePrompts(image, banks.patterns)).map((r) => ({ pattern: r.label.pattern, score: r.score })),
  };
}

// ---- モデルの読み込み ----

type Transformers = typeof import("@huggingface/transformers");
let transformers: Promise<Transformers> | null = null;
/** 重いので、使うときに初めて読み込む */
const loadTransformers = () => (transformers ??= import("@huggingface/transformers"));

type ProgressInfo = { status: string; file?: string; progress?: number; loaded?: number; total?: number };
type Device = "webgpu" | "wasm";

/** 読み込み中の進み具合を聞きたい画面の一覧（先読みと本番の呼び出しが別でも、両方に届くように） */
const progressListeners = new Set<NonNullable<AnalyzeOptions["onProgress"]>>();
function reportProgress(what: string) {
  return (p: ProgressInfo) => {
    if (p.status !== "progress" || !p.file?.endsWith(".onnx") || !p.total) return;
    const mb = Math.round(p.total / 1_000_000);
    for (const fn of progressListeners) fn({ message: `${what}を読み込み中…（初回のみ、約${mb}MB）`, progress: (p.progress ?? 0) / 100 });
  };
}
async function withProgress<T>(onProgress: AnalyzeOptions["onProgress"], run: () => Promise<T>): Promise<T> {
  if (onProgress) progressListeners.add(onProgress);
  try {
    return await run();
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

const inBrowser = () => typeof window !== "undefined" && typeof navigator !== "undefined";
/** WebGPU で失敗した端末では、以後は CPU（wasm）だけを使う */
let avoidWebGPU = false;

/** 試す順。WebGPU（fp16、速い）→ CPU の wasm（q8、どこでも動く）。Node（検証スクリプト）では既定の CPU */
function attempts(): { device?: Device; dtype: "fp16" | "q8" }[] {
  if (!inBrowser()) return [{ dtype: "q8" }];
  const list: { device?: Device; dtype: "fp16" | "q8" }[] = [];
  if ("gpu" in navigator && !avoidWebGPU) list.push({ device: "webgpu", dtype: "fp16" });
  list.push({ device: "wasm", dtype: "q8" });
  return list;
}

interface Vision {
  processor: (image: unknown) => Promise<{ pixel_values: unknown }>;
  model: ((inputs: { pixel_values: unknown }) => Promise<{ image_embeds: { type: string; data: ArrayLike<number>; to(type: string): { data: ArrayLike<number> } } }>) & {
    dispose(): Promise<unknown> | void;
  };
  device: Device | "cpu";
}

let vision: Promise<Vision> | null = null;

function describeError(e: unknown): Error {
  if (e instanceof TypeError) return new Error("モデルをダウンロードできませんでした。通信を確認してください");
  return new Error(`モデルを使えませんでした: ${e instanceof Error ? e.message : String(e)}`);
}

function loadVision(modelId: string): Promise<Vision> {
  vision ??= (async () => {
    const { AutoImageProcessor, CLIPVisionModelWithProjection } = await loadTransformers();
    const progress_callback = reportProgress("判定モデル");
    const processor = await AutoImageProcessor.from_pretrained(modelId, { progress_callback });
    let lastError: unknown;
    for (const opt of attempts()) {
      try {
        const model = await CLIPVisionModelWithProjection.from_pretrained(modelId, { ...opt, progress_callback });
        return { processor, model, device: opt.device ?? "cpu" } as unknown as Vision;
      } catch (e) {
        // WebGPU で失敗する端末があるので、次の候補でもう一度
        lastError = e;
        if (opt.device === "webgpu") avoidWebGPU = true;
      }
    }
    throw describeError(lastError);
  })();
  vision.catch(() => {
    vision = null;
  });
  return vision;
}

let banks: Promise<Banks> | null = null;

function loadBanks(modelId: string): Promise<Banks> {
  banks ??= (async () => {
    const json = (await import("./textEmbeddings.json")).default as TextEmbeddingsJson;
    const types = bankFromJson(json, "types", typePrompts(), TYPE_TEMPLATES, modelId);
    const patterns = bankFromJson(json, "patterns", patternPrompts(), PATTERN_TEMPLATES, modelId);
    if (types && patterns) return { types, patterns };
    console.warn("同梱の説明文の数値が今の言い方と合わないので、端末で計算します（npm run ai:embeddings で作り直してください）");
    return computeBanks(modelId);
  })();
  banks.catch(() => {
    banks = null;
  });
  return banks;
}

/**
 * 説明文の数値を端末で計算する（同梱のものが使えないときだけ）。文章側のモデルもダウンロードするので遅い。
 * scripts/text-embeddings.ts と同じ計算（ひな型ごとに正規化して平均し、もう一度正規化）
 */
export async function computeBanks(modelId: string, onProgress?: AnalyzeOptions["onProgress"]): Promise<Banks> {
  return withProgress(onProgress, async () => {
    const { AutoTokenizer, CLIPTextModelWithProjection } = await loadTransformers();
    const progress_callback = reportProgress("説明文のモデル");
    const tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback });
    const model = await CLIPTextModelWithProjection.from_pretrained(modelId, {
      ...(inBrowser() ? { device: "wasm" as const } : {}),
      dtype: "q8",
      progress_callback,
    });
    const embed = async (prompts: string[], templates: string[]): Promise<PromptBank> => {
      let sums: Float32Array[] | undefined;
      for (const t of templates) {
        const inputs = tokenizer(
          prompts.map((p) => fillTemplate(t, p)),
          { padding: true, truncation: true },
        );
        const { text_embeds } = (await model(inputs)) as { text_embeds: { dims: number[]; type: string; data: ArrayLike<number>; to(type: string): { data: ArrayLike<number> } } };
        const dim = text_embeds.dims[1];
        const data = (text_embeds.type === "float32" ? text_embeds : text_embeds.to("float32")).data;
        sums ??= prompts.map(() => new Float32Array(dim));
        prompts.forEach((_, i) => {
          const row = normalize(Array.from({ length: dim }, (_, j) => data[i * dim + j]));
          for (let j = 0; j < dim; j++) sums![i][j] += row[j];
        });
      }
      return { prompts, templates, vectors: (sums ?? []).map(normalize) };
    };
    const types = await embed(typePrompts(), TYPE_TEMPLATES);
    const patterns = await embed(patternPrompts(), PATTERN_TEMPLATES);
    await (model as unknown as { dispose(): Promise<void> }).dispose?.();
    return { types, patterns };
  });
}

/** 写真を数値（長さ1に正規化）にする。モデルは1回だけ動かす */
async function embedImage(photo: Blob, modelId: string): Promise<Float32Array> {
  const { RawImage } = await loadTransformers();
  const image = await RawImage.fromBlob(photo);
  const run = async () => {
    const v = await loadVision(modelId);
    const { pixel_values } = await v.processor(image);
    try {
      const { image_embeds } = await v.model({ pixel_values });
      return normalize((image_embeds.type === "float32" ? image_embeds : image_embeds.to("float32")).data);
    } catch (e) {
      // WebGPU では読み込めても動かすと失敗する端末がある。CPU で作り直してもう一度
      if (v.device !== "webgpu") throw e;
      avoidWebGPU = true;
      vision = null;
      await v.model.dispose?.();
      return undefined;
    }
  };
  return (await run()) ?? (await run())!;
}

/** 使う前に読み込みを始めておく（写真を選んでいる間にダウンロードを進めるため）。失敗しても何もしない */
export function prepareClassifier(modelId: string): void {
  void Promise.all([loadVision(modelId), loadBanks(modelId)]).catch(() => undefined);
}

export async function classifyGarment(photo: Blob, modelId: string, options?: AnalyzeOptions): Promise<Classified> {
  return withProgress(options?.onProgress, async () => {
    const [, b] = await Promise.all([loadVision(modelId), loadBanks(modelId)]);
    options?.signal?.throwIfAborted();
    options?.onProgress?.({ message: "服の種類と柄を判定中…" });
    const image = await embedImage(photo, modelId);
    options?.signal?.throwIfAborted();
    return classifyEmbedding(image, b);
  });
}
