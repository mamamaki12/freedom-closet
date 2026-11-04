// 端末内の保存（IndexedDB）。写真もここに入れ、外には送らない。
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Feedback, Garment, WearRecord } from "../domain/types";

interface ClosetDB extends DBSchema {
  garments: { key: string; value: Garment };
  feedback: { key: string; value: Feedback };
  /** 「着た」記録。1日1件（その日にもう一度押したら上書き） */
  wear: { key: string; value: WearRecord };
}

let dbPromise: Promise<IDBPDatabase<ClosetDB>> | null = null;

function db() {
  dbPromise ??= openDB<ClosetDB>("freedom-closet", 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore("garments", { keyPath: "id" });
        d.createObjectStore("feedback", { keyPath: "outfitKey" });
      }
      if (oldVersion < 2) d.createObjectStore("wear", { keyPath: "day" });
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

/** 着た記録（新しい日から） */
export async function listWear(): Promise<WearRecord[]> {
  const all = await (await db()).getAll("wear");
  return all.sort((a, b) => (a.day < b.day ? 1 : -1));
}

export async function saveWear(w: WearRecord): Promise<void> {
  await (await db()).put("wear", w);
}

export async function deleteWear(day: string): Promise<void> {
  await (await db()).delete("wear", day);
}

/** バックアップから戻す。同じIDのもの（着た記録は同じ日）は上書きし、ほかはそのまま残す */
export async function importAll(garments: Garment[], feedback: Feedback[], wear: WearRecord[] = []): Promise<void> {
  const tx = (await db()).transaction(["garments", "feedback", "wear"], "readwrite");
  await Promise.all([
    ...garments.map((g) => tx.objectStore("garments").put(g)),
    ...feedback.map((f) => tx.objectStore("feedback").put(f)),
    ...wear.map((w) => tx.objectStore("wear").put(w)),
    tx.done,
  ]);
}
