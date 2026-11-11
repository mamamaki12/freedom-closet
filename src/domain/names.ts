// 服の名前を2行に分けるときの区切り。「デニムジャケット」を「デニム／ジャケット」のように、
// 言葉の切れ目で折り返せるようにする（「デニムジャケ／ット」のような割れ方を避ける）。

/** 名前の後ろに付くことが多い言葉。長いものから順に見る */
const TAILS = [
  "カーディガン",
  "ジャケット",
  "スニーカー",
  "ワンピース",
  "スウェット",
  "ブルゾン",
  "スカート",
  "サンダル",
  "パーカー",
  "パンツ",
  "シャツ",
  "コート",
  "ブーツ",
  "ニット",
  "ダウン",
];

/** 折り返してよい切れ目で分けた名前。分けられなければ1つのまま */
export function nameParts(name: string): string[] {
  for (const tail of TAILS) {
    if (name.length > tail.length && name.endsWith(tail)) return [name.slice(0, -tail.length), tail];
  }
  return [name];
}
