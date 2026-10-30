// 似た着こなしの写真を、写真サイト（Pexels）の公式APIで探す。
// APIキーはサーバーにだけ置く（PEXELS_API_KEY）。写真はPexelsのURLのまま表示し、アプリには保存しない。
// 利用規約：https://www.pexels.com/api/documentation/ （出典のPexelsと撮影者を表示する）
import { lookQuery } from "../src/domain/look";
import type { LookPhoto, LookPhotosRequest, LookPhotosResult } from "../src/ai/schemas";

export class PhotosNotConfiguredError extends Error {}
export class PhotosUpstreamError extends Error {}

interface PexelsPhoto {
  id: number;
  url: string;
  alt?: string;
  photographer: string;
  photographer_url: string;
  src: { medium: string };
}

const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; photos: LookPhoto[] }>();

type Fetch = typeof fetch;

export async function searchLookPhotos(
  input: LookPhotosRequest,
  apiKey = process.env.PEXELS_API_KEY,
  fetchImpl: Fetch = fetch,
): Promise<LookPhotosResult> {
  if (!apiKey) throw new PhotosNotConfiguredError("写真検索のAPIキー（PEXELS_API_KEY）がありません");
  const query = lookQuery(input.items, { fit: input.fit });
  const source = { name: "Pexels", url: "https://www.pexels.com" };

  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < CACHE_MS) return { query, photos: hit.photos, source };

  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", "6");
  const res = await fetchImpl(url, { headers: { authorization: apiKey } });
  if (!res.ok) throw new PhotosUpstreamError(`Pexels ${res.status}`);
  const body = (await res.json()) as { photos?: PexelsPhoto[] };
  const photos: LookPhoto[] = (body.photos ?? []).map((p) => ({
    id: String(p.id),
    image: p.src.medium,
    alt: p.alt || query,
    pageUrl: p.url,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
  }));

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(query, { at: Date.now(), photos });
  return { query, photos, source };
}
