import { describe, expect, it } from "vitest";
import { nameParts } from "../src/domain/names";

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
});
