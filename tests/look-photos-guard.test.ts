// 似た着こなし写真の守り：https のリンクだけ使う・合言葉を送る・つながらないときの扱い
import { describe, expect, it, vi } from "vitest";
import { PhotosUpstreamError, searchLookPhotos } from "../server/photos";
import { lookPhotosResultSchema } from "../src/ai/schemas";
import { LookPhotoFinder } from "../src/shop/lookPhotos";

const items = [{ category: "tops" as const, color: "navy" as const, subType: "シャツ" }];
const good = {
  id: "1",
  image: "https://images.pexels.com/1.jpg",
  alt: "a",
  pageUrl: "https://www.pexels.com/photo/1/",
  photographer: "A",
  photographerUrl: "https://www.pexels.com/@a",
};

describe("写真のURL", () => {
  it("javascript: や http: のリンクは受け付けない（画面のリンク・画像に使うため）", () => {
    const result = (photo: object, sourceUrl = "https://www.pexels.com") => ({ query: "q", photos: [photo], source: { name: "Pexels", url: sourceUrl } });
    expect(lookPhotosResultSchema.safeParse(result(good)).success).toBe(true);
    expect(lookPhotosResultSchema.safeParse(result({ ...good, pageUrl: "javascript:alert(document.domain)" })).success).toBe(false);
    expect(lookPhotosResultSchema.safeParse(result({ ...good, image: "http://images.pexels.com/1.jpg" })).success).toBe(false);
    expect(lookPhotosResultSchema.safeParse(result({ ...good, photographerUrl: "data:text/html,<script>alert(1)</script>" })).success).toBe(false);
    expect(lookPhotosResultSchema.safeParse(result(good, "javascript:alert(1)")).success).toBe(false);
  });

  it("サーバーは Pexels の結果のうち、形の合わないものだけ落とす", async () => {
    const pexels = {
      photos: [
        { id: 1, url: good.pageUrl, alt: "ok", photographer: "A", photographer_url: good.photographerUrl, src: { medium: good.image } },
        { id: 2, url: "javascript:alert(1)", alt: "bad", photographer: "B", photographer_url: good.photographerUrl, src: { medium: good.image } },
      ],
    };
    const r = await searchLookPhotos({ items: [{ category: "tops", color: "red", subType: "ニット" }] }, "key", (async () => new Response(JSON.stringify(pexels))) as typeof fetch);
    expect(r.photos.map((p) => p.id)).toEqual(["1"]);
  });

  it("Pexels につながらないときは「写真サイトにつながらない」扱い（アプリはあとでまた聞ける）", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(searchLookPhotos({ items: [{ category: "outer", color: "khaki", subType: "コート" }] }, "key", down)).rejects.toBeInstanceOf(PhotosUpstreamError);
  });
});

describe("LookPhotoFinder の合言葉", () => {
  it("合言葉をヘッダーで送り、合言葉を変えたら断られた記録を忘れてもう一度聞く", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const code = (init.headers as Record<string, string>)["x-access-code"];
      return code === "right" ? new Response(JSON.stringify({ query: "q", photos: [good], source: { name: "Pexels", url: "https://www.pexels.com" } })) : new Response("{}", { status: 401 });
    });
    const finder = new LookPhotoFinder("", fetchImpl as unknown as typeof fetch);
    finder.setAccessCode("wrong");
    expect(await finder.find(items)).toBeNull();
    expect(await finder.find(items)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    finder.setAccessCode("right");
    expect((await finder.find(items))?.photos).toHaveLength(1);
  });
});
