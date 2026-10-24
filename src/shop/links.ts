// 買い足し提案から公式サイトの検索結果へつなぐリンク。
// ユニクロ・GUには公開の商品APIがないため、画像・価格はアプリで持たず、検索ページを開くだけにする。
// （非公開の内部APIやスクレイピングは使わない）

export interface ShopLink {
  store: "UNIQLO" | "GU";
  label: string;
  url: string;
}

// 検索URLの形。サイト側の変更で開けなくなったらここだけ直す。
// GU側は 2026-10-24 時点で実際に開いての確認ができていない（要実機確認）。
const SEARCH_URLS: Record<ShopLink["store"], { label: string; template: string }> = {
  UNIQLO: { label: "ユニクロで探す", template: "https://www.uniqlo.com/jp/ja/search?q={q}" },
  GU: { label: "GUで探す", template: "https://www.gu-global.com/jp/ja/search?q={q}" },
};

export function searchLinks(query: string): ShopLink[] {
  const q = encodeURIComponent(query.trim());
  return (Object.keys(SEARCH_URLS) as ShopLink["store"][]).map((store) => ({
    store,
    label: SEARCH_URLS[store].label,
    url: SEARCH_URLS[store].template.replace("{q}", q),
  }));
}
