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
 * 並びは、着ていない期間の長い順：一度も着ていない服（登録の古い順）→ 最後に着た日の古い順。
 */
export function idleGarments(garments: Garment[], wears: WearRecord[], now = new Date()): Garment[] {
  if (wears.length === 0) return [];
  const last = lastWornMap(wears);
  const limit = now.getTime() - IDLE_DAYS * 86_400_000;
  const wornAt = (g: Garment) => {
    const day = last.get(g.id);
    return day ? new Date(`${day}T12:00:00`).getTime() : undefined;
  };
  return garments
    .filter((g) => (wornAt(g) ?? g.createdAt) < limit)
    .sort((a, b) => {
      const wa = wornAt(a), wb = wornAt(b);
      if (wa === undefined || wb === undefined) {
        if (wa !== undefined) return 1;
        if (wb !== undefined) return -1;
        return a.createdAt - b.createdAt;
      }
      return wa - wb;
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

/** 「3日前に着た」のような言い方（一覧の写真の下と、服の詳細で使う） */
export function wornLabel(day: string, now = new Date()): string {
  return `${daysAgoLabel(day, now)}に着た`;
}

/** 1着の着た記録の1行：「3日前に着た・5回」。記録が無ければ「まだ記録なし」 */
export function wearSummaryLine(garmentId: string, wears: WearRecord[], now = new Date()): string {
  const days = wears.filter((w) => w.garmentIds.includes(garmentId)).map((w) => w.day);
  if (days.length === 0) return "まだ記録なし";
  const last = days.reduce((a, b) => (a > b ? a : b));
  return `${wornLabel(last, now)}・${days.length}回`;
}
