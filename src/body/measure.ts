// 体の写真の「骨格の点（ランドマーク）」と「人の形の切り抜き（マスク）」から体型を測る。
// 写真には触らず、数字だけを返す。端末の外には何も送らない。
import { bodyShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import type { BodyScan, LegSlice, TorsoSlice } from "./types";

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
    return this.mask.data[y * this.w + x] > 0.5;
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

const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** 正面の写真から測ったもの（身長を1とした割合） */
export type FrontMeasure = Omit<BodyScan, "version" | "at" | "views"> & {
  /** 腕が体についていて、胴の幅が正しく測れなかった */
  armsTouching: boolean;
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

  // 頭：あごは鼻と肩のあいだの半分くらい
  const chin = lerp(nose.y, sh.y, 0.5);
  const headH = chin - top;
  const headW = im.width(nose.y, nose.x) || headH * 0.75;

  // 肩：点は肩の関節なので、外側の幅はそれより少し広い
  const shoulderW = dist(ls, rs) * 1.22;

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
  // わきの下：肩から下へ、胴と腕のあいだにすき間が出る高さ。それより上は肩なので、腕が重なって見えるのは当たり前
  const elbowY = Math.max(im.p(P.lElbow).y, im.p(P.rElbow).y);
  const armpits = arms.map((arm) => {
    for (let y = Math.round(sh.y) + 1; y < elbowY; y++) {
      const x = arm(y);
      const r = im.run(y, cx(y));
      if (x !== undefined && r && (x < r[0] || x > r[1])) return y;
    }
    return undefined;
  });
  const aboveArmpit: boolean[] = [];
  for (let i = 0; i < TORSO_LEVELS; i++) {
    // いちばん下は股のすぐ上（股の高さだと片脚しか測れない）
    const y = lerp(torsoTop, crotch - H * 0.012, i / (TORSO_LEVELS - 1));
    const r = im.run(y, cx(y));
    let w = r ? r[1] - r[0] : 0;
    let above = false;
    arms.forEach((arm, side) => {
      const x = arm(y);
      if (!r || x === undefined || x < r[0] || x > r[1]) return;
      const pit = armpits[side];
      if (pit !== undefined && y < pit) {
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
  // わきの下より上は肩の幅まで測ってしまうので、わきの下の高さの胸の幅にそろえる
  const chest = torso.find((_, i) => !aboveArmpit[i]);
  if (chest) torso.forEach((t, i) => aboveArmpit[i] && (t.width = chest.width));
  // 急に細くなるところは、股や腕のすき間を拾ったものなので、ひとつ上の幅を使う
  for (let i = 1; i < torso.length; i++) if (torso[i].width < torso[i - 1].width * 0.75) torso[i].width = torso[i - 1].width;

  // 脚：左右それぞれの中心線に沿って測る。くっついていたら真ん中で分ける
  const center = (h: typeof lh, k: typeof lk, a: typeof la) => (y: number) =>
    y < k.y ? lerp(h.x, k.x, (y - h.y) / (k.y - h.y)) : lerp(k.x, a.x, (y - k.y) / (a.y - k.y));
  const lc = center(lh, lk, la);
  const rc = center(rh, rk, ra);
  const ankleY = mid(la, ra).y;
  const legs: LegSlice[] = [];
  for (let i = 0; i < LEG_LEVELS; i++) {
    const t = i / (LEG_LEVELS - 1);
    const y = lerp(crotch + (ankleY - crotch) * 0.03, ankleY, t);
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
    legs.push({ t, width: nw(ok.length ? ok.reduce((a, b) => a + b) / ok.length : 0), depth: 0 });
  }

  // 腕
  const armLen = (dist(ls, im.p(P.lElbow)) + dist(im.p(P.lElbow), im.p(P.lWrist)) + dist(rs, im.p(P.rElbow)) + dist(im.p(P.rElbow), im.p(P.rWrist))) / 2;
  // 腕の太さは、腕の向きに直角に測る（Tの字でも下ろしていても測れる）
  const armWidth = (from: number, to: number, at: number, fallback: number) => {
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
    return ok.length ? Math.min(...ok) : fallback;
  };

  return {
    head: { width: nw(headW), height: nw(headH), depth: nw(headW) * 1.15 },
    neck: { y: ny(lerp(chin, sh.y, 0.5)), width: nw(im.width(lerp(chin, sh.y, 0.55), lerp(nose.x, sh.x, 0.5)) || headW * 0.6) },
    shoulder: { y: ny(sh.y), width: nw(shoulderW) },
    torso,
    crotchY: ny(crotch),
    ankleY: ny(ankleY),
    legGap: nw(Math.abs(lc(crotch) - rc(crotch))),
    legs,
    arm: { length: nw(armLen), upper: armWidth(0, 1, 0.4, 0.05), wrist: armWidth(1, 2, 0.85, 0.032) },
    armsTouching,
  };
}

/** 横の写真から、胴と脚の厚みを測る。高さは正面で測った位置に合わせる */
export function measureSide(mask: Mask, lm: Landmark[], front: FrontMeasure): { torso: number[]; legs: number[]; head: number } {
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
  const Y = (n: number) => top + n * H;
  const sp = im.p(s);
  const hp = im.p(h);
  const kp = im.p(k);
  const ap = im.p(a);
  const cx = (y: number) => lerp(sp.x, hp.x, clamp((y - sp.y) / (hp.y - sp.y), 0, 1.3));
  // どちらも身長を1にしているので、同じ割合の高さで測る
  const fy = Y;
  const torso = front.torso.map((sl) => im.width(fy(sl.y), cx(fy(sl.y))) / H);
  const legX = (y: number) => (y < kp.y ? lerp(hp.x, kp.x, (y - hp.y) / (kp.y - hp.y)) : lerp(kp.x, ap.x, (y - kp.y) / (ap.y - kp.y)));
  const crotch = fy(front.crotchY);
  const legs = front.legs.map((l) => {
    const y = lerp(crotch, ap.y, l.t);
    return im.width(y, legX(y)) / H;
  });
  return { torso, legs, head: im.width(Y(front.head.height * 0.55), nose.x) / H };
}

/** 正面（と横）の測定から体型を作る。横がなければ厚みは幅から見積もる */
export function buildScan(front: FrontMeasure, side?: ReturnType<typeof measureSide>, at = Date.now()): BodyScan {
  const n = front.torso.length;
  const torso = front.torso.map((sl, i) => {
    const guess = sl.width * lerp(0.68, 0.8, i / (n - 1));
    const d = side?.torso[i];
    // 横の写真で腕が重なると厚く出るので、ありえない値は見積もりに戻す
    return { ...sl, depth: d && d > sl.width * 0.45 && d < sl.width * 1.3 ? d : guess };
  });
  const legs = front.legs.map((l, i) => {
    const d = side?.legs[i];
    // 横からは両脚が重なって見えるので、1本分の太さとして扱う。
    // 左右の脚が前後にずれていると厚く出るので、幅の1.15倍まで（脚の厚みは幅とだいたい同じ。実測の太もも回りと比べて決めた）
    return { ...l, depth: d && d > l.width * 0.6 ? Math.min(d, l.width * 1.15) : l.width * 1.05 };
  });
  const headDepth = side?.head && side.head > front.head.width * 0.8 && side.head < front.head.width * 1.6 ? side.head : front.head.depth;
  return sane({
    version: 1,
    at,
    views: side ? ["front", "side"] : ["front"],
    head: { ...front.head, depth: headDepth },
    neck: front.neck,
    shoulder: front.shoulder,
    torso,
    crotchY: front.crotchY,
    ankleY: front.ankleY,
    legGap: front.legGap,
    legs,
    arm: front.arm,
  });
}

/**
 * 人の体としてありえない値を、ありえる範囲に収める（写真の写り方で測りまちがえることがあるため）。
 * 範囲は身長を1とした割合。
 */
export function sane(s: BodyScan): BodyScan {
  const head = { width: clamp(s.head.width, 0.07, 0.13), height: clamp(s.head.height, 0.11, 0.17), depth: clamp(s.head.depth, 0.08, 0.15) };
  return {
    ...s,
    head,
    // 首は、腕や髪とつながって太く測れることがある
    neck: { y: clamp(s.neck.y, head.height * 0.9, 0.2), width: clamp(s.neck.width, head.width * 0.45, head.width * 0.8) },
    shoulder: { y: clamp(s.shoulder.y, 0.15, 0.24), width: clamp(s.shoulder.width, 0.17, 0.34) },
    torso: s.torso.map((t) => ({ y: t.y, width: clamp(t.width, 0.1, 0.36), depth: clamp(t.depth, 0.07, 0.3) })),
    crotchY: clamp(s.crotchY, 0.42, 0.6),
    ankleY: clamp(s.ankleY, 0.9, 0.98),
    legGap: clamp(s.legGap, 0.05, 0.16),
    legs: s.legs.map((l) => ({ t: l.t, width: clamp(l.width, 0.03, 0.17), depth: clamp(l.depth, 0.03, 0.18) })),
    arm: { length: clamp(s.arm.length, 0.25, 0.4), upper: clamp(s.arm.upper, 0.03, 0.09), wrist: clamp(s.arm.wrist, 0.02, 0.05) },
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
    return { y, width: width * k, depth: width * k * thick * lerp(0.68, 0.8, i / (base.length - 1)) };
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
  return { scan: { ...scan, torso, legs }, loose };
}
