// アプリと中継サーバー（server/）の間でやりとりするデータの形。
// 両方からこのファイルを読み、形がずれないようにする。
import { z } from "zod";
import { FITS } from "../domain/profile";
import { CATEGORIES, COLOR_NAMES, FORMALITIES, PURPOSES, SEASONS } from "../domain/types";

export const categorySchema = z.enum(CATEGORIES);
export const colorSchema = z.enum(COLOR_NAMES);

export const garmentInfoSchema = z.object({
  id: z.string().min(1).max(64),
  category: categorySchema,
  subType: z.string().max(40),
  color: colorSchema,
  seasons: z.array(z.enum(SEASONS)).max(4),
  formality: z.enum(FORMALITIES),
  warmth: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  size: z.string().max(20).optional(),
  note: z.string().max(200).optional(),
});

const sizeValue = z.string().max(20).optional();
export const profileSchema = z
  .object({
    heightCm: z.number().min(80).max(230).optional(),
    weightKg: z.number().min(20).max(250).optional(),
    fit: z.enum(FITS).optional(),
    usualSize: z.object({ tops: sizeValue, bottoms: sizeValue, shoes: sizeValue }).partial().optional(),
  })
  .optional();

export const feedbackSchema = z.object({
  outfitKey: z.string().max(1000),
  garmentIds: z.array(z.string().max(64)).max(10),
  liked: z.boolean(),
  at: z.number(),
});

const closetSchema = z.array(garmentInfoSchema).max(500);
const feedbackListSchema = z.array(feedbackSchema).max(200);

export const outfitsRequestSchema = z.object({
  closet: closetSchema,
  request: z.object({
    mustInclude: z.array(z.string().max(64)).max(5),
    temperatureC: z.number().min(-30).max(50).optional(),
    purpose: z.enum(PURPOSES),
    preference: z.string().max(300).optional(),
    exclude: z.array(z.string().max(1000)).max(30).optional(),
  }),
  feedback: feedbackListSchema,
  profile: profileSchema,
});

export const purchasesRequestSchema = z.object({
  closet: closetSchema,
  request: z.object({
    avoidColors: z.array(colorSchema).max(COLOR_NAMES.length),
    preference: z.string().max(300).optional(),
    budgetYen: z.number().int().min(0).max(1_000_000).optional(),
  }),
  feedback: feedbackListSchema,
  profile: profileSchema,
});

export const analyzeRequestSchema = z.object({
  /** base64（data: の接頭辞なし） */
  imageBase64: z.string().min(1).max(8_000_000),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

// --- Claude に出してもらう形（サーバーで構造化出力に使う）---

export const analyzeResultSchema = z.object({
  category: categorySchema,
  subType: z.string().describe("服の種類を日本語で短く。例：Tシャツ、シャツ、ワイドパンツ"),
  color: colorSchema,
  confidence: z.number().describe("0〜1。写真から判断しにくいときは低く"),
});

export const outfitsResultSchema = z.object({
  outfits: z.array(
    z.object({
      garmentIds: z.array(z.string()).describe("手持ちの服のIDだけを使う"),
      title: z.string(),
      explanation: z.array(z.string()).describe("色合わせ、袖・裾の扱いなど。1文ずつ"),
    }),
  ),
});

export const purchasesResultSchema = z.object({
  suggestions: z.array(
    z.object({
      category: categorySchema,
      color: colorSchema,
      subType: z.string(),
      searchQuery: z.string().describe("ユニクロ・GUの検索窓にそのまま入れる日本語。例：黒 ワイドパンツ"),
      reason: z.string(),
      newOutfitCount: z.number().int(),
      matchesWith: z.array(z.string()).describe("合わせられる手持ちの服のID"),
    }),
  ),
});

export type AnalyzeResult = z.infer<typeof analyzeResultSchema>;
export type OutfitsResult = z.infer<typeof outfitsResultSchema>;
export type PurchasesResult = z.infer<typeof purchasesResultSchema>;
