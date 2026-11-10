import { afterEach, describe, expect, it, vi } from "vitest";
import { closetNotices, noticeKey, noticeSummary } from "../src/screens/closetNotices";
import { closedNoticeKey, closetHintSeen, markClosetHintSeen, saveClosedNoticeKey } from "../src/storage/closetHints";

describe("closetNotices", () => {
  it("バックアップと確認したい服の両方があれば、2件をこの順に出す", () => {
    const kinds = closetNotices({ backupReminder: { kind: "never" }, reviewCount: 2, reviewFilterOn: false });
    expect(kinds).toEqual(["backup", "review"]);
    expect(noticeSummary(kinds, 2)).toEqual({ title: "お知らせ 2件", detail: "バックアップ・確認" });
  });
  it("1件だけなら、その中身を短く出す", () => {
    const backup = closetNotices({ backupReminder: { kind: "stale", days: 40 }, reviewCount: 0, reviewFilterOn: false });
    expect(noticeSummary(backup, 0)).toEqual({ title: "バックアップを書き出しましょう" });
    const review = closetNotices({ backupReminder: null, reviewCount: 3, reviewFilterOn: false });
    expect(noticeSummary(review, 3)).toEqual({ title: "確認したい服が3着あります" });
  });
  it("「確認したい」で絞り込んでいる間は、確認したい服のお知らせを出さない", () => {
    expect(closetNotices({ backupReminder: null, reviewCount: 3, reviewFilterOn: true })).toEqual([]);
    expect(closetNotices({ backupReminder: { kind: "never" }, reviewCount: 3, reviewFilterOn: true })).toEqual(["backup"]);
  });
  it("閉じた目印は種類で決まり、着数が変わっても同じ。種類が増えたら変わる", () => {
    expect(noticeKey(["review"])).toBe(noticeKey(["review"]));
    expect(noticeKey(["backup", "review"])).not.toBe(noticeKey(["review"]));
  });
});

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe("closetHints", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("説明文は一度見たら出さない", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(closetHintSeen()).toBe(false);
    markClosetHintSeen();
    expect(closetHintSeen()).toBe(true);
  });
  it("保存できない環境でも止まらず、説明文は出す", () => {
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("sessionStorage", undefined);
    expect(closetHintSeen()).toBe(false);
    expect(() => markClosetHintSeen()).not.toThrow();
    expect(closedNoticeKey()).toBeUndefined();
    expect(() => saveClosedNoticeKey("review")).not.toThrow();
  });
  it("閉じたお知らせは、開いている間だけ覚える", () => {
    vi.stubGlobal("sessionStorage", fakeStorage());
    expect(closedNoticeKey()).toBeUndefined();
    saveClosedNoticeKey("backup,review");
    expect(closedNoticeKey()).toBe("backup,review");
  });
});
