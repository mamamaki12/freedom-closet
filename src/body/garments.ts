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

/** 模様の貼り方：whole は写真を1枚そのまま、swatch は生地の模様を敷き詰める */
export type UvMode = "whole" | "swatch";

export interface CutSpec {
  /** 0以上なら残す。負なら切る（切り口に寄せる） */
  keep: (i: number) => number;
  /** 切られた頂点を切り口へ寄せる */
  project: (i: number, p: V3) => V3;
  /** 体からの離れ具合（頂点ごと） */
  ease: (i: number) => number;
  /** 面がどちらの材質か（0: 本体＝写真1枚、1: 袖など＝生地の模様） */
  group: (i: number) => 0 | 1;
  /** 生地の模様の座標（group 1 の頂点）。[0,1) の角度と、長さ方向 */
  swatchUv: (i: number) => [number, number];
  /** 垂らす処理（ゆとりをつけたあと、切る前） */
  drape?: (p: Float32Array) => void;
  /** 本体（group 0）の頂点の範囲を写真のどこに当てるか [u0, v0, u1, v1]。省略時は写真全体 */
  photoRect?: [number, number, number, number];
}

/**
 * メッシュから服を切り出す。面は3つの頂点のうち1つでも残るなら残し、切られた頂点は切り口に寄せる。
 * 返す geometry には材質グループが2つある（0: 本体、1: 袖・脚）。
 */
export function cutPiece(
  mesh: HumanMesh,
  pos: Float32Array,
  spec: CutSpec,
): THREE.BufferGeometry | undefined {
  const n = pos.length / 3;
  const normals = vertexNormals(pos, mesh.index);
  const p = new Float32Array(pos.length);
  for (let i = 0; i < n; i++) {
    const e = spec.ease(i);
    p[i * 3] = pos[i * 3] + normals[i * 3] * e;
    p[i * 3 + 1] = pos[i * 3 + 1] + normals[i * 3 + 1] * e;
    p[i * 3 + 2] = pos[i * 3 + 2] + normals[i * 3 + 2] * e;
  }
  spec.drape?.(p);
  const keep = new Float32Array(n);
  for (let i = 0; i < n; i++) keep[i] = spec.keep(i);
  const idx = mesh.index;
  const faces: [number[], number[]] = [[], []];
  const used = new Int32Array(n).fill(-1);
  const projected = new Set<number>();
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
        const q = spec.project(v, [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
        p[v * 3] = q[0];
        p[v * 3 + 1] = q[1];
        p[v * 3 + 2] = q[2];
      }
    }
    const g = spec.group(a) + spec.group(b) + spec.group(c) >= 2 ? 1 : 0;
    faces[g].push(a, b, c);
  }
  const all = [...faces[0], ...faces[1]];
  if (all.length === 0) return undefined;
  // 材質の境目の頂点は材質ごとに別の頂点にする（写真の座標と模様の座標が混ざってギザギザにならないように）。
  // 法線は切る前のメッシュ全体から取り、継ぎ目や切り口で陰影が途切れないようにする
  const full = vertexNormals(p, idx);
  const slot: [Int32Array, Int32Array] = [used, new Int32Array(n).fill(-1)];
  let count = 0;
  for (const g of [0, 1] as const)
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
  for (const g of [0, 1] as const) {
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
        const [u, t] = spec.swatchUv(v);
        uv[j * 2] = u;
        uv[j * 2 + 1] = t;
      }
    }
  }
  let k = 0;
  for (const g of [0, 1] as const)
    for (const v of faces[g]) index[k++] = slot[g][v];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(outNrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.addGroup(0, faces[0].length, 0);
  geo.addGroup(faces[0].length, faces[1].length, 1);
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
    group: (i) => (opts.swatchBody ? 1 : isArm(i) ? 1 : 0),
    swatchUv: (i) => {
      const k = aux.armK[i];
      if (k >= 0) return [aux.armAngle[i] * 2, k * 4];
      const y = pos[i * 3 + 1];
      const a =
        Math.atan2(pos[i * 3 + 2] - m.torsoCz(y), pos[i * 3]) / (Math.PI * 2) +
        0.5;
      return [a * 3, y * 6];
    },
    drape: opts.drape
      ? (p) =>
          drapeAround(
            p,
            torsoVerts(mesh, pos, aux, m.chestY + 0.02),
            (y) => [0, m.torsoCz(y)],
            m.chestY - 0.03,
            0.985,
            0.002,
          )
      : undefined,
    photoRect: opts.photoRect,
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
    group: () => (opts.swatchBody ? 1 : 0),
    swatchUv: (i) => {
      const y = pos[i * 3 + 1];
      const a =
        Math.atan2(pos[i * 3 + 2] - m.torsoCz(y), pos[i * 3]) / (Math.PI * 2) +
        0.5;
      return [a * 3, y * 6];
    },
    photoRect: opts.photoRect,
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
      const t = legT(i);
      const s = pos[i * 3] < 0 ? 0 : 1;
      const y = pos[i * 3 + 1];
      const [cx, cz] = legAxis(s)(y);
      const a =
        Math.atan2(pos[i * 3 + 2] - cz, pos[i * 3] - cx) / (Math.PI * 2) + 0.5;
      return [a * 2, (t > -8 ? t : 0) * 5 + y * 0];
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
  photo: { bodyU?: [number, number] } = {},
): Piece[] {
  const ctx: Ctx = { human, fit, m: fit.marks };
  const m = fit.marks;
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
      const ease =
        shape.width === "wide"
          ? (t: number) => 0.01 + t * 0.014
          : shape.width === "slim"
            ? () => 0.004
            : (t: number) => 0.006 + t * 0.004;
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
