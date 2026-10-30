import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { feelForMonth, loadConditions, saveConditions, temperatureFor } from "../src/storage/conditions";
import { climateFor } from "../src/ai/local/outfits";

describe("体感の気温", () => {
  it("月ごとの目安", () => {
    expect(feelForMonth(new Date(2026, 0, 10))).toBe("cold");
    expect(feelForMonth(new Date(2026, 7, 10))).toBe("hot");
    expect(feelForMonth(new Date(2026, 9, 25))).toBe("mild");
  });
  it("寒いときはアウター必須、暑いときはアウターなしになる気温に変換する", () => {
    expect(climateFor(temperatureFor("cold")).outer).toBe("required");
    expect(climateFor(temperatureFor("chilly")).outer).toBe("required");
    expect(climateFor(temperatureFor("mild")).outer).toBe("optional");
    expect(climateFor(temperatureFor("hot")).outer).toBe("none");
  });
});

describe("条件の保存", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.assign(globalThis, {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    });
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("保存がなければ季節の目安と「普段」", () => {
    expect(loadConditions(new Date(2026, 0, 10))).toEqual({ feel: "cold", purpose: "everyday" });
  });
  it("気温はその日だけ、目的はずっと覚える", () => {
    const day = new Date(2026, 9, 25, 9);
    saveConditions({ feel: "hot", purpose: "work" }, day);
    expect(loadConditions(new Date(2026, 9, 25, 20))).toEqual({ feel: "hot", purpose: "work" });
    expect(loadConditions(new Date(2026, 9, 26, 8))).toEqual({ feel: "mild", purpose: "work" });
  });
});
