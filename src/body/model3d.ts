// 3Dのマネキン（人体メッシュ）に服を着せる（three.js）。
// 体型は BodyScan（輪切りの寸法）、男女・体重の大まかな形は Profile から。単位は身長＝1、床が y=0。
import * as THREE from "three";
import type { LookShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import { garmentPieces, underwear, type UvMode } from "./garments";
import { fitHuman, loadHuman, type Fitted, type Human, type V3 } from "./human";
import type { BodyScan } from "./types";

export { THREE };

/** 体型に合わせて変形ずみの人体 */
export interface Figure {
  human: Human;
  fit: Fitted;
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
  /** whole の横方向のうち、胴（袖を除いた部分）が写っている範囲 */
  bodyU?: [number, number];
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
export function fabric(paint: Paint, kind: UvMode): THREE.MeshPhysicalMaterial {
  const base = kind === "whole" ? paint.whole : paint.swatch;
  let map: THREE.Texture | undefined;
  if (base) {
    map = base.clone();
    map.needsUpdate = true;
    if (kind === "whole") {
      map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      // 折り返して敷き詰める（つなぎ目の段差が出ない）
      map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
    }
  }
  return new THREE.MeshPhysicalMaterial({
    color: map ? "#ffffff" : paint.color,
    map,
    roughness: 0.92,
    metalness: 0,
    sheen: 0.45,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color("#ffffff"),
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

/** マネキン本体（肌・目・下着がわりの薄い一枚）。靴をはくときは足を少し小さくして靴から出ないようにする */
export function buildBody(fig: Figure, opts: { shoes: boolean }): THREE.Group {
  const { human, fit } = fig;
  const g = new THREE.Group();
  const pos = new Float32Array(fit.body);
  if (opts.shoes) {
    const m = fit.marks;
    for (let i = 0; i < pos.length / 3; i++) {
      if (human.body.parts[i * 4 + 2] < 0.5) continue;
      const y = pos[i * 3 + 1];
      const f = m.foot[pos[i * 3] < 0 ? 0 : 1];
      if (y > f.ankle[1] + 0.012) continue;
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
}
const SEG = 28;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 楕円の輪を順につないだ筒。power を大きくすると角ばる */
function loft(
  stations: Station[],
  opts: { power?: number; capStart?: boolean; capEnd?: boolean } = {},
): THREE.BufferGeometry {
  const power = opts.power ?? 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
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
      pos.push(
        s.c[0] + n1.x * a + n2.x * b,
        s.c[1] + n1.y * a + n2.y * b,
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
      if (flipAll) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
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
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface Foot {
  ankle: V3;
  heelZ: number;
  toeZ: number;
  width: number;
}

/** 足の中心線上の点。t=0 がかかと、1 がつま先。少しだけ外向き */
function footPoint(f: Foot, side: 1 | -1, t: number, y: number): V3 {
  const z0 = f.heelZ - 0.006;
  const z1 = f.toeZ + 0.008;
  const z = lerp(z0, z1, t);
  const ang = side * 0.06;
  return [
    f.ankle[0] + (z - f.ankle[2]) * Math.sin(ang),
    y,
    f.ankle[2] + (z - f.ankle[2]) * Math.cos(ang),
  ];
}

/** 靴の形。かかとは丸く、甲はつま先に向かって低くなり、つま先は丸くすぼまる */
function footStations(
  f: Foot,
  side: 1 | -1,
  inflate: number,
  height: number,
  lift: number,
): Station[] {
  const w = f.width;
  const h = f.ankle[1] * height;
  const profile: [number, number, number, number][] = [
    [0, 0.55, 0.22, 0.3],
    [0.07, 0.52, 0.42, 0.48],
    [0.2, 0.5, 0.5, 0.5],
    [0.36, 0.47, 0.53, 0.47],
    [0.52, 0.4, 0.56, 0.4],
    [0.68, 0.32, 0.56, 0.32],
    [0.81, 0.25, 0.52, 0.25],
    [0.9, 0.2, 0.44, 0.2],
    [0.96, 0.16, 0.3, 0.14],
    [1, 0.14, 0.15, 0.08],
  ];
  return profile.map(([t, yc, rw, rh]) => ({
    c: footPoint(f, side, t, h * yc + lift + 0.003),
    rx: w * rw + inflate,
    rz: h * rh + inflate,
  }));
}

function soleStations(f: Foot, side: 1 | -1, thick: number): Station[] {
  const widths = [0.25, 0.46, 0.54, 0.57, 0.6, 0.6, 0.56, 0.48, 0.34, 0.18];
  return widths.map((rw, i) => ({
    c: footPoint(f, side, i / (widths.length - 1), thick / 2 + 0.002),
    rx: f.width * rw + 0.004,
    rz: thick / 2,
  }));
}

/** 靴。足首から上（ブーツ）はタイツの脚の部分を使う */
function buildShoes(
  fig: Figure,
  shape: Extract<LookShape, { kind: "shoes" }>,
  paint: Paint,
): THREE.Group {
  const g = new THREE.Group();
  const height =
    shape.style === "boots"
      ? 1.1
      : shape.style === "leather"
        ? 0.8
        : shape.style === "sandals"
          ? 0.5
          : 1;
  const sole =
    shape.style === "sneakers" ? 0.012 : shape.style === "boots" ? 0.01 : 0.006;
  const upper = fabric(paint, "swatch");
  upper.sheen = 0.1;
  upper.roughness = shape.style === "leather" ? 0.45 : 0.8;
  const soleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(paint.color).multiplyScalar(0.45),
    roughness: 0.9,
    metalness: 0,
  });
  fig.fit.marks.foot.forEach((f, s) => {
    const side = s === 0 ? -1 : 1;
    g.add(
      new THREE.Mesh(
        loft(footStations(f, side, 0.005, height, sole), {
          capStart: true,
          capEnd: true,
        }),
        upper,
      ),
    );
    g.add(
      new THREE.Mesh(
        loft(soleStations(f, side, sole), {
          power: 2.6,
          capStart: true,
          capEnd: true,
        }),
        soleMat,
      ),
    );
  });
  if (shape.style === "boots") {
    const { human, fit } = fig;
    const mesh = human.tights;
    const pos = fit.tights;
    const aux = fit.aux.tights;
    const topT = 0.62;
    const topY = lerp(fit.marks.crotchY, fit.marks.ankleY, topT);
    const legIdx: number[] = [];
    for (let f = 0; f < mesh.index.length; f += 3) {
      const a = mesh.index[f];
      const b = mesh.index[f + 1];
      const c = mesh.index[f + 2];
      if (
        [a, b, c].some((v) => aux.legT[v] >= topT) &&
        [a, b, c].every((v) => mesh.parts[v * 4 + 2] >= 0.5)
      )
        legIdx.push(a, b, c);
    }
    const used = new Map<number, number>();
    const out: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (const v of legIdx) {
      let j = used.get(v);
      if (j === undefined) {
        j = used.size;
        used.set(v, j);
        const y = Math.min(pos[v * 3 + 1], topY);
        out.push(pos[v * 3] * 1.0, y, pos[v * 3 + 2]);
        uv.push(aux.legT[v] * 4, y * 6);
      }
      index.push(j);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // 少し外にふくらませる
    const n = geo.attributes.normal;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++)
      p.setXYZ(
        i,
        p.getX(i) + n.getX(i) * 0.008,
        p.getY(i) + n.getY(i) * 0.008,
        p.getZ(i) + n.getZ(i) * 0.008,
      );
    // 筒の部分は模様を敷き詰めると縞に見えるので、無地にする
    g.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: paint.color,
          roughness: 0.6,
          metalness: 0,
          side: THREE.DoubleSide,
        }),
      ),
    );
  }
  return g;
}

/** 体型に合わせて服1着の形を作る */
export function buildGarment(
  fig: Figure,
  shape: LookShape,
  paint: Paint,
): THREE.Group {
  if (shape.kind === "shoes") return buildShoes(fig, shape, paint);
  const g = new THREE.Group();
  for (const piece of garmentPieces(fig.human, fig.fit, shape, {
    bodyU: paint.bodyU,
  })) {
    const mesh = new THREE.Mesh(piece.geometry, [
      fabric(paint, piece.body),
      fabric(paint, "swatch"),
    ]);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}
