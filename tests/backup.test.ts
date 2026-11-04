import { describe, expect, it } from "vitest";
import { BackupFormatError, createBackup, mergeProfile, parseBackup } from "../src/storage/backup";
import type { Garment, WearRecord } from "../src/domain/types";

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 250])], { type: "image/jpeg" });
const garment: Garment = {
  id: "g1",
  category: "tops",
  subType: "シャツ",
  color: "white",
  seasons: ["spring"],
  formality: "smart",
  warmth: 2,
  photo,
  createdAt: 123,
};

/** 書き出したファイルの中身（JSON）を、手で書き換えて試すため */
async function backupJson(garments: Garment[] = [garment]) {
  return JSON.parse(JSON.stringify(await createBackup({ garments, feedback: [] }, 999)));
}

describe("backup", () => {
  it("書き出して戻すと、写真も含めて同じ内容になる", async () => {
    const fb = [{ outfitKey: "g1+g2", garmentIds: ["g1", "g2"], liked: true, at: 5 }];
    const text = JSON.stringify(await createBackup({ garments: [garment], feedback: fb }, 999));
    const back = parseBackup(text);
    expect(back.exportedAt).toBe(999);
    expect(back.feedback).toEqual(fb);
    expect(back.skipped).toBe(0);
    const { photo: p, ...rest } = back.garments[0];
    const { photo: _orig, ...origRest } = garment;
    expect(rest).toEqual(origRest);
    expect(p.type).toBe("image/jpeg");
    expect(new Uint8Array(await p.arrayBuffer())).toEqual(new Uint8Array(await photo.arrayBuffer()));
  });

  it("着た記録・身長やサイズ・「確認」の目印も戻る", async () => {
    const wear: WearRecord[] = [{ day: "2026-11-01", garmentIds: ["g1"], outfitKey: "g1", at: 7 }];
    const profile = { heightCm: 170, usualSize: { tops: "M" } };
    const unsure: Garment = { ...garment, needsReview: true, aiConfidence: 0.4 };
    const back = parseBackup(JSON.stringify(await createBackup({ garments: [unsure], feedback: [], wear, profile }, 1)));
    expect(back.wear).toEqual(wear);
    expect(back.profile).toEqual(profile);
    expect(back.garments[0]).toMatchObject({ needsReview: true, aiConfidence: 0.4 });
  });

  it("前の版のバックアップ（着た記録・サイズなし）も戻せる", async () => {
    const old = await backupJson();
    delete old.wear;
    delete old.profile;
    const back = parseBackup(JSON.stringify(old));
    expect(back.garments).toHaveLength(1);
    expect(back.wear).toEqual([]);
    expect(back.profile).toBeUndefined();
  });

  it("別のファイルは分かる言葉で断る", () => {
    expect(() => parseBackup("not json")).toThrow(BackupFormatError);
    expect(() => parseBackup(JSON.stringify({ hello: 1 }))).toThrow("バックアップファイルではない");
  });

  it("形の合わない服だけ飛ばして、ほかの服は戻す", async () => {
    const json = await backupJson([garment, { ...garment, id: "g2" }]);
    json.garments[1].category = "hat";
    const back = parseBackup(JSON.stringify(json));
    expect(back.garments.map((g) => g.id)).toEqual(["g1"]);
    expect(back.skipped).toBe(1);
    // 1着も戻せないときは、壊れていると伝える
    json.garments = [json.garments[1]];
    expect(() => parseBackup(JSON.stringify(json))).toThrow("1着も戻せません");
  });

  it("写真の中身が base64 でなければ、その服は戻さない（英語のエラーで止まらない）", async () => {
    const json = await backupJson([garment, { ...garment, id: "g2" }]);
    json.garments[1].photo.base64 = "これは写真ではない";
    const back = parseBackup(JSON.stringify(json));
    expect(back.garments.map((g) => g.id)).toEqual(["g1"]);
  });

  it("写真として開くと危ない形式（HTML・SVG）は、画像として戻さない", async () => {
    const json = await backupJson();
    for (const type of ["text/html", "image/svg+xml", "application/xhtml+xml"]) {
      json.garments[0].photo.type = type;
      expect(parseBackup(JSON.stringify(json)).garments[0].photo.type).toBe("application/octet-stream");
    }
    json.garments[0].photo.type = "image/heic";
    expect(parseBackup(JSON.stringify(json)).garments[0].photo.type).toBe("image/heic");
  });

  it("長すぎる名前は入力欄と同じ40字に切り詰める（そのほかの値は確かめる）", async () => {
    const json = await backupJson();
    json.garments[0].subType = "あ".repeat(60);
    json.garments[0].__proto__polluted = true;
    const back = parseBackup(JSON.stringify(json));
    expect(back.garments[0].subType).toHaveLength(40);
    expect(back.garments[0]).not.toHaveProperty("__proto__polluted");
    json.garments[0].warmth = 9;
    expect(() => parseBackup(JSON.stringify(json))).toThrow(BackupFormatError);
  });

  it("身長・サイズは、今の端末で入れていない項目だけ戻す", () => {
    expect(mergeProfile({ heightCm: 160 }, { heightCm: 170, weightKg: 60, usualSize: { tops: "M", shoes: "26" } })).toEqual({
      heightCm: 160,
      weightKg: 60,
      usualSize: { tops: "M", shoes: "26" },
    });
    expect(mergeProfile({ usualSize: { tops: "S" } }, { usualSize: { tops: "M" } })).toEqual({ usualSize: { tops: "S" } });
    expect(mergeProfile({ fit: "mens" }, undefined)).toEqual({ fit: "mens" });
    expect(mergeProfile({}, {})).toEqual({});
  });
});
