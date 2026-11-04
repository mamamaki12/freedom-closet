// 靴の3Dの型（スニーカー）。元は Khronos glTF-Sample-Assets の「Materials Variants Shoe」（© 2021 Shopify、CC BY 4.0）で、
// tools/body/build-shoe.mjs でロゴを消し、色を塗れるように作り直したもの。
// 型は右足用で、靴の長さ＝1、かかとが z=0・つま先が z=1、床が y=0、親指側が +x。
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import baseUrl from "./assets/shoe-base.jpg?url";
import maskUrl from "./assets/shoe-mask.png?url";
import normalUrl from "./assets/shoe-normal.jpg?url";
import ormUrl from "./assets/shoe-orm.jpg?url";
import shoeUrl from "./assets/shoe.glb?url";

export interface ShoeModel {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint16Array | Uint32Array;
}

/** glb のデータをほどく（テストからも使う） */
export function parseShoe(buffer: ArrayBuffer): Promise<ShoeModel> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<ShoeModel>((resolve, reject) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        try {
          gltf.scene.updateMatrixWorld(true);
          let mesh: THREE.Mesh | undefined;
          gltf.scene.traverse((o) => {
            if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
          });
          if (!mesh) throw new Error("靴の3Dデータに形がありません");
          const g = mesh.geometry;
          const p = g.attributes.position;
          const nr = g.attributes.normal;
          const tc = g.attributes.uv;
          if (!nr || !tc || !g.index)
            throw new Error("靴の3Dデータに向き・模様の座標がありません");
          const m = mesh.matrixWorld;
          const nm = new THREE.Matrix3().getNormalMatrix(m);
          const n = p.count;
          const position = new Float32Array(n * 3);
          const normal = new Float32Array(n * 3);
          const uv = new Float32Array(n * 2);
          const v = new THREE.Vector3();
          for (let i = 0; i < n; i++) {
            v.fromBufferAttribute(p, i).applyMatrix4(m);
            position[i * 3] = v.x;
            position[i * 3 + 1] = v.y;
            position[i * 3 + 2] = v.z;
            v.fromBufferAttribute(nr, i).applyMatrix3(nm).normalize();
            normal[i * 3] = v.x;
            normal[i * 3 + 1] = v.y;
            normal[i * 3 + 2] = v.z;
            uv[i * 2] = tc.getX(i);
            uv[i * 2 + 1] = tc.getY(i);
          }
          const idx = g.index.array;
          const index =
            idx instanceof Uint32Array
              ? new Uint32Array(idx)
              : new Uint16Array(idx);
          resolve({ position, normal, uv, index });
        } catch (e) {
          reject(e);
        }
      },
      reject,
    );
  });
}

// ---------- 読み込み ----------

export interface ShoeAsset {
  model: ShoeModel;
  /** 色を塗る下地と、塗り分けの範囲（R 甲・G 底・B 濃い部分） */
  base: ImageData;
  mask: ImageData;
  /** 凹凸（革靴では甲の編み目を消して使う） */
  normal: ImageData;
  /** R が陰（AO）、G が表面の粗さ */
  orm: THREE.Texture;
}

async function fetchOk(url: string): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`靴の3Dデータを読み込めませんでした（${r.status}）`);
  return r;
}

async function bitmap(url: string): Promise<ImageBitmap> {
  const blob = await (await fetchOk(url)).blob();
  return createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
}

async function imageData(url: string): Promise<ImageData> {
  const bmp = await bitmap(url);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

async function dataTexture(url: string): Promise<THREE.Texture> {
  const t = new THREE.Texture(await bitmap(url));
  // glTF の模様の座標は上下を反転しない
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

let loading: Promise<ShoeAsset> | undefined;

/** 靴の3Dの型と模様を読み込む（1回だけ） */
export function loadShoe(): Promise<ShoeAsset> {
  if (!loading) {
    loading = Promise.all([
      fetchOk(shoeUrl)
        .then((r) => r.arrayBuffer())
        .then(parseShoe),
      imageData(baseUrl),
      imageData(maskUrl),
      imageData(normalUrl),
      dataTexture(ormUrl),
    ]).then(([model, base, mask, normal, orm]) => ({
      model,
      base,
      mask,
      normal,
      orm,
    }));
    loading.catch(() => (loading = undefined));
  }
  return loading;
}

// ---------- 足に合わせて置く ----------

/** 足の形（model3d.ts の measureFoot が測る）。z はかかと→つま先、cx は輪切りの中心、halfW は半分の幅、top は高さ */
export interface FootFit {
  heelZ: number;
  toeZ: number;
  slices: { z: number; cx: number; halfW: number; top: number }[];
}

/** 足のかかと・つま先から靴の外側までのゆとり（身長＝1。0.006 ≈ 1cm） */
const HEEL_ROOM = 0.0065;
const TOE_ROOM = 0.011;

/** 型の幅と、型の中心の線（x = a + b·z） */
interface ShoeStats {
  width: number;
  a: number;
  b: number;
}
const statsCache = new WeakMap<ShoeModel, ShoeStats>();

function lineFit(pts: [number, number][]): [number, number] {
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const n = pts.length;
  const d = n * sxx - sx * sx;
  const b = Math.abs(d) < 1e-12 ? 0 : (n * sxy - sx * sy) / d;
  return [(sy - b * sx) / n, b];
}

function shoeStats(model: ShoeModel): ShoeStats {
  let s = statsCache.get(model);
  if (s) return s;
  const P = model.position;
  const N = 10;
  const lo = new Array<number>(N).fill(Infinity);
  const hi = new Array<number>(N).fill(-Infinity);
  for (let i = 0; i < P.length / 3; i++) {
    const k = Math.floor(P[i * 3 + 2] * N);
    if (k < 0 || k >= N) continue;
    lo[k] = Math.min(lo[k], P[i * 3]);
    hi[k] = Math.max(hi[k], P[i * 3]);
  }
  let width = 0;
  const pts: [number, number][] = [];
  for (let k = 1; k < N - 1; k++) {
    if (!Number.isFinite(lo[k])) continue;
    width = Math.max(width, hi[k] - lo[k]);
    pts.push([(k + 0.5) / N, (lo[k] + hi[k]) / 2]);
  }
  const [a, b] = lineFit(pts);
  s = { width: width || 0.39, a, b };
  statsCache.set(model, s);
  return s;
}

/**
 * 型を足に合わせて置いた形（体の座標）。side は -1 が右足（x<0）、1 が左足（型を左右反転する）。
 * 長さは足の長さにゆとりを足し、幅は足が収まるように少し広げ、向きは足の向きにそろえる。
 * lift(y) で型の高さ（0〜型の高さ）を変えられる（底を薄くする、履き口を低くする）
 */
export function fitShoe(
  model: ShoeModel,
  foot: FootFit,
  side: 1 | -1,
  lift: (y: number) => number = (y) => y,
): THREE.BufferGeometry {
  const st = shoeStats(model);
  const len = foot.toeZ - foot.heelZ;
  const k = len + HEEL_ROOM + TOE_ROOM;
  const maxHalfW = Math.max(...foot.slices.map((s) => s.halfW));
  const kx = Math.min(1.25 * k, Math.max(k, (2 * maxHalfW + 0.006) / st.width));
  // 足の中心の線（cx = a + b·z）
  const [fa, fb] = lineFit(foot.slices.map((s) => [s.z, s.cx]));
  const z0 = foot.heelZ - HEEL_ROOM;
  const d = new THREE.Vector2(fb, 1).normalize(); // 足の向き（x, z）
  const ox = fa + fb * z0;
  const P = model.position;
  const NN = model.normal;
  const n = P.length / 3;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const h = 1e-3;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    // 型の中心の線を x=0 にそろえてから大きさを合わせる（右足の型。左足は x を反転）
    const lx = (x - (st.a + st.b * z)) * kx * -side;
    const ly = lift(y);
    const lz = z * k;
    pos[i * 3] = ox + lx * d.y + lz * d.x;
    pos[i * 3 + 1] = ly * k;
    pos[i * 3 + 2] = z0 + lz * d.y - lx * d.x;
    // 向きも同じ変形で（ずれ・伸び縮みの逆の転置を掛ける）
    const dl = (lift(y + h) - lift(y - h)) / (2 * h) || 1;
    let nx = NN[i * 3] / kx;
    let ny = NN[i * 3 + 1] / (dl * k);
    let nz = (NN[i * 3 + 2] + st.b * NN[i * 3]) / k;
    nx *= -side;
    const wx = nx * d.y + nz * d.x;
    const wz = nz * d.y - nx * d.x;
    nx = wx;
    nz = wz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[i * 3] = nx / l;
    nrm[i * 3 + 1] = ny / l;
    nrm[i * 3 + 2] = nz / l;
  }
  const index =
    model.index instanceof Uint32Array
      ? new Uint32Array(model.index)
      : new Uint16Array(model.index);
  if (side === 1) {
    // 左右反転すると三角形の表裏が逆になるので、頂点の順を入れ替える
    for (let f = 0; f < index.length; f += 3) {
      const t = index[f + 1];
      index[f + 1] = index[f + 2];
      index[f + 2] = t;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(model.uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// ---------- 色を塗る ----------

/** 靴の見た目。sneakers は布の甲と白いゴム底、leather は革の甲と薄くて濃い色の底 */
export type ShoeLook = "sneakers" | "leather";

/** 甲の下地の明るさの平均（build-shoe.mjs でこの明るさにそろえてある） */
const UPPER_MEAN = 0.82;
/** 革靴の底の色 */
const LEATHER_SOLE: [number, number, number] = [44, 37, 33];

function srgb(color: string): [number, number, number] {
  const c = new THREE.Color(color);
  const o = { r: 0, g: 0, b: 0 };
  c.getRGB(o, THREE.SRGBColorSpace);
  return [o.r * 255, o.g * 255, o.b * 255];
}

function canvasTexture(img: ImageData, color: boolean): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  // glTF の模様の座標は上下を反転しない
  t.flipY = false;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

const painted = new Map<string, THREE.Texture>();

/**
 * 下地に靴の色を塗った模様。
 * スニーカー：甲だけに色を掛け（編み目の濃淡は残す）、底（白いゴム）と濃い部分（ひも・履き口・かかと）はそのまま。
 * 革靴：甲はなめらかな一色、ひもなどの濃い部分は甲の色を濃くした色、底は濃い茶色
 */
export function shoeColorMap(
  asset: ShoeAsset,
  color: string,
  look: ShoeLook,
): THREE.Texture {
  const key = `${look}|${color}`;
  let t = painted.get(key);
  if (t) return t;
  const { width: w, height: h, data: B } = asset.base;
  const M = asset.mask.data;
  const out = new ImageData(w, h);
  const O = out.data;
  const tint = srgb(color);
  for (let i = 0; i < w * h; i++) {
    const up = M[i * 4] / 255;
    const so = M[i * 4 + 1] / 255;
    const f = B[i * 4] / (UPPER_MEAN * 255);
    for (let ch = 0; ch < 3; ch++) {
      const v = B[i * 4 + ch];
      let o: number;
      if (look === "sneakers") o = v * (1 - up) + Math.min(255, tint[ch] * f) * up;
      else {
        // 底は元の明るさの濃淡を少しだけ残す
        const sole = LEATHER_SOLE[ch] * (0.85 + 0.15 * (v / 255));
        o = tint[ch] * up + sole * so + tint[ch] * 0.5 * Math.max(0, 1 - up - so);
      }
      O[i * 4 + ch] = Math.round(o);
    }
    O[i * 4 + 3] = 255;
  }
  t = canvasTexture(out, true);
  painted.set(key, t);
  return t;
}

const normals = new Map<ShoeAsset, Map<ShoeLook, THREE.Texture>>();

/** 凹凸の模様。革靴は甲の編み目を消す（縫い目や底の凹凸はそのまま） */
function shoeNormalMap(asset: ShoeAsset, look: ShoeLook): THREE.Texture {
  let byLook = normals.get(asset);
  if (!byLook) normals.set(asset, (byLook = new Map()));
  let t = byLook.get(look);
  if (t) return t;
  const src = asset.normal;
  if (look === "sneakers") t = canvasTexture(src, false);
  else {
    const out = new ImageData(src.width, src.height);
    const M = asset.mask.data;
    const flat = [128, 128, 255];
    for (let i = 0; i < src.width * src.height; i++) {
      const up = M[i * 4] / 255;
      for (let ch = 0; ch < 3; ch++)
        out.data[i * 4 + ch] = Math.round(src.data[i * 4 + ch] * (1 - up) + flat[ch] * up);
      out.data[i * 4 + 3] = 255;
    }
    t = canvasTexture(out, false);
  }
  byLook.set(look, t);
  return t;
}

/** 靴の材質（スニーカー：布の甲とゴムの底。革靴：つやのある革と、濃い色の底） */
export function shoeMaterial(
  asset: ShoeAsset,
  color: string,
  look: ShoeLook,
): THREE.MeshPhysicalMaterial {
  const map = shoeColorMap(asset, color, look);
  const normalMap = shoeNormalMap(asset, look);
  if (look === "leather")
    return new THREE.MeshPhysicalMaterial({
      map,
      normalMap,
      aoMap: asset.orm,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.32,
    });
  return new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    aoMap: asset.orm,
    roughnessMap: asset.orm,
    roughness: 1,
    metalness: 0,
    sheen: 0.3,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color("#ffffff"),
    sheenColorMap: map,
  });
}

/**
 * 型の高さの変え方。履き口より上（かかとの上・ベロ・引き手）は低めにして、パンツのすそから突き出ないようにする。
 * 革靴はさらに底を薄くし（かかとは少し厚いまま）、甲は少し高くして足を収める
 */
export function shoeLift(look: ShoeLook): (y: number) => number {
  const top = (y: number) => (y < 0.3 ? y : 0.3 + (y - 0.3) * 0.6);
  if (look === "sneakers") return top;
  const s = 0.09;
  return (y) => top(y < s ? y * 0.45 : s * 0.45 + (y - s) * 1.1);
}
