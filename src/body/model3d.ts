// 3Dのマネキン（人体メッシュ）に服を着せる（three.js）。
// 体型は BodyScan（輪切りの寸法）、男女・体重の大まかな形は Profile から。単位は身長＝1、床が y=0。
import * as THREE from "three";
import type { LookShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import { garmentPieces, Layers, underwear, type UvMode } from "./garments";
import { fitHuman, loadHuman, type Fitted, type Human, type V3 } from "./human";
import { fitShoe, shoeLift, shoeMaterial, type ShoeAsset } from "./shoe";
import type { BodyScan } from "./types";

export { Layers };

export { THREE };

/** 体型に合わせて変形ずみの人体 */
export interface Figure {
  human: Human;
  fit: Fitted;
  /** 靴の3Dの型（読み込めたときだけ。ないときは足の形から作る） */
  shoe?: ShoeAsset;
}

export async function prepareFigure(
  scan: BodyScan,
  profile: Profile,
  opts: { warp?: boolean } = {},
): Promise<Figure> {
  const human = await loadHuman();
  // 体の写真から作った体型のときだけ、測った寸法に合わせて変形する。身長・体重だけのときは男女・体重の形をそのまま使う
  return {
    human,
    fit: fitHuman(human, scan, profile, {
      warp: opts.warp ?? scan.views.length > 0,
    }),
  };
}

/** 服や体の材質 */
export interface Paint {
  color: string;
  /** 服の写真から作った模様（1枚の布として貼る） */
  whole?: THREE.Texture;
  /** 生地を敷き詰める模様（袖・パンツ用） */
  swatch?: THREE.Texture;
  /** 袖の生地の見本（袖の色が胴とはっきり違う服だけ。なければ swatch を使う） */
  sleeve?: THREE.Texture;
  /** whole の横方向のうち、胴（袖を除いた部分）が写っている範囲 */
  bodyU?: [number, number];
  /** 写真から取った地の色（生地の見本の平均）。靴など模様を貼らないものに使う */
  tone?: string;
  /**
   * 生地の見本（つなぎ目なくくり返せる模様1枚）の横と縦が、写真の中の基準の幅
   * （トップスは胴の幅、ボトムスは腰の幅）の何倍か。
   * 3Dでも同じ割合で敷き詰めて、前（写真）と背中・袖（見本）の模様の大きさをそろえる
   */
  tile?: [number, number];
  sleeveTile?: [number, number];
}

const SKIN = new THREE.MeshStandardMaterial({
  color: "#dcc8b6",
  roughness: 0.62,
  metalness: 0,
});
const UNDER = new THREE.MeshStandardMaterial({
  color: "#d3cbc1",
  roughness: 0.9,
  metalness: 0,
  side: THREE.DoubleSide,
});

/** 布の材質。sheen で布らしいやわらかな光り方にする */
export function fabric(
  paint: Paint,
  kind: UvMode | "sleeve",
): THREE.MeshPhysicalMaterial {
  const base =
    kind === "whole"
      ? paint.whole
      : kind === "sleeve"
        ? (paint.sleeve ?? paint.swatch)
        : paint.swatch;
  let map: THREE.Texture | undefined;
  if (base) {
    map = base.clone();
    map.needsUpdate = true;
    if (kind === "whole") {
      map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      // そのまま敷き詰める（見本はつなぎ目なくくり返せる模様にしてある。折り返すと柄が左右対称に映る）
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
    }
  }
  // 布のつやは生地の色にする（白いつやだと、黒や紺の服が白っぽくかすんで見える）
  return new THREE.MeshPhysicalMaterial({
    color: map ? "#ffffff" : paint.color,
    map,
    roughness: 0.92,
    metalness: 0,
    sheen: 0.6,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color(map ? "#ffffff" : paint.color),
    sheenColorMap: map ?? null,
    side: THREE.DoubleSide,
  });
}

function geometryOf(
  pos: Float32Array,
  index: Uint16Array | Uint32Array,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

/** 本物の靴の3Dの型を使う靴の種類（ほかは足の形から作る） */
const ASSET_SHOES: ReadonlySet<ShoeStyle> = new Set(["sneakers", "leather"]);

function usesShoeAsset(fig: Figure, style: ShoeStyle): boolean {
  return !!fig.shoe && ASSET_SHOES.has(style);
}

/** マネキン本体（肌・目・下着がわりの薄い一枚）。靴をはくときは足を少し小さくして靴から出ないようにする */
export function buildBody(fig: Figure, opts: { shoes?: ShoeStyle }): THREE.Group {
  const { human, fit } = fig;
  const g = new THREE.Group();
  const pos = new Float32Array(fit.body);
  if (opts.shoes) {
    const m = fit.marks;
    const asset = usesShoeAsset(fig, opts.shoes);
    const feet = asset ? [measureFoot(fig, -1), measureFoot(fig, 1)] : [];
    for (let i = 0; i < pos.length / 3; i++) {
      if (human.body.parts[i * 4 + 2] < 0.5) continue;
      const y = pos[i * 3 + 1];
      const s = pos[i * 3] < 0 ? 0 : 1;
      const f = m.foot[s];
      const top = f.ankle[1] + 0.012;
      if (y > top) continue;
      if (asset) {
        // 靴の型は足の形どおりではないので、足を細く・低く・少し短くして、靴の中（底より上）に収める。
        // 足首の上でもとの形になめらかにつなぐ（靴の履き口から見えるところ）
        const fs = feet[s];
        const w = smoothstep((top - y) / 0.02);
        const t = (pos[i * 3 + 2] - fs.heelZ) / Math.max(1e-3, fs.toeZ - fs.heelZ);
        const cx = footAt(fs, t).cx;
        pos[i * 3] = cx + (pos[i * 3] - cx) * (1 - 0.25 * w);
        // 足の裏は靴底の上へ（革靴は底が薄いので低めに）
        const sole = opts.shoes === "leather" ? 0.006 : 0.012;
        pos[i * 3 + 1] = y * (1 - 0.25 * w) + sole * w;
        pos[i * 3 + 2] = f.ankle[2] + (pos[i * 3 + 2] - f.ankle[2]) * (1 - 0.08 * w);
        continue;
      }
      const k = 0.9;
      pos[i * 3] = f.ankle[0] + (pos[i * 3] - f.ankle[0]) * k;
      pos[i * 3 + 1] = y * 0.92 + 0.004;
      pos[i * 3 + 2] = f.ankle[2] + (pos[i * 3 + 2] - f.ankle[2]) * k;
    }
  }
  const body = new THREE.Mesh(geometryOf(pos, human.body.index), SKIN);
  body.castShadow = true;
  g.add(body);
  // 目は閉じたマネキン風（くぼみを埋める）
  for (const e of fit.marks.eye) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 16, 12), SKIN);
    eye.position.set(e[0], e[1], e[2] - 0.004);
    g.add(eye);
  }
  const under = underwear(human, fit);
  if (under) g.add(new THREE.Mesh(under, UNDER));
  return g;
}

// ---------- 靴（楕円の輪を積んだ形） ----------

interface Station {
  c: V3;
  rx: number;
  rz: number;
  /** これより上は平らに切る（靴の履き口） */
  cap?: number;
}
const SEG = 28;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** 楕円の輪を順につないだ筒。power を大きくすると角ばる */
function loft(
  stations: Station[],
  opts: { power?: number; capStart?: boolean; capEnd?: boolean } = {},
): THREE.BufferGeometry {
  const power = opts.power ?? 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const lid: number[] = [];
  const clipped: boolean[] = [];
  const n = stations.length;
  const e = 2 / power;
  const sgnPow = (v: number) => Math.sign(v) * Math.abs(v) ** e;
  for (let i = 0; i < n; i++) {
    const s = stations[i];
    const prev = stations[Math.max(0, i - 1)].c;
    const next = stations[Math.min(n - 1, i + 1)].c;
    const d = new THREE.Vector3(
      next[0] - prev[0],
      next[1] - prev[1],
      next[2] - prev[2],
    ).normalize();
    const ref =
      Math.abs(d.y) > 0.6
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(0, 1, 0);
    let n1 = new THREE.Vector3().crossVectors(d, ref);
    if (n1.lengthSq() < 1e-6) n1 = new THREE.Vector3(1, 0, 0);
    n1.normalize();
    if (n1.x < 0) n1.negate();
    const n2 = new THREE.Vector3().crossVectors(n1, d).normalize();
    if (n2.z < 0 || (Math.abs(n2.z) < 1e-6 && n2.y > 0)) n2.negate();
    for (let j = 0; j <= SEG; j++) {
      const th = Math.PI + (j / SEG) * Math.PI * 2;
      const a = sgnPow(Math.sin(th)) * s.rx;
      const b = sgnPow(Math.cos(th)) * s.rz;
      const py = s.c[1] + n1.y * a + n2.y * b;
      const cut = s.cap !== undefined && py > s.cap;
      // 履き口の穴は真ん中あたりだけ（端は靴の上面）
      clipped.push(cut && Math.abs(a) < s.rx * 0.62);
      pos.push(
        s.c[0] + n1.x * a + n2.x * b,
        cut ? s.cap! : py,
        s.c[2] + n1.z * a + n2.z * b,
      );
      uv.push((j / SEG) * 2, (n > 1 ? i / (n - 1) : 0) * 2);
    }
  }
  let flipAll = false;
  if (n > 1) {
    const m = Math.floor((n - 1) / 2);
    const P = (i: number, j: number) =>
      new THREE.Vector3().fromArray(pos, (i * (SEG + 1) + j) * 3);
    const p0 = P(m, 0);
    const normal = new THREE.Vector3().crossVectors(
      P(m, 1).sub(p0),
      P(m + 1, 0).sub(p0),
    );
    const outward = p0.clone().sub(new THREE.Vector3(...stations[m].c));
    flipAll = normal.dot(outward) < 0;
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j;
      const b = a + SEG + 1;
      // 切り詰めた点だけでできた面（履き口の中）は別の材質に
      const to =
        clipped[a] && clipped[a + 1] && clipped[b] && clipped[b + 1]
          ? lid
          : idx;
      if (flipAll) to.push(a, b, a + 1, a + 1, b, b + 1);
      else to.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const cap = (i: number, end: boolean) => {
    const s = stations[i];
    const center = pos.length / 3;
    pos.push(...s.c);
    uv.push(0.5, end ? 1 : 0);
    const c = new THREE.Vector3(...s.c);
    const other = new THREE.Vector3(...stations[end ? i - 1 : i + 1].c);
    const outward = c.clone().sub(other);
    const P = (j: number) =>
      new THREE.Vector3().fromArray(pos, (i * (SEG + 1) + j) * 3);
    const normal = new THREE.Vector3().crossVectors(P(0).sub(c), P(1).sub(c));
    const flip = normal.dot(outward) < 0;
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j;
      if (flip) idx.push(center, a + 1, a);
      else idx.push(center, a, a + 1);
    }
  };
  if (opts.capStart && n > 1) cap(0, false);
  if (opts.capEnd && n > 1) cap(n - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...idx, ...lid]);
  g.addGroup(0, idx.length, 0);
  if (lid.length) g.addGroup(idx.length, lid.length, 1);
  g.computeVertexNormals();
  return g;
}

// ---------- 靴 ----------

/** 足の断面（かかとからつま先へ）。体のメッシュから測る */
interface FootSlice {
  z: number;
  cx: number;
  halfW: number;
  top: number;
}
interface FootShape {
  heelZ: number;
  toeZ: number;
  slices: FootSlice[];
}
const FOOT_N = 16;

/** 片足の形を体のメッシュから測る（足首より下の頂点を、前後に輪切りにして幅と高さを取る） */
function measureFoot(fig: Figure, side: 1 | -1): FootShape {
  const pos = fig.fit.body;
  const limit = fig.fit.marks.ankleY + 0.012;
  const idx: number[] = [];
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    if (y > limit || Math.sign(x) !== side) continue;
    idx.push(i);
    zMin = Math.min(zMin, pos[i * 3 + 2]);
    zMax = Math.max(zMax, pos[i * 3 + 2]);
  }
  if (!Number.isFinite(zMin)) {
    zMin = -0.03;
    zMax = 0.11;
  }
  const len = zMax - zMin || 0.1;
  const raw: FootSlice[] = [];
  for (let k = 0; k < FOOT_N; k++) {
    const z = zMin + (len * (k + 0.5)) / FOOT_N;
    let top = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of idx) {
      if (Math.abs(pos[i * 3 + 2] - z) > len / FOOT_N) continue;
      top = Math.max(top, pos[i * 3 + 1]);
      lo = Math.min(lo, pos[i * 3]);
      hi = Math.max(hi, pos[i * 3]);
    }
    if (!Number.isFinite(lo)) {
      const prev = raw[raw.length - 1];
      lo = prev ? prev.cx - prev.halfW : side * 0.1;
      hi = prev ? prev.cx + prev.halfW : side * 0.1;
      top = prev ? prev.top : 0.02;
    }
    raw.push({
      z,
      cx: (lo + hi) / 2,
      halfW: Math.max(0.004, (hi - lo) / 2),
      top,
    });
  }
  // となりとならして、輪切りの刻みが見えないようにする
  const slices = raw.map((s, k) => {
    const a = raw[Math.max(0, k - 1)];
    const b = raw[Math.min(FOOT_N - 1, k + 1)];
    return {
      z: s.z,
      cx: (a.cx + s.cx * 2 + b.cx) / 4,
      halfW: (a.halfW + s.halfW * 2 + b.halfW) / 4,
      top: (a.top + s.top * 2 + b.top) / 4,
    };
  });
  return { heelZ: zMin, toeZ: zMax, slices };
}

/** 足の形を t（0 かかと〜1 つま先）で補間して返す */
function footAt(fs: FootShape, t: number): FootSlice {
  const f = clamp(t, 0, 1) * (FOOT_N - 1);
  const i = Math.floor(f);
  const j = Math.min(FOOT_N - 1, i + 1);
  const u = f - i;
  const a = fs.slices[i];
  const b = fs.slices[j];
  return {
    z: lerp(a.z, b.z, u),
    cx: lerp(a.cx, b.cx, u),
    halfW: lerp(a.halfW, b.halfW, u),
    top: lerp(a.top, b.top, u),
  };
}

const smoothstep = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

type ShoeStyle = Extract<LookShape, { kind: "shoes" }>["style"];

/** 靴の種類ごとの寸法（身長＝1。0.006 ≈ 1cm） */
function shoeSpec(style: ShoeStyle) {
  switch (style) {
    case "sneakers":
      return {
        pad: 0.0045,
        // 底：厚めで、かかとが少し高い
        sole: (t: number) => 0.012 + 0.004 * (1 - smoothstep((t - 0.2) / 0.35)),
        // 履き口：かかとの高さと、甲が始まる位置（t）と、そこでの高さ
        collar: { heel: 0.037, throat: 0.42, tongue: 0.052, gap: 0.004 },
        soleColor: "#ecE9e2",
        roughness: 0.8,
        clearcoat: 0,
      };
    case "leather":
      return {
        pad: 0.004,
        sole: (t: number) => 0.006 + 0.012 * (1 - smoothstep((t - 0.22) / 0.1)),
        collar: { heel: 0.031, throat: 0.56, tongue: 0.047, gap: 0.003 },
        soleColor: "#2a2421",
        roughness: 0.3,
        clearcoat: 0.6,
      };
    case "boots":
      return {
        pad: 0.0055,
        sole: (t: number) => 0.01 + 0.012 * (1 - smoothstep((t - 0.22) / 0.1)),
        collar: undefined,
        soleColor: "#26221f",
        roughness: 0.45,
        clearcoat: 0.2,
      };
    case "sandals":
      return {
        pad: 0.003,
        sole: (t: number) => 0.009 + 0.003 * (1 - smoothstep((t - 0.2) / 0.35)),
        collar: undefined,
        soleColor: "#c4a36e",
        roughness: 0.5,
        clearcoat: 0.1,
      };
  }
}
type ShoeSpec = ReturnType<typeof shoeSpec>;

const HEEL_EXT = 0.006;
const TOE_EXT = 0.018;
const SHOE_N = 22;

/** 靴の長さ方向の位置 u（0〜1）を、足の t（かかと 0〜つま先 1、はみ出しは範囲外）と、はみ出し分のすぼめ方に直す */
function shoeParam(fs: FootShape, u: number) {
  const z = lerp(fs.heelZ - HEEL_EXT, fs.toeZ + TOE_EXT, u);
  const len = fs.toeZ - fs.heelZ;
  const t = (z - fs.heelZ) / len;
  const over = clamp(
    t < 0 ? (-t * len) / HEEL_EXT : t > 1 ? ((t - 1) * len) / TOE_EXT : 0,
    0,
    1,
  );
  // 足からはみ出した分は、だ円を描いてすぼめる（先が平らな壁にならない）
  const round = Math.max(0, 1 - over * over);
  return { z, t, taperW: Math.sqrt(round), taperH: round ** 0.7 };
}

/** 靴の本体（アッパー）。足の形を少しふくらませ、履き口の高さで上を切る */
function upperStations(fs: FootShape, spec: ShoeSpec, extra = 0): Station[] {
  const st: Station[] = [];
  for (let k = 0; k <= SHOE_N; k++) {
    const u = k / SHOE_N;
    const { z, t, taperW, taperH } = shoeParam(fs, u);
    const f = footAt(fs, t);
    const bottom = spec.sole(clamp(t, 0, 1)) - 0.002;
    // つま先の箱は足の指より少し高くする（靴らしい厚み）
    const footTop = Math.max(f.top, 0.015 * smoothstep((t - 0.45) / 0.3));
    let top = Math.max(
      bottom + 0.002,
      footTop * taperH + (spec.pad + extra) * (0.3 + 0.7 * taperH),
    );
    let cap: number | undefined;
    if (spec.collar && t < spec.collar.throat) {
      cap =
        lerp(
          spec.collar.heel,
          spec.collar.tongue,
          smoothstep(t / spec.collar.throat),
        ) + extra;
      // 履き口のすぐ上で丸く閉じるようにして、切り口が広い平らな面にならないようにする
      top = Math.min(top, cap + spec.collar.gap);
    }
    st.push({
      c: [f.cx, (top + bottom) / 2, z],
      rx: (f.halfW + spec.pad + extra) * taperW,
      rz: (top - bottom) / 2,
      cap,
    });
  }
  return st;
}

/** 靴底。アッパーより少し外に出て、かかとが厚い */
function soleStations(fs: FootShape, spec: ShoeSpec): Station[] {
  const st: Station[] = [];
  for (let k = 0; k <= SHOE_N; k++) {
    const u = k / SHOE_N;
    const { z, t, taperW } = shoeParam(fs, u);
    const f = footAt(fs, t);
    const thick = spec.sole(clamp(t, 0, 1));
    st.push({
      c: [f.cx, thick / 2, z],
      rx: (f.halfW + spec.pad + 0.003) * taperW,
      rz: thick / 2,
    });
  }
  return st;
}

/** 細長い帯（靴ひもの部分、サンダルのベルト）。points に沿って、widthAxis の向きに幅を持つ */
function ribbon(
  points: V3[],
  widthAxis: V3,
  halfW: number,
  thick: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const frames = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const d = new THREE.Vector3(
      b[0] - a[0],
      b[1] - a[1],
      b[2] - a[2],
    ).normalize();
    const w = new THREE.Vector3(...widthAxis);
    w.sub(d.clone().multiplyScalar(w.dot(d))).normalize();
    const n = new THREE.Vector3().crossVectors(d, w).normalize();
    const corner = (sw: number, sn: number): V3 => [
      p[0] + w.x * halfW * sw + n.x * (thick / 2) * sn,
      p[1] + w.y * halfW * sw + n.y * (thick / 2) * sn,
      p[2] + w.z * halfW * sw + n.z * (thick / 2) * sn,
    ];
    return [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
  });
  const quad = (a: V3, b: V3, c: V3, d: V3) =>
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < frames.length - 1; i++) {
    const A = frames[i];
    const B = frames[i + 1];
    for (let e = 0; e < 4; e++)
      quad(A[e], B[e], B[(e + 1) % 4], A[(e + 1) % 4]);
  }
  const first = frames[0];
  const last = frames[frames.length - 1];
  quad(first[0], first[1], first[2], first[3]);
  quad(last[3], last[2], last[1], last[0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 靴。足の形を体のメッシュから測って作る。ブーツの筒はタイツの脚の部分を使う */
function buildShoes(
  fig: Figure,
  shape: Extract<LookShape, { kind: "shoes" }>,
  paint: Paint,
): THREE.Group {
  const g = new THREE.Group();
  const style = shape.style;
  if (fig.shoe && usesShoeAsset(fig, style)) {
    // スニーカー・革靴は本物の靴の3Dの型を、足の長さ・幅・向きに合わせて置く（革靴は底を薄く、表面を革に）
    const look = style === "leather" ? "leather" : "sneakers";
    const mat = shoeMaterial(fig.shoe, paint.tone ?? paint.color, look);
    for (const side of [-1, 1] as const) {
      const m = new THREE.Mesh(
        fitShoe(fig.shoe.model, measureFoot(fig, side), side, shoeLift(look)),
        mat,
      );
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }
  const spec = shoeSpec(style);
  // 色は写真から取った地の色（なければ登録した色）。生地の模様を貼ると靴はまだらに見えるので貼らない
  const base = new THREE.Color(paint.tone ?? paint.color);
  const upperMat = new THREE.MeshPhysicalMaterial({
    color: base,
    roughness: spec.roughness,
    metalness: 0,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: 0.35,
    sheen: style === "sneakers" ? 0.2 : 0,
    side: THREE.DoubleSide,
  });
  const soleMat = new THREE.MeshStandardMaterial({
    color: spec.soleColor,
    roughness: style === "sneakers" ? 0.65 : 0.5,
    metalness: 0,
  });
  // 靴ひものところ：濃い靴なら明るく、明るい靴なら少し濃く
  const light = (base.r + base.g + base.b) / 3 > 0.6;
  const laceMat = new THREE.MeshStandardMaterial({
    color: light ? base.clone().multiplyScalar(0.8) : "#e6e2da",
    roughness: 0.75,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  // 履き口の中（中敷き・靴下が見えるところ）は暗く
  const insideMat = new THREE.MeshStandardMaterial({
    color: "#2b2622",
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
  };
  for (const side of [-1, 1] as const) {
    const fs = measureFoot(fig, side);
    add(
      loft(soleStations(fs, spec), {
        power: 3.2,
        capStart: true,
        capEnd: true,
      }),
      soleMat,
    );
    if (style === "sandals") {
      // ベルトを2本、甲の上にわたす
      for (const t of [0.5, 0.72]) {
        const f = footAt(fs, t);
        const soleTop = spec.sole(t);
        const rx = f.halfW + spec.pad + 0.002;
        const ry = f.top + spec.pad + 0.002 - soleTop;
        const pts: V3[] = [];
        for (let k = 0; k <= 10; k++) {
          const th = Math.PI - (k / 10) * Math.PI;
          pts.push([
            f.cx + rx * Math.cos(th),
            soleTop - 0.002 + ry * Math.sin(th),
            f.z,
          ]);
        }
        add(ribbon(pts, [0, 0, 1], 0.007, 0.002), upperMat);
      }
      continue;
    }
    const upperGeo = loft(upperStations(fs, spec), {
      power: 2.1,
      capStart: true,
      capEnd: true,
    });
    const m = new THREE.Mesh(upperGeo, [upperMat, insideMat]);
    m.castShadow = true;
    g.add(m);
    if (style === "sneakers") {
      // つま先の補強と、靴ひもの部分
      const toe = upperStations(fs, spec, 0.0012).filter(
        (_, k) => k / SHOE_N >= 0.86,
      );
      add(loft(toe, { power: 2.3, capStart: true, capEnd: true }), soleMat);
      const pts: V3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = lerp(spec.collar!.throat + 0.03, 0.78, k / 8);
        const f = footAt(fs, t);
        const top = Math.max(f.top, 0.015 * smoothstep((t - 0.45) / 0.3));
        pts.push([f.cx, top + spec.pad + 0.0012, f.z]);
      }
      add(ribbon(pts, [1, 0, 0], 0.008, 0.002), laceMat);
      // かかとのつまみ
      const heel = footAt(fs, 0);
      const zb = fs.heelZ - HEEL_EXT + 0.0015;
      add(
        ribbon(
          [
            [heel.cx, spec.sole(0) + 0.004, zb],
            [heel.cx, spec.collar!.heel + 0.0045, zb - 0.001],
          ],
          [1, 0, 0],
          0.007,
          0.0025,
        ),
        laceMat,
      );
    }
  }
  if (style === "boots") {
    const { human, fit } = fig;
    const mesh = human.tights;
    const pos = fit.tights;
    const aux = fit.aux.tights;
    const topT = 0.62;
    const topY = lerp(fit.marks.crotchY, fit.marks.ankleY, topT);
    const lowY = fit.marks.ankleY - 0.012;
    const legIdx: number[] = [];
    for (let f = 0; f < mesh.index.length; f += 3) {
      const a = mesh.index[f];
      const b = mesh.index[f + 1];
      const c = mesh.index[f + 2];
      if (
        [a, b, c].some((v) => aux.legT[v] >= topT) &&
        [a, b, c].every(
          (v) => mesh.parts[v * 4 + 2] >= 0.5 && pos[v * 3 + 1] >= lowY,
        )
      )
        legIdx.push(a, b, c);
    }
    const used = new Map<number, number>();
    const out: number[] = [];
    const index: number[] = [];
    for (const v of legIdx) {
      let j = used.get(v);
      if (j === undefined) {
        j = used.size;
        used.set(v, j);
        out.push(pos[v * 3], Math.min(pos[v * 3 + 1], topY), pos[v * 3 + 2]);
      }
      index.push(j);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // 少し外にふくらませる（足首のところはアッパーと重なるように広めに）
    const n = geo.attributes.normal;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const e =
        0.008 + 0.003 * smoothstep((fit.marks.ankleY + 0.03 - y) / 0.04);
      p.setXYZ(
        i,
        p.getX(i) + n.getX(i) * e,
        y + n.getY(i) * e,
        p.getZ(i) + n.getZ(i) * e,
      );
    }
    geo.computeVertexNormals();
    add(geo, upperMat);
  }
  return g;
}

/** 体型に合わせて服1着の形を作る */
export function buildGarment(
  fig: Figure,
  shape: LookShape,
  paint: Paint,
  layers?: Layers,
): THREE.Group {
  if (shape.kind === "shoes") return buildShoes(fig, shape, paint);
  const g = new THREE.Group();
  for (const piece of garmentPieces(
    fig.human,
    fig.fit,
    shape,
    {
      bodyU: paint.bodyU,
      tile: paint.tile,
      sleeveTile: paint.sleeveTile ?? paint.tile,
    },
    layers,
  )) {
    // 材質は 0: 前（写真1枚）、1: 背中・パンツなど（生地の見本）、2: 袖（袖の見本）
    const mesh = new THREE.Mesh(piece.geometry, [
      fabric(paint, piece.body),
      fabric(paint, "swatch"),
      fabric(paint, "sleeve"),
    ]);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}
