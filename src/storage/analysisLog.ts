// 自動判定と、本人が直したあとの値の記録。検証計画の「種類・色の認識精度」を測るため。
// 写真は残さず、判定結果と最終的な値だけを残す。
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AIProviderId } from "../ai/types";
import type { Category, ColorName } from "../domain/types";

export interface AnalysisRecord {
  /** 登録した服のID（あとから直したときに記録を更新するため） */
  id: string;
  at: number;
  provider: AIProviderId;
  /** 判定にかかった時間（ミリ秒）。初回はモデルの読み込みを含む */
  elapsedMs: number;
  predicted: { category: Category | null; subType: string | null; color: ColorName; confidence: number };
  final: { category: Category; subType: string; color: ColorName };
}

interface LogDB extends DBSchema {
  records: { key: string; value: AnalysisRecord };
}

let dbPromise: Promise<IDBPDatabase<LogDB>> | null = null;
function db() {
  dbPromise ??= openDB<LogDB>("freedom-closet-verify", 1, {
    upgrade(d) {
      d.createObjectStore("records", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function addRecord(r: AnalysisRecord): Promise<void> {
  await (await db()).put("records", r);
}

/** 本人があとから直した値を記録に反映する。記録がなければ何もしない */
export async function updateFinal(id: string, final: AnalysisRecord["final"]): Promise<void> {
  const d = await db();
  const r = await d.get("records", id);
  if (r) await d.put("records", { ...r, final });
}

export async function listRecords(): Promise<AnalysisRecord[]> {
  return (await (await db()).getAll("records")).sort((a, b) => a.at - b.at);
}

export async function clearRecords(): Promise<void> {
  await (await db()).clear("records");
}

export interface AccuracySummary {
  provider: AIProviderId;
  total: number;
  /** 種類（トップス・ボトムスなど）が合っていた割合。判定できなかったものは不正解 */
  categoryRate: number;
  /** 服の名前（シャツ・ワイドパンツなど）が直されなかった割合 */
  subTypeRate: number;
  colorRate: number;
  /** 種類を判定できなかった件数 */
  failed: number;
  medianMs: number;
}

export function summarize(records: AnalysisRecord[]): AccuracySummary[] {
  const byProvider = new Map<AIProviderId, AnalysisRecord[]>();
  for (const r of records) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r]);
  return [...byProvider.entries()].map(([provider, rs]) => {
    const rate = (f: (r: AnalysisRecord) => boolean) => rs.filter(f).length / rs.length;
    const ms = rs.map((r) => r.elapsedMs).sort((a, b) => a - b);
    return {
      provider,
      total: rs.length,
      categoryRate: rate((r) => r.predicted.category === r.final.category),
      subTypeRate: rate((r) => r.predicted.subType === r.final.subType),
      colorRate: rate((r) => r.predicted.color === r.final.color),
      failed: rs.filter((r) => r.predicted.category === null).length,
      medianMs: ms[Math.floor(ms.length / 2)] ?? 0,
    };
  });
}

/** 表計算ソフトで見られるようにCSVにする */
export function toCsv(records: AnalysisRecord[]): string {
  const head = [
    "日時",
    "AI",
    "時間ms",
    "判定_種類",
    "判定_名前",
    "判定_色",
    "確からしさ",
    "正解_種類",
    "正解_名前",
    "正解_色",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = records.map((r) =>
    [
      new Date(r.at).toISOString(),
      r.provider,
      Math.round(r.elapsedMs),
      r.predicted.category,
      r.predicted.subType,
      r.predicted.color,
      r.predicted.confidence.toFixed(2),
      r.final.category,
      r.final.subType,
      r.final.color,
    ]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n");
}
