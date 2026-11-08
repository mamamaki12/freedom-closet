// バックアップのお知らせ。服の写真は端末の中にだけあるので、しばらく書き出していないときにクローゼットで知らせる。
import type { Garment } from "../domain/types";

const LAST_KEY = "freedom-closet:last-backup";
const SNOOZE_KEY = "freedom-closet:backup-snooze";
const DAY = 86_400_000;

/** 服がこれだけ登録されたら、はじめてのバックアップをすすめる */
export const FIRST_REMINDER_AT = 5;
/** 前回からこれだけ日がたち、そのあと服が増えていたら、もう一度すすめる */
export const REMIND_AFTER_DAYS = 30;
/** 「あとで」を押したら、これだけ待つ */
export const SNOOZE_DAYS = 14;

export type BackupReminder = { kind: "never" } | { kind: "stale"; days: number };

export function backupReminder(
  garments: Pick<Garment, "createdAt">[],
  lastBackupAt: number | undefined,
  snoozedUntil: number | undefined,
  now = Date.now(),
): BackupReminder | null {
  if (garments.length < FIRST_REMINDER_AT) return null;
  if (snoozedUntil && snoozedUntil > now) return null;
  if (!lastBackupAt) return { kind: "never" };
  const days = Math.floor((now - lastBackupAt) / DAY);
  if (days < REMIND_AFTER_DAYS) return null;
  return garments.some((g) => g.createdAt > lastBackupAt) ? { kind: "stale", days } : null;
}

function readTime(key: string): number | undefined {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeTime(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // 保存できない環境では、開いている間だけ覚える
  }
}

export const loadLastBackup = (): number | undefined => readTime(LAST_KEY);
export const loadBackupSnooze = (): number | undefined => readTime(SNOOZE_KEY);

/** 書き出した（または、その時点のバックアップから戻した）時刻を覚える。前より古い時刻では戻さない */
export function saveLastBackup(at = Date.now()): number {
  const v = Math.max(at, loadLastBackup() ?? 0);
  writeTime(LAST_KEY, v);
  return v;
}

export function snoozeBackupReminder(now = Date.now()): number {
  const until = now + SNOOZE_DAYS * DAY;
  writeTime(SNOOZE_KEY, until);
  return until;
}
