// 体の写真から読み取った体型。写真そのものは持たず、身長を1とした割合だけを持つ。

/** 胴の輪切り1枚。y は頭のてっぺん(0)から床(1)までの位置 */
export interface TorsoSlice {
  y: number;
  /** 正面から見た幅 */
  width: number;
  /** 横から見た厚み（横の写真がないときは幅から見積もる） */
  depth: number;
}

/** 脚の輪切り。t は股(0)から足首(1)まで */
export interface LegSlice {
  t: number;
  width: number;
  depth: number;
}

export interface BodyScan {
  version: 1;
  /** 読み取った日時 */
  at: number;
  /** どの向きの写真から読んだか */
  views: ("front" | "side")[];
  /** 頭の幅・高さ（あご まで） */
  head: { width: number; height: number; depth: number };
  neck: { y: number; width: number };
  /** 肩の外側どうしの幅と、肩の高さ */
  shoulder: { y: number; width: number };
  /** 肩から股までの胴の輪切り（上から順） */
  torso: TorsoSlice[];
  /** 股と足首の高さ */
  crotchY: number;
  ankleY: number;
  /** 左右の脚の中心どうしの距離 */
  legGap: number;
  legs: LegSlice[];
  /** 腕の長さ（肩から手首）と太さ（上腕・手首） */
  arm: { length: number; upper: number; wrist: number };
}
