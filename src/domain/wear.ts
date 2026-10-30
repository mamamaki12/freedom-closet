// 「着た」記録のまとめ方。コーデ画面の「今日はこれ」と、クローゼットの「しばらく着ていない服」に使う。
import type { Garment, WearRecord } from "./types";

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 直近 n 日ぶんの記録（今日を除く、新しい順）。コーデ提案に渡して、昨日と同じ服を避ける */
export function recentWears(wears: WearRecord[], today: string, n = 3): { garmentIds: string[]; day: string }[] {
  return wears
    .filter((w) => w.day !== today && w.garmentIds.length > 0)
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, n)
    .map((w) => ({ garmentIds: w.garmentIds, day: w.day }));
}

/** 服ごとに最後に着た日 */
export function lastWornMap(wears: WearRecord[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const w of wears) for (const id of w.garmentIds) if (!m.has(id) || m.get(id)! < w.day) m.set(id, w.day);
  return m;
}

/** これ以上着ていなければ「しばらく着ていない」 */
export const IDLE_DAYS = 30;

/**
 * しばらく着ていない服。記録が一度もない服は、登録から IDLE_DAYS 以上たっていれば入れる。
 * 着た記録を付け始めたばかりの人に全部が並ばないよう、記録が1件もなければ空にする。
 */
export function idleGarments(garments: Garment[], wears: WearRecord[], now = new Date()): Garment[] {
  if (wears.length === 0) return [];
  const last = lastWornMap(wears);
  const limit = now.getTime() - IDLE_DAYS * 86_400_000;
  return garments.filter((g) => {
    const day = last.get(g.id);
    if (day) return new Date(`${day}T12:00:00`).getTime() < limit;
    return g.createdAt < limit;
  });
}

/** 「3日前」「今日」のような言い方 */
export function daysAgoLabel(day: string, now = new Date()): string {
  const diff = Math.round((new Date(`${dayKey(now)}T12:00:00`).getTime() - new Date(`${day}T12:00:00`).getTime()) / 86_400_000);
  if (diff <= 0) return "今日";
  if (diff === 1) return "昨日";
  if (diff < 30) return `${diff}日前`;
  if (diff < 365) return `${Math.floor(diff / 30)}か月前`;
  return "1年以上前";
}
