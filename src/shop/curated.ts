// 第2段階用：定番品だけを手で選んだ小さなリスト。
// 買い足し提案の種類・色が一致するものがあれば、検索リンクに加えて商品ページへのリンクを出す。
//
// 追加するときのルール
// - 公式サイトで実際に開いて確かめた商品だけを入れる（URLを推測で書かない）
// - 画像・価格は入れない（変わるため。見るのは公式サイトで）
// - 廃番になったら消す。checkedAt を目安に見直す
import type { Category, ColorName } from "../domain/types";

export interface CuratedItem {
  store: "UNIQLO" | "GU";
  name: string;
  category: Category;
  /** 選べる色のうち、提案に使う色 */
  colors: ColorName[];
  /** 「ワイドパンツ」など。提案の subType と部分一致で照合する */
  subType: string;
  url: string;
  /** 公式サイトで確認した日（YYYY-MM-DD） */
  checkedAt: string;
}

export const CURATED_ITEMS: CuratedItem[] = [
  // まだ空。公式サイトで確認したものから足していく。
];

export function findCurated(
  s: { category: Category; color: ColorName; subType: string },
  items: CuratedItem[] = CURATED_ITEMS,
): CuratedItem[] {
  return items.filter(
    (i) =>
      i.category === s.category &&
      i.colors.includes(s.color) &&
      (i.subType.includes(s.subType) || s.subType.includes(i.subType)),
  );
}
