// 服の名前を2行に分けるときの区切り。「デニムジャケット」を「デニム／ジャケット」のように、
// 言葉の切れ目で折り返せるようにする（「デニムジャケ／ット」のような割れ方を避ける）。
import { isPatterned, PATTERN_SHORT, type GarmentInfo } from "./types";

/** 名前の後ろに付くことが多い言葉。長いものから順に見る（「ボーダーTシャツ」を「ボーダーT／シャツ」にしないため） */
const TAILS = [
  "カーディガン",
  "ジャケット",
  "スニーカー",
  "ワンピース",
  "スウェット",
  "ポロシャツ",
  "カットソー",
  "ローファー",
  "スラックス",
  "トレーナー",
  "ブルゾン",
  "スカート",
  "サンダル",
  "パーカー",
  "ブラウス",
  "シューズ",
  "パンプス",
  "セーター",
  "Tシャツ",
  "パーカ",
  "ネック",
  "パンツ",
  "シャツ",
  "コート",
  "ブーツ",
  "ニット",
  "ダウン",
  "デニム",
  "トップ",
  "ベスト",
].sort((a, b) => b.length - a.length);

/** 折り返してよい切れ目で分けた名前。分けられなければ1つのまま */
export function nameParts(name: string): string[] {
  // それ自体がひとつの言葉（Tシャツ・ポロシャツ など）は分けない
  if (TAILS.includes(name)) return [name];
  for (const tail of TAILS) {
    if (name.length > tail.length && name.endsWith(tail)) return [name.slice(0, -tail.length), tail];
  }
  return [name];
}

/** 一覧に出す服の名前を、切れ目で分けたもの。柄の付いた服は「ボーダー／カーディガン」のように柄と種類の間で分ける */
export function garmentNameParts(g: Pick<GarmentInfo, "subType" | "pattern">): string[] {
  return isPatterned(g) ? [PATTERN_SHORT[g.pattern!], g.subType] : nameParts(g.subType);
}

/** 1行（1つの切れ目の中）に入れるには長い名前か。カーディガン など6文字以上 */
export const isLongName = (parts: string[]): boolean => parts.some((p) => p.length >= 6);
