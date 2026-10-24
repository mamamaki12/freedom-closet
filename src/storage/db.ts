// 端末内の保存（IndexedDB）。写真もここに入れ、外には送らない。
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Feedback, Garment } from "../domain/types";

interface ClosetDB extends DBSchema {
  garments: { key: string; value: Garment };
  feedback: { key: string; value: Feedback };
}

let dbPromise: Promise<IDBPDatabase<ClosetDB>> | null = null;

function db() {
  dbPromise ??= openDB<ClosetDB>("freedom-closet", 1, {
    upgrade(d) {
      d.createObjectStore("garments", { keyPath: "id" });
      d.createObjectStore("feedback", { keyPath: "outfitKey" });
    },
  });
  return dbPromise;
}

export async function listGarments(): Promise<Garment[]> {
  const all = await (await db()).getAll("garments");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveGarment(g: Garment): Promise<void> {
  await (await db()).put("garments", g);
}

export async function deleteGarment(id: string): Promise<void> {
  await (await db()).delete("garments", id);
}

export async function listFeedback(): Promise<Feedback[]> {
  return (await db()).getAll("feedback");
}

/** 同じコーデへの評価は最新のものだけ残す */
export async function saveFeedback(f: Feedback): Promise<void> {
  await (await db()).put("feedback", f);
}

export async function deleteFeedback(outfitKey: string): Promise<void> {
  await (await db()).delete("feedback", outfitKey);
}

/** バックアップから戻す。同じIDのものは上書きし、ほかはそのまま残す */
export async function importAll(garments: Garment[], feedback: Feedback[]): Promise<void> {
  const tx = (await db()).transaction(["garments", "feedback"], "readwrite");
  await Promise.all([
    ...garments.map((g) => tx.objectStore("garments").put(g)),
    ...feedback.map((f) => tx.objectStore("feedback").put(f)),
    tx.done,
  ]);
}
