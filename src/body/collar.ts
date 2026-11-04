// えり：服を切り出したあとの、えりぐりのふち（輪）に沿って作る部分。
//   crew  … Tシャツ・ニット・スウェットのリブ（ふちを包む細い帯）
//   v     … Vネック（リブ）
//   plain … ふちを細く折り返しただけ（ブラウス・ワンピース）
//   collar… シャツのえり（首に沿って立つ台えりと、折り返して肩にのる羽。前は先がとがる）
//   stand … 立ちえり（ダウン・ブルゾン）
//   hood  … フード（首の後ろにたたんで垂れている）
//   lapel … ジャケット・コートのえり（後ろはシャツのえりのように立ち、前は V 字のふちに沿って折り返す）
// えりの断面（ふちに直角な切り口の形）を、ふちに沿って少しずつ変えながらつないで面にする。
// 服の上にのるところは、服の面に沿わせてから少し浮かせる（肩や胸の丸みに埋もれないように）
import * as THREE from "three";
import type { Neck } from "../domain/look";
import type { V3 } from "./human";

export type { Neck };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** えりぐりのふち：前のまん中から、首の軸のまわりの角度が増える向きに1周（同じ間隔の点） */
export interface Rim {
  p: V3[];
  /** 服の面の法線（外向き） */
  n: V3[];
  /** 首の軸のまわりの角度。前のまん中が 0、後ろのまん中が π、1周で 2π */
  psi: number[];
  /** 前のまん中からのふちに沿った長さ */
  s: number[];
  total: number;
}

/**
 * 服の面のふちのうち、首のまわりを1周するいちばん高い輪を、同じ間隔の M 点にする。
 * 面は材質ごとに頂点が分かれているので、同じ位置の頂点はまとめてから数える
 */
export function neckRim(geo: THREE.BufferGeometry, cz: number, M = 192): Rim | undefined {
  const P = geo.getAttribute("position").array as ArrayLike<number>;
  const NN = geo.getAttribute("normal").array as ArrayLike<number>;
  const I = geo.getIndex()!.array as ArrayLike<number>;
  const nv = P.length / 3;
  const ids = new Map<string, number>();
  const weld = new Int32Array(nv);
  const first: number[] = [];
  for (let i = 0; i < nv; i++) {
    const key = `${P[i * 3]},${P[i * 3 + 1]},${P[i * 3 + 2]}`;
    let w = ids.get(key);
    if (w === undefined) {
      w = first.length;
      ids.set(key, w);
      first.push(i);
    }
    weld[i] = w;
  }
  const W = first.length;
  const half = new Set<number>();
  for (let f = 0; f < I.length; f += 3)
    for (let e = 0; e < 3; e++) {
      const a = weld[I[f + e]];
      const b = weld[I[f + ((e + 1) % 3)]];
      if (a !== b) half.add(a * W + b);
    }
  // 逆向きの辺がない辺がふち。向きをたどって輪にする
  const next = new Int32Array(W).fill(-1);
  for (const k of half) {
    const a = Math.floor(k / W);
    const b = k - a * W;
    if (!half.has(b * W + a)) next[a] = b;
  }
  const ang = (v: number) => Math.atan2(P[first[v] * 3], P[first[v] * 3 + 2] - cz);
  const seen = new Uint8Array(W);
  let best: number[] | undefined;
  let bestY = -Infinity;
  for (let s = 0; s < W; s++) {
    if (next[s] < 0 || seen[s]) continue;
    const loop: number[] = [];
    let v = s;
    while (v >= 0 && !seen[v]) {
      seen[v] = 1;
      loop.push(v);
      v = next[v];
    }
    if (v !== s || loop.length < 8) continue;
    let wind = 0;
    let y = 0;
    for (let k = 0; k < loop.length; k++) {
      let d = ang(loop[(k + 1) % loop.length]) - ang(loop[k]);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      wind += d;
      y += P[first[loop[k]] * 3 + 1];
    }
    y /= loop.length;
    // 首の軸を1周する輪（袖口は首の軸のまわりを回らない）
    if (Math.abs(wind) < Math.PI || y <= bestY) continue;
    bestY = y;
    best = wind > 0 ? loop : loop.reverse();
  }
  if (!best) return undefined;
  const pts: V3[] = best.map((v) => [P[first[v] * 3], P[first[v] * 3 + 1], P[first[v] * 3 + 2]]);
  const nrm: V3[] = best.map((v) => unit([NN[first[v] * 3], NN[first[v] * 3 + 1], NN[first[v] * 3 + 2]]));
  // 前のまん中（x が 0 をまたぐ前側の辺）から始める
  let start = 0;
  let startT = 0;
  let found = false;
  for (let k = 0; k < pts.length && !found; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    if (a[2] > cz && b[2] > cz && a[0] <= 0 && b[0] > 0) {
      start = k;
      startT = -a[0] / (b[0] - a[0]);
      found = true;
    }
  }
  const K = pts.length;
  const at = (k: number) => pts[((k % K) + K) % K];
  const nat = (k: number) => nrm[((k % K) + K) % K];
  // 始まりの点から1周ぶんの長さ
  const seg: number[] = [];
  let total = 0;
  for (let k = 0; k < K; k++) {
    const a = at(start + k);
    const b = at(start + k + 1);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    seg.push(l);
    total += l;
  }
  const off = seg[0] * startT;
  const rim: Rim = { p: [], n: [], psi: [], s: [], total };
  let k = 0;
  let acc = 0;
  for (let j = 0; j < M; j++) {
    const target = off + (total * j) / M;
    while (k < K - 1 && acc + seg[k] < target) acc += seg[k++];
    const t = seg[k] > 0 ? clamp((target - acc) / seg[k], 0, 1) : 0;
    const a = at(start + k);
    const b = at(start + k + 1);
    const p: V3 = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const na = nat(start + k);
    const nb = nat(start + k + 1);
    rim.p.push(p);
    rim.n.push(unit([lerp(na[0], nb[0], t), lerp(na[1], nb[1], t), lerp(na[2], nb[2], t)]));
    rim.s.push((total * j) / M);
    let psi = Math.atan2(p[0], p[2] - cz);
    if (psi < 0) psi += 2 * Math.PI;
    // 始まりの点のすぐ手前（x がわずかに負）は 2π の近く
    if (j === 0) psi = 0;
    rim.psi.push(psi);
  }
  // 角度は1周で増えていくようにそろえる（始まりの近くの 2π ↔ 0 の飛びを直す）
  for (let j = 1; j < M; j++) if (rim.psi[j] < rim.psi[j - 1] - Math.PI) rim.psi[j] += 2 * Math.PI;
  // 法線はふちに沿って少しならす（ふちの面は小さいので向きがばらつく）
  for (let pass = 0; pass < 10; pass++) {
    const n0 = rim.n.map((v) => [...v] as V3);
    for (let j = 0; j < M; j++) {
      const a = n0[(j + M - 1) % M];
      const b = n0[(j + 1) % M];
      rim.n[j] = unit(add(add(n0[j], a, 0.5), b, 0.5));
    }
  }
  return rim;
}

/**
 * 服の面に写す：近くの頂点（1cm ほどの範囲を重みづけ）の位置と法線をならした面に下ろして、
 * 法線の向きに h だけ浮かせる（服の面の細かいしわで、えりが波打たないように）
 */
function surfaceOf(geo: THREE.BufferGeometry, minY: number) {
  const P = geo.getAttribute("position").array as ArrayLike<number>;
  const NN = geo.getAttribute("normal").array as ArrayLike<number>;
  const cand: number[] = [];
  for (let i = 0; i < P.length / 3; i++) if (P[i * 3 + 1] >= minY) cand.push(i);
  const SIG = 0.006;
  return (q: V3, h: number): { p: V3; n: V3 } => {
    let best = -1;
    let bd = Infinity;
    let w = 0;
    const c: V3 = [0, 0, 0];
    const nr: V3 = [0, 0, 0];
    for (const i of cand) {
      const d = (P[i * 3] - q[0]) ** 2 + (P[i * 3 + 1] - q[1]) ** 2 + (P[i * 3 + 2] - q[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
      if (d > 9 * SIG * SIG) continue;
      const k = Math.exp(-d / (2 * SIG * SIG));
      w += k;
      for (let e = 0; e < 3; e++) {
        c[e] += P[i * 3 + e] * k;
        nr[e] += NN[i * 3 + e] * k;
      }
    }
    if (best < 0) return { p: q, n: [0, 1, 0] };
    let v: V3;
    let n: V3;
    if (w > 1e-6) {
      v = [c[0] / w, c[1] / w, c[2] / w];
      n = unit(nr);
    } else {
      v = [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]];
      n = unit([NN[best * 3], NN[best * 3 + 1], NN[best * 3 + 2]]);
    }
    const on = add(q, n, -dot(sub(q, v), n));
    return { p: add(on, n, h), n };
  };
}

/** 体の首の太さ（首の軸からの距離）を、向き（ψ）と高さで引く表 */
function neckRadius(body: Float32Array, use: (i: number) => boolean, cz: number) {
  const A = 48;
  const Y0 = 0.74;
  const DY = 0.004;
  const B = 60;
  const r = new Float32Array(A * B);
  for (let i = 0; i < body.length / 3; i++) {
    const y = body[i * 3 + 1];
    const b = Math.floor((y - Y0) / DY);
    if (b < 0 || b >= B || !use(i)) continue;
    const x = body[i * 3];
    const dz = body[i * 3 + 2] - cz;
    let psi = Math.atan2(x, dz);
    if (psi < 0) psi += 2 * Math.PI;
    const a = Math.floor((psi / (2 * Math.PI)) * A) % A;
    r[b * A + a] = Math.max(r[b * A + a], Math.hypot(x, dz));
  }
  return (psi: number, y: number) => {
    const b = clamp(Math.floor((y - Y0) / DY), 0, B - 1);
    const p = ((psi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const a = Math.floor((p / (2 * Math.PI)) * A) % A;
    let m = 0;
    for (const db of [-1, 0, 1])
      for (const da of [-1, 0, 1]) {
        const bb = b + db;
        if (bb < 0 || bb >= B) continue;
        m = Math.max(m, r[bb * A + ((a + da + A) % A)]);
      }
    return m;
  };
}

export interface CollarInput {
  /** 切り出した服（えりぐりのふちを探す・えりをのせる面） */
  cloth: THREE.BufferGeometry;
  cz: number;
  /** 体（首の太さを測る）と、首・胴の頂点か */
  body: Float32Array;
  bodyUse: (i: number) => boolean;
  /** 生地の見本1枚の大きさ [横, 縦] */
  tile: [number, number];
  /** ふくらみ（ダウンなど）のときに厚くする倍率 */
  puffy?: boolean;
  /** 下に着た服のえりの、その場所での首の軸からの距離（このえりはそれより外に出す） */
  outside?: (x: number, y: number, z: number) => number;
}

/** 断面の1点：ふちの点からの位置を、まわりの向きで決める */
interface Frame {
  P: V3;
  N: V3;
  /** 服の面に沿って、ふちから服の中へ向かう向き */
  D: V3;
  /** ふちに沿った向き（ψ が増える向き） */
  T: V3;
  /** 首の軸から外へ（水平） */
  R: V3;
  psi: number;
  /** 前のまん中からのふちに沿った長さ（左右どちら回りでも短いほう） */
  sFront: number;
}

/** えりの面を作る（作れないときは undefined）。材質は生地の見本（group 1）だけ */
export function buildCollar(kind: Neck, inp: CollarInput): THREE.BufferGeometry | undefined {
  const rim = neckRim(inp.cloth, inp.cz);
  if (!rim) return undefined;
  const M = rim.p.length;
  let minY = Infinity;
  for (const p of rim.p) minY = Math.min(minY, p[1]);
  const surf = surfaceOf(inp.cloth, minY - 0.1);
  const neckR = neckRadius(inp.body, inp.bodyUse, inp.cz);
  const Y: V3 = [0, 1, 0];
  const frames: Frame[] = [];
  for (let j = 0; j < M; j++) {
    const P = rim.p[j];
    const N = rim.n[j];
    const T = unit(sub(rim.p[(j + 1) % M], rim.p[(j + M - 1) % M]));
    let D = unit(cross(T, N));
    const R = unit([P[0], 0, P[2] - inp.cz]);
    // 服の中へ向かう向き：穴（首）から離れる向き
    if (dot(D, sub(R, Y)) < 0) D = [-D[0], -D[1], -D[2]];
    const s = rim.s[j];
    frames.push({ P, N, D, T, R, psi: rim.psi[j], sFront: Math.min(s, rim.total - s) });
  }
  /** 服の面の上の点（ふちから服の中へ d、面から h 浮かせる） */
  const onCloth = (f: Frame, d: number, h: number): V3 =>
    d <= 0.0005 ? add(add(f.P, f.D, d), f.N, h) : surf(add(f.P, f.D, d), h).p;
  /** ふちから首に沿って立ち上がる向きと、立ち上がった先（高さ h、首から gap 離す） */
  const standTop = (f: Frame, h: number, gap: number, lean: number): V3 => {
    const r0 = Math.hypot(f.P[0], f.P[2] - inp.cz);
    const y = f.P[1] + h;
    const r = Math.max(r0 - h * lean, neckR(f.psi, y) + gap);
    return [f.R[0] * r, y, inp.cz + f.R[2] * r];
  };
  const front = (f: Frame) => Math.cos(f.psi); // 前 1、横 0、後ろ -1
  const puff = inp.puffy ? 1.6 : 1;

  /** 断面（内側から外側へ）。ψ ごとに */
  let section: (f: Frame) => V3[];
  /** えりの切れ目（前の開き）。この長さより前のまん中に近いところには作らない */
  let gap = 0;
  switch (kind) {
    case "crew":
    case "v":
    case "plain": {
      const w = kind === "plain" ? 0.0035 : 0.0085;
      const th = kind === "plain" ? 0.0011 : 0.0017;
      section = (f) => [
        onCloth(f, w * 0.7, -0.0011),
        onCloth(f, 0.15 * w, -0.0009),
        add(add(f.P, f.D, -0.001), f.N, 0.0002),
        add(add(f.P, f.D, -0.0007), f.N, th * 0.75),
        onCloth(f, 0.0008, th),
        onCloth(f, w * 0.5, th * 0.95),
        onCloth(f, w, th * 0.7),
        onCloth(f, w + 0.0015, 0.0002),
      ];
      break;
    }
    case "collar": {
      // シャツのえり：台えり（首に沿って立つ）と羽（折り返して台えりをおおい、肩にのる）。
      // 前の端はとがって胸の上に下がる（えり先）
      gap = 0.0004;
      section = (f) => {
        const fr = front(f);
        const tip = smooth((0.075 - f.sFront) / 0.06); // えり先に近いほど 1
        const hs = lerp(0.0165, 0.013, smooth((fr + 0.2) / 1.2));
        const L = lerp(0.009, 0.012, smooth((fr + 1) / 1.3)) + 0.026 * tip;
        const S = standTop(f, hs, 0.003, 0.35);
        const U = unit(sub(S, f.P));
        const F = add(add(S, f.R, 0.0022), Y, 0.0014);
        // えり先は、前のまん中から外へ開く
        const side: V3 = f.psi < Math.PI ? f.T : [-f.T[0], -f.T[1], -f.T[2]];
        const spread = 0.016 * tip;
        return [
          onCloth(f, 0.002, -0.0006),
          add(f.P, U, hs * 0.5),
          S,
          F,
          add(add(add(f.P, U, hs * 0.55), f.R, 0.0045), side, spread * 0.25),
          add(onCloth(f, 0.0015, 0.0042), side, spread * 0.45),
          add(onCloth(f, L * 0.55, 0.003), side, spread * 0.75),
          add(onCloth(f, L, 0.0024), side, spread),
        ];
      };
      break;
    }
    case "lapel": {
      // ジャケット・コートのえり：後ろと横はシャツのえりのように立って折り返し、前は V 字のふちから外へ
      // 折り返して胸にのる平らな下えり（ラペル）。ラペルは V の底で幅 0、上へ広がり、肩の近くで後ろのえりにつながる
      let yV = Infinity;
      let yT = -Infinity;
      for (const p of rim.p) {
        yV = Math.min(yV, p[1]);
        yT = Math.max(yT, p[1]);
      }
      section = (f) => {
        const fr = front(f);
        const t = clamp((f.P[1] - yV) / Math.max(1e-3, yT - yV), 0, 1);
        const b = (1 - smooth((t - 0.78) / 0.17)) * smooth((fr + 0.1) / 0.4);
        // 後ろ・横のえり
        const hs = lerp(0.018, 0.015, smooth((fr + 0.2) / 1.2));
        const L = lerp(0.016, 0.019, smooth((fr + 1) / 1.3));
        const S = standTop(f, hs, 0.003, 0.3);
        const U = unit(sub(S, f.P));
        const collar: V3[] = [
          onCloth(f, 0.002, -0.0006),
          add(f.P, U, hs * 0.5),
          S,
          add(add(S, f.R, 0.0024), Y, 0.0015),
          add(add(f.P, U, hs * 0.55), f.R, 0.0048),
          onCloth(f, 0.0015, 0.0045),
          onCloth(f, L * 0.55, 0.0032),
          onCloth(f, L, 0.0024),
        ];
        if (b <= 0) return collar;
        // ラペル
        const W = 0.045 * smooth(t / 0.55) * (1 - 0.35 * smooth((t - 0.6) / 0.3)) + 0.002;
        const lapel: V3[] = [
          onCloth(f, 0.002, -0.0006),
          add(add(f.P, f.D, -0.0012), f.N, 0.0012),
          add(add(f.P, f.D, -0.0009), f.N, 0.003),
          onCloth(f, 0.0015, 0.0038),
          onCloth(f, W * 0.3, 0.0036),
          onCloth(f, W * 0.6, 0.0033),
          onCloth(f, W * 0.9, 0.0028),
          onCloth(f, W, 0.0018),
        ];
        return collar.map((c, k) => [lerp(c[0], lapel[k][0], b), lerp(c[1], lapel[k][1], b), lerp(c[2], lapel[k][2], b)]);
      };
      break;
    }
    case "stand": {
      // 立ちえり：首に沿って立ち、上のふちは丸く厚い
      const h = inp.puffy ? 0.03 : 0.022;
      const t = 0.0045 * puff;
      section = (f) => {
        const hh = h * lerp(1, 0.85, smooth((front(f) + 0.2) / 1.2));
        const S = standTop(f, hh, 0.004, 0.25);
        const U = unit(sub(S, f.P));
        return [
          onCloth(f, 0.002, -0.0006),
          add(f.P, U, hh * 0.5),
          S,
          add(add(S, f.R, t * 0.6), U, t * 0.45),
          add(add(S, f.R, t), U, -t * 0.3),
          add(add(f.P, U, hh * 0.45), f.R, t * 1.05),
          onCloth(f, 0.003, t * 0.8),
          onCloth(f, 0.004 + t, 0.0015),
        ];
      };
      break;
    }
    case "hood": {
      // フード：首の後ろで立ち上がって丸く折り返し、ふくらんだまま背中にたたんで垂れる。
      // 横から前は、首のまわりの太い輪になって前で合わさる
      section = (f) => {
        const fr = front(f);
        const back = smooth((0.3 - fr) / 1.3); // 後ろ 1、前 0
        const hs = lerp(0.012, 0.024, back);
        const r = lerp(0.006, 0.013, back);
        const L = lerp(0.01, 0.105, back ** 1.5);
        const lift = lerp(0.004, 0.017, back);
        const S = standTop(f, hs, 0.005, 0.2);
        const U = unit(sub(S, f.P));
        return [
          onCloth(f, 0.002, -0.0006),
          add(f.P, U, hs * 0.5),
          S,
          add(add(S, f.R, r * 0.9), U, r * 0.6),
          add(add(f.P, U, hs * 0.55), f.R, r * 1.9),
          onCloth(f, 0.004, lift),
          onCloth(f, L * 0.45, lift * 1.05),
          onCloth(f, L * 0.8, lift * 0.7),
          onCloth(f, L, 0.0035),
        ];
      };
      break;
    }
  }
  // 断面を並べる（前に切れ目があるえりは、切れ目の左から後ろを回って右まで）
  const cols: { pts: V3[]; s: number }[] = [];
  const open = gap > 0;
  /** ふちの点 j と j+1 の間（t）の断面の向き */
  const between = (j: number, t: number): Frame => {
    const a = frames[j];
    const b = frames[(j + 1) % M];
    const mix = (u: V3, v: V3): V3 => [lerp(u[0], v[0], t), lerp(u[1], v[1], t), lerp(u[2], v[2], t)];
    let psi = lerp(a.psi, b.psi < a.psi - Math.PI ? b.psi + 2 * Math.PI : b.psi, t);
    if (psi >= 2 * Math.PI) psi -= 2 * Math.PI;
    return {
      P: mix(a.P, b.P),
      N: unit(mix(a.N, b.N)),
      D: unit(mix(a.D, b.D)),
      T: unit(mix(a.T, b.T)),
      R: unit(mix(a.R, b.R)),
      psi,
      sFront: lerp(a.sFront, j + 1 === M ? 0 : b.sFront, t),
    };
  };
  const step = rim.total / M;
  // 前に切れ目があるえりは、切れ目のちょうどそのところから始めて、そのところで終える
  if (open) cols.push({ pts: section(between(0, gap / step)), s: gap });
  for (let j = 0; j < M; j++) {
    const f = frames[j];
    if (open && f.sFront <= gap) continue;
    cols.push({ pts: section(f), s: rim.s[j] });
  }
  if (open) cols.push({ pts: section(between(M - 1, 1 - gap / step)), s: rim.total - gap });
  if (cols.length < 4) return undefined;
  // 下に着た服のえりと重なるところは、断面ごとに外へ広げる（となりの断面となめらかに。ふちの根もとは動かさない）
  if (inp.outside) {
    const need = cols.map((c) => {
      let s = 1;
      for (const p of c.pts) {
        const o = inp.outside!(p[0], p[1], p[2]);
        const r = Math.hypot(p[0], p[2] - inp.cz);
        if (o > 0 && r > 1e-5) s = Math.max(s, (o + 0.0025) / r);
      }
      return Math.min(s, 1.6);
    });
    const C0 = cols.length;
    const smoothNeed = need.map((_, j) => {
      let m = 0;
      for (let d = -4; d <= 4; d++) {
        const k = open ? clamp(j + d, 0, C0 - 1) : (j + d + C0) % C0;
        m = Math.max(m, (need[k] - 1) * (1 - Math.abs(d) / 6));
      }
      return 1 + m;
    });
    cols.forEach((c, j) => {
      const sc = smoothNeed[j];
      if (sc <= 1) return;
      c.pts = c.pts.map((p, k) => {
        const w = smooth(k / 2.5);
        const f = 1 + (sc - 1) * w;
        return [p[0] * f, p[1], inp.cz + (p[2] - inp.cz) * f];
      });
    });
  }
  // 1周するえりは、はじめの断面を終わりにもう一度置く（模様の座標が 1 周ぶん進んだところで閉じる）
  if (!open) cols.push({ pts: cols[0].pts, s: rim.total });
  const K = cols[0].pts.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const [tx, ty] = inp.tile;
  for (const c of cols) {
    let acc = 0;
    for (let k = 0; k < K; k++) {
      if (k > 0) acc += Math.hypot(...sub(c.pts[k], c.pts[k - 1]));
      pos.push(...c.pts[k]);
      uv.push(c.s / tx, acc / ty);
    }
  }
  const index: number[] = [];
  const C = cols.length;
  for (let j = 0; j + 1 < C; j++) {
    const a = j;
    const b = j + 1;
    for (let k = 0; k + 1 < K; k++) {
      const p = a * K + k;
      const q = b * K + k;
      index.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  if (!open) {
    // 閉じたところ（はじめと終わりの断面）の法線をそろえる（陰の筋が出ないように）
    const nr = geo.getAttribute("normal").array as Float32Array;
    const last = (C - 1) * K;
    for (let k = 0; k < K; k++) {
      const a = k * 3;
      const b = (last + k) * 3;
      const v = unit([nr[a] + nr[b], nr[a + 1] + nr[b + 1], nr[a + 2] + nr[b + 2]]);
      for (let e = 0; e < 3; e++) nr[a + e] = nr[b + e] = v[e];
    }
  }
  // 材質は服の本体と同じ並び（0: 前の写真・1: 生地の見本・2: 袖の見本）。えりは生地の見本だけ
  geo.addGroup(0, 0, 0);
  geo.addGroup(0, index.length, 1);
  geo.addGroup(index.length, 0, 2);
  return geo;
}
