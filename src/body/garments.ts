// 服のメッシュを、体にぴったり沿った「タイツ」「スカート」のメッシュ（human.glb）から切り出して作る。
// 裾・襟・袖の長さで切り、体から少し離し（ゆとり）、胸やおなかのいちばん出たところから下はまっすぐ垂らす。
import * as THREE from "three";
import type { LookShape } from "../domain/look";
import type { Neck } from "../domain/look";
import { gridAt, type AlignGrid } from "./align";
import { buildCollar } from "./collar";
import type { Aux, Fitted, Human, HumanMesh, Marks, V3 } from "./human";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/**
 * 生地の見本を、写真（1枚貼る模様 whole）の柄に重ねるための対応。
 * whole の座標 at のところを見本の座標 tileAt に当て、見本1枚を whole の座標で size の大きさにする
 */
export interface SwatchMatch {
  at: [number, number];
  tileAt: [number, number];
  size: [number, number];
  /**
   * whole の座標から見本の座標への対応の表（align.ts）。1枚貼る用の模様は列ごとに縦に伸ばしてあり、
   * 見本は柄の傾きを直して取ってあり、写真の柄は少しずつ曲がっているので、それを合わせたもの。
   * なければ at・size どおり（まっすぐ）
   */
  grid?: AlignGrid;
}

/** 見本を3Dにまっすぐ前から当てる当て方：位置 (x, y) が見本の座標 at、見本1枚が3Dで tx × ty */
export interface SwatchPlane {
  x: number;
  y: number;
  tx: number;
  ty: number;
  at: [number, number];
}

/** 面ごとの頂点法線（なめらか） */
export function vertexNormals(
  pos: Float32Array,
  index: ArrayLike<number>,
): Float32Array {
  const n = new Float32Array(pos.length);
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f] * 3;
    const b = index[f + 1] * 3;
    const c = index[f + 2] * 3;
    const abx = pos[b] - pos[a];
    const aby = pos[b + 1] - pos[a + 1];
    const abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a];
    const acy = pos[c + 1] - pos[a + 1];
    const acz = pos[c + 2] - pos[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const i of [a, b, c]) {
      n[i] += nx;
      n[i + 1] += ny;
      n[i + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/** となりの頂点の一覧（面の辺から）。i のとなりは adj[start[i]] 〜 adj[start[i + 1] - 1]（重なりあり） */
export function neighbors(index: ArrayLike<number>, n: number): { start: Int32Array; adj: Int32Array } {
  const start = new Int32Array(n + 1);
  for (let f = 0; f < index.length; f++) start[index[f] + 1] += 2;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const adj = new Int32Array(start[n]);
  const fill = start.slice(0, n);
  for (let f = 0; f < index.length; f += 3)
    for (let e = 0; e < 3; e++) {
      const a = index[f + e];
      const b = index[f + ((e + 1) % 3)];
      adj[fill[a]++] = b;
      adj[fill[b]++] = a;
    }
  return { start, adj };
}

/** 法線をとなりの頂点と平均して、なめらかにする（times 回） */
export function smoothNormals(
  normals: Float32Array,
  index: ArrayLike<number>,
  times: number,
): Float32Array {
  const n = normals.length / 3;
  const { start: deg, adj } = neighbors(index, n);
  let cur = normals;
  for (let t = 0; t < times; t++) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < n; i++) {
      let x = cur[i * 3];
      let y = cur[i * 3 + 1];
      let z = cur[i * 3 + 2];
      for (let q = deg[i]; q < deg[i + 1]; q++) {
        const j = adj[q];
        x += cur[j * 3];
        y += cur[j * 3 + 1];
        z += cur[j * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      next[i * 3] = x / l;
      next[i * 3 + 1] = y / l;
      next[i * 3 + 2] = z / l;
    }
    cur = next;
  }
  return cur;
}

/** 模様の貼り方：whole は写真を1枚そのまま、swatch は生地の模様を敷き詰める */
export type UvMode = "whole" | "swatch";
export type Group = 0 | 1 | 2;


/**
 * 重ね着：すでに着た服のいちばん外側を、胴の軸のまわりの角度と高さの区画ごとに覚えておき、
 * 上に着る服をそれより外へ出す（シャツのすそからスカートが突き抜けて見えないように）。腕は含めない。
 */
export class Layers {
  private static readonly SECT = 40;
  private static readonly YB = 100;
  private r = new Float32Array(Layers.SECT * Layers.YB);
  constructor(private axisZ: (y: number) => number) {}

  private cell(x: number, y: number, z: number): [number, number, number] {
    const dz = z - this.axisZ(y);
    const sec =
      ((Math.floor(((Math.atan2(dz, x) / (Math.PI * 2)) + 0.5) * Layers.SECT) % Layers.SECT) +
        Layers.SECT) %
      Layers.SECT;
    const yb = clamp(Math.floor(y * Layers.YB), 0, Layers.YB - 1);
    return [sec, yb, Math.hypot(x, dz)];
  }

  /** p の頂点 verts を、すでに着た服より gap だけ外へ出す */
  push(p: Float32Array, verts: Iterable<number>, gap = 0.003): void {
    const S = Layers.SECT;
    for (const i of verts) {
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      const [sec, yb, r] = this.cell(x, y, z);
      let need = 0;
      for (const d of [-1, 0, 1]) need = Math.max(need, this.r[yb * S + ((sec + d + S) % S)]);
      if (need <= 0 || r >= need + gap || r < 1e-5) continue;
      const k = (need + gap) / r;
      const cz = this.axisZ(y);
      p[i * 3] = x * k;
      p[i * 3 + 2] = cz + (z - cz) * k;
    }
  }

  // えり用：首の軸のまわりの向き（5°ごと）と高さ（2mm ごと）で、いちばん外のえりの距離
  private static readonly NA = 72;
  private static readonly NY0 = 0.74;
  private static readonly NYB = 90;
  private nk = new Float32Array(Layers.NA * Layers.NYB);

  private neckCell(x: number, y: number, z: number, cz: number): [number, number] {
    let a = Math.atan2(x, z - cz);
    if (a < 0) a += Math.PI * 2;
    return [
      Math.floor((a / (Math.PI * 2)) * Layers.NA) % Layers.NA,
      Math.floor((y - Layers.NY0) / 0.002),
    ];
  }

  /** すでに作ったえりの、その場所での首の軸からのいちばん外の距離（なければ 0） */
  neckOuter(x: number, y: number, z: number, cz: number): number {
    const [a, b] = this.neckCell(x, y, z, cz);
    let need = 0;
    for (const db of [-1, 0, 1]) {
      const bb = b + db;
      if (bb < 0 || bb >= Layers.NYB) continue;
      for (const da of [-1, 0, 1]) need = Math.max(need, this.nk[bb * Layers.NA + ((a + da + Layers.NA) % Layers.NA)]);
    }
    return need;
  }

  /** えりの点を覚える */
  addNeck(p: Float32Array, cz: number): void {
    for (let i = 0; i < p.length / 3; i++) {
      const [a, b] = this.neckCell(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], cz);
      if (b < 0 || b >= Layers.NYB) continue;
      const r = Math.hypot(p[i * 3], p[i * 3 + 2] - cz);
      const j = b * Layers.NA + a;
      if (r > this.nk[j]) this.nk[j] = r;
    }
  }

  /** 着た服の面を覚える（三角形の中も細かく調べて、すき間を作らない） */
  add(pos: Float32Array, index: ArrayLike<number>, use: (v: number) => boolean): void {
    const S = Layers.SECT;
    const mark = (x: number, y: number, z: number) => {
      const [sec, yb, r] = this.cell(x, y, z);
      const j = yb * S + sec;
      if (r > this.r[j]) this.r[j] = r;
    };
    const N = 4;
    for (let f = 0; f < index.length; f += 3) {
      const a = index[f];
      const b = index[f + 1];
      const c = index[f + 2];
      if (!use(a) || !use(b) || !use(c)) continue;
      for (let u = 0; u <= N; u++)
        for (let v = 0; u + v <= N; v++) {
          const wa = u / N;
          const wb = v / N;
          const wc = 1 - wa - wb;
          mark(
            pos[a * 3] * wa + pos[b * 3] * wb + pos[c * 3] * wc,
            pos[a * 3 + 1] * wa + pos[b * 3 + 1] * wb + pos[c * 3 + 1] * wc,
            pos[a * 3 + 2] * wa + pos[b * 3 + 2] * wb + pos[c * 3 + 2] * wc,
          );
        }
    }
  }
}

export interface CutSpec {
  /**
   * 0以上なら残す。負なら切る。0 になるところ（辺の上で求める）が切り口。
   * at は、ゆとりをつけて垂らしたあとの服の位置（えりぐりやすそを、できあがった服の上でなめらかな線にするため）
   */
  keep: (i: number, at: Float32Array) => number;
  /** 体からの離れ具合（頂点ごと） */
  ease: (i: number) => number;
  /**
   * 面を切り分ける、なめらかに変わる量（頂点ごと）。それぞれ 0 になるところでも面を切り分け、
   * 分けた面ごとに、量が正かどうかから材質と見本の座標の測り方を決める（classify）。
   * こうすると前と背中・袖と胴の境目も、メッシュの辺に沿ったギザギザにならず、なめらかな線になる
   */
  fields?: ((i: number) => number)[];
  /**
   * 面の材質（0: 前＝写真1枚、1: 背中・パンツなど＝生地の見本、2: 袖＝袖の見本）と、
   * 生地の見本の座標をどの区切りで測るか（左右の袖・左右の脚など）
   */
  classify: (positive: boolean[]) => { g: Group; chart: number };
  /**
   * 生地の見本の座標（group 1・2 の頂点を、区切り chart の測り方で）。見本1枚ぶんが 1。
   * 3つめの値があれば、輪になったところ（腕・脚のまわり）の1周ぶんの座標の長さで、
   * 座標はそこで 0 に戻る（縫い目）。縫い目は見えにくいところ（腕・脚の内側）に置く
   */
  swatchUv: (i: number, g: Group, chart: number) => [number, number] | [number, number, number];
  /** 垂らす処理（ゆとりをつけたあと、切る前） */
  drape?: (p: Float32Array) => void;
  /** 本体（group 0）の頂点の範囲を写真のどこに当てるか [u0, v0, u1, v1]。省略時は写真全体 */
  photoRect?: [number, number, number, number];
  /**
   * 本体（写真1枚）を、生地の見本に切り替える割合（0: 写真、1: 見本）。side は頂点ごと（辺の上に作る点は両はしの間）、
   * band は写真の横の座標 u から決め、大きいほうを使う。
   * 本体の頂点に、割合（photoFade）と見本の座標（swatchUv。group 1 と同じ測り方）を持たせ、材質で混ぜる。
   * 前と背中の境目で 1 にすると、写真が背中の見本へ継ぎ目なくつながる
   */
  photoFade?: {
    side: (i: number) => number;
    band?: (u: number) => number;
    /** 前と背中を分ける fields の番号。その境目に作る点は見本だけ（1）にする */
    seam?: number;
  };
  /**
   * 見本の座標（group 1 と、本体の swatchUv）を、写真の柄に重ねる。写真の貼り方（本体の範囲と photoRect）から、
   * 見本を取ったところの3Dの位置と、見本1枚の3Dの大きさ（near の 0.6〜1.6 倍まで）を決めて、まっすぐ前から当てる。
   * plane があればその当て方を使う（上下2枚に分かれる服で、背中の模様を上下でつなげる）。
   * できた当て方は、返す geometry の userData.swatchPlane に入れる
   */
  swatchMatch?: SwatchMatch & { near: [number, number]; plane?: SwatchPlane };
  /** 重ね着（下に着た服より外へ出し、この服も覚える）。torso は腕でない頂点 */
  layers?: Layers;
  torso?: (i: number) => boolean;
}

/**
 * メッシュから服を切り出す。keep が 0 になるところで面を切り分けるので、切り口（すそ・えりぐり・袖口）は
 * メッシュの細かさのままなめらかな線になる。材質の境目（fields）も同じように切り分ける。
 * 返す geometry には材質グループが3つある（0: 前、1: 背中・脚、2: 袖）。
 */
export function cutPiece(
  mesh: HumanMesh,
  pos: Float32Array,
  spec: CutSpec,
): THREE.BufferGeometry | undefined {
  const n = pos.length / 3;
  // ゆとりは法線の向きに足すが、法線はならしてから使う（おしりの割れ目や脇の下のような狭い谷では、
  // 両側の法線が向かい合っていて、そのまま足すと両側の面が交差して折れ目やすき間になる）
  const normals = smoothNormals(vertexNormals(pos, mesh.index), mesh.index, 4);
  const p = new Float32Array(pos.length);
  for (let i = 0; i < n; i++) {
    const e = spec.ease(i);
    p[i * 3] = pos[i * 3] + normals[i * 3] * e;
    p[i * 3 + 1] = pos[i * 3 + 1] + normals[i * 3 + 1] * e;
    p[i * 3 + 2] = pos[i * 3 + 2] + normals[i * 3 + 2] * e;
  }
  spec.drape?.(p);
  if (spec.layers) {
    const torso: number[] = [];
    for (let i = 0; i < n; i++) if (!spec.torso || spec.torso(i)) torso.push(i);
    spec.layers.push(p, torso);
  }
  // 法線は切る前のメッシュ全体から取り、継ぎ目や切り口で陰影が途切れないようにする
  const full = vertexNormals(p, mesh.index);

  // 頂点ごとの値：位置3・法線3・keep・fields・写真から見本への割合。辺の上に作る点（番号は n から）は両はしの値の間
  const F = spec.fields ?? [];
  const fadeAt = 7 + F.length;
  const stride = fadeAt + 1;
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let e = 0; e < 3; e++) vals.push(p[i * 3 + e]);
    for (let e = 0; e < 3; e++) vals.push(full[i * 3 + e]);
    // 切り口の位置は両はしの値の比で決めるので、値は有限にしておく
    vals.push(clamp(spec.keep(i, p), -1e3, 1e3));
    for (const f of F) vals.push(clamp(f(i), -1e3, 1e3));
    vals.push(spec.photoFade ? clamp(spec.photoFade.side(i), 0, 1) : 0);
  }
  const from: number[] = []; // 作った点の両はし
  const ts: number[] = []; // 1つめのはしから、どれだけ進んだところか
  const made = new Map<number, number>();
  const SHIFT = 2 ** 20;
  /** 辺 a-b の上で、k 番めの値（0: keep、1〜: fields）が 0 になる点。となりの面と同じ点を使う */
  const point = (a: number, b: number, k: number): number => {
    const key = (k * SHIFT + Math.min(a, b)) * SHIFT + Math.max(a, b);
    let v = made.get(key);
    if (v === undefined) {
      const fa = vals[a * stride + 6 + k];
      const fb = vals[b * stride + 6 + k];
      const t = fa / (fa - fb);
      v = vals.length / stride;
      for (let e = 0; e < stride; e++) vals.push(lerp(vals[a * stride + e], vals[b * stride + e], t));
      vals[v * stride + 6 + k] = 0;
      if (k >= 1 && k - 1 === spec.photoFade?.seam) vals[v * stride + fadeAt] = 1;
      from.push(a, b);
      ts.push(t);
      made.set(key, v);
    }
    return v;
  };
  /** 多角形を、k 番めの値が 0 になる線で、正の側と負の側に分ける */
  const split = (poly: number[], k: number): [number[], number[]] => {
    const plus: number[] = [];
    const minus: number[] = [];
    for (let e = 0; e < poly.length; e++) {
      const u = poly[e];
      const w = poly[(e + 1) % poly.length];
      const su = vals[u * stride + 6 + k] >= 0;
      const sw = vals[w * stride + 6 + k] >= 0;
      (su ? plus : minus).push(u);
      if (su !== sw) {
        const q = point(u, w, k);
        plus.push(q);
        minus.push(q);
      }
    }
    return [plus, minus];
  };

  const tris: { v: number[]; g: Group; c: number }[] = [];
  const idx = mesh.index;
  for (let f = 0; f < idx.length; f += 3) {
    const tri = [idx[f], idx[f + 1], idx[f + 2]];
    const kept = tri.filter((v) => vals[v * stride + 6] >= 0).length;
    if (kept === 0) continue;
    let polys = [kept === 3 ? tri : split(tri, 0)[0]];
    for (let k = 1; k <= F.length; k++)
      polys = polys.flatMap((q) => split(q, k).filter((r) => r.length >= 3));
    for (const q of polys) {
      const positive = F.map((_, k) => {
        let s = 0;
        for (const v of q) s += vals[v * stride + 7 + k];
        return s >= 0;
      });
      const { g, chart } = spec.classify(positive);
      for (let k = 1; k + 1 < q.length; k++) tris.push({ v: [q[0], q[k], q[k + 1]], g, c: chart });
    }
  }
  if (tris.length === 0) return undefined;

  // 本体（写真1枚）の座標は、本体の頂点の範囲を写真の photoRect に当てる
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of tris) {
    if (t.g !== 0) continue;
    for (const v of t.v) {
      minX = Math.min(minX, vals[v * stride]);
      maxX = Math.max(maxX, vals[v * stride]);
      minY = Math.min(minY, vals[v * stride + 1]);
      maxY = Math.max(maxY, vals[v * stride + 1]);
    }
  }
  const w = Math.max(1e-3, maxX - minX);
  const h = Math.max(1e-3, maxY - minY);
  const [u0, v0, u1, v1] = spec.photoRect ?? [0, 0, 1, 1];
  /** 本体の写真の座標 */
  const photoUv = (v: number): [number, number] => [
    u0 + ((vals[v * stride] - minX) / w) * (u1 - u0),
    v0 + ((vals[v * stride + 1] - minY) / h) * (v1 - v0),
  ];
  // 見本を写真の柄に重ねる：写真の座標 at に当たる3Dの位置と、見本1枚の3Dの大きさ
  const match = spec.swatchMatch;
  const plane: SwatchPlane | undefined =
    match &&
    (match.plane ?? {
      x: minX + ((match.at[0] - u0) / (u1 - u0)) * w,
      y: minY + ((match.at[1] - v0) / (v1 - v0)) * h,
      tx: clamp((match.size[0] / (u1 - u0)) * w, match.near[0] * 0.6, match.near[0] * 1.6),
      ty: clamp((match.size[1] / (v1 - v0)) * h, match.near[1] * 0.6, match.near[1] * 1.6),
      at: match.tileAt,
    });
  /**
   * 写真の柄にぴったり重なる見本の座標（写真の座標 u, v から）。脇で写真から見本へ切り替えはじめるところでは、
   * 見本をこれに合わせて、写真の柄と見本の柄が二重に見えないようにする
   */
  const alongPhoto = (u: number, v: number): [number, number] => {
    const m = match!;
    if (m.grid) return gridAt(m.grid, u, v);
    return [m.tileAt[0] + (u - m.at[0]) / m.size[0], m.tileAt[1] + (v - m.at[1]) / m.size[1]];
  };
  /** 背中など（group 1）の見本の座標。写真に重ねるときは、まっすぐ前から当てる */
  const planeUv = (v: number): [number, number, number] =>
    plane
      ? [
          (vals[v * stride] - plane.x) / plane.tx + plane.at[0],
          (vals[v * stride + 1] - plane.y) / plane.ty + plane.at[1],
          0,
        ]
      : swatchUvAt(v, 1, 0);

  /** 生地の見本の座標。作った点は両はしの座標の間（縫い目をまたぐ辺は、1周ぶんずらしてから） */
  const swatchUvAt = (v: number, g: Group, ch: number): [number, number, number] => {
    if (v < n) {
      const r = spec.swatchUv(v, g, ch);
      return [r[0], r[1], r[2] ?? 0];
    }
    const j = v - n;
    const A = swatchUvAt(from[j * 2], g, ch);
    const B = swatchUvAt(from[j * 2 + 1], g, ch);
    const P = A[2] || B[2];
    let ua = A[0];
    const ub = B[0];
    if (P > 0 && Math.abs(ua - ub) > P / 2) ua += ua < ub ? P : -P;
    return [lerp(ua, ub, ts[j]), lerp(A[1], B[1], ts[j]), P];
  };
  /** 作った点のもとの頂点（腕かどうかを調べるため） */
  const origin = (v: number): number => (v < n ? v : origin(from[(v - n) * 2]));

  // 出力の頂点：同じ頂点でも、材質・区切り・縫い目のどちら側かが違えば別の頂点にする
  // （写真の座標と模様の座標が混ざってギザギザにならないように。縫い目で模様の座標が飛ぶように）
  const slot = new Map<number, number>();
  const outPos: number[] = [];
  const outNrm: number[] = [];
  const uv: number[] = [];
  const src: number[] = [];
  const fade: number[] = [];
  const fadeUv: number[] = [];
  const index: number[][] = [[], [], []];
  for (const t of tris) {
    let corner: [number, number, number][];
    let wrap = [false, false, false];
    if (t.g === 0) {
      corner = t.v.map((v) => [...photoUv(v), 0]);
    } else if (t.g === 1 && plane) {
      corner = t.v.map(planeUv);
    } else {
      corner = t.v.map((v) => swatchUvAt(v, t.g, t.c));
      const P = Math.max(corner[0][2], corner[1][2], corner[2][2]);
      if (P > 0) {
        const us = corner.map((q) => q[0]);
        const lo = Math.min(...us);
        const hi = Math.max(...us);
        // 縫い目をまたぐ面：0 に戻った側を1周ぶん先へ
        if (hi - lo > P / 2) {
          wrap = us.map((u) => u < (lo + hi) / 2);
          corner = corner.map((q, k) => (wrap[k] ? [q[0] + (q[2] || P), q[1], q[2]] : q));
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      const v = t.v[k];
      const key = v * 64 + t.g * 16 + t.c * 2 + (wrap[k] ? 1 : 0);
      let o = slot.get(key);
      if (o === undefined) {
        o = src.length;
        slot.set(key, o);
        for (let e = 0; e < 6; e++) (e < 3 ? outPos : outNrm).push(vals[v * stride + e]);
        uv.push(corner[k][0], corner[k][1]);
        src.push(origin(v));
        if (spec.photoFade) {
          if (t.g === 0) {
            const band = spec.photoFade.band?.(corner[k][0]) ?? 0;
            const a = Math.max(vals[v * stride + fadeAt], clamp(band, 0, 1));
            fade.push(a);
            // 見本の座標：写真が見えているあいだは写真の柄に重ね（二重に見えないように）、写真がほとんど消えてから、
            // 見本だけになるところ（前と背中の境目）で背中と同じ座標になるように移す
            const f = planeUv(v);
            if (match) {
              const [pu, pv] = alongPhoto(corner[k][0], corner[k][1]);
              const b = smooth((a - 0.75) / 0.25);
              fadeUv.push(lerp(pu, f[0], b), lerp(pv, f[1], b));
            } else fadeUv.push(f[0], f[1]);
          } else {
            fade.push(0);
            fadeUv.push(0, 0);
          }
        }
      }
      index[t.g].push(o);
    }
  }
  const nrm = new Float32Array(outNrm);
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l;
    nrm[i + 1] /= l;
    nrm[i + 2] /= l;
  }
  const positions = new Float32Array(outPos);
  const all = new Uint32Array([...index[0], ...index[1], ...index[2]]);
  if (spec.layers)
    spec.layers.add(positions, all, (j) => !spec.torso || spec.torso(src[j]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  if (spec.photoFade) {
    geo.setAttribute("photoFade", new THREE.BufferAttribute(new Float32Array(fade), 1));
    geo.setAttribute("swatchUv", new THREE.BufferAttribute(new Float32Array(fadeUv), 2));
  }
  geo.setIndex(new THREE.BufferAttribute(all, 1));
  geo.addGroup(0, index[0].length, 0);
  geo.addGroup(index[0].length, index[1].length, 1);
  geo.addGroup(index[0].length + index[1].length, index[2].length, 2);
  if (plane) geo.userData.swatchPlane = plane;
  return geo;
}

const SECTORS = 32;

/**
 * 「垂らす」：軸のまわりで、上のいちばん出たところより内側に入らないようにする（服は体の凹みに沿わず、まっすぐ落ちる）。
 * startY より上で基準の太さを覚え、それより下に適用する。
 */
function drapeAround(
  p: Float32Array,
  verts: number[],
  axis: (y: number) => [number, number],
  startY: number,
  keepRatio: number,
  slack: number,
) {
  const order = [...verts].sort((a, b) => p[b * 3 + 1] - p[a * 3 + 1]);
  const maxR = new Float32Array(SECTORS);
  for (const i of order) {
    const y = p[i * 3 + 1];
    const [cx, cz] = axis(y);
    const dx = p[i * 3] - cx;
    const dz = p[i * 3 + 2] - cz;
    const r = Math.hypot(dx, dz);
    const sec =
      ((Math.floor((Math.atan2(dz, dx) / (Math.PI * 2)) * SECTORS) % SECTORS) +
        SECTORS) %
      SECTORS;
    if (y > startY) {
      maxR[sec] = Math.max(maxR[sec], r);
      continue;
    }
    const m = Math.max(
      maxR[sec],
      (maxR[(sec + SECTORS - 1) % SECTORS] + maxR[(sec + 1) % SECTORS]) / 2,
    );
    const r2 = Math.max(r, m * keepRatio - slack);
    if (r2 > r && r > 1e-6) {
      const k = r2 / r;
      p[i * 3] = cx + dx * k;
      p[i * 3 + 2] = cz + dz * k;
    }
    maxR[sec] = Math.max(maxR[sec], r2);
  }
}

/**
 * 「橋をかける」：水平に輪切りにしたとき、布はくぼみ（背骨の溝・おしりの割れ目・胸の下）に入らず、
 * 出っぱりから出っぱりへまっすぐ渡る。輪切りごとに凸包（輪ゴムをかけた形）を作り、その内側の頂点を外へ出す。
 * 輪切りは上下に少し重ねて取り、頂点の少ない段でも形が欠けないようにする。
 */
function bridgeSlices(
  p: Float32Array,
  verts: number[],
  axis: (y: number) => [number, number],
  keepRatio: number,
): number[] {
  if (verts.length < 3) return [];
  const order = [...verts].sort((a, b) => p[a * 3 + 1] - p[b * 3 + 1]);
  const ys = order.map((i) => p[i * 3 + 1]);
  const STEP = 0.005;
  const HALF = 0.012;
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  // 段ごとの凸包（点は軸からの横 x・奥行き dz）
  const hulls: [number, number][][] = [];
  let lo = 0;
  let hi = 0;
  for (let k = 0; y0 + k * STEP <= y1 + STEP; k++) {
    const yc = y0 + k * STEP;
    while (lo < order.length && ys[lo] < yc - HALF) lo++;
    while (hi < order.length && ys[hi] <= yc + HALF) hi++;
    const pts: [number, number][] = [];
    for (let q = lo; q < hi; q++) {
      const i = order[q];
      const [cx, cz] = axis(p[i * 3 + 1]);
      pts.push([p[i * 3] - cx, p[i * 3 + 2] - cz]);
    }
    hulls.push(convexHull(pts));
  }
  const moved: [number, number, number][] = [];
  for (const i of verts) {
    const y = p[i * 3 + 1];
    const hull = hulls[clamp(Math.round((y - y0) / STEP), 0, hulls.length - 1)];
    if (hull.length < 3) continue;
    const [cx, cz] = axis(y);
    const dx = p[i * 3] - cx;
    const dz = p[i * 3 + 2] - cz;
    const r = Math.hypot(dx, dz);
    if (r < 1e-6) continue;
    const reach = rayToHull(hull, dx / r, dz / r);
    if (reach * keepRatio > r) moved.push([i, cx + (dx / r) * reach * keepRatio, cz + (dz / r) * reach * keepRatio]);
  }
  // 計算し終えてから動かす（動かした点で次の凸包が変わらないように）
  const out: number[] = [];
  for (const [i, x, z] of moved) {
    if (Math.hypot(p[i * 3] - x, p[i * 3 + 2] - z) > 0.002) out.push(i);
    p[i * 3] = x;
    p[i * 3 + 2] = z;
  }
  return out;
}

/**
 * 大きく動かした頂点を、まわりの（動かしていない）頂点のあいだに膜を張るようにならす。
 * くぼみの壁を外へ押し出すと、壁の面どうしが重なって裏返ることがあるので、それをほどく。
 * 体（ゆとりをつけた面）より内側には戻さない。
 */
function relax(
  p: Float32Array,
  verts: number[],
  nb: { start: Int32Array; adj: Int32Array },
  axis: (y: number) => [number, number],
  times: number,
) {
  if (!verts.length) return;
  const floor = new Float32Array(verts.length);
  verts.forEach((i, q) => {
    const [cx, cz] = axis(p[i * 3 + 1]);
    floor[q] = Math.hypot(p[i * 3] - cx, p[i * 3 + 2] - cz);
  });
  const next = new Float32Array(verts.length * 3);
  for (let t = 0; t < times; t++) {
    verts.forEach((i, q) => {
      let x = 0;
      let y = 0;
      let z = 0;
      let c = 0;
      for (let k = nb.start[i]; k < nb.start[i + 1]; k++) {
        const j = nb.adj[k];
        x += p[j * 3];
        y += p[j * 3 + 1];
        z += p[j * 3 + 2];
        c++;
      }
      if (!c) {
        next[q * 3] = p[i * 3];
        next[q * 3 + 1] = p[i * 3 + 1];
        next[q * 3 + 2] = p[i * 3 + 2];
        return;
      }
      next[q * 3] = x / c;
      next[q * 3 + 1] = y / c;
      next[q * 3 + 2] = z / c;
    });
    verts.forEach((i, q) => {
      let x = next[q * 3];
      const y = next[q * 3 + 1];
      let z = next[q * 3 + 2];
      const [cx, cz] = axis(y);
      const r = Math.hypot(x - cx, z - cz);
      if (r < floor[q] && r > 1e-6) {
        x = cx + ((x - cx) / r) * floor[q];
        z = cz + ((z - cz) / r) * floor[q];
      }
      p[i * 3] = x;
      p[i * 3 + 1] = y;
      p[i * 3 + 2] = z;
    });
  }
}

/** 平面の点の凸包（反時計回り） */
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const a = [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: [number, number], p: [number, number], q: [number, number]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of a) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = a.length - 1; i >= 0; i--) {
    const p = a[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 原点から向き (ux, uz) に進んで凸包のふちに着くまでの距離（原点が外なら 0） */
function rayToHull(hull: [number, number][], ux: number, uz: number): number {
  let best = 0;
  for (let k = 0; k < hull.length; k++) {
    const [ax, az] = hull[k];
    const [bx, bz] = hull[(k + 1) % hull.length];
    // 原点 + t*u = a + s*(b-a)
    const ex = bx - ax;
    const ez = bz - az;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ez - az * ex) / den;
    const sPar = (ax * uz - az * ux) / den;
    if (t > 0 && sPar >= -1e-6 && sPar <= 1 + 1e-6) best = Math.max(best, t);
  }
  return best;
}

/** 服1着ぶんの切り出し結果 */
export interface Piece {
  geometry: THREE.BufferGeometry;
  /** 本体の材質（group 0）に写真を1枚貼るか、生地の模様にするか */
  body: UvMode;
}

interface Ctx {
  human: Human;
  fit: Fitted;
  m: Marks;
  /** 生地の見本1枚が3Dでどの大きさになるか [横, 縦]（身長＝1）。胴・脚用と袖用 */
  tile: [number, number];
  sleeveTile: [number, number];
  layers?: Layers;
  /** 見本を写真の柄に重ねる対応（写真がなければなし） */
  match?: SwatchMatch;
  /**
   * 写真の左右のはしから、袖が写っている幅（写真の横の座標で）。ハンガーにかけた写真は袖が胴の脇に垂れて写るので、
   * そこは写真を使わず生地の見本にする
   */
  sleeveBand: number;
}

/**
 * 本体（写真1枚）を脇に向かって生地の見本に切り替える割合（cutPiece の photoFade）。
 * 体の上の位置の、胴の軸のまわりの向き（前のまん中が 0、真横が 1）で from から to にかけて写真から見本へ移り、
 * 真横の少し手前で見本だけになる（前と背中の境目も体の上の位置で決めているので、境目ではちょうど見本だけ）。
 * 写真の左右のはしの袖が写っているところ（はしから sleeveBand まで）も見本にする
 */
function sideFade(ctx: Ctx, pos: Float32Array, seam: number, from: number, to: number): CutSpec["photoFade"] {
  const { m, sleeveBand: band } = ctx;
  return {
    seam,
    side: (i) => {
      const a = Math.atan2(Math.abs(pos[i * 3]), pos[i * 3 + 2] - m.torsoCz(pos[i * 3 + 1])) / (Math.PI / 2);
      return smooth((a - from) / (to - from));
    },
    band: band > 0 ? (u) => Math.max(smooth((band - u) / 0.08), smooth((u - (1 - band)) / 0.08)) : undefined,
  };
}

/** 胴の頂点（腕を除く）。belowY より下だけ */
function torsoVerts(
  mesh: HumanMesh,
  pos: Float32Array,
  aux: Aux,
  belowY: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < mesh.parts.length / 4; i++) {
    if (
      mesh.parts[i * 4 + 1] < 0.5 &&
      aux.armK[i] < 0.02 &&
      pos[i * 3 + 1] < belowY
    )
      out.push(i);
  }
  return out;
}

/**
 * えりぐり：首のまわりの、なめらかな1本の線。
 * 形は正面から見て決める：前はのどの下のくぼみより少し下を底にした丸い U 字（だ円の弧）で、
 * 首の付け根の少し外（肩の上）まで上がる。後ろも同じ形で浅い。
 * これを服の面の上の線にするため、首の軸のまわりの向き θ ごとに「高さ − 首の軸からの距離」
 * （首に近く高いほど大きい）の境の値を決めて、それより大きいところを切る。境の値は、
 * U 字の上の点を服の面に写したところで測る。胸のような立った面でも、肩の上のような寝た面でも、なめらかな線になる
 */
export interface Neckline {
  /** 首の軸（前後の位置） */
  cz: number;
  /** えりぐりの前のいちばん下・横（肩の上）・後ろのいちばん下の点 [x, y, z]（服の上の位置） */
  front: V3;
  side: V3;
  back: V3;
  /** その場所（服の上の位置）を残すか（正なら残す） */
  keep: (x: number, y: number, z: number) => number;
}

/** 境の値の表の細かさ（前から後ろまで） */
const NECK_BINS = 64;

/** 首の骨の重み（胴・腕・脚・頭のどれでもない残り） */
const neckWeight = (mesh: HumanMesh, i: number) =>
  Math.max(0, 1 - mesh.parts[i * 4] - mesh.parts[i * 4 + 1] - mesh.parts[i * 4 + 2] - mesh.parts[i * 4 + 3]);

/** 服の面を正面から見て (x, y) のところの、いちばん手前（dir=1）またはいちばん奥（dir=-1）の z */
function surfaceZ(
  cloth: Float32Array,
  index: ArrayLike<number>,
  use: (v: number) => boolean,
  x: number,
  y: number,
  dir: 1 | -1,
): number | undefined {
  let best = -Infinity;
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f];
    const b = index[f + 1];
    const c = index[f + 2];
    const ax = cloth[a * 3];
    const ay = cloth[a * 3 + 1];
    const bx = cloth[b * 3];
    const by = cloth[b * 3 + 1];
    const cx = cloth[c * 3];
    const cy = cloth[c * 3 + 1];
    if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx)) continue;
    if (y < Math.min(ay, by, cy) || y > Math.max(ay, by, cy)) continue;
    if (!use(a) || !use(b) || !use(c)) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
    const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
    const wc = 1 - wa - wb;
    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
    const z = wa * cloth[a * 3 + 2] + wb * cloth[b * 3 + 2] + wc * cloth[c * 3 + 2];
    best = Math.max(best, z * dir);
  }
  return Number.isFinite(best) ? best * dir : undefined;
}

export function neckline(
  mesh: HumanMesh,
  pos: Float32Array,
  cloth: Float32Array,
  m: Marks,
  opts: { drop: number; open: number; ease: number; v?: boolean; backDrop?: number },
): Neckline {
  const n = pos.length / 3;
  const cz = m.neckCz;
  const body = (i: number) => mesh.parts[i * 4 + 3] < 0.5 && mesh.parts[i * 4 + 1] < 0.5;
  // 前の基準：のどの下のくぼみ（胸から上へ見て、体の前の面がいちばん奥に入るところ）
  let notchY = m.shoulderY;
  let notchZ = Infinity;
  for (let y = m.chestY - 0.01; y <= m.neckY - 0.01; y += 0.003) {
    const z = surfaceZ(pos, mesh.index, body, 0, y, 1);
    // 首の前の面がないところ（タイツの首の上のふち）では、後ろの面を拾うので使わない
    if (z === undefined || z < cz + 0.01) break;
    if (z < notchZ) {
      notchZ = z;
      notchY = y;
    }
  }
  // 横：首の付け根（首の柱から肩の上の面に変わるところ）。横から見た服の上の輪郭（首の軸の
  // 左右の面）を内から外へたどって、首の骨の重みが半分を切るところ。そこから open だけ外
  const prof: [number, number, number][] = [];
  {
    const top = new Map<number, [number, number, number]>();
    for (let i = 0; i < n; i++) {
      if (!body(i) || Math.abs(cloth[i * 3 + 2] - cz) > 0.012) continue;
      const ax = Math.abs(cloth[i * 3]);
      if (ax < m.neckHalfW * 0.6 || ax > m.neckHalfW * 3.5) continue;
      const b = Math.round(ax / 0.004);
      const cur = top.get(b);
      if (!cur || cloth[i * 3 + 1] > cur[1]) top.set(b, [ax, cloth[i * 3 + 1], neckWeight(mesh, i)]);
    }
    prof.push(...[...top.values()].sort((p, q) => p[0] - q[0]));
  }
  /** 横から見た服の上の輪郭の高さ（|x| のところ） */
  const profY = (x: number) => {
    let k = 0;
    while (k + 2 < prof.length && prof[k + 1][0] < x) k++;
    const [x0, y0] = prof[k];
    const [x1, y1] = prof[k + 1];
    return y0 + ((y1 - y0) * clamp((x - x0) / Math.max(1e-6, x1 - x0), 0, 1));
  };
  let rS = m.neckHalfW + 0.02;
  for (let k = 1; k < prof.length; k++) {
    const [x0, , w0] = prof[k - 1];
    const [x1, , w1] = prof[k];
    if (x0 > m.neckHalfW && w0 >= 0.5 && w1 < 0.5) {
      rS = x0 + ((x1 - x0) * (w0 - 0.5)) / (w0 - w1);
      break;
    }
  }
  rS += opts.open;
  const sy = prof.length >= 2 ? profY(rS) : m.shoulderY + 0.04;
  const fy = Math.min(notchY - opts.drop, sy - 0.03);
  const by = sy - (opts.backDrop ?? 0.022);
  /**
   * 正面（後ろ）から見た、えりぐりの高さ。x=0 で底、|x|=rS で横の高さ（だ円の弧）。
   * V ネックの前は、底から横へまっすぐ（上のほうだけ少し丸める）
   */
  const arc = (bottom: number, x: number, v = false) => {
    const u = Math.min(1, Math.abs(x) / rS);
    if (v) return bottom + (sy - bottom) * (u * 0.85 + 0.15 * (1 - Math.sqrt(1 - u * u)));
    return bottom + (sy - bottom) * (1 - Math.sqrt(1 - u * u));
  };
  // U 字の上の点を服の面に写して、向きと境の値を測る
  const samples: [number, number][] = [[0.5, sy - rS]];
  const J = 16;
  for (const dir of [1, -1] as const)
    for (let j = 0; j < J; j++) {
      const x = (rS * j) / J;
      const y = arc(dir === 1 ? fy : by, x, dir === 1 && opts.v);
      const z = surfaceZ(cloth, mesh.index, body, x, y, dir);
      if (z === undefined) continue;
      const a = Math.atan2(x, z - cz) / Math.PI;
      // 横（0.5）を越えて反対側に回ったものは使わない
      if (dir === 1 ? a >= 0.5 : a <= 0.5) continue;
      samples.push([a, y - Math.hypot(x, z - cz)]);
    }
  samples.sort((p, q) => p[0] - q[0]);
  const table = new Float64Array(NECK_BINS + 1);
  for (let b = 0; b <= NECK_BINS; b++) {
    const a = b / NECK_BINS;
    let k = 0;
    while (k + 1 < samples.length && samples[k + 1][0] < a) k++;
    const [a0, q0] = samples[k];
    const [a1, q1] = samples[Math.min(samples.length - 1, k + 1)];
    table[b] = a <= a0 ? q0 : a >= a1 ? q1 : q0 + ((q1 - q0) * (a - a0)) / (a1 - a0);
  }
  const front: V3 = [0, fy, (surfaceZ(cloth, mesh.index, body, 0, fy, 1) ?? cz + 0.05)];
  const back: V3 = [0, by, (surfaceZ(cloth, mesh.index, body, 0, by, -1) ?? cz - 0.05)];
  return {
    cz,
    front,
    side: [rS, sy, cz],
    back,
    keep: (x, y, z) => {
      const d = Math.hypot(x, z - cz);
      const a = (Math.atan2(Math.abs(x), z - cz) / Math.PI) * NECK_BINS;
      const b = Math.min(NECK_BINS - 1, Math.floor(a));
      const t = a - b;
      return table[b] * (1 - t) + table[b + 1] * t - (y - d);
    },
  };
}

/** えりの形ごとの、えりぐりの深さ（前をのどの下のくぼみから下げる）・広さ（横を首の付け根から外へ）・後ろの深さ */
const NECKLINE: Record<"top" | "outer" | "dress", Partial<Record<Neck, { drop: number; open: number; back?: number; v?: boolean }>> & { default: { drop: number; open: number } }> = {
  top: {
    default: { drop: 0.008, open: 0 },
    plain: { drop: 0.012, open: 0.003 },
    v: { drop: 0.055, open: 0, v: true },
    collar: { drop: -0.004, open: -0.006, back: 0.016 },
    stand: { drop: -0.006, open: -0.008, back: 0.014 },
    hood: { drop: 0.01, open: 0 },
  },
  outer: {
    default: { drop: 0.03, open: 0.008 },
    stand: { drop: 0.012, open: 0.004, back: 0.018 },
    collar: { drop: 0.004, open: 0.002, back: 0.016 },
    hood: { drop: 0.02, open: 0.006 },
    v: { drop: 0.09, open: 0.004, v: true },
    lapel: { drop: 0.13, open: 0.006, back: 0.016, v: true },
  },
  dress: {
    default: { drop: 0.025, open: 0.006 },
    collar: { drop: -0.002, open: -0.004, back: 0.016 },
    v: { drop: 0.06, open: 0.004, v: true },
  },
};

/** 上半身の服（トップス・アウター・ワンピースの上）をタイツから切り出す。えりがあれば、えりも */
function upperPiece(
  ctx: Ctx,
  opts: {
    hemY: number;
    sleeve: number;
    ease: number;
    /** えりの形と、えりぐりの深さ・広さ */
    neck: Neck;
    neckline: { drop: number; open: number; back?: number; v?: boolean };
    puffy?: boolean;
    photoRect?: [number, number, number, number];
    /** 写真から見本へ切り替える向きの範囲（sideFade） */
    fade: [number, number];
    drape: boolean;
    swatchBody?: boolean;
  },
): Piece[] {
  const { human, fit, m } = ctx;
  const mesh = human.tights;
  const pos = fit.tights;
  const aux = fit.aux.tights;
  const sleeve = opts.sleeve;
  const isArm = (i: number) => mesh.parts[i * 4 + 1] >= 0.5;
  // えりぐりは、ゆとりをつけて垂らしたあとの服の形で決める（最初に keep を呼ぶとき）
  let neck: Neckline | undefined;
  const armLen = Math.hypot(
    m.wrist[0][0] - m.shoulder[0][0],
    m.wrist[0][1] - m.shoulder[0][1],
    m.wrist[0][2] - m.shoulder[0][2],
  );
  const spec: CutSpec = {
    keep: (i, at) => {
      // 腕はすそでは切らない（長袖の手首はすそより下にある）
      neck ??= neckline(mesh, pos, at, m, {
        drop: opts.neckline.drop,
        open: opts.neckline.open,
        backDrop: opts.neckline.back,
        v: opts.neckline.v,
        ease: opts.ease,
      });
      let c = neck.keep(at[i * 3], at[i * 3 + 1], at[i * 3 + 2]);
      if (!isArm(i)) c = Math.min(c, at[i * 3 + 1] - opts.hemY);
      const k = aux.armK[i];
      if (k >= 0) c = Math.min(c, sleeve - k);
      return c;
    },
    ease: (i) => (isArm(i) ? opts.ease * 0.85 : opts.ease),
    // 腕か（骨の重み）・前か（胴の軸より前）・左か。袖は左右で別に測る。
    // 背中は写真の裏返しではなく生地の見本にする（前のプリントやボタンが背中に出ないように）
    fields: [
      (i) => mesh.parts[i * 4 + 1] - 0.5,
      (i) => pos[i * 3 + 2] - m.torsoCz(pos[i * 3 + 1]),
      (i) => pos[i * 3],
    ],
    classify: ([arm, front, left]) =>
      arm
        ? { g: 2, chart: left ? 1 : 0 }
        : { g: opts.swatchBody || !front ? 1 : 0, chart: 0 },
    swatchUv: (i, g, chart) => {
      if (g === 2) {
        // 腕のまわり（上腕は太く、手首は細い）と、肩からの長さ。
        // 肩の丸み（腕の付け根より上、k が負）もそのまま長さにする（0 でそろえると模様が筋に伸びる）。
        // まわりの縫い目は腕の内側（体に向いた側。右腕は角度 0.5、左腕は 0）
        const k = aux.armK[i];
        const around = lerp(0.18, 0.13, clamp(k, 0, 1));
        const [tx, ty] = ctx.sleeveTile;
        const a = (((aux.armAngle[i] - (chart === 0 ? 0.5 : 0)) % 1) + 1) % 1;
        return [(a * around) / tx, (k * armLen) / ty, around / tx];
      }
      // 背中：後ろから見た平面に貼る
      return [pos[i * 3] / ctx.tile[0], pos[i * 3 + 1] / ctx.tile[1]];
    },
    drape: opts.drape
      ? (p) => {
          const verts = torsoVerts(mesh, pos, aux, m.shoulderY);
          const axis = (y: number): [number, number] => [0, m.torsoCz(y)];
          const moved = bridgeSlices(p, verts, axis, 0.995);
          relax(p, moved, neighbors(mesh.index, pos.length / 3), axis, 12);
          drapeAround(
            p,
            verts.filter((i) => pos[i * 3 + 1] < m.chestY + 0.02),
            axis,
            m.chestY - 0.03,
            0.985,
            0.002,
          );
        }
      : undefined,
    photoRect: opts.photoRect,
    photoFade: sideFade(ctx, pos, 1, opts.fade[0], opts.fade[1]),
    swatchMatch: ctx.match && { ...ctx.match, near: ctx.tile },
    layers: ctx.layers,
    torso: (i) => !isArm(i),
  };
  const geometry = cutPiece(mesh, pos, spec);
  if (!geometry) return [];
  const out: Piece[] = [{ geometry, body: opts.swatchBody ? "swatch" : "whole" }];
  // えり：えりぐりのふちに沿って作り、重ね着の上の服がえりの外に来るように覚える
  const bodyMesh = human.body;
  const layers = ctx.layers;
  const collar = buildCollar(opts.neck, {
    cloth: geometry,
    cz: m.neckCz,
    body: fit.body,
    bodyUse: (i) => bodyMesh.parts[i * 4 + 1] < 0.5 && bodyMesh.parts[i * 4 + 3] < 0.5,
    tile: ctx.tile,
    puffy: opts.puffy,
    // 下に着た服のえりより外へ（首の軸から測る。胴の重ね着の表は粗くて、えりには使えない）
    outside: layers && ((x, y, z) => layers.neckOuter(x, y, z, m.neckCz)),
  });
  if (collar) {
    if (layers) {
      const cp = collar.getAttribute("position").array as Float32Array;
      layers.addNeck(cp, m.neckCz);
      layers.add(cp, collar.getIndex()!.array, () => true);
    }
    out.push({ geometry: collar, body: "swatch" });
  }
  return out;
}

/** スカート（またはコート・ワンピースの下半分）をスカートのメッシュから切り出す */
function skirtPiece(
  ctx: Ctx,
  opts: {
    hemY: number;
    ease: number;
    flare: number;
    swatchBody?: boolean;
    photoRect?: [number, number, number, number];
    fade?: [number, number];
    /** 上半分（upperPiece）の見本の当て方。背中の模様を上下でつなげる */
    plane?: SwatchPlane;
  },
): Piece | undefined {
  const { human, fit, m } = ctx;
  const mesh = human.skirt;
  const pos = fit.skirt;
  const spec: CutSpec = {
    keep: (i, at) => at[i * 3 + 1] - opts.hemY,
    // 下に向かって少し広がる
    ease: (i) => opts.ease + Math.max(0, m.hipY - pos[i * 3 + 1]) * opts.flare,
    // 後ろ半分は生地の見本
    fields: [(i) => pos[i * 3 + 2] - m.torsoCz(pos[i * 3 + 1])],
    classify: ([front]) => ({ g: opts.swatchBody || !front ? 1 : 0, chart: 0 }),
    swatchUv: (i) => [pos[i * 3] / ctx.tile[0], pos[i * 3 + 1] / ctx.tile[1]],
    photoRect: opts.photoRect,
    photoFade: opts.fade && sideFade(ctx, pos, 0, opts.fade[0], opts.fade[1]),
    swatchMatch: opts.fade && ctx.match && { ...ctx.match, near: ctx.tile, plane: opts.plane },
    layers: ctx.layers,
  };
  const geometry = cutPiece(mesh, pos, spec);
  return geometry && { geometry, body: opts.swatchBody ? "swatch" : "whole" };
}

/** パンツ（腰から脚）をタイツから切り出す */
function pantsPiece(
  ctx: Ctx,
  opts: { to: number; ease: (t: number) => number; drape: number },
): Piece | undefined {
  const { human, fit, m } = ctx;
  const mesh = human.tights;
  const pos = fit.tights;
  const aux = fit.aux.tights;
  const legAxis = (s: 0 | 1) => {
    const hip = m.hip[s];
    const ankle = m.foot[s].ankle;
    return (y: number): [number, number] => {
      const t = clamp((hip[1] - y) / Math.max(1e-3, hip[1] - ankle[1]), 0, 1);
      return [lerp(hip[0], ankle[0], t), lerp(hip[2], ankle[2], t)];
    };
  };
  const legT = (i: number) => aux.legT[i];
  const spec: CutSpec = {
    keep: (i) => {
      if (mesh.parts[i * 4 + 1] >= 0.5 || aux.armK[i] >= 0.05) return -1;
      const y = pos[i * 3 + 1];
      const t = legT(i);
      let c = m.waistY - y;
      if (t > -8) c = Math.min(c, opts.to - t);
      return c;
    },
    ease: (i) => opts.ease(clamp(legT(i), 0, 1)),
    // 左右の脚で別に測る（まん中の前と後ろが、本物のパンツと同じく縫い目になる）
    fields: [(i) => pos[i * 3]],
    classify: ([left]) => ({ g: 1, chart: left ? 1 : 0 }),
    swatchUv: (i, _g, chart) => {
      const t = clamp(legT(i), 0, 1);
      const y = pos[i * 3 + 1];
      const [cx, cz] = legAxis(chart as 0 | 1)(y);
      const a0 = Math.atan2(pos[i * 3 + 2] - cz, pos[i * 3] - cx) / (Math.PI * 2) + 0.5;
      // まわりの縫い目は脚の内側（右脚は角度 0.5、左脚は 0）
      const a = (((a0 - (chart === 0 ? 0.5 : 0)) % 1) + 1) % 1;
      // 脚のまわり（太ももは太く、足首は細い）と、股からの長さ
      const around = lerp(0.3, 0.2, t);
      const [tx, ty] = ctx.tile;
      return [(a * around) / tx, (m.crotchY - y) / ty, around / tx];
    },
    drape:
      opts.drape > 0
        ? (p) => {
            for (const s of [0, 1] as const) {
              const verts: number[] = [];
              for (let i = 0; i < mesh.parts.length / 4; i++) {
                if (
                  mesh.parts[i * 4 + 2] >= 0.5 &&
                  legT(i) >= 0.08 &&
                  (pos[i * 3] < 0 ? 0 : 1) === s
                )
                  verts.push(i);
              }
              drapeAround(
                p,
                verts,
                legAxis(s),
                lerp(m.crotchY, m.ankleY, 0.2),
                opts.drape,
                0.002,
              );
            }
          }
        : undefined,
    layers: ctx.layers,
    torso: (i) => mesh.parts[i * 4 + 1] < 0.5,
  };
  const geometry = cutPiece(mesh, pos, spec);
  return geometry && { geometry, body: "swatch" };
}

/** 下着がわりの薄い一枚（体の3Dだけを見るときや、服が足りないとき用） */
export function underwear(
  human: Human,
  fit: Fitted,
): THREE.BufferGeometry | undefined {
  const m = fit.marks;
  const mesh = human.tights;
  const pos = fit.tights;
  const aux = fit.aux.tights;
  const spec: CutSpec = {
    keep: (i) => {
      if (mesh.parts[i * 4 + 1] >= 0.5) return -1;
      const y = pos[i * 3 + 1];
      let c = Math.min(m.shoulderY - 0.045 - y, y - (m.crotchY - 0.0));
      const t = aux.legT[i];
      if (t > -8) c = Math.min(c, 0.2 - t);
      if (aux.armK[i] >= 0) c = Math.min(c, 0.03 - aux.armK[i]);
      return c;
    },
    ease: () => 0.0025,
    classify: () => ({ g: 1, chart: 0 }),
    swatchUv: () => [0, 0],
  };
  return cutPiece(mesh, pos, spec);
}

/** 服1着ぶんのメッシュ（靴以外）。重ね着の順に呼ぶ */
export function garmentPieces(
  human: Human,
  fit: Fitted,
  shape: LookShape,
  photo: {
    bodyU?: [number, number];
    tile?: [number, number];
    sleeveTile?: [number, number];
    swatchMatch?: SwatchMatch;
  } = {},
  layers?: Layers,
): Piece[] {
  const m = fit.marks;
  // 生地の見本の大きさ：写真の中で見本が基準の幅（胴の幅、ボトムスは腰の幅）の何倍かを、3Dの同じ幅に掛ける
  const lower = shape.kind === "pants" || shape.kind === "skirt";
  const ref = lower ? m.torsoWidth(m.hipY) : m.torsoWidth(m.chestY);
  const toTile = (f: [number, number] | undefined): [number, number] => {
    const [fx, fy] = f ?? [0.3, 0.3];
    const tx = clamp(fx * ref, 0.03, 0.2);
    return [tx, clamp((tx * fy) / Math.max(1e-6, fx), 0.02, 0.3)];
  };
  // 写真の横方向のうち胴に当たる範囲（袖を除いたところ）。写真がなければ全体
  const [bu0, bu1] = photo.bodyU ?? [0, 1];
  // ハンガーにかけた写真は袖が胴の脇に垂れて写り、胴の範囲が服の幅いっぱいに見つかる。
  // 長袖の服でそうなっていたら、写真の左右のはし（袖が写っているところ）は生地の見本にする
  const longSleeves =
    shape.kind === "outer" ? shape.sleeve !== "none" : (shape.kind === "top" || shape.kind === "dress") && shape.sleeve === "long";
  const ctx: Ctx = {
    human,
    fit,
    m,
    tile: toTile(photo.tile),
    sleeveTile: toTile(photo.sleeveTile ?? photo.tile),
    layers,
    match: photo.swatchMatch,
    sleeveBand: longSleeves && photo.bodyU ? 0.24 * smooth((bu1 - bu0 - 0.72) / 0.14) : 0,
  };
  const sleeveLen = (s: "none" | "short" | "long") =>
    s === "none" ? 0.04 : s === "short" ? 0.3 : 0.96;
  /** 写真から見本へ切り替える向きの範囲。上着は写真のはしに影や厚みが写りやすいので、早めに切り替える */
  const TOP_FADE: [number, number] = [0.68, 0.95];
  const OUTER_FADE: [number, number] = [0.6, 0.94];
  /** 上下2枚に分かれる服（コート・ワンピース）で、写真を腰の高さで上下に分ける */
  const split = (
    upperHem: number,
    lowerHem: number,
  ): [[number, number, number, number], [number, number, number, number]] => {
    const v = (upperHem - lowerHem) / (m.neckY - lowerHem);
    return [
      [bu0, v, bu1, 1],
      [0, 0, 1, v],
    ];
  };
  switch (shape.kind) {
    case "top": {
      const hemY =
        shape.hem === "short"
          ? m.waistY
          : shape.hem === "long"
            ? m.crotchY - 0.07
            : m.crotchY + 0.015;
      const neck = shape.neck ?? "crew";
      return upperPiece(ctx, {
        hemY,
        sleeve: sleeveLen(shape.sleeve),
        ease: 0.011,
        neck,
        neckline: NECKLINE.top[neck] ?? NECKLINE.top.default,
        drape: true,
        photoRect: [bu0, 0, bu1, 1],
        fade: TOP_FADE,
      });
    }
    case "outer": {
      const ease = shape.puffy ? 0.032 : 0.017;
      // ベストは袖なし（袖ぐりまで）
      const sleeve = shape.sleeve === "none" ? sleeveLen("none") : 0.97;
      const neck = shape.neck ?? "stand";
      const neckline = NECKLINE.outer[neck] ?? NECKLINE.outer.default;
      const pieces: (Piece | undefined)[] = [];
      if (shape.length === "short")
        pieces.push(
          ...upperPiece(ctx, {
            hemY: m.crotchY - 0.01,
            sleeve,
            ease,
            neck,
            neckline,
            puffy: shape.puffy,
            drape: true,
            photoRect: [bu0, 0, bu1, 1],
            fade: OUTER_FADE,
          }),
        );
      else {
        const hemY =
          shape.length === "middle" ? m.crotchY - 0.17 : m.crotchY - 0.3;
        const upperHem = m.crotchY + 0.02;
        const [upRect, lowRect] = split(upperHem, hemY);
        pieces.push(
          ...upperPiece(ctx, {
            hemY: upperHem,
            sleeve,
            ease,
            neck,
            neckline,
            puffy: shape.puffy,
            drape: true,
            photoRect: upRect,
            fade: OUTER_FADE,
          }),
        );
        pieces.push(
          skirtPiece(ctx, {
            hemY,
            ease: ease + 0.003,
            flare: 0.05,
            photoRect: lowRect,
            fade: OUTER_FADE,
            plane: pieces[0]?.geometry.userData.swatchPlane,
          }),
        );
      }
      return pieces.filter((p): p is Piece => !!p);
    }
    case "dress": {
      const hemY = shape.length === "long" ? m.crotchY - 0.36 : m.crotchY - 0.2;
      const upperHem = m.crotchY + 0.02;
      const [upRect, lowRect] = split(upperHem, hemY);
      const neck = shape.neck ?? "plain";
      const upper = upperPiece(ctx, {
        hemY: upperHem,
        sleeve: sleeveLen(shape.sleeve),
        ease: 0.008,
        neck,
        neckline: NECKLINE.dress[neck] ?? NECKLINE.dress.default,
        drape: true,
        photoRect: upRect,
        fade: TOP_FADE,
      });
      return [
        ...upper,
        skirtPiece(ctx, {
          hemY,
          ease: 0.011,
          flare: 0.08,
          photoRect: lowRect,
          fade: TOP_FADE,
          plane: upper[0]?.geometry.userData.swatchPlane,
        }),
      ].filter((p): p is Piece => !!p);
    }
    case "skirt": {
      const hemY =
        shape.length === "mini"
          ? m.crotchY - 0.08
          : shape.length === "knee"
            ? m.crotchY - 0.22
            : m.crotchY - 0.4;
      const piece = skirtPiece(ctx, { hemY, ease: 0.006, flare: 0.08, fade: TOP_FADE });
      return piece ? [piece] : [];
    }
    case "pants": {
      const to = shape.length === "short" ? 0.28 : 0.985;
      const base =
        shape.width === "wide"
          ? (t: number) => 0.01 + t * 0.014
          : shape.width === "slim"
            ? () => 0.004
            : (t: number) => 0.006 + t * 0.004;
      // 長いパンツは、すそを少し広げて靴の履き口にかぶせる（靴の上に布が乗るように）
      const ease =
        to > 0.9
          ? (t: number) => {
              const u = clamp((t - 0.9) / (to - 0.9), 0, 1);
              return base(t) + 0.007 * u * u * (3 - 2 * u);
            }
          : base;
      const piece = pantsPiece(ctx, {
        to,
        ease,
        drape:
          shape.width === "wide" ? 0.97 : shape.width === "regular" ? 0.9 : 0,
      });
      return piece ? [piece] : [];
    }
    case "shoes":
      return [];
  }
}
