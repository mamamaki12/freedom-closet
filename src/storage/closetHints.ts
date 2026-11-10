// クローゼットの説明文を「一度見たか」と、お知らせを「×」で閉じたかを覚える。
// 説明文は一度見たら出さない（端末に残す）。お知らせを閉じるのは、アプリを開いている間だけ。
const HINT_SEEN_KEY = "freedom-closet:closet-hint-seen";
const NOTICE_CLOSED_KEY = "freedom-closet:closet-notice-closed";

/** 「服をタップすると…」の説明をもう見たか */
export function closetHintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) === "1";
  } catch {
    // 保存できない環境では、毎回出す
    return false;
  }
}

export function markClosetHintSeen(): void {
  try {
    localStorage.setItem(HINT_SEEN_KEY, "1");
  } catch {
    // 保存できなくても、画面はそのまま使える
  }
}

/** 「×」で閉じたお知らせの目印（closetNotices の noticeKey）。開いている間だけ覚える */
export function closedNoticeKey(): string | undefined {
  try {
    return sessionStorage.getItem(NOTICE_CLOSED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveClosedNoticeKey(key: string): void {
  try {
    sessionStorage.setItem(NOTICE_CLOSED_KEY, key);
  } catch {
    // 保存できない環境では、この画面を開いている間だけ閉じる
  }
}
