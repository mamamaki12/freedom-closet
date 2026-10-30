import { describe, expect, it } from "vitest";
import { BackupFormatError, createBackup, parseBackup } from "../src/storage/backup";
import type { Garment } from "../src/domain/types";

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

describe("backup", () => {
  it("書き出して戻すと、写真も含めて同じ内容になる", async () => {
    const fb = [{ outfitKey: "g1+g2", garmentIds: ["g1", "g2"], liked: true, at: 5 }];
    const text = JSON.stringify(await createBackup([garment], fb, 999));
    const back = parseBackup(text);
    expect(back.exportedAt).toBe(999);
    expect(back.feedback).toEqual(fb);
    const { photo: p, ...rest } = back.garments[0];
    const { photo: _orig, ...origRest } = garment;
    expect(rest).toEqual(origRest);
    expect(p.type).toBe("image/jpeg");
    expect(new Uint8Array(await p.arrayBuffer())).toEqual(new Uint8Array(await photo.arrayBuffer()));
  });

  it("別のファイルは分かる言葉で断る", () => {
    expect(() => parseBackup("not json")).toThrow(BackupFormatError);
    expect(() => parseBackup(JSON.stringify({ hello: 1 }))).toThrow("バックアップファイルではない");
  });
});
