// バックアップと復元。写真も含めて1つのJSONファイルにまとめる。
// 機種変更やブラウザのデータ削除に備えて、利用者が自分で保存しておく。
import { z } from "zod";
import { garmentInfoSchema, feedbackSchema } from "../ai/schemas";
import type { Feedback, Garment } from "../domain/types";

const FORMAT = "freedom-closet-backup";
const VERSION = 1;

const backupSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  exportedAt: z.number(),
  garments: z.array(
    garmentInfoSchema.extend({
      createdAt: z.number(),
      photo: z.object({ type: z.string(), base64: z.string() }),
    }),
  ),
  feedback: z.array(feedbackSchema),
});

export type BackupFile = z.infer<typeof backupSchema>;

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

export async function createBackup(garments: Garment[], feedback: Feedback[], now = Date.now()): Promise<BackupFile> {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: now,
    garments: await Promise.all(
      garments.map(async ({ photo, ...rest }) => ({
        ...rest,
        photo: { type: photo.type || "image/jpeg", base64: bytesToBase64(new Uint8Array(await photo.arrayBuffer())) },
      })),
    ),
    feedback,
  };
}

export class BackupFormatError extends Error {}

export function parseBackup(text: string): { garments: Garment[]; feedback: Feedback[]; exportedAt: number } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupFormatError("バックアップファイルを読み込めませんでした（JSONではありません）");
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) throw new BackupFormatError("freedom closet のバックアップファイルではないか、壊れています");
  const b = parsed.data;
  return {
    exportedAt: b.exportedAt,
    garments: b.garments.map(({ photo, ...rest }) => ({
      ...rest,
      photo: new Blob([base64ToBytes(photo.base64)], { type: photo.type }),
    })),
    feedback: b.feedback,
  };
}

export function backupFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `freedom-closet-${d}.json`;
}
