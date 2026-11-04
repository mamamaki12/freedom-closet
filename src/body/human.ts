// 人体メッシュ（MakeHuman 由来・CC0。tools/body/build.mjs で作る human.glb）を読み込み、
// 測った体型（BodyScan）に合わせて変形する。単位は身長＝1、床が y=0、顔が +z。
//
// 変形のしくみ：頂点ごとに「胴・腕・脚・頭・首」のどれにどれだけ属するか（骨の重み）を持っているので、
// 部位ごとに別の変形（胴は高さごとの幅と厚み、脚は脚の軸まわり、腕は腕の軸まわり…）をかけて、重みで混ぜる。
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { bodyShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import humanUrl from "./assets/human.glb?url";
import type { BodyScan } from "./types";

export interface HumanMesh {
  /** 基準の体型の頂点の位置 */
  position: Float32Array;
  /** 頂点ごとの部位の重み [胴, 腕, 脚, 頭]（残りが首） */
  parts: Float32Array;
  index: Uint16Array | Uint32Array;
  /** 体型ごとの差分（Human.morphs の順） */
  morphs: Float32Array[];
}

export interface Human {
  morphs: string[];
  /** 体型ごとの目印（関節）の位置 */
  landmarks: Record<string, Record<string, number[]>>;
  body: HumanMesh;
  tights: HumanMesh;
  skirt: HumanMesh;
}

let loading: Promise<Human> | undefined;

/** 3Dデータを読み込む（1回だけ） */
export function loadHuman(): Promise<Human> {
  if (!loading) {
    loading = fetch(humanUrl)
      .then((r) => {
        if (!r.ok)
          throw new Error(`3Dデータを読み込めませんでした（${r.status}）`);
        return r.arrayBuffer();
      })
      .then(parseHuman);
    loading.catch(() => (loading = undefined));
  }
  return loading;
}

/** glb のデータをほどく（テストからも使う） */
export function parseHuman(buffer: ArrayBuffer): Promise<Human> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<Human>((resolve, reject) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        try {
          gltf.scene.updateMatrixWorld(true);
          const extras = gltf.scene.userData as {
            morphs: string[];
            landmarks: Human["landmarks"];
          };
          const pick = (name: string): HumanMesh => {
            let mesh: THREE.Mesh | undefined;
            gltf.scene.getObjectByName(name)?.traverse((o) => {
              if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
            });
            if (!mesh) throw new Error(`3Dデータに ${name} がありません`);
            return decode(mesh, extras.morphs.length);
          };
          resolve({
            morphs: extras.morphs,
            landmarks: extras.landmarks,
            body: pick("body"),
            tights: pick("tights"),
            skirt: pick("skirt"),
          });
        } catch (e) {
          reject(e);
        }
      },
      reject,
    );
  });
}

/** glTF の圧縮・量子化された属性を、ふつうの配列にほどく */
function decode(mesh: THREE.Mesh, nMorphs: number): HumanMesh {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const col = g.attributes.color;
  const n = pos.count;
  const m = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const position = new Float32Array(n * 3);
  const parts = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    position[i * 3] = v.x;
    position[i * 3 + 1] = v.y;
    position[i * 3 + 2] = v.z;
    parts[i * 4] = col.getX(i);
    parts[i * 4 + 1] = col.getY(i);
    parts[i * 4 + 2] = col.getZ(i);
    parts[i * 4 + 3] = col.getW(i);
  }
  const morphs: Float32Array[] = [];
  for (let k = 0; k < nMorphs; k++) {
    const d = g.morphAttributes.position![k];
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      v.x += d.getX(i);
      v.y += d.getY(i);
      v.z += d.getZ(i);
      v.applyMatrix4(m);
      out[i * 3] = v.x - position[i * 3];
      out[i * 3 + 1] = v.y - position[i * 3 + 1];
      out[i * 3 + 2] = v.z - position[i * 3 + 2];
    }
    morphs.push(out);
  }
  const idx = g.index!.array;
  const index =
    idx instanceof Uint32Array ? new Uint32Array(idx) : new Uint16Array(idx);
  return { position, parts, index, morphs };
}

// ---------- 体型の混ぜ方 ----------

export type Blend = Record<string, number>;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/** 性別（メンズ・レディース）と体格指数から、男女・体重の形の混ぜ具合を決める */
export function blendFor(profile: Profile): Blend {
  const { bmi } = bodyShape(profile);
  const f = profile.fit === "womens" ? 1 : profile.fit === "mens" ? 0 : 0.5;
  const w = clamp(0.5 + (bmi - 21.5) * 0.05, 0, 1);
  const heavy = Math.max(0, w * 2 - 1);
  const thin = Math.max(0, 1 - w * 2);
  const avg = 1 - heavy - thin;
  return {
    female: f * avg,
    male: (1 - f) * avg,
    femaleHeavy: f * heavy,
    femaleThin: f * thin,
    maleHeavy: (1 - f) * heavy,
    maleThin: (1 - f) * thin,
  };
}

function mix(mesh: HumanMesh, names: string[], blend: Blend): Float32Array {
  const out = new Float32Array(mesh.position);
  names.forEach((name, k) => {
    const w = blend[name];
    if (!w) return;
    const d = mesh.morphs[k];
    for (let i = 0; i < out.length; i++) out[i] += d[i] * w;
  });
  return out;
}

function mixLandmarks(h: Human, blend: Blend): Record<string, number[]> {
  const base = h.landmarks.base;
  const out: Record<string, number[]> = {};
  for (const [name, p] of Object.entries(base)) {
    out[name] = p.map((v, j) => {
      let r = v;
      for (const [k, w] of Object.entries(blend))
        if (w && h.landmarks[k]) r += (h.landmarks[k][name][j] - v) * w;
      return r;
    });
  }
  return out;
}

// ---------- メッシュの寸法を測る ----------

/** 高さ（またはパラメータ）ごとの寸法。bin は 0〜1 を n 等分 */
class Bins {
  minX: Float32Array;
  maxX: Float32Array;
  minZ: Float32Array;
  maxZ: Float32Array;
  count: Uint16Array;
  constructor(readonly n: number) {
    this.minX = new Float32Array(n).fill(Infinity);
    this.maxX = new Float32Array(n).fill(-Infinity);
    this.minZ = new Float32Array(n).fill(Infinity);
    this.maxZ = new Float32Array(n).fill(-Infinity);
    this.count = new Uint16Array(n);
  }
  add(t: number, x: number, z: number) {
    const b = clamp(Math.floor(t * this.n), 0, this.n - 1);
    this.minX[b] = Math.min(this.minX[b], x);
    this.maxX[b] = Math.max(this.maxX[b], x);
    this.minZ[b] = Math.min(this.minZ[b], z);
    this.maxZ[b] = Math.max(this.maxZ[b], z);
    this.count[b]++;
  }
  /** 空の段は隣から埋め、少しならす */
  finish() {
    const first = this.first();
    for (const arr of [this.minX, this.maxX, this.minZ, this.maxZ]) {
      let prev = arr[first];
      for (let i = 0; i < this.n; i++) {
        if (this.count[i]) prev = arr[i];
        else arr[i] = prev;
      }
      const copy = Float32Array.from(arr);
      for (let i = 0; i < this.n; i++) {
        const a = copy[Math.max(0, i - 1)];
        const c = copy[Math.min(this.n - 1, i + 1)];
        arr[i] = (a + copy[i] * 2 + c) / 4;
      }
    }
  }
  first() {
    for (let i = 0; i < this.n; i++) if (this.count[i]) return i;
    return 0;
  }
  private at(arr: Float32Array, t: number) {
    const f = clamp(t * this.n - 0.5, 0, this.n - 1);
    const i = Math.floor(f);
    return lerp(arr[i], arr[Math.min(this.n - 1, i + 1)], f - i);
  }
  width(t: number) {
    return Math.max(1e-4, this.at(this.maxX, t) - this.at(this.minX, t));
  }
  halfOuter(t: number) {
    return Math.max(
      1e-4,
      Math.max(
        Math.abs(this.at(this.maxX, t)),
        Math.abs(this.at(this.minX, t)),
      ),
    );
  }
  cx(t: number) {
    return (this.at(this.maxX, t) + this.at(this.minX, t)) / 2;
  }
  depth(t: number) {
    return Math.max(1e-4, this.at(this.maxZ, t) - this.at(this.minZ, t));
  }
  cz(t: number) {
    return (this.at(this.maxZ, t) + this.at(this.minZ, t)) / 2;
  }
}

export type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a: V3, b: V3, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 腕の軸（肩→ひじ→手首）。k は肩(0)・ひじ(0.5)・手首(1)、手は 1 より先 */
class ArmAxis {
  readonly d1: V3;
  readonly d2: V3;
  readonly l1: number;
  readonly l2: number;
  constructor(
    readonly s: V3,
    readonly e: V3,
    readonly w: V3,
  ) {
    this.d1 = unit(sub(e, s));
    this.d2 = unit(sub(w, e));
    this.l1 = len(sub(e, s));
    this.l2 = len(sub(w, e));
  }
  /** 点を軸に投影したパラメータと、軸からのずれ */
  locate(p: V3): { k: number; off: V3 } {
    const a = dot(sub(p, this.s), this.d1) / this.l1;
    const b = dot(sub(p, this.e), this.d2) / this.l2;
    // ひじより上は上腕、下は前腕で測る
    if (a <= 1 && b <= 0) {
      const k = a * 0.5;
      return { k, off: sub(p, this.at(k)) };
    }
    if (b >= 0) {
      const k = 0.5 + b * 0.5;
      return { k, off: sub(p, this.at(k)) };
    }
    // ひじの外側（どちらにも入らない）：近いほう
    const k = a > 1 ? 0.5 : a * 0.5;
    return { k, off: sub(p, this.at(k)) };
  }
  at(k: number): V3 {
    return k <= 0.5
      ? addS(this.s, this.d1, k * 2 * this.l1)
      : addS(this.e, this.d2, (k - 0.5) * 2 * this.l2);
  }
  dir(k: number): V3 {
    return k <= 0.5 ? this.d1 : this.d2;
  }
}

/** 基準メッシュを測った結果（変形の元になる値） */
interface Measured {
  trunk: Bins; // 胴だけ（腕を除く）。高さは頭から(0)〜床(1)
  outer: Bins; // 頭以外ぜんぶ（肩の外側の幅）
  legs: [Bins, Bins]; // 右(-x)・左(+x)。股(0)〜足首(1)
  arms: [Float32Array, Float32Array]; // 腕の太さ（半径）。k を 0〜1.3 で 26 段
  armAxis: [ArmAxis, ArmAxis];
  head: { top: number; chin: number; halfW: number; depth: number; cz: number };
  neck: { halfW: number; cz: number };
  shoulderM: number; // 肩の関節の高さ（頭から）
  crotchM: number;
  ankleM: number;
  chestM: number;
}

const ARM_BINS = 26;
const ARM_MAX = 1.3;

function measure(
  pos: Float32Array,
  parts: Float32Array,
  lm: Record<string, number[]>,
): Measured {
  const n = pos.length / 3;
  const trunk = new Bins(100);
  const outer = new Bins(100);
  const legs: [Bins, Bins] = [new Bins(50), new Bins(50)];
  const sideOf = (x: number) => (x < 0 ? 0 : 1);
  const armAxis: [ArmAxis, ArmAxis] = [
    new ArmAxis(
      lm["upperarm01.R____head"] as V3,
      lm["lowerarm01.R____head"] as V3,
      lm["wrist.R____head"] as V3,
    ),
    new ArmAxis(
      lm["upperarm01.L____head"] as V3,
      lm["lowerarm01.L____head"] as V3,
      lm["wrist.L____head"] as V3,
    ),
  ];
  const armSum: [Float32Array, Float32Array] = [
    new Float32Array(ARM_BINS),
    new Float32Array(ARM_BINS),
  ];
  const armCnt: [Float32Array, Float32Array] = [
    new Float32Array(ARM_BINS),
    new Float32Array(ARM_BINS),
  ];
  const shoulderM = 1 - lm["upperarm01.L____head"][1];
  const ankleM = 1 - (lm["foot.L____head"][1] + lm["foot.R____head"][1]) / 2;
  // 股：体の真ん中あたりで、脚のあいだのいちばん低い点
  let crotchY = Infinity;
  let headTop = -Infinity;
  let headMinY = Infinity;
  let headHalfW = 0;
  let headMinZ = Infinity;
  let headMaxZ = -Infinity;
  let neckHalfW = 0;
  let neckMinZ = Infinity;
  let neckMaxZ = -Infinity;
  const neckMid = 1 - (lm["neck01____head"][1] + lm["head____head"][1]) / 2;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const yt = 1 - y;
    const [wT, wA, wL, wH] = [
      parts[i * 4],
      parts[i * 4 + 1],
      parts[i * 4 + 2],
      parts[i * 4 + 3],
    ];
    const wN = Math.max(0, 1 - wT - wA - wL - wH);
    if (wH < 0.5) outer.add(yt, x, z);
    // 胴の輪郭：腕（手も）と頭を除いた、股より上のぜんぶ（腰まわりは脚の重みが強いので、部位では選ばない）
    if (wA < 0.3 && wH < 0.5) {
      if (y > 0.3 && Math.abs(x) < 0.015 && (wL >= 0.3 || wT >= 0.3))
        crotchY = Math.min(crotchY, y);
    }
    if (wH >= 0.5) {
      headTop = Math.max(headTop, y);
      headMinY = Math.min(headMinY, y);
      headHalfW = Math.max(headHalfW, Math.abs(x));
      headMinZ = Math.min(headMinZ, z);
      headMaxZ = Math.max(headMaxZ, z);
    }
    if (wN >= 0.5 && Math.abs(yt - neckMid) < 0.012) {
      neckHalfW = Math.max(neckHalfW, Math.abs(x));
      neckMinZ = Math.min(neckMinZ, z);
      neckMaxZ = Math.max(neckMaxZ, z);
    }
  }
  const crotchM = 1 - crotchY;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const yt = 1 - y;
    const wA = parts[i * 4 + 1];
    const wH = parts[i * 4 + 3];
    if (wA >= 0.3 || wH >= 0.5) {
      if (wA >= 0.5) {
        const s = sideOf(x);
        const { k, off } = armAxis[s].locate([x, y, z]);
        const b = clamp(Math.floor((k / ARM_MAX) * ARM_BINS), 0, ARM_BINS - 1);
        armSum[s][b] += len(off);
        armCnt[s][b]++;
      }
      continue;
    }
    if (yt <= crotchM) trunk.add(yt, x, z);
    else if (yt <= ankleM)
      legs[sideOf(x)].add((yt - crotchM) / (ankleM - crotchM), x, z);
  }
  trunk.finish();
  outer.finish();
  legs[0].finish();
  legs[1].finish();
  const arms = armSum.map((sum, s) => {
    const r = new Float32Array(ARM_BINS);
    let last = 0.03;
    for (let b = 0; b < ARM_BINS; b++) {
      if (armCnt[s][b]) last = sum[b] / armCnt[s][b];
      r[b] = last;
    }
    return r;
  }) as [Float32Array, Float32Array];
  return {
    trunk,
    outer,
    legs,
    arms,
    armAxis,
    head: {
      top: headTop,
      chin: headMinY,
      halfW: headHalfW,
      depth: headMaxZ - headMinZ,
      cz: (headMaxZ + headMinZ) / 2,
    },
    neck: {
      halfW: neckHalfW || 0.03,
      cz: neckMinZ < neckMaxZ ? (neckMaxZ + neckMinZ) / 2 : 0,
    },
    shoulderM,
    crotchM,
    ankleM,
    chestM: 0, // あとで決める（測った体型の胸の段に対応する高さ）
  };
}

function armRadius(r: Float32Array, k: number) {
  const f = clamp((k / ARM_MAX) * ARM_BINS - 0.5, 0, ARM_BINS - 1);
  const i = Math.floor(f);
  return lerp(r[i], r[Math.min(ARM_BINS - 1, i + 1)], f - i);
}

// ---------- 測った体型（BodyScan）の目標値 ----------

/** 胴の目標の幅と厚み。y は頭から(0)〜床(1) */
function torsoTarget(scan: BodyScan, y: number): { w: number; d: number } {
  const t = scan.torso;
  const sh = scan.shoulder;
  if (y <= sh.y) return { w: sh.width, d: t[0].depth * 0.9 };
  if (y <= t[0].y) {
    const k = smooth((y - sh.y) / Math.max(1e-3, t[0].y - sh.y));
    return {
      w: lerp(sh.width, t[0].width, k),
      d: lerp(t[0].depth * 0.9, t[0].depth, k),
    };
  }
  for (let i = 1; i < t.length; i++) {
    if (y <= t[i].y) {
      const k = (y - t[i - 1].y) / (t[i].y - t[i - 1].y);
      return {
        w: lerp(t[i - 1].width, t[i].width, k),
        d: lerp(t[i - 1].depth, t[i].depth, k),
      };
    }
  }
  const last = t[t.length - 1];
  return { w: last.width, d: last.depth };
}

function legTarget(scan: BodyScan, t: number): { w: number; d: number } {
  const L = scan.legs;
  t = clamp(t, 0, 1);
  for (let i = 1; i < L.length; i++) {
    if (t <= L[i].t) {
      const k = (t - L[i - 1].t) / (L[i].t - L[i - 1].t);
      return {
        w: lerp(L[i - 1].width, L[i].width, k),
        d: lerp(L[i - 1].depth, L[i].depth, k),
      };
    }
  }
  return { w: L[L.length - 1].width, d: L[L.length - 1].depth };
}

/** 頭からの高さの対応（メッシュ → 測った体型）。区切りの高さを合わせ、あいだは比例 */
class YMap {
  private xs: number[];
  private ys: number[];
  constructor(pairs: [number, number][]) {
    pairs.sort((a, b) => a[0] - b[0]);
    this.xs = pairs.map((p) => p[0]);
    this.ys = pairs.map((p) => p[1]);
    // 単調になるように
    for (let i = 1; i < this.ys.length; i++)
      this.ys[i] = Math.max(this.ys[i], this.ys[i - 1] + 1e-3);
  }
  map(x: number) {
    const { xs, ys } = this;
    if (x <= xs[0]) return ys[0] + (x - xs[0]);
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i])
        return lerp(ys[i - 1], ys[i], (x - xs[i - 1]) / (xs[i] - xs[i - 1]));
    }
    return ys[ys.length - 1] + (x - xs[xs.length - 1]);
  }
  inverse(y: number) {
    const { xs, ys } = this;
    for (let i = 1; i < ys.length; i++) {
      if (y <= ys[i])
        return lerp(xs[i - 1], xs[i], (y - ys[i - 1]) / (ys[i] - ys[i - 1]));
    }
    return xs[xs.length - 1];
  }
}

/** いくつかの点で決めた値を、あいだはなめらかにつなぐ曲線（細かい段差を作らないため） */
class Curve {
  private xs: number[];
  private vs: number[];
  constructor(points: [number, number][]) {
    points.sort((a, b) => a[0] - b[0]);
    this.xs = points.map((p) => p[0]);
    this.vs = points.map((p) => p[1]);
  }
  at(x: number): number {
    const { xs, vs } = this;
    if (x <= xs[0]) return vs[0];
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) {
        const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return lerp(vs[i - 1], vs[i], (1 - Math.cos(t * Math.PI)) / 2);
      }
    }
    return vs[vs.length - 1];
  }
}

// ---------- 変形 ----------

/** 変形したあとの目印（床からの高さ） */
export interface Marks {
  /** 肩・ひじ・手首・指先の位置 [右, 左] */
  shoulder: [V3, V3];
  elbow: [V3, V3];
  wrist: [V3, V3];
  hand: [V3, V3];
  /** 変形後の腕の軸 */
  armAxis: [ArmAxis, ArmAxis];
  /** 床からの高さ */
  topY: number;
  chinY: number;
  neckY: number;
  shoulderY: number;
  chestY: number;
  crotchY: number;
  ankleY: number;
  /** 腰（いちばん細いあたり）と、腰骨の高さ */
  waistY: number;
  hipY: number;
  /** 股関節の位置 [右, 左] */
  hip: [V3, V3];
  /** 目の位置 [右, 左] */
  eye: [V3, V3];
  /** 首の中心（前後）と半分の太さ（変形後） */
  neckCz: number;
  neckHalfW: number;
  /** 足：足首の位置と、かかと・つま先の前後、幅 [右, 左] */
  foot: { ankle: V3; heelZ: number; toeZ: number; width: number }[];
  /** 胴の前後の中心（床からの高さ y で） */
  torsoCz: (y: number) => number;
  /** 胴の目標の幅（床からの高さ y で） */
  torsoWidth: (y: number) => number;
}

/** 頂点ごとの補助情報 */
export interface Aux {
  /** 腕の軸のパラメータ（肩0・ひじ0.5・手首1）。腕でなければ -1 */
  armK: Float32Array;
  /** 脚のパラメータ（股0・足首1）。脚でなければ -9 */
  legT: Float32Array;
  /** 腕まわりの角度（0〜1） */
  armAngle: Float32Array;
}

export interface Fitted {
  body: Float32Array;
  tights: Float32Array;
  skirt: Float32Array;
  aux: { body: Aux; tights: Aux; skirt: Aux };
  marks: Marks;
}

interface Warp {
  apply: (p: V3, w: [number, number, number, number]) => V3;
  armK: (p: V3) => { k: number; angle: number };
  legT: (p: V3) => number;
}

function makeWarp(
  scan: BodyScan,
  m: Measured,
  lm: Record<string, number[]>,
): { warp: Warp; marks: Marks } {
  const chinM = 1 - m.head.chin;
  const ymap = new YMap([
    [0, 0],
    [chinM, scan.head.height],
    [m.shoulderM, scan.shoulder.y],
    [m.crotchM, scan.crotchY],
    [m.ankleM, scan.ankleY],
    [1, 1],
  ]);
  const chestM = ymap.inverse(scan.torso[0].y);
  m.chestM = chestM;

  // 胴：高さごとの幅・厚みの倍率。肩・胸・腰（いちばん細い）・ヒップ（いちばん太い）・股の5か所で決め、あいだはなめらかに
  const meshTorsoW = (yt: number) => {
    if (yt <= m.shoulderM) return m.outer.halfOuter(yt) * 2;
    if (yt < chestM)
      return lerp(
        m.outer.halfOuter(m.shoulderM) * 2,
        m.trunk.width(chestM),
        smooth((yt - m.shoulderM) / (chestM - m.shoulderM)),
      );
    return m.trunk.width(yt);
  };
  const T = scan.torso;
  const mid = T.slice(2, 7);
  const waistSlice = mid.reduce((a, b) => (b.width < a.width ? b : a));
  const lower = T.slice(5);
  const hipSlice = lower.reduce((a, b) => (b.width > a.width ? b : a));
  const levels = [
    scan.shoulder.y,
    T[0].y,
    waistSlice.y,
    hipSlice.y,
    T[T.length - 1].y,
  ];
  const ratioAt = (ys: number) => {
    const yt = ymap.inverse(ys);
    const { w, d } = torsoTarget(scan, ys);
    return {
      yt,
      sx: clamp(w / meshTorsoW(yt), 0.75, 1.4),
      sz: clamp(d / m.trunk.depth(yt), 0.75, 1.4),
    };
  };
  const pts = levels.map(ratioAt);
  const sxCurve = new Curve(pts.map((p) => [p.yt, p.sx]));
  const szCurve = new Curve(pts.map((p) => [p.yt, p.sz]));
  const torsoScale = (yt: number) => ({
    sx: sxCurve.at(yt),
    sz: szCurve.at(yt),
    ys: ymap.map(yt),
    cz: m.trunk.cz(yt),
  });
  const torso = (p: V3): V3 => {
    const yt = 1 - p[1];
    const { sx, sz, ys, cz } = torsoScale(yt);
    return [p[0] * sx, 1 - ys, cz + (p[2] - cz) * sz];
  };

  // 脚：脚の軸まわり
  const legX = [-(scan.legGap / 2), scan.legGap / 2];
  const crotchSx = torsoScale(m.crotchM - 0.01).sx;
  // 脚：太もも・ひざ・ふくらはぎ・足首の4か所で倍率を決める
  const legCurves = m.legs.map((b) => {
    const ts = [0.12, 0.43, 0.71, 1];
    const w = new Curve(
      ts.map((t) => [t, clamp(legTarget(scan, t).w / b.width(t), 0.75, 1.4)]),
    );
    const d = new Curve(
      ts.map((t) => [t, clamp(legTarget(scan, t).d / b.depth(t), 0.75, 1.4)]),
    );
    return { w, d };
  });
  const leg = (p: V3): V3 => {
    const s = p[0] < 0 ? 0 : 1;
    const yt = 1 - p[1];
    const t = (yt - m.crotchM) / (m.ankleM - m.crotchM);
    const tc = clamp(t, 0.04, 1);
    const b = m.legs[s];
    const cx = b.cx(tc);
    const cz = b.cz(tc);
    // 脚の中心：股では胴の倍率に合わせ（段差を作らない）、下に行くにつれて測った脚の間隔へ
    const xs = lerp(
      crotchSx,
      legX[s] / (b.cx(0.04) || legX[s]),
      smooth(tc / 0.35),
    );
    // 足首から下（足）は前後に伸ばさない（足の長さは脚の太さと関係ない）
    const dz = t > 1 ? 1 : legCurves[s].d.at(tc);
    return [
      cx * xs + (p[0] - cx) * legCurves[s].w.at(tc),
      1 - ymap.map(yt),
      cz + (p[2] - cz) * dz,
    ];
  };

  // 頭・首
  const headCz = m.head.cz;
  const hsx = clamp(scan.head.width / (m.head.halfW * 2), 0.7, 1.4);
  const hsz = clamp(scan.head.depth / m.head.depth, 0.7, 1.4);
  const head = (p: V3): V3 => [
    p[0] * hsx,
    1 - ymap.map(1 - p[1]),
    headCz + (p[2] - headCz) * hsz,
  ];
  const nsx = clamp(scan.neck.width / (m.neck.halfW * 2), 0.7, 1.5);
  const neck = (p: V3): V3 => [
    p[0] * nsx,
    1 - ymap.map(1 - p[1]),
    m.neck.cz + (p[2] - m.neck.cz) * nsx,
  ];

  // 腕：肩の位置は胴の変形に合わせ、長さと太さを合わせる。胴が太ければ少し外に開く
  const armLen = (ax: ArmAxis) => ax.l1 + ax.l2;
  const armAxes = m.armAxis.map((ax, s) => {
    const sgn = s === 0 ? -1 : 1;
    const S = torso(ax.s);
    const ls = clamp((scan.arm.length - 0.02) / armLen(ax), 0.85, 1.2);
    const su = clamp(
      scan.arm.upper / (armRadius(m.arms[s], 0.25) * 2),
      0.6,
      1.8,
    );
    let E = addS(S, ax.d1, ax.l1 * ls);
    // ひじの内側が胴に食い込まないように開く
    const half = torsoTarget(scan, ymap.map(1 - E[1])).w / 2;
    const inner = E[0] * sgn - armRadius(m.arms[s], 0.5) * su;
    const need = half + 0.012 - inner;
    let rot = 0;
    if (need > 0) rot = Math.asin(clamp(need / (ax.l1 * ls), 0, 0.6)) * sgn;
    const rz = (v: V3, c: V3): V3 => {
      const dx = v[0] - c[0];
      const dy = v[1] - c[1];
      // z まわりに rot だけ回す（外向き）。右腕は向きが逆
      return [
        c[0] + dx * Math.cos(rot) - dy * Math.sin(rot),
        c[1] + dx * Math.sin(rot) + dy * Math.cos(rot),
        v[2],
      ];
    };
    E = rz(E, S);
    const W = rz(addS(E, ax.d2, ax.l2 * ls), S);
    return {
      axis: new ArmAxis(S, E, W),
      su,
      sw: clamp(scan.arm.wrist / (armRadius(m.arms[s], 0.95) * 2), 0.6, 1.8),
    };
  }) as [
    { axis: ArmAxis; su: number; sw: number },
    { axis: ArmAxis; su: number; sw: number },
  ];
  const q = new THREE.Quaternion();
  const tmp = new THREE.Vector3();
  const arm = (p: V3): V3 => {
    const s = p[0] < 0 ? 0 : 1;
    const ax = m.armAxis[s];
    const { axis, su, sw } = armAxes[s];
    const { k, off } = ax.locate(p);
    const rs = k <= 0.5 ? su : lerp(su, sw, clamp((k - 0.5) * 2, 0, 1));
    q.setFromUnitVectors(
      tmp.set(...ax.dir(k)),
      new THREE.Vector3(...axis.dir(k)),
    );
    const o = tmp
      .set(...off)
      .applyQuaternion(q)
      .multiplyScalar(rs);
    const base = axis.at(k);
    return [base[0] + o.x, base[1] + o.y, base[2] + o.z];
  };

  const apply = (p: V3, w: [number, number, number, number]): V3 => {
    let [wT, wA, wL, wH] = w;
    const wN = Math.max(0, 1 - wT - wA - wL - wH);
    // 股より上（腰まわり）の脚の重みは胴として扱う（腰の幅は胴の輪切りで決まる）
    if (wL > 0) {
      const t = (1 - p[1] - m.crotchM) / (m.ankleM - m.crotchM);
      const f = smooth((t + 0.12) / 0.14);
      wT += wL * (1 - f);
      wL *= f;
    }
    const out: V3 = [0, 0, 0];
    const acc = (f: (p: V3) => V3, wt: number) => {
      if (wt < 1e-3) return;
      const r = f(p);
      out[0] += r[0] * wt;
      out[1] += r[1] * wt;
      out[2] += r[2] * wt;
    };
    acc(torso, wT);
    acc(arm, wA);
    acc(leg, wL);
    acc(head, wH);
    acc(neck, wN);
    const sum = wT + wA + wL + wH + wN;
    if (sum > 0 && Math.abs(sum - 1) > 1e-3)
      return [out[0] / sum, out[1] / sum, out[2] / sum];
    return out;
  };

  const feet = m.armAxis.map((_, s) => {
    const side = s === 0 ? "R" : "L";
    const ankle = leg(lm[`foot.${side}____head`] as V3);
    const b = m.legs[s];
    return {
      ankle,
      heelZ: lm.foot[0],
      toeZ: lm.foot[1],
      width: b.width(1) * legCurves[s].w.at(1) * 1.15,
    };
  });

  const marks: Marks = {
    shoulder: [armAxes[0].axis.s, armAxes[1].axis.s],
    elbow: [armAxes[0].axis.e, armAxes[1].axis.e],
    wrist: [armAxes[0].axis.w, armAxes[1].axis.w],
    hand: [armAxes[0].axis.at(1.28), armAxes[1].axis.at(1.28)],
    armAxis: [armAxes[0].axis, armAxes[1].axis],
    topY: 1,
    chinY: 1 - scan.head.height,
    neckY: 1 - ymap.map(1 - lm["neck01____head"][1]),
    shoulderY: 1 - scan.shoulder.y,
    chestY: 1 - scan.torso[0].y,
    crotchY: 1 - scan.crotchY,
    ankleY: 1 - scan.ankleY,
    waistY: 1 - scan.torso[Math.floor(scan.torso.length * 0.45)].y,
    hipY: 1 - (scan.crotchY - 0.04),
    hip: [
      leg(lm["upperleg01.R____head"] as V3),
      leg(lm["upperleg01.L____head"] as V3),
    ],
    eye: [head(lm["eye.R____head"] as V3), head(lm["eye.L____head"] as V3)],
    neckCz: m.neck.cz,
    neckHalfW: m.neck.halfW * nsx,
    foot: feet,
    torsoCz: (y) => m.trunk.cz(1 - y),
    torsoWidth: (y) => torsoTarget(scan, 1 - y).w,
  };
  const warp: Warp = {
    apply,
    armK: (p) => {
      const s = p[0] < 0 ? 0 : 1;
      const { k, off } = m.armAxis[s].locate(p);
      // 腕まわりの角度：腕の軸を上から見た向きを基準に
      const d = m.armAxis[s].dir(k);
      const ref: V3 = unit([0, 0, 1]);
      const n1 = unit([
        d[1] * ref[2] - d[2] * ref[1],
        d[2] * ref[0] - d[0] * ref[2],
        d[0] * ref[1] - d[1] * ref[0],
      ]);
      const n2 = unit([
        n1[1] * d[2] - n1[2] * d[1],
        n1[2] * d[0] - n1[0] * d[2],
        n1[0] * d[1] - n1[1] * d[0],
      ]);
      const angle =
        (Math.atan2(dot(off, n2), dot(off, n1)) / (Math.PI * 2) + 1) % 1;
      return { k, angle };
    },
    legT: (p) => (1 - p[1] - m.crotchM) / (m.ankleM - m.crotchM),
  };
  return { warp, marks };
}

/** 体型（BodyScan）と本人の情報に合わせて、体・タイツ・スカートのメッシュを変形する */
export function fitHuman(
  h: Human,
  scan: BodyScan,
  profile: Profile,
  opts: { warp?: boolean } = {},
): Fitted {
  const blend = blendFor(profile);
  const body = mix(h.body, h.morphs, blend);
  const tights = mix(h.tights, h.morphs, blend);
  const skirt = mix(h.skirt, h.morphs, blend);
  const lm = mixLandmarks(h, blend);
  // 身長1・床 y=0 にそろえる（体型を混ぜると身長が少し変わるため）
  let floor = Infinity;
  let top = -Infinity;
  for (let i = 1; i < body.length; i += 3) {
    floor = Math.min(floor, body[i]);
    top = Math.max(top, body[i]);
  }
  const s = 1 / (top - floor);
  for (const arr of [body, tights, skirt]) {
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] *= s;
      arr[i + 1] = (arr[i + 1] - floor) * s;
      arr[i + 2] *= s;
    }
  }
  for (const [k, p] of Object.entries(lm))
    lm[k] =
      k === "foot"
        ? p.map((z) => z * s)
        : [p[0] * s, (p[1] - floor) * s, p[2] * s];
  const m = measure(body, h.body.parts, lm);
  const { warp, marks } = makeWarp(scan, m, lm);
  const run = (
    mesh: HumanMesh,
    pos: Float32Array,
  ): { pos: Float32Array; aux: Aux } => {
    const n = pos.length / 3;
    const out = new Float32Array(n * 3);
    const armK = new Float32Array(n).fill(-1);
    const legT = new Float32Array(n).fill(-9);
    const armAngle = new Float32Array(n);
    const w: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const p: V3 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      w[0] = mesh.parts[i * 4];
      w[1] = mesh.parts[i * 4 + 1];
      w[2] = mesh.parts[i * 4 + 2];
      w[3] = mesh.parts[i * 4 + 3];
      const r = opts.warp === false ? p : warp.apply(p, w);
      out[i * 3] = r[0];
      out[i * 3 + 1] = r[1];
      out[i * 3 + 2] = r[2];
      if (w[1] > 0.2) {
        const a = warp.armK(p);
        armK[i] = a.k;
        armAngle[i] = a.angle;
      }
      if (w[2] > 0.2) legT[i] = warp.legT(p);
    }
    return { pos: out, aux: { armK, legT, armAngle } };
  };
  const b = run(h.body, body);
  const t = run(h.tights, tights);
  const k = run(h.skirt, skirt);
  return {
    body: b.pos,
    tights: t.pos,
    skirt: k.pos,
    aux: { body: b.aux, tights: t.aux, skirt: k.aux },
    marks,
  };
}
