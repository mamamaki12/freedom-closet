// 似た着こなしの写真を中継サーバー（server/photos.ts）に頼んで探す。
// サーバーがない・写真検索が設定されていないときは null を返し、画面はイラストと検索リンクだけにする。
import { lookPhotosResultSchema, type LookPhotosRequest, type LookPhotosResult } from "../ai/schemas";
import type { Fit } from "../domain/profile";
import type { GarmentInfo } from "../domain/types";

type Fetch = typeof fetch;

export class LookPhotoFinder {
  private readonly cache = new Map<string, Promise<LookPhotosResult | null>>();
  /** 一度つながらなかったら、開いている間はもう聞かない */
  private unavailable = false;

  constructor(
    private readonly baseUrl: string = "",
    private readonly fetchImpl: Fetch = (...args) => fetch(...args),
  ) {}

  find(items: Pick<GarmentInfo, "category" | "color" | "subType">[], fit?: Fit): Promise<LookPhotosResult | null> {
    if (this.unavailable) return Promise.resolve(null);
    const body: LookPhotosRequest = {
      items: items.slice(0, 6).map(({ category, color, subType }) => ({ category, color, subType: subType.slice(0, 40) })),
      fit,
    };
    const key = JSON.stringify(body);
    let p = this.cache.get(key);
    if (!p) {
      p = this.request(body);
      this.cache.set(key, p);
      // 見つからなかったときは次に開いたらもう一度聞く
      void p.then((r) => r || this.cache.delete(key));
    }
    return p;
  }

  private async request(body: LookPhotosRequest): Promise<LookPhotosResult | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/looks/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // 404（サーバーなし）・503（キーなし）などは、写真なしで続ける
      if (!res.ok) {
        if (res.status !== 429 && res.status !== 502) this.unavailable = true;
        return null;
      }
      return lookPhotosResultSchema.parse(await res.json());
    } catch {
      this.unavailable = true;
      return null;
    }
  }
}

export const lookPhotoFinder = new LookPhotoFinder(import.meta.env.VITE_AI_API_BASE ?? "");
