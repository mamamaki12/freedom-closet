import { describe, expect, it } from "vitest";
import { restorePlan } from "../src/screens/BackupPanel";
import type { RestoredBackup } from "../src/storage/backup";
import type { Garment } from "../src/domain/types";

const g = (id: string) => ({ id }) as Garment;
const restored = (over: Partial<RestoredBackup> = {}): RestoredBackup => ({ exportedAt: 0, garments: [], feedback: [], wear: [], skipped: 0, ...over });

describe("戻す前の確認に出す数", () => {
  it("戻す服の数と、今ある服を上書きする数を数える", () => {
    const plan = restorePlan(
      restored({ garments: [g("a"), g("b"), g("c")], feedback: [{ outfitKey: "a+b", garmentIds: ["a", "b"], liked: true, at: 1 }], wear: [{ day: "2026-11-01", garmentIds: ["a"], at: 1 }] }),
      ["b", "c", "x"],
    );
    expect(plan).toEqual({ garments: 3, overwrite: 2, feedback: 1, wear: 1, empty: false });
  });
  it("何も入っていなければ empty（戻さずに知らせる）", () => {
    expect(restorePlan(restored(), []).empty).toBe(true);
    expect(restorePlan(restored({ profile: { heightCm: 160 } }), []).empty).toBe(false);
  });
});
