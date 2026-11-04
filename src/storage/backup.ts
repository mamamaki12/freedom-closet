// バックアップと復元。写真も含めて1つのJSONファイルにまとめる。
// 機種変更やブラウザのデータ削除に備えて、利用者が自分で保存しておく。
// 戻すときは中身を1件ずつ確かめ、形の合わないものだけ飛ばす（1着がおかしくても、ほかの服は戻せるように）。
import { z } from "zod";
import { feedbackSchema, garmentInfoSchema, profileSchema } from "../ai/schemas";
import type { Profile } from "../domain/profile";
import type { Feedback, Garment, WearRecord } from "../domain/types";

const FORMAT = "freedom-closet-backup";
const VERSION = 1;

/** 写真として戻す形式。これ以外（HTML・SVG など、開くと中のスクリプトが動きうるもの）は中身の分からないデータとして戻す */
const PHOTO_TYPES = /^image\/(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/;
/** 1枚の写真の大きさの上限（base64 の文字数。元の写真で約22MB）。アプリが保存する写真はふつう1枚0.5MBもない */
const MAX_PHOTO_BASE64 = 30_000_000;

/** ファイルの形（書き出すときの型） */
export interface BackupFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  exportedAt: number;
  garments: (Omit<Garment, "photo"> & { photo: { type: string; base64: string } })[];
  feedback: Feedback[];
  /** 「今日はこれ」の記録（あとから足した。古いバックアップにはない） */
  wear?: WearRecord[];
  /** 身長・体重・いつものサイズ（同上） */
  profile?: Profile;
}

const envelopeSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  exportedAt: z.number(),
  garments: z.array(z.unknown()).max(10_000),
  feedback: z.array(z.unknown()).max(50_000),
  wear: z.array(z.unknown()).max(50_000).optional(),
  profile: z.unknown().optional(),
});

const backupGarmentSchema = garmentInfoSchema.extend({
  // 名前とメモは入力欄と同じ長さに切り詰めて受け入れる（前の版で長い名前が入ったことがあるため）
  subType: z
    .string()
    .max(10_000)
    .transform((s) => s.slice(0, 40)),
  note: z
    .string()
    .max(10_000)
    .transform((s) => s.slice(0, 200))
    .optional(),
  createdAt: z.number(),
  aiConfidence: z.number().min(0).max(1).optional(),
  needsReview: z.boolean().optional(),
  photo: z.object({ type: z.string().max(100), base64: z.base64().min(1).max(MAX_PHOTO_BASE64) }),
});

const wearSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  garmentIds: z.array(z.string().max(64)).max(20),
  outfitKey: z.string().max(1000).optional(),
  at: z.number(),
});

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function createBackup(
  data: { garments: Garment[]; feedback: Feedback[]; wear?: WearRecord[]; profile?: Profile },
  now = Date.now(),
): Promise<BackupFile> {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: now,
    garments: await Promise.all(
      data.garments.map(async ({ photo, ...rest }) => ({
        ...rest,
        photo: { type: photo.type || "image/jpeg", base64: bytesToBase64(new Uint8Array(await photo.arrayBuffer())) },
      })),
    ),
    feedback: data.feedback,
    ...(data.wear ? { wear: data.wear } : {}),
    ...(data.profile && Object.keys(data.profile).length ? { profile: data.profile } : {}),
  };
}

export class BackupFormatError extends Error {}

export interface RestoredBackup {
  exportedAt: number;
  garments: Garment[];
  feedback: Feedback[];
  wear: WearRecord[];
  profile?: Profile;
  /** 形が合わずに戻せなかった服の数 */
  skipped: number;
}

/** 1件ずつ確かめて、合うものだけ残す */
function each<T>(items: unknown[] | undefined, schema: z.ZodType<T>): { ok: T[]; bad: number } {
  const ok: T[] = [];
  let bad = 0;
  for (const item of items ?? []) {
    const r = schema.safeParse(item);
    if (r.success) ok.push(r.data);
    else bad++;
  }
  return { ok, bad };
}

export function parseBackup(text: string): RestoredBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupFormatError("バックアップファイルを読み込めませんでした（JSONではありません）");
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) throw new BackupFormatError("freedom closet のバックアップファイルではないか、壊れています");
  const b = parsed.data;
  const garments = each(b.garments, backupGarmentSchema);
  if (garments.ok.length === 0 && garments.bad > 0) {
    throw new BackupFormatError("バックアップファイルが壊れていて、服を1着も戻せませんでした");
  }
  const profile = profileSchema.safeParse(b.profile);
  return {
    exportedAt: b.exportedAt,
    garments: garments.ok.map(({ photo, ...rest }) => ({
      ...rest,
      photo: new Blob([base64ToBytes(photo.base64)], { type: PHOTO_TYPES.test(photo.type) ? photo.type : "application/octet-stream" }),
    })),
    feedback: each(b.feedback, feedbackSchema).ok,
    wear: each(b.wear, wearSchema).ok,
    ...(profile.success && profile.data && Object.keys(profile.data).length ? { profile: profile.data } : {}),
    skipped: garments.bad,
  };
}

/**
 * バックアップの身長・サイズなどを、今の設定に足す。今の端末で入れてある項目はそのまま（上書きしない）
 */
export function mergeProfile(current: Profile, restored: Profile | undefined): Profile {
  if (!restored) return current;
  const defined = <T extends object>(o: T | undefined) =>
    Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
  const { usualSize: nowSizes, ...nowRest } = current;
  const { usualSize: oldSizes, ...oldRest } = restored;
  const usualSize = { ...defined(oldSizes), ...defined(nowSizes) };
  return { ...defined(oldRest), ...defined(nowRest), ...(Object.keys(usualSize).length ? { usualSize } : {}) };
}

export function backupFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `freedom-closet-${d}.json`;
}
