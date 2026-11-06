#!/usr/bin/env node
// ブーツの 3D データ（Sketchfab の「Photoscanned Female Ankle Boots」、作者 TunnelVisionStudio、CC BY 4.0）から、
// アプリで使うブーツの形と模様を作る。
//
//   sh tools/body/fetch-boot.sh        # 元データを取ってくる（初回だけ）
//   node tools/body/build-boot.mjs     # → src/body/assets/boot.glb, boot-base.jpg, boot-mask.png, boot-normal.jpg, boot-orm.jpg
//
// 形（boot.glb）：右足のショートブーツ1つ（ひもと、内側にファスナー）。単位は靴と同じで、長さ＝1、
//   かかとが z=0・つま先が z=1、床が y=0、内側（親指側）が +x。左足は x を反転して使う。
// 模様：
// - boot-base.jpg：色を塗る下地。甲（革）は明るい灰色の濃淡だけにしてあり、アプリでブーツの色を掛ける。
//   底（ゴムと、かかとの積み革）は元の明るさの濃淡だけ（色はアプリで塗る）
// - boot-mask.png：R が甲、G が底、B が内側（外から見えないところ。履き口の内張り・中敷き）
// - boot-normal.jpg：凹凸、boot-orm.jpg：R が陰（AO）、G が表面の粗さ
// 元データは写真から作った形なので、塗り分けは形から決める：外から見えるかどうか（履き口にふたをして、まわりの
// いろいろな向きから見る）と、底からの高さ。中敷きのロゴのような文字は、内側を一色で塗るので残らない。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { glb, meshJson, readGltf } from "./glb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ?? path.join(here, ".cache/boot");
const outDir = process.argv[3] ?? path.join(here, "../../src/body/assets");
/** 調べる用の画像を書き出す先（なければ書かない） */
const debugDir = process.env.BOOT_DEBUG;
const SIZE = 512;

// ---------- 形 ----------
const { gltf, accessor } = readGltf(src, "scene.gltf");

// ノードの行列（4×4、列優先）をかけ合わせて、いちばん大きい形の置き方を求める
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const trs = (n) => {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
};
let best;
const walk = (i, parent) => {
  const node = gltf.nodes[i];
  const m = mul(parent, trs(node));
  if (node.mesh !== undefined)
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const count = gltf.accessors[prim.attributes.POSITION].count;
      // 元データには、形と関係のない8頂点の小さな箱が入っているので、いちばん大きい形だけを使う
      if (!best || count > best.count) best = { prim, m, count };
    }
  for (const c of node.children ?? []) walk(c, m);
};
for (const i of gltf.scenes[gltf.scene ?? 0].nodes) walk(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const { prim, m: M, count } = best;
const P = accessor(prim.attributes.POSITION);
const N = accessor(prim.attributes.NORMAL);
const UV = accessor(prim.attributes.TEXCOORD_0);
const I = accessor(prim.indices);

// 置いたあと（glTF の向き）は、つま先が +z、上が +y、内側（ファスナーのある側。土踏まずのくびれもこちら）が +x の右足
const raw = new Float32Array(count * 3);
const nrm = new Float32Array(count * 3);
for (let i = 0; i < count; i++) {
  const [x, y, z] = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (let r = 0; r < 3; r++) raw[i * 3 + r] = M[r] * x + M[4 + r] * y + M[8 + r] * z + M[12 + r];
  const [a, b, c] = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
  // 拡大・縮小はないので、向きは回転だけかければよい
  const v = [0, 1, 2].map((r) => M[r] * a + M[4 + r] * b + M[8 + r] * c);
  const l = Math.hypot(...v) || 1;
  for (let r = 0; r < 3; r++) nrm[i * 3 + r] = v[r] / l;
}
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < count; i++)
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], raw[i * 3 + k]);
    hi[k] = Math.max(hi[k], raw[i * 3 + k]);
  }
const len = hi[2] - lo[2];
const pos = new Float32Array(count * 3);
for (let i = 0; i < count; i++) {
  pos[i * 3] = (raw[i * 3] - (lo[0] + hi[0]) / 2) / len;
  pos[i * 3 + 1] = (raw[i * 3 + 1] - lo[1]) / len;
  pos[i * 3 + 2] = (raw[i * 3 + 2] - lo[2]) / len;
}
const height = (hi[1] - lo[1]) / len;
const index = count < 65536 ? Uint16Array.from(I) : Uint32Array.from(I);
const tris = index.length / 3;

// ---------- 模様の画素ごとの、形の上の位置 ----------
// 三角形を模様の座標で塗って、画素ごとに位置と向きを覚える
const texPos = new Float32Array(SIZE * SIZE * 3);
const texNrm = new Float32Array(SIZE * SIZE * 3);
const covered = new Uint8Array(SIZE * SIZE);
for (let f = 0; f < tris; f++) {
  const v = [index[f * 3], index[f * 3 + 1], index[f * 3 + 2]];
  const u = v.map((i) => [UV[i * 2] * SIZE - 0.5, UV[i * 2 + 1] * SIZE - 0.5]);
  const x0 = Math.max(0, Math.floor(Math.min(u[0][0], u[1][0], u[2][0])));
  const x1 = Math.min(SIZE - 1, Math.ceil(Math.max(u[0][0], u[1][0], u[2][0])));
  const y0 = Math.max(0, Math.floor(Math.min(u[0][1], u[1][1], u[2][1])));
  const y1 = Math.min(SIZE - 1, Math.ceil(Math.max(u[0][1], u[1][1], u[2][1])));
  const d = (u[1][1] - u[2][1]) * (u[0][0] - u[2][0]) + (u[2][0] - u[1][0]) * (u[0][1] - u[2][1]);
  if (Math.abs(d) < 1e-12) continue;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const a = ((u[1][1] - u[2][1]) * (x - u[2][0]) + (u[2][0] - u[1][0]) * (y - u[2][1])) / d;
      const b = ((u[2][1] - u[0][1]) * (x - u[2][0]) + (u[0][0] - u[2][0]) * (y - u[2][1])) / d;
      const c = 1 - a - b;
      if (a < -1e-4 || b < -1e-4 || c < -1e-4) continue;
      const t = y * SIZE + x;
      covered[t] = 1;
      for (let k = 0; k < 3; k++) {
        texPos[t * 3 + k] = a * pos[v[0] * 3 + k] + b * pos[v[1] * 3 + k] + c * pos[v[2] * 3 + k];
        texNrm[t * 3 + k] = a * nrm[v[0] * 3 + k] + b * nrm[v[1] * 3 + k] + c * nrm[v[2] * 3 + k];
      }
    }
}

// ---------- 外から見えるところ ----------
// 履き口に、ふち近くの高さでふたをする（上から見たときに、中敷きや内張りが「外」にならないように）
const LID = height - 0.06;
const rim = [];
for (let i = 0; i < count; i++) if (pos[i * 3 + 1] > LID - 0.08 && pos[i * 3 + 1] < LID) rim.push([pos[i * 3], pos[i * 3 + 2]]);
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const lidPts = hull(rim);
const lidC = lidPts.reduce((s, q) => [s[0] + q[0] / lidPts.length, s[1] + q[1] / lidPts.length], [0, 0]);
// ふたの三角形（形の三角形のあとに足して、見えるかどうかを調べるときだけ使う）
const occPos = [...pos];
const occIdx = [...index];
const c0 = occPos.length / 3;
occPos.push(lidC[0], LID, lidC[1]);
lidPts.forEach((q) => occPos.push(q[0], LID, q[1]));
for (let k = 0; k < lidPts.length; k++) occIdx.push(c0, c0 + 1 + k, c0 + 1 + ((k + 1) % lidPts.length));

// まわりのいろいろな向きから、奥行きの図を描いて、画素の位置がいちばん手前かを調べる
const G = 512;
const EPS = 0.004;
const visible = new Uint8Array(SIZE * SIZE);
const dirs = [];
for (let e = -90; e <= 90; e += 22.5) {
  const steps = Math.abs(e) === 90 ? 1 : 16;
  for (let a = 0; a < steps; a++) {
    const th = (a / steps) * Math.PI * 2;
    const ce = Math.cos((e * Math.PI) / 180);
    dirs.push([Math.sin(th) * ce, Math.sin((e * Math.PI) / 180), Math.cos(th) * ce]);
  }
}
const depth = new Float32Array(G * G);
for (const d of dirs) {
  // 見る向き d に垂直な2つの向き
  const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
  const ul = Math.hypot(...ux);
  for (let k = 0; k < 3; k++) ux[k] /= ul;
  const uy = [d[1] * ux[2] - d[2] * ux[1], d[2] * ux[0] - d[0] * ux[2], d[0] * ux[1] - d[1] * ux[0]];
  const proj = (x, y, z) => [
    ((x * ux[0] + y * ux[1] + z * ux[2]) / 1.3 + 0.5) * G,
    ((x * uy[0] + y * uy[1] + z * uy[2] - 0.3) / 1.3 + 0.5) * G,
    x * d[0] + y * d[1] + z * d[2],
  ];
  depth.fill(-Infinity);
  const V = occPos.length / 3;
  const pr = new Float32Array(V * 3);
  for (let i = 0; i < V; i++) pr.set(proj(occPos[i * 3], occPos[i * 3 + 1], occPos[i * 3 + 2]), i * 3);
  for (let f = 0; f < occIdx.length; f += 3) {
    const a = occIdx[f] * 3;
    const b = occIdx[f + 1] * 3;
    const c = occIdx[f + 2] * 3;
    const den = (pr[b + 1] - pr[c + 1]) * (pr[a] - pr[c]) + (pr[c] - pr[b]) * (pr[a + 1] - pr[c + 1]);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(pr[a], pr[b], pr[c])));
    const x1 = Math.min(G - 1, Math.ceil(Math.max(pr[a], pr[b], pr[c])));
    const y0 = Math.max(0, Math.floor(Math.min(pr[a + 1], pr[b + 1], pr[c + 1])));
    const y1 = Math.min(G - 1, Math.ceil(Math.max(pr[a + 1], pr[b + 1], pr[c + 1])));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const l0 = ((pr[b + 1] - pr[c + 1]) * (x - pr[c]) + (pr[c] - pr[b]) * (y - pr[c + 1])) / den;
        const l1 = ((pr[c + 1] - pr[a + 1]) * (x - pr[c]) + (pr[a] - pr[c]) * (y - pr[c + 1])) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
        const z = l0 * pr[a + 2] + l1 * pr[b + 2] + l2 * pr[c + 2];
        const t = y * G + x;
        if (z > depth[t]) depth[t] = z;
      }
  }
  for (let t = 0; t < SIZE * SIZE; t++) {
    if (!covered[t] || visible[t]) continue;
    const [x, y, z] = proj(texPos[t * 3], texPos[t * 3 + 1], texPos[t * 3 + 2]);
    // まわりの画素のうちいちばん奥のものとくらべる（へりで手前の面に負けないように）
    const px = Math.round(x - 0.5);
    const py = Math.round(y - 0.5);
    let far = Infinity;
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const qx = Math.min(G - 1, Math.max(0, px + dx));
        const qy = Math.min(G - 1, Math.max(0, py + dy));
        far = Math.min(far, depth[qy * G + qx]);
      }
    if (z >= far - EPS) visible[t] = 1;
  }
}

// ---------- 調べる用 ----------
async function writeDebug(name, rgb) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  const png = await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();
  fs.writeFileSync(path.join(debugDir, `${name}.png`), png);
  // 形にこの模様を貼った glb（tools/body/.cache/view2.html で見る）
  const json = meshJson("boot", "debug", count, pos, index);
  json.images = [{ bufferView: 4, mimeType: "image/png" }];
  json.textures = [{ source: 0 }];
  json.samplers = [{ magFilter: 9729, minFilter: 9729 }];
  json.materials[0].pbrMetallicRoughness = { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 };
  json.materials[0].doubleSided = true;
  fs.writeFileSync(path.join(debugDir, `${name}.glb`), glb(json, [pos, nrm, UV, index, new Uint8Array(png)]));
}


// ---------- 塗り分け ----------
// 底の上のはし：かかと（積み革）は高さ一定、前（つま先側）は底の下の面から一定の高さ（つま先は反り上がっている）。
// 底の下の面の高さは、長さ方向の輪切りごとの、いちばん低い頂点
const ZB = 50;
const bottom = new Array(ZB).fill(Infinity);
for (let i = 0; i < count; i++) {
  const k = Math.min(ZB - 1, Math.floor(pos[i * 3 + 2] * ZB));
  bottom[k] = Math.min(bottom[k], pos[i * 3 + 1]);
}
for (let k = 0; k < ZB; k++) if (!Number.isFinite(bottom[k])) bottom[k] = bottom[k - 1] ?? 0;
const bottomAt = (z) => {
  const f = Math.min(ZB - 1, Math.max(0, z * ZB - 0.5));
  const k = Math.min(ZB - 2, Math.floor(f));
  return bottom[k] + (bottom[k + 1] - bottom[k]) * (f - k);
};
const smooth = (t) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};
/** かかとの積み革の上のはし・前の底の厚み（長さ＝1。元データで 1 ≈ 25cm） */
const HEEL_TOP = 0.118;
const FORE_SOLE = 0.058;
/** かかとの前の面（積み革が終わるところ） */
const HEEL_FRONT = 0.305;
const soleTop = (z) => {
  const fore = bottomAt(z) + FORE_SOLE;
  // 土踏まずのところは、底のへりが少し高い（内側ほど）。かかとの前の面からなめらかにつなぐ
  return HEEL_TOP + (fore - HEEL_TOP) * smooth((z - HEEL_FRONT) / 0.12);
};

const upper = new Float32Array(SIZE * SIZE);
const sole = new Float32Array(SIZE * SIZE);
const inside = new Float32Array(SIZE * SIZE);
for (let t = 0; t < SIZE * SIZE; t++) {
  if (!covered[t]) continue;
  if (!visible[t]) {
    inside[t] = 1;
    continue;
  }
  const y = texPos[t * 3 + 1];
  const z = texPos[t * 3 + 2];
  // 底のへりは 3mm ほどでなめらかに切り替える（模様の画素の境目が見えないように）
  const s = smooth((soleTop(z) - y) / 0.012 + 0.5);
  sole[t] = s;
  upper[t] = 1 - s;
}

// 外から見えるかどうかは画素ごとに決めたので、ぽつぽつと混じったところをならす（3×3 の多数決）
const fixInside = new Float32Array(inside);
for (let y = 1; y < SIZE - 1; y++)
  for (let x = 1; x < SIZE - 1; x++) {
    const t = y * SIZE + x;
    if (!covered[t]) continue;
    let n = 0;
    let c = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const q = t + dy * SIZE + dx;
        if (!covered[q]) continue;
        n++;
        c += inside[q];
      }
    fixInside[t] = c / n > 0.5 ? 1 : 0;
  }
for (let t = 0; t < SIZE * SIZE; t++) {
  if (!covered[t] || fixInside[t] === inside[t]) continue;
  inside[t] = fixInside[t];
  if (inside[t]) {
    upper[t] = 0;
    sole[t] = 0;
  } else {
    const y = texPos[t * 3 + 1];
    const s = smooth((soleTop(texPos[t * 3 + 2]) - y) / 0.012 + 0.5);
    sole[t] = s;
    upper[t] = 1 - s;
  }
}

// ---------- 模様 ----------
async function texture(file) {
  return sharp(path.join(src, "textures", file)).resize(SIZE, SIZE, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer();
}
const color = await texture("blinn1SG_baseColor.png");
const normal = await texture("blinn1SG_normal.png");
const orm = await texture("blinn1SG_metallicRoughness.png");
const n = SIZE * SIZE;
const lum = (i) => 0.299 * color[i * 3] + 0.587 * color[i * 3 + 1] + 0.114 * color[i * 3 + 2];

// 模様の座標のない画素（模様の切れ目のすき間）には、となりの画素の塗り分けを広げる（縮小・拡大で境目がにじまないように）
const known = Uint8Array.from(covered);
for (let pass = 0; pass < 8; pass++) {
  const next = Uint8Array.from(known);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const t = y * SIZE + x;
      if (known[t]) continue;
      let w = 0;
      let u = 0;
      let s = 0;
      let d = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qx = x + dx;
        const qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= SIZE || qy >= SIZE) continue;
        const q = qy * SIZE + qx;
        if (!known[q]) continue;
        w++;
        u += upper[q];
        s += sole[q];
        d += inside[q];
      }
      if (!w) continue;
      upper[t] = u / w;
      sole[t] = s / w;
      inside[t] = d / w;
      next[t] = 1;
    }
  known.set(next);
}
for (let t = 0; t < n; t++) if (!known[t]) upper[t] = 1;

// 下地：それぞれの部分の明るさの濃淡だけを、平均 0.82 の灰色にそろえる。
// 甲の濃淡（すれて白っぽいところ・しわの影）は元の半分くらいに弱める（アプリで塗る色がまだらに見えすぎないように）
const MEAN = 0.82;
const CONTRAST = { upper: 0.55, sole: 0.8, inside: 0.4 };
const meanOf = (w) => {
  let a = 0;
  let b = 0;
  for (let t = 0; t < n; t++) {
    if (!covered[t]) continue;
    a += lum(t) * w[t];
    b += w[t];
  }
  return a / Math.max(1, b);
};
const means = { upper: meanOf(upper), sole: meanOf(sole), inside: meanOf(inside) };
const base = Buffer.alloc(n * 3);
const mask = Buffer.alloc(n * 3);
for (let t = 0; t < n; t++) {
  let g = 0;
  let wsum = 0;
  for (const [k, w] of [["upper", upper[t]], ["sole", sole[t]], ["inside", inside[t]]]) {
    if (w <= 0) continue;
    const f = 1 + (lum(t) / means[k] - 1) * CONTRAST[k];
    g += w * Math.max(0, f) * MEAN * 255;
    wsum += w;
  }
  g = Math.min(255, Math.round(g / Math.max(1e-6, wsum)));
  base[t * 3] = base[t * 3 + 1] = base[t * 3 + 2] = g;
  const sum = upper[t] + sole[t] + inside[t] || 1;
  mask[t * 3] = Math.round((upper[t] / sum) * 255);
  mask[t * 3 + 1] = Math.round((sole[t] / sum) * 255);
  mask[t * 3 + 2] = Math.round((inside[t] / sum) * 255);
}
const img = (buf) => sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 3 } });
// 下地は灰色なので、1つの色の JPEG にする
await img(base).toColourspace("b-w").jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(outDir, "boot-base.jpg"));
await img(mask).png({ compressionLevel: 9, palette: false }).toFile(path.join(outDir, "boot-mask.png"));
await img(normal).jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(outDir, "boot-normal.jpg"));
// ORM：R が陰（AO）、G が粗さ。B（金属っぽさ）は使わないので 0 に
for (let t = 0; t < n; t++) orm[t * 3 + 2] = 0;
await img(orm).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(outDir, "boot-orm.jpg"));

if (debugDir) {
  const cls = Buffer.alloc(n * 3);
  for (let t = 0; t < n; t++) {
    const c = [0, 1, 2].map((k) => Math.round(upper[t] * [200, 170, 120][k] + sole[t] * [60, 60, 60][k] + inside[t] * [60, 120, 220][k]));
    cls.set(c, t * 3);
  }
  await writeDebug("classes", cls);
  const tinted = Buffer.alloc(n * 3);
  for (let t = 0; t < n; t++) {
    const g = base[t * 3] / (MEAN * 255);
    const tint = [0, 1, 2].map((k) => upper[t] * [70, 45, 30][k] + sole[t] * [38, 32, 28][k] + inside[t] * [40, 30, 22][k]);
    tinted.set(tint.map((v) => Math.min(255, Math.round(v * g))), t * 3);
  }
  await writeDebug("tinted", tinted);
  console.log("debug:", { count, tris, height: height.toFixed(3), lid: LID.toFixed(3), means });
}

// ---------- glb に書き出す（形だけ。模様はアプリで色を塗ってから貼る） ----------
const json = meshJson(
  "boot",
  "Photoscanned Female Ankle Boots by TunnelVisionStudio (https://sketchfab.com/TunnelVisionStudio), CC BY 4.0",
  count,
  pos,
  index,
);
const rawFile = path.join(here, ".cache/boot-raw.glb");
fs.writeFileSync(rawFile, glb(json, [pos, nrm, UV, index]));
const gltfpack = path.join(here, "../../node_modules/.bin/gltfpack");
const outFile = path.join(outDir, "boot.glb");
// 三角形を 2 割に減らし（元は写真から作った細かい形。スマホでも軽く）、meshoptimizer で小さくする。
// 模様の座標（UV）は材質に模様がないと消されるので -kv で残し、-vtf で量子化しない（戻し方が材質側に書かれるため）
execFileSync(gltfpack, ["-i", rawFile, "-o", outFile, "-cc", "-si", process.env.BOOT_SI ?? "0.2", "-kn", "-kv", "-vtf"], { stdio: "inherit" });
const kb = (f) => (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0);
console.log(
  `ok: boot.glb ${kb("boot.glb")}KB, base ${kb("boot-base.jpg")}KB, mask ${kb("boot-mask.png")}KB, normal ${kb("boot-normal.jpg")}KB, orm ${kb("boot-orm.jpg")}KB`,
);
