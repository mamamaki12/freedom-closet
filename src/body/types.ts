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
  /** 採寸の目安（胸囲など）を出すために、写真で直接測った値。古い保存データにはない */
  marks?: ScanMarks;
  /** ゆったりした服で撮った（胴や脚の太さは身長・体重からの見積もりに寄せ、cm の目安は出さない） */
  loose?: boolean;
}

/** 胴の決まった高さで測った幅と、横の写真があれば厚み（身長を1とした割合） */
export interface MarkSlice {
  /** 頭のてっぺん(0)から床(1)までの位置 */
  y: number;
  width: number;
  depth?: number;
}

/**
 * 写真で直接測った、採寸の目安のもとになる値（身長を1とした割合）。
 * 高さは骨格の点で決める：胸はわきの下、ウエストは肩と腰の点のあいだの65%、ヒップは95%の高さ。
 */
export interface ScanMarks {
  chest: MarkSlice;
  waist: MarkSlice;
  hip: MarkSlice;
  /** 太もも（腰とひざの点の中間）の片脚の幅 */
  thigh: number;
  /** ふくらはぎ（ひざから足首までの35%）の片脚の幅 */
  calf: number;
  /** 肩の点の高さでの体の外側どうしの幅 */
  shoulder: number;
  /** 上腕（肩からひじの7割）と手首の太さ。腕が胴にくっついていて測れなかったときはない */
  upperArm?: number;
  wrist?: number;
}
