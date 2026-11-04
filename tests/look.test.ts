import { describe, expect, it, vi } from "vitest";
import { PhotosNotConfiguredError, searchLookPhotos } from "../server/photos";
import { bodyShape, lookQuery, lookShape } from "../src/domain/look";
import { LookPhotoFinder } from "../src/shop/lookPhotos";

const items = [
  { category: "tops" as const, color: "navy" as const, subType: "シャツ" },
  { category: "bottoms" as const, color: "beige" as const, subType: "ワイドパンツ" },
  { category: "shoes" as const, color: "white" as const, subType: "スニーカー" },
];

describe("lookShape", () => {
  it("服の名前から形を決める", () => {
    expect(lookShape({ category: "tops", subType: "Tシャツ" })).toMatchObject({ kind: "top", sleeve: "short" });
    expect(lookShape({ category: "tops", subType: "ニット" })).toMatchObject({ kind: "top", sleeve: "long" });
    expect(lookShape({ category: "bottoms", subType: "ワイドパンツ" })).toMatchObject({ kind: "pants", width: "wide", length: "full" });
    expect(lookShape({ category: "bottoms", subType: "ショートパンツ" })).toMatchObject({ kind: "pants", length: "short" });
    expect(lookShape({ category: "bottoms", subType: "ロングスカート" })).toMatchObject({ kind: "skirt", length: "long" });
    expect(lookShape({ category: "outer", subType: "トレンチコート" })).toMatchObject({ kind: "outer", length: "long" });
    expect(lookShape({ category: "outer", subType: "ダウン" })).toMatchObject({ kind: "outer", puffy: true, length: "short", sleeve: "long" });
    expect(lookShape({ category: "outer", subType: "ダウンベスト" })).toMatchObject({ kind: "outer", sleeve: "none" });
    expect(lookShape({ category: "outer", subType: "ニットジレ" })).toMatchObject({ kind: "outer", sleeve: "none" });
    expect(lookShape({ category: "shoes", subType: "ブーツ" })).toMatchObject({ kind: "shoes", style: "boots" });
  });

  it("服の種類の名前から、えりの形を決める", () => {
    const neck = (category: "tops" | "outer" | "onepiece", subType: string) =>
      (lookShape({ category, subType }) as { neck?: string }).neck;
    expect(neck("tops", "Tシャツ")).toBe("crew");
    expect(neck("tops", "スウェットシャツ")).toBe("crew");
    expect(neck("tops", "ニット")).toBe("crew");
    expect(neck("tops", "シャツ")).toBe("collar");
    expect(neck("tops", "ポロシャツ")).toBe("collar");
    expect(neck("tops", "パーカー")).toBe("hood");
    expect(neck("tops", "タートルネック")).toBe("stand");
    expect(neck("tops", "Vネックニット")).toBe("v");
    expect(neck("tops", "ブラウス")).toBe("plain");
    expect(neck("outer", "ダウンジャケット")).toBe("stand");
    expect(neck("outer", "テーラードジャケット")).toBe("lapel");
    expect(neck("outer", "デニムジャケット")).toBe("collar");
    expect(neck("outer", "マウンテンパーカー")).toBe("hood");
    expect(neck("outer", "カーディガン")).toBe("v");
    expect(neck("outer", "トレンチコート")).toBe("lapel");
    expect(neck("onepiece", "ワンピース")).toBe("plain");
    expect(neck("onepiece", "シャツワンピース")).toBe("collar");
  });
});

describe("bodyShape", () => {
  it("何も入れていなければ標準の体型", () => {
    expect(bodyShape({})).toMatchObject({ width: 1, belly: 1 });
  });
  it("体重が重めなら太く、おなかまわりは肩より大きく増える（上限あり）", () => {
    const b = bodyShape({ heightCm: 170, weightKg: 80 });
    expect(b.width).toBeGreaterThan(1);
    expect(b.belly).toBeGreaterThan(b.width);
    expect(bodyShape({ heightCm: 150, weightKg: 200 })).toMatchObject({ width: 1.35, belly: 1.7 });
    expect(bodyShape({ heightCm: 180, weightKg: 52 }).width).toBeLessThan(1);
  });
  it("背が高いほど大きく描く", () => {
    expect(bodyShape({ heightCm: 185 }).scale).toBeGreaterThan(bodyShape({ heightCm: 155 }).scale);
    expect(bodyShape({ heightCm: 230 }).scale).toBe(1);
  });
  it("体重だけでも、平均くらいの身長として太さを出す", () => {
    expect(bodyShape({ weightKg: 90, fit: "mens" }).width).toBeGreaterThan(1);
  });
});

describe("lookQuery", () => {
  it("英語の検索語にし、靴は省く", () => {
    expect(lookQuery(items)).toBe("navy shirt beige wide leg pants outfit");
    expect(lookQuery(items, { fit: "womens" })).toBe("navy shirt beige wide leg pants women outfit");
  });
  it("ボトムスのスウェットはトップスの名前にしない", () => {
    expect(lookQuery([{ category: "bottoms", color: "gray", subType: "スウェットパンツ" }])).toBe("gray pants outfit");
  });
});

describe("searchLookPhotos（サーバー）", () => {
  const pexels = {
    photos: [
      {
        id: 1,
        url: "https://www.pexels.com/photo/1/",
        alt: "man in navy shirt",
        photographer: "A",
        photographer_url: "https://www.pexels.com/@a",
        src: { medium: "https://images.pexels.com/1.jpg" },
      },
    ],
  };
  it("APIキーがなければ設定されていないエラー", async () => {
    await expect(searchLookPhotos({ items }, "")).rejects.toBeInstanceOf(PhotosNotConfiguredError);
  });
  it("Pexelsの結果を出典つきで返し、同じ検索は覚えておく", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(pexels)));
    const r = await searchLookPhotos({ items, fit: "mens" }, "key", fetchImpl as typeof fetch);
    expect(r.photos[0]).toMatchObject({
      image: "https://images.pexels.com/1.jpg",
      photographer: "A",
      pageUrl: "https://www.pexels.com/photo/1/",
    });
    expect(r.source.name).toBe("Pexels");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("query")).toBe("navy shirt beige wide leg pants men outfit");
    expect((init.headers as Record<string, string>).authorization).toBe("key");
    await searchLookPhotos({ items, fit: "mens" }, "key", fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("LookPhotoFinder（アプリ）", () => {
  it("サーバーが写真検索に対応していなければ null で、そのあとは聞かない", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    const finder = new LookPhotoFinder("", fetchImpl as typeof fetch);
    expect(await finder.find(items)).toBeNull();
    expect(await finder.find(items.slice(0, 2))).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("つながらなくても失敗にしない", async () => {
    const finder = new LookPhotoFinder("", (async () => {
      throw new TypeError("network");
    }) as typeof fetch);
    expect(await finder.find(items)).toBeNull();
  });
});
