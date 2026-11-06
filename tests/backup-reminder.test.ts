import { describe, expect, it } from "vitest";
import { backupReminder } from "../src/storage/backupReminder";

const DAY = 86_400_000;
const now = Date.parse("2026-11-04T12:00:00+09:00");
const garments = (n: number, createdAt = now - 60 * DAY) => Array.from({ length: n }, () => ({ createdAt }));

describe("backupReminder", () => {
  it("服が少ないうちは知らせない", () => {
    expect(backupReminder(garments(4), undefined, undefined, now)).toBeNull();
  });
  it("5着を超えて一度も書き出していなければ知らせる", () => {
    expect(backupReminder(garments(5), undefined, undefined, now)).toEqual({ kind: "never" });
  });
  it("前回から30日たち、そのあと服が増えていたら知らせる", () => {
    const last = now - 40 * DAY;
    expect(backupReminder([...garments(5), { createdAt: now - DAY }], last, undefined, now)).toEqual({ kind: "stale", days: 40 });
    // 増えていなければ知らせない
    expect(backupReminder(garments(6), last, undefined, now)).toBeNull();
    // 30日たっていなければ知らせない
    expect(backupReminder([...garments(5), { createdAt: now - DAY }], now - 10 * DAY, undefined, now)).toBeNull();
  });
  it("「あとで」を押したら、その間は知らせない", () => {
    expect(backupReminder(garments(5), undefined, now + DAY, now)).toBeNull();
    expect(backupReminder(garments(5), undefined, now - DAY, now)).toEqual({ kind: "never" });
  });
});
