// コーデを「着たときの形」にする。イラストの描き分けと、似た着こなし写真の検索語に使う。
import type { Category, ColorName, GarmentInfo } from "./types";
import type { Profile } from "./profile";

export type Sleeve = "none" | "short" | "long";

/** イラストで描く形。服の種類の名前（subType）から決める */
export type LookShape =
  | { kind: "top"; sleeve: Sleeve; hem: "short" | "normal" | "long" }
  | { kind: "outer"; length: "short" | "middle" | "long"; puffy: boolean }
  | { kind: "pants"; width: "slim" | "regular" | "wide"; length: "short" | "full" }
  | { kind: "skirt"; length: "mini" | "knee" | "long" }
  | { kind: "dress"; sleeve: Sleeve; length: "knee" | "long" }
  | { kind: "shoes"; style: "sneakers" | "leather" | "boots" | "sandals" };

const has = (s: string, re: RegExp) => re.test(s);

export function lookShape(g: Pick<GarmentInfo, "category" | "subType">): LookShape {
  const s = g.subType;
  switch (g.category) {
    case "tops":
      return {
        kind: "top",
        sleeve: has(s, /ノースリーブ|タンク|キャミ/) ? "none" : has(s, /Tシャツ|ポロ|半袖/) && !has(s, /長袖|ロンT/) ? "short" : "long",
        hem: has(s, /クロップ|ショート丈/) ? "short" : has(s, /チュニック|ロング/) ? "long" : "normal",
      };
    case "outer":
      return {
        kind: "outer",
        length: has(s, /ロング|トレンチ|チェスター/) ? "long" : has(s, /コート/) ? "middle" : "short",
        puffy: has(s, /ダウン|中綿|ダウンジャケット/),
      };
    case "bottoms":
      if (has(s, /スカート/)) return { kind: "skirt", length: has(s, /ミニ/) ? "mini" : has(s, /ロング|マキシ|フレア/) ? "long" : "knee" };
      return {
        kind: "pants",
        width: has(s, /ワイド|ガウチョ|バギー|カーゴ/) ? "wide" : has(s, /スキニー|スリム|レギンス|スラックス/) ? "slim" : "regular",
        length: has(s, /ショート|ハーフ|短パン/) ? "short" : "full",
      };
    case "onepiece":
      return {
        kind: "dress",
        sleeve: has(s, /ノースリーブ|キャミ/) ? "none" : has(s, /半袖|Tシャツ/) ? "short" : "long",
        length: has(s, /ロング|マキシ/) ? "long" : "knee",
      };
    case "shoes":
      return {
        kind: "shoes",
        style: has(s, /ブーツ/)
          ? "boots"
          : has(s, /サンダル|ミュール/)
            ? "sandals"
            : has(s, /革|ローファー|パンプス|ヒール/)
              ? "leather"
              : "sneakers",
      };
  }
}

/** イラストの枠いっぱいになる身長。これより低い人は小さく描く */
export const FIGURE_BASE_HEIGHT = 190;

export interface BodyShape {
  /** 背の高さ。枠いっぱいを1とした倍率 */
  scale: number;
  /** 肩・腕・脚の太さの倍率 */
  width: number;
  /** おなかまわりの倍率。体重が重めだと肩より大きく増える */
  belly: number;
  /** メンズ・レディース（肩と腰の形） */
  curvy: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 身長・体重から、イラストの体の大きさと太さを決める。分からないところは標準 */
export function bodyShape(profile: Profile): BodyShape {
  const { heightCm, weightKg } = profile;
  const curvy = profile.fit === "womens";
  // 体重だけ分かるときは、平均くらいの身長として太さを出す
  const h = heightCm ?? (curvy ? 158 : profile.fit === "mens" ? 171 : 165);
  const bmi = weightKg ? weightKg / (h / 100) ** 2 : 21;
  return {
    scale: heightCm ? clamp(heightCm / FIGURE_BASE_HEIGHT, 0.75, 1) : 0.9,
    width: clamp(1 + (bmi - 21) * 0.04, 0.82, 1.35),
    belly: clamp(1 + (bmi - 21) * 0.075, 0.8, 1.7),
    curvy,
  };
}

// 検索語は英語にする（写真サイトの検索は英語のほうが見つかりやすい）
const COLOR_EN: Record<ColorName, string> = {
  black: "black",
  white: "white",
  gray: "gray",
  navy: "navy",
  blue: "blue",
  lightblue: "light blue",
  beige: "beige",
  brown: "brown",
  khaki: "khaki",
  green: "green",
  red: "red",
  pink: "pink",
  yellow: "yellow",
  orange: "orange",
  purple: "purple",
};

const SUBTYPE_EN: Record<Category, [RegExp, string][]> = {
  tops: [
    [/Tシャツ|ロンT/, "t-shirt"],
    [/ブラウス/, "blouse"],
    [/シャツ/, "shirt"],
    [/ニット|セーター/, "sweater"],
    [/スウェット|トレーナー/, "sweatshirt"],
    [/パーカー/, "hoodie"],
  ],
  outer: [
    [/デニム|Gジャン/, "denim jacket"],
    [/カーディガン/, "cardigan"],
    [/ダウン/, "puffer jacket"],
    [/トレンチ/, "trench coat"],
    [/コート/, "coat"],
    [/パーカー/, "hoodie"],
  ],
  bottoms: [
    [/スカート/, "skirt"],
    [/ショート|短パン|ハーフ/, "shorts"],
    [/ワイド/, "wide leg pants"],
    [/スラックス/, "slacks"],
    [/チノ/, "chinos"],
    [/デニム|ジーンズ/, "jeans"],
  ],
  onepiece: [],
  shoes: [],
};

const CATEGORY_EN: Record<Category, string> = { tops: "top", outer: "jacket", bottoms: "pants", onepiece: "dress", shoes: "shoes" };

/** 「navy shirt beige wide leg pants outfit」のような検索語。靴は省き、目立つ服から最大3つ */
export function lookQuery(items: Pick<GarmentInfo, "category" | "color" | "subType">[], profile: Profile = {}): string {
  const order = ["outer", "onepiece", "tops", "bottoms"];
  const words = items
    .filter((g) => g.category !== "shoes")
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
    .slice(0, 3)
    .map((g) => `${COLOR_EN[g.color]} ${SUBTYPE_EN[g.category].find(([re]) => re.test(g.subType))?.[1] ?? CATEGORY_EN[g.category]}`);
  const who = profile.fit === "mens" ? "men" : profile.fit === "womens" ? "women" : "";
  return [...words, who, "outfit"].filter(Boolean).join(" ");
}
