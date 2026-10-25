import { describe, expect, it, vi } from "vitest";
import { ClaudeAI, sanitizeOutfits } from "../src/ai/claude";
import { withFallback } from "../src/ai";
import type { ClosetAI } from "../src/ai/types";
import { g } from "./fixtures";

const closet = [
  g({ id: "t1", category: "tops", color: "white" }),
  g({ id: "t2", category: "tops", color: "black" }),
  g({ id: "b1", category: "bottoms", color: "navy" }),
];

describe("sanitizeOutfits", () => {
  it("持っていない服・同じ種類2着・使いたい服なしの案を落とす", () => {
    const res = sanitizeOutfits(
      {
        outfits: [
          { garmentIds: ["t1", "b1"], title: "OK", explanation: [] },
          { garmentIds: ["t1", "zzz"], title: "持っていない", explanation: [] },
          { garmentIds: ["t1", "t2"], title: "トップス2着", explanation: [] },
          { garmentIds: ["b1", "t1"], title: "重複", explanation: [] },
        ],
      },
      closet,
      ["t1"],
    );
    expect(res.map((o) => o.title)).toEqual(["OK"]);
  });

  it("もう見せた組み合わせは落とす", () => {
    const res = sanitizeOutfits(
      {
        outfits: [
          { garmentIds: ["b1", "t1"], title: "見せた", explanation: [] },
          { garmentIds: ["t2", "b1"], title: "新しい", explanation: [] },
        ],
      },
      closet,
      [],
      ["b1+t1"],
    );
    expect(res.map((o) => o.title)).toEqual(["新しい"]);
  });
});

describe("ClaudeAI", () => {
  it("中継サーバーの /api/ai/outfits を呼ぶ", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ outfits: [{ garmentIds: ["t2", "b1"], title: "黒×紺", explanation: ["a"] }] })),
    );
    const ai = new ClaudeAI("https://example.test/", fetchMock as unknown as typeof fetch);
    const res = await ai.suggestOutfits({ closet, request: { mustInclude: [], purpose: "everyday" }, feedback: [] });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api/ai/outfits", expect.objectContaining({ method: "POST" }));
    expect(res[0].garmentIds).toEqual(["t2", "b1"]);
  });

  it("サーバーのエラー文をそのまま伝える", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "混み合っています" }), { status: 429 }));
    const ai = new ClaudeAI("", fetchMock as unknown as typeof fetch);
    await expect(
      ai.suggestPurchases({ closet, request: { avoidColors: [] }, feedback: [] }),
    ).rejects.toThrow("混み合っています");
  });
});

describe("withFallback", () => {
  const make = (id: "local" | "claude", fail: boolean): ClosetAI => ({
    id,
    label: id,
    sendsPhotosOffDevice: id === "claude",
    analyzeGarment: vi.fn(),
    suggestOutfits: vi.fn(async () => {
      if (fail) throw new Error("down");
      return [{ key: id, garmentIds: [], title: id, explanation: [], score: 0 }];
    }),
    suggestPurchases: vi.fn(),
  });

  it("失敗したら控えのAIで続け、知らせる", async () => {
    const onFallback = vi.fn();
    const ai = withFallback(make("claude", true), make("local", false), onFallback);
    const res = await ai.suggestOutfits({ closet, request: { mustInclude: [], purpose: "everyday" }, feedback: [] });
    expect(res[0].title).toBe("local");
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("成功したら控えは使わない", async () => {
    const local = make("local", false);
    const ai = withFallback(make("claude", false), local);
    await ai.suggestOutfits({ closet, request: { mustInclude: [], purpose: "everyday" }, feedback: [] });
    expect(local.suggestOutfits).not.toHaveBeenCalled();
  });
});
