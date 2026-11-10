// クローゼットの上に出すお知らせ（バックアップ・確認したい服）を1行にまとめるための決まり。
// スマホの最初の画面で服が見えるよう、お知らせは1行にたたみ、タップで中身を開く。
import type { BackupReminder } from "../storage/backupReminder";

export type ClosetNoticeKind = "backup" | "review";

/** 今出すお知らせ。並びは、たたんだ行に出す順 */
export function closetNotices({
  backupReminder,
  reviewCount,
  reviewFilterOn,
}: {
  backupReminder: BackupReminder | null | undefined;
  reviewCount: number;
  /** 「確認したい」で絞り込んでいる間は、確認したい服のお知らせはいらない */
  reviewFilterOn: boolean;
}): ClosetNoticeKind[] {
  const kinds: ClosetNoticeKind[] = [];
  if (backupReminder) kinds.push("backup");
  if (reviewCount > 0 && !reviewFilterOn) kinds.push("review");
  return kinds;
}

const SHORT_LABELS: Record<ClosetNoticeKind, string> = {
  backup: "バックアップ",
  review: "確認",
};

/** たたんだ行の文。1件ならその中身を短く、2件以上なら「お知らせ 2件」と、何のお知らせか（detail） */
export function noticeSummary(kinds: ClosetNoticeKind[], reviewCount: number): { title: string; detail?: string } {
  if (kinds.length === 0) return { title: "" };
  if (kinds.length === 1) {
    return { title: kinds[0] === "backup" ? "バックアップを書き出しましょう" : `確認したい服が${reviewCount}着あります` };
  }
  return { title: `お知らせ ${kinds.length}件`, detail: kinds.map((k) => SHORT_LABELS[k]).join("・") };
}

/** 「×」で閉じたときに覚える目印。新しい種類のお知らせが増えたら、また出す */
export const noticeKey = (kinds: ClosetNoticeKind[]): string => kinds.join(",");
