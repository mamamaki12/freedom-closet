// 服のメッシュを、体にぴったり沿った「タイツ」「スカート」のメッシュ（human.glb）から切り出して作る。
// 裾・襟・袖の長さで切り、体から少し離し（ゆとり）、胸やおなかのいちばん出たところから下はまっすぐ垂らす。
import * as THREE from "three";
import type { LookShape } from "../domain/look";
import type { Aux, Fitted, Human, HumanMesh, Marks, V3 } from "./human";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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

/** 0→1→0 と行って戻る（輪のまわりの角度 0〜1 を、継ぎ目のない座標にする） */
export const tent = (a: number) => 1 - Math.abs(2 * (((a % 1) + 1) % 1) - 1);

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
  /** 0以上なら残す。負なら切る（切り口に寄せる） */
  keep: (i: number) => number;
  /** 切られた頂点を切り口へ寄せる */
  project: (i: number, p: V3) => V3;
  /** 体からの離れ具合（頂点ごと） */
  ease: (i: number) => number;
  /** 面がどの材質か（0: 前＝写真1枚、1: 背中・パンツなど＝生地の見本、2: 袖＝袖の見本） */
  group: (i: number) => Group;
  /**
   * 生地の見本の座標（group 1・2 の頂点）。見本1枚ぶんが 1。
   * 見本は折り返して敷き詰めるので、輪になったところ（腕・脚のまわり）は
   * 行って戻る座標（tent）にして、座標が飛ぶところ（継ぎ目の筋）を作らない
   */
  swatchUv: (i: number, g: Group) => [number, number];
  /** 垂らす処理（ゆとりをつけたあと、切る前） */
  drape?: (p: Float32Array) => void;
  /** 本体（group 0）の頂点の範囲を写真のどこに当てるか [u0, v0, u1, v1]。省略時は写真全体 */
  photoRect?: [number, number, number, number];
  /** 重ね着（下に着た服より外へ出し、この服も覚える）。torso は腕でない頂点 */
  layers?: Layers;
  torso?: (i: number) => boolean;
}

/**
 * メッシュから服を切り出す。面は3つの頂点のうち1つでも残るなら残し、切られた頂点は切り口に寄せる。
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
  const keep = new Float32Array(n);
  for (let i = 0; i < n; i++) keep[i] = spec.keep(i);
  const idx = mesh.index;
  const nb = neighbors(idx, n);
  const faces: [number[], number[], number[]] = [[], [], []];
  const projected = new Set<number>();
  const groups = new Uint8Array(n);
  for (let i = 0; i < n; i++) groups[i] = spec.group(i);
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f];
    const b = idx[f + 1];
    const c = idx[f + 2];
    const kept =
      (keep[a] >= 0 ? 1 : 0) + (keep[b] >= 0 ? 1 : 0) + (keep[c] >= 0 ? 1 : 0);
    if (kept === 0) continue;
    for (const v of [a, b, c]) {
      if (keep[v] < 0 && !projected.has(v)) {
        projected.add(v);
        // まず、残る頂点との辺の上の、切り口（keep が 0 になるところ）へ。
        // 真上にずらすだけだと、すその下で細くなる体の形のまま内側へ折れ込む（すその内側にひだができる）
        let best = -1;
        let bt = -1;
        for (let q = nb.start[v]; q < nb.start[v + 1]; q++) {
          const j = nb.adj[q];
          if (keep[j] < 0) continue;
          const t = keep[j] / (keep[j] - keep[v]);
          if (t > bt) {
            bt = t;
            best = j;
          }
        }
        if (best >= 0)
          for (let e = 0; e < 3; e++)
            p[v * 3 + e] = p[best * 3 + e] + (p[v * 3 + e] - p[best * 3 + e]) * bt;
        const q = spec.project(v, [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
        p[v * 3] = q[0];
        p[v * 3 + 1] = q[1];
        p[v * 3 + 2] = q[2];
      }
    }
    // 面の材質は、3つの頂点のうち多いほう（ばらばらなら1つめの頂点）
    const ga = groups[a];
    const gb = groups[b];
    const gc = groups[c];
    const g = (gb === gc ? gb : ga) as Group;
    faces[g].push(a, b, c);
  }
  const all = [...faces[0], ...faces[1], ...faces[2]];
  if (all.length === 0) return undefined;
  // 材質の境目の頂点は材質ごとに別の頂点にする（写真の座標と模様の座標が混ざってギザギザにならないように）。
  // 法線は切る前のメッシュ全体から取り、継ぎ目や切り口で陰影が途切れないようにする
  const full = vertexNormals(p, idx);
  const slot = [0, 1, 2].map(() => new Int32Array(n).fill(-1));
  let count = 0;
  for (const g of [0, 1, 2] as const)
    for (const v of faces[g]) if (slot[g][v] < 0) slot[g][v] = count++;
  const outPos = new Float32Array(count * 3);
  const outNrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index = new Uint32Array(all.length);
  // 本体（写真1枚）の座標は、本体の頂点の範囲を写真の photoRect に当てる
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < n; v++) {
    if (slot[0][v] < 0) continue;
    minX = Math.min(minX, p[v * 3]);
    maxX = Math.max(maxX, p[v * 3]);
    minY = Math.min(minY, p[v * 3 + 1]);
    maxY = Math.max(maxY, p[v * 3 + 1]);
  }
  const w = Math.max(1e-3, maxX - minX);
  const h = Math.max(1e-3, maxY - minY);
  const [u0, v0, u1, v1] = spec.photoRect ?? [0, 0, 1, 1];
  for (const g of [0, 1, 2] as const) {
    for (let v = 0; v < n; v++) {
      const j = slot[g][v];
      if (j < 0) continue;
      for (let k = 0; k < 3; k++) {
        outPos[j * 3 + k] = p[v * 3 + k];
        outNrm[j * 3 + k] = full[v * 3 + k];
      }
      if (g === 0) {
        uv[j * 2] = u0 + ((p[v * 3] - minX) / w) * (u1 - u0);
        uv[j * 2 + 1] = v0 + ((p[v * 3 + 1] - minY) / h) * (v1 - v0);
      } else {
        const [u, t] = spec.swatchUv(v, g);
        uv[j * 2] = u;
        uv[j * 2 + 1] = t;
      }
    }
  }
  let k = 0;
  for (const g of [0, 1, 2] as const)
    for (const v of faces[g]) index[k++] = slot[g][v];
  if (spec.layers) {
    // 出力の頂点が、元のどの頂点か（腕かどうかを調べるため）
    const src = new Int32Array(count);
    for (const g of [0, 1, 2] as const)
      for (let v = 0; v < n; v++) if (slot[g][v] >= 0) src[slot[g][v]] = v;
    spec.layers.add(outPos, index, (j) => !spec.torso || spec.torso(src[j]));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(outNrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.addGroup(0, faces[0].length, 0);
  geo.addGroup(faces[0].length, faces[1].length, 1);
  geo.addGroup(faces[0].length + faces[1].length, faces[2].length, 2);
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
  /** 生地の見本1枚が3Dでどの長さになるか（身長＝1）。胴・脚用と袖用 */
  tile: number;
  sleeveTile: number;
  layers?: Layers;
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
 * 襟ぐり：首のまわりを丸く開け、前は広く低く、後ろは狭く高く。
 * 「首の軸からの距離が襟の半径より外」か「開きの高さより下」なら残す。
 */
function collar(
  m: Marks,
  pos: Float32Array,
  i: number,
  opts: { drop: number; front: number },
) {
  const x = pos[i * 3];
  const y = pos[i * 3 + 1];
  const z = pos[i * 3 + 2];
  const f = clamp((z - m.neckCz) / 0.05, -1, 1) * 0.5 + 0.5; // 1 が前
  const r = lerp(m.neckHalfW + 0.012, m.neckHalfW + 0.012 + opts.front, f);
  const yCut = lerp(m.shoulderY + 0.02, m.shoulderY - opts.drop, f);
  const dist = Math.hypot(x, z - m.neckCz);
  return { keep: Math.max(dist - r, yCut - y), dist, r, yCut, y };
}

/** 上半身の服（トップス・アウター・ワンピースの上）をタイツから切り出す */
function upperPiece(
  ctx: Ctx,
  opts: {
    hemY: number;
    sleeve: number;
    ease: number;
    neckDrop: number;
    photoRect?: [number, number, number, number];
    neckFront: number;
    drape: boolean;
    swatchBody?: boolean;
  },
): Piece | undefined {
  const { human, fit, m } = ctx;
  const mesh = human.tights;
  const pos = fit.tights;
  const aux = fit.aux.tights;
  const sleeve = opts.sleeve;
  const isArm = (i: number) => mesh.parts[i * 4 + 1] >= 0.5;
  const neck = { drop: opts.neckDrop, front: opts.neckFront };
  // 背中は写真の裏返しではなく生地の見本にする（前のプリントやボタンが背中に出ないように）
  const isBack = (i: number) => pos[i * 3 + 2] < m.torsoCz(pos[i * 3 + 1]);
  const armLen = Math.hypot(
    m.wrist[0][0] - m.shoulder[0][0],
    m.wrist[0][1] - m.shoulder[0][1],
    m.wrist[0][2] - m.shoulder[0][2],
  );
  const spec: CutSpec = {
    keep: (i) => {
      const y = pos[i * 3 + 1];
      let c = Infinity;
      if (!isArm(i)) c = Math.min(y - opts.hemY, collar(m, pos, i, neck).keep);
      const k = aux.armK[i];
      if (k >= 0) c = Math.min(c, sleeve - k);
      return c;
    },
    project: (i, p) => {
      const q: V3 = [p[0], p[1], p[2]];
      if (!isArm(i)) {
        if (q[1] < opts.hemY) q[1] = opts.hemY;
        const c = collar(m, pos, i, neck);
        if (c.keep < 0) {
          // 襟の内側で開きより上：近いほうへ（横に押し出すか、開きの高さまで下げる）
          const dr = c.r - c.dist;
          const dy = c.y - c.yCut;
          if (dr <= dy && c.dist > 1e-4) {
            const k = c.r / c.dist;
            q[0] *= k;
            q[2] = m.neckCz + (q[2] - m.neckCz) * k;
          } else q[1] = c.yCut;
        }
      }
      const k = aux.armK[i];
      if (k >= 0 && k > sleeve) {
        const s = pos[i * 3] < 0 ? 0 : 1;
        const ax = m.armAxis[s];
        const d = ax.dir(sleeve);
        const base = ax.at(sleeve);
        const t =
          (q[0] - base[0]) * d[0] +
          (q[1] - base[1]) * d[1] +
          (q[2] - base[2]) * d[2];
        return [q[0] - d[0] * t, q[1] - d[1] * t, q[2] - d[2] * t];
      }
      return q;
    },
    ease: (i) => (isArm(i) ? opts.ease * 0.85 : opts.ease),
    group: (i) => (isArm(i) ? 2 : opts.swatchBody || isBack(i) ? 1 : 0),
    swatchUv: (i, g) => {
      if (g === 2) {
        // 腕のまわり（上腕は太く、手首は細い）と、肩からの長さ。
        // 肩の丸み（腕の付け根より上、k が負）もそのまま長さにする（0 でそろえると模様が筋に伸びる）
        const k = aux.armK[i];
        const around = lerp(0.18, 0.13, clamp(k, 0, 1));
        return [
          (tent(aux.armAngle[i]) * around) / 2 / ctx.sleeveTile,
          (k * armLen) / ctx.sleeveTile,
        ];
      }
      // 背中：後ろから見た平面に貼る
      return [pos[i * 3] / ctx.tile, pos[i * 3 + 1] / ctx.tile];
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
    layers: ctx.layers,
    torso: (i) => !isArm(i),
  };
  const geometry = cutPiece(mesh, pos, spec);
  return geometry && { geometry, body: opts.swatchBody ? "swatch" : "whole" };
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
  },
): Piece | undefined {
  const { human, fit, m } = ctx;
  const mesh = human.skirt;
  const pos = fit.skirt;
  const spec: CutSpec = {
    keep: (i) => pos[i * 3 + 1] - opts.hemY,
    project: (_i, p) => [p[0], opts.hemY, p[2]],
    // 下に向かって少し広がる
    ease: (i) => opts.ease + Math.max(0, m.hipY - pos[i * 3 + 1]) * opts.flare,
    // 後ろ半分は生地の見本
    group: (i) =>
      opts.swatchBody || pos[i * 3 + 2] < m.torsoCz(pos[i * 3 + 1]) ? 1 : 0,
    swatchUv: (i) => [pos[i * 3] / ctx.tile, pos[i * 3 + 1] / ctx.tile],
    photoRect: opts.photoRect,
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
  const hemY = lerp(m.crotchY, m.ankleY, opts.to);
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
    project: (i, p) => {
      const q: V3 = [p[0], p[1], p[2]];
      if (q[1] > m.waistY) q[1] = m.waistY;
      if (legT(i) > opts.to) q[1] = hemY;
      return q;
    },
    ease: (i) => opts.ease(clamp(legT(i), 0, 1)),
    group: () => 1,
    swatchUv: (i) => {
      const t = clamp(legT(i), 0, 1);
      const s = pos[i * 3] < 0 ? 0 : 1;
      const y = pos[i * 3 + 1];
      const [cx, cz] = legAxis(s)(y);
      // 左右の脚で向きを鏡にして、まん中（前と後ろの縫い目）で座標がそろうようにする
      const dx = (pos[i * 3] - cx) * (s === 1 ? -1 : 1);
      const a = Math.atan2(pos[i * 3 + 2] - cz, dx) / (Math.PI * 2) + 0.5;
      // 脚のまわり（太ももは太く、足首は細い）と、股からの長さ
      const around = lerp(0.3, 0.2, t);
      return [(tent(a) * around) / 2 / ctx.tile, (m.crotchY - y) / ctx.tile];
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
    project: (i, p) => {
      const q: V3 = [p[0], p[1], p[2]];
      if (q[1] > m.shoulderY - 0.045) q[1] = m.shoulderY - 0.045;
      if (aux.legT[i] > 0.2) q[1] = lerp(m.crotchY, m.ankleY, 0.2);
      return q;
    },
    ease: () => 0.0025,
    group: () => 1,
    swatchUv: () => [0, 0],
  };
  return cutPiece(mesh, pos, spec);
}

/** 服1着ぶんのメッシュ（靴以外）。重ね着の順に呼ぶ */
export function garmentPieces(
  human: Human,
  fit: Fitted,
  shape: LookShape,
  photo: { bodyU?: [number, number]; tile?: number; sleeveTile?: number } = {},
  layers?: Layers,
): Piece[] {
  const m = fit.marks;
  // 生地の見本の大きさ：写真の中で見本が基準の幅（胴の幅、ボトムスは腰の幅）の何倍かを、3Dの同じ幅に掛ける
  const lower = shape.kind === "pants" || shape.kind === "skirt";
  const ref = lower ? m.torsoWidth(m.hipY) : m.torsoWidth(m.chestY);
  const toTile = (f: number | undefined) => clamp((f ?? 0.3) * ref, 0.03, 0.2);
  const ctx: Ctx = {
    human,
    fit,
    m,
    tile: toTile(photo.tile),
    sleeveTile: toTile(photo.sleeveTile ?? photo.tile),
    layers,
  };
  const sleeveLen = (s: "none" | "short" | "long") =>
    s === "none" ? 0.04 : s === "short" ? 0.3 : 0.96;
  // 写真の横方向のうち胴に当たる範囲（袖を除いたところ）。写真がなければ全体
  const [bu0, bu1] = photo.bodyU ?? [0, 1];
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
      const piece = upperPiece(ctx, {
        hemY,
        sleeve: sleeveLen(shape.sleeve),
        ease: 0.011,
        neckDrop: 0.03,
        neckFront: 0.02,
        drape: true,
        photoRect: [bu0, 0, bu1, 1],
      });
      return piece ? [piece] : [];
    }
    case "outer": {
      const ease = shape.puffy ? 0.032 : 0.017;
      const pieces: (Piece | undefined)[] = [];
      if (shape.length === "short")
        pieces.push(
          upperPiece(ctx, {
            hemY: m.crotchY - 0.01,
            sleeve: 0.97,
            ease,
            neckDrop: 0.02,
            neckFront: 0.03,
            drape: true,
            photoRect: [bu0, 0, bu1, 1],
          }),
        );
      else {
        const hemY =
          shape.length === "middle" ? m.crotchY - 0.17 : m.crotchY - 0.3;
        const upperHem = m.crotchY + 0.02;
        const [upRect, lowRect] = split(upperHem, hemY);
        pieces.push(
          upperPiece(ctx, {
            hemY: upperHem,
            sleeve: 0.97,
            ease,
            neckDrop: 0.02,
            neckFront: 0.03,
            drape: true,
            photoRect: upRect,
          }),
        );
        pieces.push(
          skirtPiece(ctx, {
            hemY,
            ease: ease + 0.003,
            flare: 0.05,
            photoRect: lowRect,
          }),
        );
      }
      return pieces.filter((p): p is Piece => !!p);
    }
    case "dress": {
      const hemY = shape.length === "long" ? m.crotchY - 0.36 : m.crotchY - 0.2;
      const upperHem = m.crotchY + 0.02;
      const [upRect, lowRect] = split(upperHem, hemY);
      return [
        upperPiece(ctx, {
          hemY: upperHem,
          sleeve: sleeveLen(shape.sleeve),
          ease: 0.008,
          neckDrop: 0.045,
          neckFront: 0.03,
          drape: true,
          photoRect: upRect,
        }),
        skirtPiece(ctx, {
          hemY,
          ease: 0.011,
          flare: 0.08,
          photoRect: lowRect,
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
      const piece = skirtPiece(ctx, { hemY, ease: 0.006, flare: 0.08 });
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
