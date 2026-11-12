import { describe, expect, it } from "vitest";
import { garmentNameParts, isLongName, nameParts } from "../src/domain/names";

describe("nameParts", () => {
  it("後ろの言葉の前で分ける", () => {
    expect(nameParts("デニムジャケット")).toEqual(["デニム", "ジャケット"]);
    expect(nameParts("スウェットパンツ")).toEqual(["スウェット", "パンツ"]);
    expect(nameParts("花柄シャツ")).toEqual(["花柄", "シャツ"]);
    expect(nameParts("タートルネック")).toEqual(["タートル", "ネック"]);
    expect(nameParts("マウンテンパーカ")).toEqual(["マウンテン", "パーカ"]);
  });
  it("短い名前や、分けられない名前はそのまま", () => {
    expect(nameParts("シャツ")).toEqual(["シャツ"]);
    expect(nameParts("ジャケット")).toEqual(["ジャケット"]);
    expect(nameParts("革靴")).toEqual(["革靴"]);
  });
  it("言葉を増やした分も分ける（Tシャツ・ポロシャツは割らない）", () => {
    expect(nameParts("スキニーデニム")).toEqual(["スキニー", "デニム"]);
    expect(nameParts("タンクトップ")).toEqual(["タンク", "トップ"]);
    expect(nameParts("ニットベスト")).toEqual(["ニット", "ベスト"]);
    expect(nameParts("ボーダーTシャツ")).toEqual(["ボーダー", "Tシャツ"]);
    expect(nameParts("ポロシャツ")).toEqual(["ポロシャツ"]);
    expect(nameParts("Tシャツ")).toEqual(["Tシャツ"]);
  });
});

describe("garmentNameParts", () => {
  it("柄の付いた服は、柄と種類の間で分ける", () => {
    expect(garmentNameParts({ subType: "ポロシャツ", pattern: "stripe" })).toEqual(["ボーダー", "ポロシャツ"]);
    expect(garmentNameParts({ subType: "デニムジャケット", pattern: "solid" })).toEqual(["デニム", "ジャケット"]);
  });
  it("1つの切れ目の中が6文字以上なら長い名前", () => {
    expect(isLongName(["カーディガン"])).toBe(true);
    expect(isLongName(["ボーダー", "カーディガン"])).toBe(true);
    expect(isLongName(["デニム", "ジャケット"])).toBe(false);
  });
});
