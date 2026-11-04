// Claude API を使うAI。ブラウザから Claude API を直接は呼ばず、
// 中継サーバー（server/）に送る。APIキーはサーバーにだけ置く。
import { outfitKey, type GarmentAnalysis, type GarmentInfo, type Outfit, type PurchaseSuggestion } from "../../domain/types";
import {
  analyzeResultSchema,
  outfitsResultSchema,
  purchasesResultSchema,
  type AnalyzeResult,
  type OutfitsResult,
  type PurchasesResult,
} from "../schemas";
import { MAX_OUTFITS, MAX_PURCHASES, type AnalyzeOptions, type ClosetAI, type OutfitInput, type PurchaseInput } from "../types";

export class ClaudeAIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ClaudeAIError";
  }
}

type Fetch = typeof fetch;

const UNREACHABLE = "Claudeにつながりませんでした。少しあとでもう一度試すか、設定で「端末内AI」に切り替えてください";

export class ClaudeAI implements ClosetAI {
  readonly id = "claude" as const;
  readonly label = "Claude API";
  readonly sendsPhotosOffDevice = true;

  constructor(
    /** 中継サーバーのURL。空文字なら同じオリジンの /api を使う */
    private readonly baseUrl: string = "",
    private readonly fetchImpl: Fetch = (...args) => fetch(...args),
    /** 中継サーバーの合言葉（RELAY_ACCESS_CODE を決めたときだけ）。設定画面で入れる */
    private readonly accessCode: string = "",
  ) {}

  private async post<T>(path: string, body: unknown, parse: (v: unknown) => T, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/ai/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...accessCodeHeader(this.accessCode) },
      body: JSON.stringify(body),
      signal,
    }).catch((e: unknown) => {
      if (signal?.aborted) throw e;
      throw new ClaudeAIError(`${UNREACHABLE}（通信エラー）`, 0);
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}) as { error?: string });
      throw new ClaudeAIError((detail as { error?: string }).error ?? `${UNREACHABLE}（${res.status}）`, res.status);
    }
    return parse(await res.json());
  }

  async analyzeGarment(photo: Blob, options?: AnalyzeOptions): Promise<GarmentAnalysis> {
    options?.onProgress?.({ message: "Claudeに写真を送って判定中…" });
    const { base64, mediaType } = await toBase64Jpeg(photo);
    const r: AnalyzeResult = await this.post(
      "analyze",
      { imageBase64: base64, mediaType },
      (v) => analyzeResultSchema.parse(v),
      options?.signal,
    );
    const confidence = Math.max(0, Math.min(1, r.confidence));
    // 服の名前は40字まで（入力欄・中継サーバー・バックアップと同じ）。長い名前が入ると、提案やバックアップの読み込みで断られるため
    const name = (s: string) => s.trim().slice(0, 40);
    return {
      category: r.category,
      subType: name(r.subType),
      color: r.color,
      pattern: r.pattern,
      subColor: r.subColor ?? undefined,
      confidence,
      candidates: [
        { category: r.category, subType: name(r.subType), score: confidence },
        ...r.alternatives.map((a) => ({ ...a, subType: name(a.subType), score: (1 - confidence) / Math.max(1, r.alternatives.length) })),
      ],
    };
  }

  async suggestOutfits(input: OutfitInput, options?: { signal?: AbortSignal }): Promise<Outfit[]> {
    const r: OutfitsResult = await this.post("outfits", input, (v) => outfitsResultSchema.parse(v), options?.signal);
    return sanitizeOutfits(r, input.closet, input.request.mustInclude, input.request.exclude);
  }

  async suggestPurchases(input: PurchaseInput, options?: { signal?: AbortSignal }): Promise<PurchaseSuggestion[]> {
    const r: PurchasesResult = await this.post("purchases", input, (v) => purchasesResultSchema.parse(v), options?.signal);
    const ids = new Set(input.closet.map((g) => g.id));
    return r.suggestions
      .filter((s) => !input.request.avoidColors.includes(s.color))
      .map((s) => ({ ...s, matchesWith: s.matchesWith.filter((id) => ids.has(id)) }))
      .slice(0, MAX_PURCHASES);
  }
}

/** 中継サーバーに合言葉を送るヘッダー。日本語の合言葉も送れるよう、URLの形に直して入れる */
export function accessCodeHeader(code: string | undefined): Record<string, string> {
  const c = code?.trim();
  return c ? { "x-access-code": encodeURIComponent(c) } : {};
}

/** 持っていない服や同じ種類の重複を含む案、使いたい服が入っていない案、もう見せた案を落とす */
export function sanitizeOutfits(r: OutfitsResult, closet: GarmentInfo[], mustInclude: string[], exclude: string[] = []): Outfit[] {
  const byId = new Map(closet.map((g) => [g.id, g]));
  const out: Outfit[] = [];
  const seen = new Set<string>(exclude);
  r.outfits.forEach((o, i) => {
    const ids = [...new Set(o.garmentIds)];
    if (ids.length === 0 || !ids.every((id) => byId.has(id))) return;
    if (!mustInclude.every((id) => ids.includes(id))) return;
    const cats = ids.map((id) => byId.get(id)!.category);
    if (new Set(cats).size !== cats.length) return;
    const key = outfitKey(ids);
    if (seen.has(key)) return;
    seen.add(key);
    // Claude が並べた順を点数として使う
    out.push({ key, garmentIds: ids, title: o.title, explanation: o.explanation, score: r.outfits.length - i });
  });
  return out.slice(0, MAX_OUTFITS);
}

/**
 * 送る量を減らすため、長辺768pxのJPEGに縮める（ブラウザ専用）。
 * 種類と色の判定にはこれで十分で、1024pxより送るデータが約4割、Claudeが読む量も約4割減る
 */
async function toBase64Jpeg(photo: Blob, maxSide = 768): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(photo);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), mediaType: "image/jpeg" };
}
