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

  it("つながらないときは、どうすればよいかを伝える", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const ai = new ClaudeAI("", down as unknown as typeof fetch);
    await expect(ai.suggestPurchases({ closet, request: { avoidColors: [] }, feedback: [] })).rejects.toThrow("端末内AI");
    const bad = vi.fn(async () => new Response("<html>", { status: 502 }));
    await expect(
      new ClaudeAI("", bad as unknown as typeof fetch).suggestPurchases({ closet, request: { avoidColors: [] }, feedback: [] }),
    ).rejects.toThrow("（502）");
  });
});

describe("ClaudeAI（合言葉・名前の長さ）", () => {
  it("合言葉を決めたら、URLの形にしてヘッダーで送る（日本語でも送れる）", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ suggestions: [] })));
    await new ClaudeAI("", fetchMock as unknown as typeof fetch, " ひみつ ").suggestPurchases({ closet, request: { avoidColors: [] }, feedback: [] });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["x-access-code"]).toBe(encodeURIComponent("ひみつ"));
    // ヘッダーに入れられる文字だけになっている
    expect(() => new Headers(headers)).not.toThrow();

    await new ClaudeAI("", fetchMock as unknown as typeof fetch).suggestPurchases({ closet, request: { avoidColors: [] }, feedback: [] });
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty("x-access-code");
  });

  it("Claude が長すぎる服の名前を返しても、40字に切り詰める（中継サーバーやバックアップで断られないように）", async () => {
    const long = "あ".repeat(80);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            category: "tops",
            subType: long,
            color: "black",
            pattern: "solid",
            subColor: null,
            alternatives: [{ category: "outer", subType: long }],
            confidence: 0.9,
          }),
        ),
    );
    const ai = new ClaudeAI("", fetchMock as unknown as typeof fetch);
    // 写真を縮める部分（ブラウザ専用）は使わない
    const photo = { size: 1 } as Blob;
    vi.stubGlobal("createImageBitmap", async () => ({ width: 10, height: 10, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width = 10;
        height = 10;
        getContext() {
          return { drawImage() {} };
        }
        async convertToBlob() {
          return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
        }
      },
    );
    try {
      const r = await ai.analyzeGarment(photo);
      expect(r.subType).toHaveLength(40);
      expect(r.candidates.every((c) => c.subType.length <= 40)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
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
