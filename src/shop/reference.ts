// 参考になる着用写真を探すリンク。
// 他サイトの写真をアプリに取り込む（転載する）のではなく、検索結果を開くだけにする。
import { colorLabel } from "../domain/colors";
import type { GarmentInfo } from "../domain/types";

export interface ReferenceLink {
  label: string;
  url: string;
}

// 検索ページのURLの形。開けなくなったらここだけ直す。
const SITES: { label: string; template: string }[] = [
  { label: "Pinterestで見る", template: "https://www.pinterest.jp/search/pins/?q={q}" },
  { label: "画像検索で見る", template: "https://www.google.com/search?tbm=isch&q={q}" },
];

/** コーデの服から「ネイビー シャツ ベージュ ワイドパンツ コーデ」のような検索語を作る（靴は省く） */
export function referenceQuery(items: Pick<GarmentInfo, "category" | "color" | "subType">[]): string {
  const words = items
    .filter((g) => g.category !== "shoes")
    .map((g) => `${colorLabel(g.color)} ${g.subType}`.trim());
  return [...words, "コーデ"].join(" ");
}

export function referenceLinks(items: Pick<GarmentInfo, "category" | "color" | "subType">[]): ReferenceLink[] {
  const q = encodeURIComponent(referenceQuery(items));
  return SITES.map((s) => ({ label: s.label, url: s.template.replace("{q}", q) }));
}
