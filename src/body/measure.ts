// 体の写真の「骨格の点（ランドマーク）」と「人の形の切り抜き（マスク）」から体型を測る。
// 写真には触らず、数字だけを返す。端末の外には何も送らない。
import { bodyShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import type { BodyScan, LegSlice, ScanMarks, TorsoSlice } from "./types";

/** 0〜1 の位置（画像の幅・高さに対する割合） */
export interface Landmark {
  x: number;
  y: number;
  visibility?: number;
}

/** 人の部分が 1、背景が 0 に近い値の2次元配列 */
export interface Mask {
  width: number;
  height: number;
  data: ArrayLike<number>;
  /** 読み取り用に写真のまわりに足した余白（上下左右それぞれ、写真の高さ・幅に対する割合） */
  padding?: number;
  /** この値より大きいところを人とみなす（ふつうは 0.5） */
  threshold?: number;
}

export class ScanError extends Error {}

// MediaPipe Pose の点の番号
const P = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lToe: 31,
  rToe: 32,
};

const TORSO_LEVELS = 10;
const LEG_LEVELS = 8;

/**
 * 横の写真がないときの、胴の厚み ÷ 幅（上の段から10段）。BodyM（1803人）で横の写真から測った比の中央値。
 * 胸のあたりがいちばん厚く、下（股の近く）にいくほど薄い
 */
export const TORSO_DEPTH_RATIO = [0.699, 0.784, 0.804, 0.816, 0.804, 0.748, 0.745, 0.745, 0.724, 0.693];

/**
 * 股下（股から床まで、身長を1とした割合）の見積もり。写真の股の高さは撮り方（カメラの高さや向き）で
 * -2〜+4cm ずれ、身長の約45.7%とするほうがよく当たったので、写真の値は1割弱だけ効かせる（BodyM の train で合わせた式）
 */
export const inseamRatio = (photo: number) => 0.4224 + 0.076 * photo;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

class Img {
  constructor(
    readonly mask: Mask,
    readonly lm: Landmark[],
  ) {}
  get w() {
    return this.mask.width;
  }
  get h() {
    return this.mask.height;
  }
  /** 余白を除いた、もとの写真の高さ */
  get photoH() {
    return this.mask.height / (1 + 2 * (this.mask.padding ?? 0));
  }
  /** 点の位置（ピクセル） */
  p(i: number) {
    return { x: this.lm[i].x * this.w, y: this.lm[i].y * this.h, v: this.lm[i].visibility ?? 1 };
  }
  on(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.mask.data[y * this.w + x] > (this.mask.threshold ?? 0.5);
  }
  /** y の行で、x を含む（なければ近くの）人の部分の左右の端 */
  run(y: number, x: number, tol = this.w * 0.02): [number, number] | undefined {
    y = Math.round(clamp(y, 0, this.h - 1));
    let start = -1;
    for (let d = 0; d <= tol; d++) {
      if (this.on(x - d, y)) {
        start = Math.round(x - d);
        break;
      }
      if (this.on(x + d, y)) {
        start = Math.round(x + d);
        break;
      }
    }
    if (start < 0) return undefined;
    let a = start;
    let b = start;
    while (this.on(a - 1, y)) a--;
    while (this.on(b + 1, y)) b++;
    return [a, b + 1];
  }
  width(y: number, x: number) {
    const r = this.run(y, x);
    return r ? r[1] - r[0] : 0;
  }
  /** y の上下 band 行の幅の中央値（1行だけだと、切り抜きのふちのぎざぎざで揺れるため） */
  widthBand(y: number, x: number | ((y: number) => number), band: number) {
    const ws: number[] = [];
    for (let yy = Math.round(y) - band; yy <= Math.round(y) + band; yy++) {
      const w = this.width(yy, typeof x === "number" ? x : x(yy));
      if (w > 0) ws.push(w);
    }
    return median(ws);
  }
  /** (x, y) を通り、向き (dx, dy) に直角な方向の人の部分の長さ（腕の太さなど） */
  across(x: number, y: number, dx: number, dy: number) {
    const len = Math.hypot(dx, dy) || 1;
    const [nx, ny] = [-dy / len, dx / len];
    if (!this.on(x, y)) return 0;
    let a = 0;
    let b = 0;
    while (a < this.w && this.on(x + nx * (a + 1), y + ny * (a + 1))) a++;
    while (b < this.w && this.on(x - nx * (b + 1), y - ny * (b + 1))) b++;
    return a + b + 1;
  }
  /** 頭のてっぺん（鼻の上をたどって、人の部分が始まる行） */
  top(x: number, fromY: number) {
    for (let y = 0; y < fromY; y++) if (this.run(y, x, this.w * 0.04)) return y;
    return 0;
  }
  /** 足の裏（かかと・つま先の点と、足首の下の人の部分の下端のうち低いほう） */
  bottom() {
    let y = Math.max(...[P.lHeel, P.rHeel, P.lToe, P.rToe].map((i) => this.p(i).y));
    for (const i of [P.lAnkle, P.rAnkle]) {
      const a = this.p(i);
      let yy = Math.round(a.y);
      while (yy < this.h - 1 && this.run(yy + 1, a.x, this.w * 0.03)) yy++;
      y = Math.max(y, Math.min(yy, a.y + (a.y - this.p(i === P.lAnkle ? P.lKnee : P.rKnee).y) * 0.35));
    }
    return y;
  }
}

function median(v: number[]) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** 正面の写真から測ったもの（身長を1とした割合） */
export type FrontMeasure = Omit<BodyScan, "version" | "at" | "views" | "marks"> & {
  /** 腕が体についていて、胴の幅が正しく測れなかった */
  armsTouching: boolean;
  marks: ScanMarks;
  /**
   * 骨格の点の高さ（横の写真で同じ高さを探すのに使う）と、胸（わきの下）の高さ。
   * chestA は肩の点(0)〜腰の点(1)の割合
   */
  ref: { shoulderY: number; hipY: number; kneeY: number; ankleY: number; chestA: number };
};

const REQUIRED = [P.nose, P.lShoulder, P.rShoulder, P.lHip, P.rHip, P.lKnee, P.rKnee, P.lAnkle, P.rAnkle];

function checkVisible(lm: Landmark[], idx: number[]) {
  if (lm.length < 33 || idx.some((i) => (lm[i].visibility ?? 1) < 0.5)) {
    throw new ScanError("頭から足先までが写った写真にしてください（体の一部が隠れているか、写っていないようです）");
  }
}

/**
 * まっすぐ立って腕を下ろしているか。ジャンプや大きなポーズ、座っている写真は体型を測れない
 * （ネット上のファッション写真で試すと、ポーズのまま変な体型になった）。
 */
function checkStanding(im: Img) {
  const sh = mid(im.p(P.lShoulder), im.p(P.rShoulder));
  const hip = mid(im.p(P.lHip), im.p(P.rHip));
  const la = im.p(P.lAnkle);
  const ra = im.p(P.rAnkle);
  const L = Math.max(1, mid(la, ra).y - sh.y); // 肩から足首まで
  const tilt = Math.abs(Math.atan2(hip.x - sh.x, hip.y - sh.y));
  const legsDown = [
    [P.lHip, P.lKnee, P.lAnkle],
    [P.rHip, P.rKnee, P.rAnkle],
  ].every(([h, k, a]) => im.p(k).y > im.p(h).y + L * 0.1 && im.p(a).y > im.p(k).y + L * 0.1);
  const armsDown = [P.lWrist, P.rWrist].every((w) => im.p(w).y > sh.y - L * 0.05);
  const feetClose = Math.abs(la.x - ra.x) < L * 0.5;
  if (tilt > (20 * Math.PI) / 180 || !legsDown || !armsDown || !feetClose) {
    throw new ScanError("まっすぐ立って、腕を下ろした写真にしてください（ジャンプや大きなポーズ、座った姿勢は読み取れません）");
  }
}

/**
 * 採寸の目安を測る高さ。肩の点(0)から腰の点(1)までの割合。
 * 実在の人の体型データ BodyM（2018人）で、巻き尺の実測値といちばんよく合う高さを選んだ。
 */
export const MARK_LEVELS = { waist: 0.65, hip: 0.95 };
/** 太もも：腰の点(0)からひざ(1)まで、ふくらはぎ：ひざ(0)から足首(1)までの割合 */
export const LEG_MARK_LEVELS = { thigh: 0.5, calf: 0.35 };

export function measureFront(mask: Mask, lm: Landmark[]): FrontMeasure {
  checkVisible(lm, REQUIRED);
  const im = new Img(mask, lm);
  checkStanding(im);
  const nose = im.p(P.nose);
  const ls = im.p(P.lShoulder);
  const rs = im.p(P.rShoulder);
  const lh = im.p(P.lHip);
  const rh = im.p(P.rHip);
  const lk = im.p(P.lKnee);
  const rk = im.p(P.rKnee);
  const la = im.p(P.lAnkle);
  const ra = im.p(P.rAnkle);
  const sh = mid(ls, rs);
  const hip = mid(lh, rh);

  const top = im.top(nose.x, nose.y);
  const bottom = im.bottom();
  const H = bottom - top;
  if (H < im.photoH * 0.3) throw new ScanError("体が小さく写っています。頭から足先までが画面いっぱいになるように撮ってください");
  const ny = (y: number) => (y - top) / H;
  const nw = (w: number) => w / H;
  const cx = (y: number) => lerp(sh.x, hip.x, clamp((y - sh.y) / (hip.y - sh.y), 0, 1.3));
  // 幅は上下に少し幅をもたせた帯の中央値で測る（身長の約0.4%）
  const band = Math.max(1, Math.round(H * 0.004));
  /** 肩の点(0)〜腰の点(1)の割合の高さ */
  const at = (a: number) => sh.y + a * (hip.y - sh.y);

  // 頭：あごは鼻と肩のあいだの半分くらい
  const chin = lerp(nose.y, sh.y, 0.5);
  const headH = chin - top;
  const headW = im.width(nose.y, nose.x) || headH * 0.75;

  // 肩：肩の点の高さで、体の外側どうしの幅を切り抜きから測る（BodyM で、骨格の点の間隔より実測とよく合った）。
  // 腕を横に上げていて腕まで測ってしまったときなどは、点の間隔から見積もる（切り抜きの幅は点の間隔の約1.34倍）
  const jointW = dist(ls, rs);
  const silW = im.widthBand(sh.y, sh.x, band);
  const shoulderW = silW > jointW * 1.1 && silW < jointW * 1.6 ? silW : jointW * 1.34;

  // 股：腰から下へ、脚のあいだにすき間が出るところ。ただし太ももの内側がくっついていると
  // すき間は本当の股より下に出るので、腰とひざの点から見積もった高さより下にはしない
  // （体型データ BodyM の実測で、股は腰の点からひざまでの約1割下）
  const kneeY = mid(lk, rk).y;
  let crotch = lerp(hip.y, kneeY, 0.12);
  for (let y = Math.round(hip.y), gap = 0; y < kneeY; y++) {
    gap = im.on(cx(y), y) ? 0 : gap + 1;
    if (gap >= 3) {
      crotch = Math.min(crotch, y - 2);
      break;
    }
  }

  let armsTouching = false;
  const torso: TorsoSlice[] = [];
  const torsoTop = sh.y + (crotch - sh.y) * 0.12;
  // 腕の中心線（肩→ひじ→手首）。その高さで腕がどこにあるか
  const armX = (s: number, e: number, w: number) => (y: number) => {
    const [ps, pe, pw] = [im.p(s), im.p(e), im.p(w)];
    if (y <= ps.y || y > pw.y) return undefined;
    return y <= pe.y ? lerp(ps.x, pe.x, (y - ps.y) / (pe.y - ps.y)) : lerp(pe.x, pw.x, (y - pe.y) / (pw.y - pe.y));
  };
  const arms = [armX(P.lShoulder, P.lElbow, P.lWrist), armX(P.rShoulder, P.rElbow, P.rWrist)];
  // わきの下：肩から下へ、胴と腕のあいだにすき間が出る高さと、そこでの胴の端。
  // それより上は肩なので、腕が重なって見えるのは当たり前
  const armpits = arms.map((arm) => {
    for (let y = Math.round(sh.y) + 1; y < hip.y; y++) {
      const x = arm(y);
      const r = im.run(y, cx(y));
      if (x !== undefined && r && (x < r[0] || x > r[1])) return { y, edge: x < r[0] ? r[0] : r[1] };
    }
    return undefined;
  });
  const aboveArmpit: boolean[] = [];
  for (let i = 0; i < TORSO_LEVELS; i++) {
    // いちばん下は股のすぐ上（股の高さだと片脚しか測れない）
    const y = lerp(torsoTop, crotch - H * 0.012, i / (TORSO_LEVELS - 1));
    const r = im.run(y, cx(y));
    let w = r ? im.widthBand(y, cx, band) : 0;
    let above = false;
    arms.forEach((arm, side) => {
      const x = arm(y);
      if (!r || x === undefined || x < r[0] || x > r[1]) return;
      const pit = armpits[side];
      if (pit !== undefined && y < pit.y) {
        above = true;
        return;
      }
      // 腕が胴についていると、腕まで含めて広く測れてしまうので、腕の太さ（身長の約5%）を引く
      armsTouching = true;
      w -= H * 0.05;
    });
    if (w <= 0) w = shoulderW * 0.8;
    aboveArmpit.push(above);
    torso.push({ y: ny(y), width: nw(w), depth: 0 });
  }
  // 胸：わきの下の、左右の胴の端どうしの幅。見つからなければ肩と腰の点のあいだの6割の高さの幅
  const [lp, rp] = armpits;
  const chestA = lp && rp ? ((lp.y + rp.y) / 2 - sh.y) / (hip.y - sh.y) : 0.6;
  const chestW = lp && rp && Math.abs(rp.edge - lp.edge) > 0 ? Math.abs(rp.edge - lp.edge) : im.widthBand(at(0.6), cx, band);
  // わきの下より上は肩の幅まで測ってしまうので、胸の幅にそろえる
  const chestSlice = torso.find((_, i) => !aboveArmpit[i]);
  torso.forEach((t, i) => aboveArmpit[i] && (t.width = lp && rp ? nw(chestW) : (chestSlice?.width ?? t.width)));
  // 急に細くなるところは、股や腕のすき間を拾ったものなので、ひとつ上の幅を使う
  for (let i = 1; i < torso.length; i++) if (torso[i].width < torso[i - 1].width * 0.75) torso[i].width = torso[i - 1].width;

  // 脚：左右それぞれの中心線に沿って測る。くっついていたら真ん中で分ける
  const center = (h: typeof lh, k: typeof lk, a: typeof la) => (y: number) =>
    y < k.y ? lerp(h.x, k.x, (y - h.y) / (k.y - h.y)) : lerp(k.x, a.x, (y - k.y) / (a.y - k.y));
  const lc = center(lh, lk, la);
  const rc = center(rh, rk, ra);
  const ankleY = mid(la, ra).y;
  /** 左右の脚の太さの平均（1行） */
  const legWidth = (y: number) => {
    const widths = [lc, rc].map((c, side) => {
      const r = im.run(y, c(y));
      if (!r) return 0;
      const m = (lc(y) + rc(y)) / 2;
      const other = side === 0 ? rc(y) : lc(y);
      if (r[0] <= other && other <= r[1]) {
        const onLeft = (side === 0 ? lc(y) : rc(y)) < m;
        return onLeft ? m - r[0] : r[1] - m;
      }
      return r[1] - r[0];
    });
    const ok = widths.filter((w) => w > 0);
    return ok.length ? ok.reduce((a, b) => a + b) / ok.length : 0;
  };
  const legBand = (y: number) => median([...Array(band * 2 + 1)].map((_, j) => legWidth(Math.round(y) - band + j)).filter((w) => w > 0));
  const legs: LegSlice[] = [];
  for (let i = 0; i < LEG_LEVELS; i++) {
    const t = i / (LEG_LEVELS - 1);
    const y = lerp(crotch + (ankleY - crotch) * 0.03, ankleY, t);
    legs.push({ t, width: nw(legBand(y)), depth: 0 });
  }

  // 腕
  const armLen = (dist(ls, im.p(P.lElbow)) + dist(im.p(P.lElbow), im.p(P.lWrist)) + dist(rs, im.p(P.rElbow)) + dist(im.p(P.rElbow), im.p(P.rWrist))) / 2;
  // 腕の太さは、腕の向きに直角に測る（Tの字でも下ろしていても測れる）。
  // 上腕は肩からひじの7割のところで測る（4割だと腕を下ろした人の8割以上で胴まで測ってしまった。BodyM）
  const armWidth = (from: number, to: number, at: number, fallback: number): number | undefined => {
    const ws = [
      [P.lShoulder, P.lElbow, P.lWrist],
      [P.rShoulder, P.rElbow, P.rWrist],
    ].map((side) => {
      const p = im.p(side[from]);
      const q = im.p(side[to]);
      const width = im.across(lerp(p.x, q.x, at), lerp(p.y, q.y, at), q.x - p.x, q.y - p.y);
      // 胴にくっついていると胴まで含めて測れてしまうので捨てる
      return nw(width) < fallback * 1.8 ? nw(width) : 0;
    });
    const ok = ws.filter((w) => w > fallback * 0.3);
    return ok.length ? Math.min(...ok) : undefined;
  };
  const upperArm = armWidth(0, 1, 0.7, 0.05);
  const wristW = armWidth(1, 2, 0.85, 0.032);

  return {
    head: { width: nw(headW), height: nw(headH), depth: nw(headW) * 1.15 },
    neck: { y: ny(lerp(chin, sh.y, 0.5)), width: nw(im.width(lerp(chin, sh.y, 0.55), lerp(nose.x, sh.x, 0.5)) || headW * 0.6) },
    shoulder: { y: ny(sh.y), width: nw(shoulderW) },
    torso,
    crotchY: ny(crotch),
    ankleY: ny(ankleY),
    legGap: nw(Math.abs(lc(crotch) - rc(crotch))),
    legs,
    arm: { length: nw(armLen), upper: upperArm ?? 0.05, wrist: wristW ?? 0.032 },
    armsTouching,
    marks: {
      chest: { y: ny(at(chestA)), width: nw(chestW) },
      waist: { y: ny(at(MARK_LEVELS.waist)), width: nw(im.widthBand(at(MARK_LEVELS.waist), cx, band)) },
      hip: { y: ny(at(MARK_LEVELS.hip)), width: nw(im.widthBand(at(MARK_LEVELS.hip), cx, band)) },
      thigh: nw(legBand(lerp(hip.y, kneeY, LEG_MARK_LEVELS.thigh))),
      calf: nw(legBand(lerp(kneeY, ankleY, LEG_MARK_LEVELS.calf))),
      shoulder: nw(shoulderW),
      upperArm,
      wrist: wristW,
    },
    ref: { shoulderY: ny(sh.y), hipY: ny(hip.y), kneeY: ny(kneeY), ankleY: ny(ankleY), chestA },
  };
}

/** 横の写真から測った厚み（身長を1とした割合）。高さは正面で測った位置に、骨格の点で合わせる */
export interface SideMeasure {
  torso: number[];
  legs: number[];
  head: number;
  marks?: { chest: number; waist: number; hip: number };
}

/** 横の写真から、胴と脚の厚みを測る */
export function measureSide(mask: Mask, lm: Landmark[], front: FrontMeasure): SideMeasure {
  // 横向きだと片側の点は隠れるので、見えているほうを使う
  const pick = (a: number, b: number) => ((lm[a]?.visibility ?? 1) >= (lm[b]?.visibility ?? 1) ? a : b);
  const s = pick(P.lShoulder, P.rShoulder);
  const h = pick(P.lHip, P.rHip);
  const k = pick(P.lKnee, P.rKnee);
  const a = pick(P.lAnkle, P.rAnkle);
  checkVisible(lm, [P.nose, s, h, k, a]);
  const im = new Img(mask, lm);
  const nose = im.p(P.nose);
  const top = im.top(nose.x, nose.y);
  const H = im.bottom() - top;
  if (H < im.photoH * 0.3) throw new ScanError("体が小さく写っています。頭から足先までが画面いっぱいになるように撮ってください");
  const band = Math.max(1, Math.round(H * 0.004));
  const sp = im.p(s);
  const hp = im.p(h);
  const kp = im.p(k);
  const ap = im.p(a);
  const cx = (y: number) => lerp(sp.x, hp.x, clamp((y - sp.y) / (hp.y - sp.y), 0, 1.3));
  // 正面の高さ（身長を1とした割合）を、横の写真の行に移す。頭から足までの割合で移すと、
  // 髪の毛の盛り上がりや足の写り方で数%ずれるので、肩・腰・ひざ・足首の点を目印にして合わせる
  // （BodyM の実測で、ヒップの合い方がよくなった）
  const r = front.ref;
  const marks: [number, number][] = [
    [r.shoulderY, sp.y],
    [r.hipY, hp.y],
    [r.kneeY, kp.y],
    [r.ankleY, ap.y],
  ];
  const fy = (y: number) => {
    let i = 0;
    while (i < marks.length - 2 && y > marks[i + 1][0]) i++;
    const [[y0, s0], [y1, s1]] = [marks[i], marks[i + 1]];
    return s0 + ((y - y0) / (y1 - y0 || 1)) * (s1 - s0);
  };
  const depthAt = (y: number) => im.widthBand(fy(y), cx, band) / H;
  const torso = front.torso.map((sl) => depthAt(sl.y));
  const legX = (y: number) => (y < kp.y ? lerp(hp.x, kp.x, (y - hp.y) / (kp.y - hp.y)) : lerp(kp.x, ap.x, (y - kp.y) / (ap.y - kp.y)));
  const legs = front.legs.map((l) => {
    const y = fy(lerp(front.crotchY, front.ankleY, l.t));
    return im.widthBand(y, legX, band) / H;
  });
  const atA = (frac: number) => r.shoulderY + frac * (r.hipY - r.shoulderY);
  return {
    torso,
    legs,
    head: im.width(top + front.head.height * 0.55 * H, nose.x) / H,
    marks: {
      chest: depthAt(atA(r.chestA)),
      waist: depthAt(atA(MARK_LEVELS.waist)),
      hip: depthAt(atA(MARK_LEVELS.hip)),
    },
  };
}

/** 正面（と横）の測定から体型を作る。横がなければ厚みは幅から見積もる */
export function buildScan(front: FrontMeasure, side?: SideMeasure, at = Date.now()): BodyScan {
  // 股の高さは写真の値より平均に寄せる（inseamRatio）。胴の段と目安の高さは、肩から股までをその分だけ伸び縮みさせる
  // （横の写真は写真どおりの股の高さで測ってあるので、ここで直す）
  const crotchY = 1 - inseamRatio(1 - front.crotchY);
  const top = front.shoulder.y;
  const moveY = (y: number) => top + ((y - top) * (crotchY - top)) / (front.crotchY - top || 1);
  const torso = front.torso.map((sl, i) => {
    const guess = sl.width * TORSO_DEPTH_RATIO[i];
    const d = side?.torso[i];
    // 横の写真で腕が重なると厚く出るので、ありえない値は見積もりに戻す
    return { ...sl, y: moveY(sl.y), depth: d && d > sl.width * 0.45 && d < sl.width * 1.3 ? d : guess };
  });
  const legs = front.legs.map((l, i) => {
    const d = side?.legs[i];
    // 横からは両脚が重なって見えるので、1本分の太さとして扱う。
    // 左右の脚が前後にずれていると厚く出るので、幅の1.15倍まで（脚の厚みは幅とだいたい同じ。実測の太もも回りと比べて決めた）
    return { ...l, depth: d && d > l.width * 0.6 ? Math.min(d, l.width * 1.15) : l.width * 1.05 };
  });
  const headDepth = side?.head && side.head > front.head.width * 0.8 && side.head < front.head.width * 1.6 ? side.head : front.head.depth;
  // 横の厚みも、ありえない値（腕の重なりなど）は使わない
  const depth = (w: number, d?: number) => (d && d > w * 0.45 && d < w * 1.3 ? d : undefined);
  const m = front.marks;
  return sane({
    version: 1,
    at,
    views: side ? ["front", "side"] : ["front"],
    head: { ...front.head, depth: headDepth },
    neck: front.neck,
    shoulder: front.shoulder,
    torso,
    crotchY,
    ankleY: front.ankleY,
    legGap: front.legGap,
    legs,
    arm: front.arm,
    marks: {
      ...m,
      chest: { ...m.chest, y: moveY(m.chest.y), depth: depth(m.chest.width, side?.marks?.chest) },
      waist: { ...m.waist, y: moveY(m.waist.y), depth: depth(m.waist.width, side?.marks?.waist) },
      hip: { ...m.hip, y: moveY(m.hip.y), depth: depth(m.hip.width, side?.marks?.hip) },
    },
  });
}

/**
 * 人の体としてありえない値を、ありえる範囲に収める（写真の写り方で測りまちがえることがあるため）。
 * 範囲は身長を1とした割合。
 */
export function sane(s: BodyScan): BodyScan {
  const head = { width: clamp(s.head.width, 0.07, 0.13), height: clamp(s.head.height, 0.11, 0.17), depth: clamp(s.head.depth, 0.08, 0.15) };
  const tw = (v: number) => clamp(v, 0.1, 0.36);
  const td = (v?: number) => (v === undefined ? undefined : clamp(v, 0.07, 0.3));
  const lw = (v: number) => clamp(v, 0.03, 0.17);
  return {
    ...s,
    head,
    // 首は、腕や髪とつながって太く測れることがある
    neck: { y: clamp(s.neck.y, head.height * 0.9, 0.2), width: clamp(s.neck.width, head.width * 0.45, head.width * 0.8) },
    shoulder: { y: clamp(s.shoulder.y, 0.15, 0.24), width: clamp(s.shoulder.width, 0.17, 0.34) },
    torso: s.torso.map((t) => ({ y: t.y, width: tw(t.width), depth: td(t.depth)! })),
    crotchY: clamp(s.crotchY, 0.42, 0.6),
    ankleY: clamp(s.ankleY, 0.9, 0.98),
    legGap: clamp(s.legGap, 0.05, 0.16),
    legs: s.legs.map((l) => ({ t: l.t, width: lw(l.width), depth: clamp(l.depth, 0.03, 0.18) })),
    arm: { length: clamp(s.arm.length, 0.25, 0.4), upper: clamp(s.arm.upper, 0.03, 0.09), wrist: clamp(s.arm.wrist, 0.02, 0.05) },
    marks: s.marks && {
      chest: { y: s.marks.chest.y, width: tw(s.marks.chest.width), depth: td(s.marks.chest.depth) },
      waist: { y: s.marks.waist.y, width: tw(s.marks.waist.width), depth: td(s.marks.waist.depth) },
      hip: { y: s.marks.hip.y, width: tw(s.marks.hip.width), depth: td(s.marks.hip.depth) },
      thigh: lw(s.marks.thigh),
      calf: lw(s.marks.calf),
      shoulder: clamp(s.marks.shoulder, 0.17, 0.34),
      upperArm: s.marks.upperArm === undefined ? undefined : clamp(s.marks.upperArm, 0.03, 0.09),
      wrist: s.marks.wrist === undefined ? undefined : clamp(s.marks.wrist, 0.02, 0.05),
    },
  };
}

/**
 * 写真がないときの標準の体型。身長・体重・メンズ/レディースで太さを変える。
 * 太さの係数は、Amazon 公開の体型データ BodyM（24人）の正面・横のシルエットに合わせた：
 * 体格指数が1増えるごとに、正面の幅は約1.6%、おなかは約2.6%、厚みは約3%増える。
 */
export function defaultScan(profile: Profile): BodyScan {
  const { curvy, bmi } = bodyShape(profile);
  const w = clamp(0.95 + (bmi - 21) * 0.016, 0.8, 1.3);
  const belly = clamp(0.99 + (bmi - 21) * 0.026, 0.8, 1.5);
  const thick = clamp(1 + (bmi - 21) * 0.015, 0.85, 1.3);
  const hipW = Math.max(w, (w + belly) / 2);
  // 胸 → おなか → 腰 → 股（上から10段）
  const base = curvy
    ? [0.205, 0.2, 0.183, 0.167, 0.159, 0.167, 0.188, 0.214, 0.225, 0.22]
    : [0.195, 0.19, 0.18, 0.169, 0.163, 0.166, 0.176, 0.185, 0.19, 0.188];
  const torso = base.map((width, i) => {
    const y = lerp(0.205, 0.54, i / (base.length - 1));
    // おなかまわり（真ん中あたり）は体重の影響を大きく、胸と腰はほどほど。段差が出ないようになめらかに
    const bump = Math.sin(Math.PI * Math.min(1, i / (base.length - 1.5))) ** 1.5;
    const k = lerp(i >= base.length / 2 ? hipW : w, belly, bump);
    return { y, width: width * k, depth: width * k * thick * TORSO_DEPTH_RATIO[i] };
  });
  const legBase = [0.105, 0.095, 0.08, 0.065, 0.062, 0.064, 0.055, 0.042];
  return {
    version: 1,
    at: 0,
    views: [],
    head: { width: 0.09, height: 0.13, depth: 0.105 },
    neck: { y: 0.145, width: 0.06 * Math.sqrt(w) },
    // 肩幅は骨格で決まるので、体重ではあまり変わらない
    shoulder: { y: 0.185, width: (curvy ? 0.245 : 0.25) * (1 + (w - 1) * 0.4) },
    torso,
    crotchY: 0.54,
    ankleY: 0.955,
    legGap: (curvy ? 0.11 : 0.105) * hipW,
    legs: legBase.map((width, i) => ({ t: i / (legBase.length - 1), width: width * hipW, depth: width * hipW * 1.05 * thick })),
    arm: { length: 0.33, upper: 0.05 * w, wrist: 0.032 * Math.sqrt(w) },
  };
}

/** 服を着た写真でも、下着の体型なら標準体型の何倍までありえるか（BodyM の24人では 0.75〜1.25 倍に収まった） */
const CLOTHES_TOLERANCE = 1.2;

/**
 * 服を着て撮った写真の分をさし引く。
 * 肩・腰・ひざなどの骨格の点は服に影響されにくいので、長さはそのまま使う。
 * 胴と脚の太さは服でふくらむので、身長・体重から想定される太さよりずっと太いところは、服の分とみなして想定値に寄せる。
 * 身長か体重が未登録なら、想定が立てられないので何もしない。
 */
export function fitClothes(scan: BodyScan, profile: Profile): { scan: BodyScan; loose: boolean } {
  if (!bodyShape(profile).known) return { scan, loose: false };
  const expect = defaultScan(profile);
  const cap = (v: number, e: number) => Math.min(v, e * CLOTHES_TOLERANCE);
  const torso = scan.torso.map((t, i) => ({ ...t, width: cap(t.width, expect.torso[i].width), depth: cap(t.depth, expect.torso[i].depth) }));
  const legs = scan.legs.map((l, i) => ({ ...l, width: cap(l.width, expect.legs[i].width), depth: cap(l.depth, expect.legs[i].depth) }));
  const ratios = [...scan.torso.map((t, i) => t.width / expect.torso[i].width), ...scan.legs.map((l, i) => l.width / expect.legs[i].width)];
  // 半分以上の段が想定よりずっと太ければ、ゆったりした服と判断する
  const loose = ratios.filter((r) => r > CLOTHES_TOLERANCE).length >= ratios.length / 2;
  // ゆったりした服だと、写真で測った胸囲などの目安も服の分だけ大きく出るので、目安は出さない
  // （BodyM の下着のシルエットでは、2,495人中3人しか「ゆったり」にならなかった）
  return { scan: loose ? { ...scan, torso, legs, marks: undefined, loose } : { ...scan, torso, legs }, loose };
}
