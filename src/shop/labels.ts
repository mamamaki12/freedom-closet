// 買い足しの画面に出す短い言い方。

/** 「コーデ +14通り」の数の部分。服が多いと「591通り」のような実感のない数になるので、大きい数はまるめる */
export function outfitGainLabel(n: number): string {
  return n >= 100 ? "+100通り以上" : `+${n}通り`;
}
