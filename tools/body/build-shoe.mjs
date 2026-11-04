#!/usr/bin/env node
// 靴の 3D データ（Khronos glTF-Sample-Assets の「Materials Variants Shoe」、© 2021 Shopify、CC BY 4.0）から、
// アプリで使う靴の形と模様を作る。
//
//   sh tools/body/fetch-shoe.sh        # 元データを取ってくる（初回だけ）
//   node tools/body/build-shoe.mjs     # → src/body/assets/shoe.glb, shoe-base.jpg, shoe-mask.png, shoe-normal.jpg, shoe-orm.jpg
//
// 形（shoe.glb）：右足のスニーカー1つ。単位は靴の長さ＝1、かかとが z=0・つま先が z=1、床が y=0、
//   内側（親指側）が +x。左足は x を反転して使う。
// 模様：
// - shoe-base.jpg：色を塗る下地。甲（色の変わるところ）は明るい灰色の濃淡だけにしてあり、アプリで靴の色を掛ける。
//   底（白いゴム）と、ひも・履き口などの濃い部分は元の色のまま。かかとのロゴは消してある
//   （元データのライセンスはロゴ・商標を含まないため。靴底の横の刻印も消す）
// - shoe-mask.png：R が甲、G が底、B が濃い部分（それぞれ 0〜255）
// - shoe-normal.jpg：凹凸、shoe-orm.jpg：R が陰（AO）、G が表面の粗さ
// 元データの3色（Midnight・Beach・Street）で色が変わるところを「甲」とみなす。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ?? path.join(here, ".cache/shoe/Models/MaterialsVariantsShoe/glTF");
const outDir = process.argv[3] ?? path.join(here, "../../src/body/assets");
const SIZE = 512;

// ---------- 形 ----------
const gltf = JSON.parse(fs.readFileSync(path.join(src, "MaterialsVariantsShoe.gltf"), "utf8"));
const bin = fs.readFileSync(path.join(src, gltf.buffers[0].uri));
function accessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
  const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * T.BYTES_PER_ELEMENT));
}
const prim = gltf.meshes[0].primitives[0];
const P = accessor(prim.attributes.POSITION);
const N = accessor(prim.attributes.NORMAL);
const UV = accessor(prim.attributes.TEXCOORD_0);
const I = accessor(prim.indices);
const count = P.length / 3;

// 元データは つま先が +x、上が +y、親指側が -z（つま先の先端が -z に寄っている）。長さは x の -1〜1
let xmin = Infinity;
let ymin = Infinity;
for (let i = 0; i < count; i++) {
  xmin = Math.min(xmin, P[i * 3]);
  ymin = Math.min(ymin, P[i * 3 + 1]);
}
let xmax = -Infinity;
for (let i = 0; i < count; i++) xmax = Math.max(xmax, P[i * 3]);
const len = xmax - xmin;
const pos = new Float32Array(count * 3);
const nrm = new Float32Array(count * 3);
for (let i = 0; i < count; i++) {
  const [x, y, z] = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  pos[i * 3] = -z / len;
  pos[i * 3 + 1] = (y - ymin) / len;
  pos[i * 3 + 2] = (x - xmin) / len;
  const [nx, ny, nz] = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
  nrm[i * 3] = -nz;
  nrm[i * 3 + 1] = ny;
  nrm[i * 3 + 2] = nx;
}

const index = count < 65536 ? Uint16Array.from(I) : Uint32Array.from(I);

// ---------- 模様 ----------
async function raw(file) {
  return sharp(path.join(src, file)).resize(SIZE, SIZE, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer();
}
const mid = await raw("diffuseMidnight.jpg");
const beach = await raw("diffuseBeach.jpg");
const street = await raw("diffuseStreet.jpg");
const normal = await raw("normal.jpg");
const orm = await raw("occlusionRougnessMetalness.jpg");
const n = SIZE * SIZE;
const lum = (d, i) => 0.299 * d[i * 3] + 0.587 * d[i * 3 + 1] + 0.114 * d[i * 3 + 2];
const dist = (a, b, i) =>
  Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]);

const upper = new Float32Array(n);
const sole = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const d = Math.max(dist(mid, beach, i), dist(mid, street, i), dist(beach, street, i));
  // 3色で色が変わるところが甲。変わらない明るいところが底、変わらない濃いところがひも・履き口など
  upper[i] = Math.min(1, Math.max(0, (d - 30) / 30));
  const l = Math.min(lum(mid, i), lum(beach, i), lum(street, i));
  sole[i] = (1 - upper[i]) * Math.min(1, Math.max(0, (l - 140) / 40));
}

// かかとのロゴ（黒い当て布の上の3本の斜めの線）を消す：当て布の黒で塗り、凹凸も平らにする
const logo = { x0: 136, x1: 162, y0: 150, y1: 182 };
const patch = [];
const patchOrm = [];
for (let y = logo.y0 - 6; y <= logo.y1 + 6; y++)
  for (let x = logo.x0 - 6; x <= logo.x1 + 6; x++) {
    const i = y * SIZE + x;
    const inBox = x >= logo.x0 && x <= logo.x1 && y >= logo.y0 && y <= logo.y1;
    if (lum(mid, i) < 40) patch.push([mid[i * 3], mid[i * 3 + 1], mid[i * 3 + 2]]);
    // 陰・粗さは、ロゴの外の当て布から取る（ロゴの凹凸が陰にも残っているため）
    if (lum(mid, i) < 40 && !inBox) patchOrm.push([orm[i * 3], orm[i * 3 + 1]]);
  }
const median = (list, c, fallback) => {
  const v = list.map((p) => p[c]).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? fallback;
};
const black = [0, 1, 2].map((c) => median(patch, c, 20));
const flatOrm = [0, 1].map((c) => median(patchOrm, c, 200));
let removed = 0;
for (let y = logo.y0; y <= logo.y1; y++)
  for (let x = logo.x0; x <= logo.x1; x++) {
    const i = y * SIZE + x;
    if (lum(mid, i) < 32 && upper[i] < 0.5) continue;
    removed++;
    for (const d of [mid, beach, street]) for (let c = 0; c < 3; c++) d[i * 3 + c] = black[c];
    upper[i] = 0;
    sole[i] = 0;
    normal[i * 3] = 128;
    normal[i * 3 + 1] = 128;
    normal[i * 3 + 2] = 255;
  }
for (let y = logo.y0 - 5; y <= logo.y1 + 5; y++)
  for (let x = logo.x0 - 5; x <= logo.x1 + 5; x++) {
    const i = y * SIZE + x;
    if (upper[i] >= 0.5 || lum(mid, i) >= 40) continue;
    orm[i * 3] = flatOrm[0];
    orm[i * 3 + 1] = flatOrm[1];
  }

// 靴底の横の刻印（3本の斜めの線と「FOAM」の文字。凹凸の模様にだけある）も消す：
// すぐ左どなりの同じゴムの凹凸を写し、ふちは元となじませる
const stamp = { x0: 433, x1: 453, y0: 182, y1: 252 };
const shift = stamp.x1 - stamp.x0 + 1;
for (let y = stamp.y0; y <= stamp.y1; y++)
  for (let x = stamp.x0; x <= stamp.x1; x++) {
    const i = y * SIZE + x;
    const j = y * SIZE + x - shift;
    const edge = Math.min(x - stamp.x0, stamp.x1 - x, y - stamp.y0, stamp.y1 - y);
    const w = Math.min(1, (edge + 1) / 3);
    for (let c = 0; c < 3; c++) normal[i * 3 + c] = Math.round(normal[j * 3 + c] * w + normal[i * 3 + c] * (1 - w));
  }

// 下地：甲は明るさの濃淡だけ（平均 0.82 の灰色）、ほかは元の色（Midnight）
let sum = 0;
let wsum = 0;
for (let i = 0; i < n; i++) {
  sum += lum(mid, i) * upper[i];
  wsum += upper[i];
}
const meanUpper = sum / Math.max(1, wsum);
const base = Buffer.alloc(n * 3);
const mask = Buffer.alloc(n * 3);
for (let i = 0; i < n; i++) {
  const g = Math.min(255, (lum(mid, i) / meanUpper) * 0.82 * 255);
  for (let c = 0; c < 3; c++) base[i * 3 + c] = Math.round(mid[i * 3 + c] * (1 - upper[i]) + g * upper[i]);
  mask[i * 3] = Math.round(upper[i] * 255);
  mask[i * 3 + 1] = Math.round(sole[i] * 255);
  mask[i * 3 + 2] = Math.round((1 - upper[i] - sole[i]) * 255);
}
const img = (buf) => sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 3 } });
await img(base).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(outDir, "shoe-base.jpg"));
await img(mask).png({ compressionLevel: 9, palette: false }).toFile(path.join(outDir, "shoe-mask.png"));
await img(normal).jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(outDir, "shoe-normal.jpg"));
// ORM：B（金属っぽさ）は使わないので 0 に
for (let i = 0; i < n; i++) orm[i * 3 + 2] = 0;
await img(orm).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(outDir, "shoe-orm.jpg"));

// ---------- glb に書き出す（形だけ。模様はアプリで色を塗ってから貼る） ----------
function glb(json, chunks) {
  const pad = (b, v) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, v)]);
  const binBuf = pad(Buffer.concat(chunks.map((c) => pad(Buffer.from(c.buffer, c.byteOffset, c.byteLength), 0))), 0);
  let offset = 0;
  json.bufferViews = chunks.map((c) => {
    const v = { buffer: 0, byteOffset: offset, byteLength: c.byteLength };
    offset += c.byteLength + ((4 - (c.byteLength % 4)) % 4);
    return v;
  });
  json.buffers = [{ byteLength: binBuf.length }];
  const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const ch = (type, buf) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(buf.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, buf]);
  };
  return Buffer.concat([header, ch(0x4e4f534a, jsonBuf), ch(0x004e4942, binBuf)]);
}
const bounds = (a) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], a[i + k]);
      hi[k] = Math.max(hi[k], a[i + k]);
    }
  return { min: lo, max: hi };
};
const json = {
  asset: { version: "2.0", generator: "freedom-closet build-shoe.mjs", copyright: "© 2021 Shopify, CC BY 4.0 (Materials Variants Shoe)" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "shoe", mesh: 0 }],
  materials: [{ name: "shoe", pbrMetallicRoughness: { metallicFactor: 0 } }],
  meshes: [{ name: "shoe", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
  accessors: [
    { bufferView: 0, componentType: 5126, count, type: "VEC3", ...bounds(pos) },
    { bufferView: 1, componentType: 5126, count, type: "VEC3" },
    { bufferView: 2, componentType: 5126, count, type: "VEC2" },
    { bufferView: 3, componentType: index instanceof Uint16Array ? 5123 : 5125, count: index.length, type: "SCALAR" },
  ],
};
const rawFile = path.join(here, ".cache/shoe-raw.glb");
fs.writeFileSync(rawFile, glb(json, [pos, nrm, UV, index]));
const gltfpack = path.join(here, "../../node_modules/.bin/gltfpack");
const outFile = path.join(outDir, "shoe.glb");
// 三角形を 6 割に減らし（スマホでも軽く）、meshoptimizer で小さくする。
// 模様の座標（UV）は材質に模様がないと消されるので -kv で残し、-vtf で量子化しない（戻し方が材質側に書かれるため）
execFileSync(gltfpack, ["-i", rawFile, "-o", outFile, "-cc", "-si", "0.6", "-kn", "-kv", "-vtf"], { stdio: "inherit" });
const kb = (f) => (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0);
console.log(
  `ok: shoe.glb ${kb("shoe.glb")}KB, base ${kb("shoe-base.jpg")}KB, mask ${kb("shoe-mask.png")}KB, normal ${kb("shoe-normal.jpg")}KB, orm ${kb("shoe-orm.jpg")}KB, ロゴを消した画素 ${removed}`,
);
