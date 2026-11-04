#!/usr/bin/env node
// MakeHuman（CC0）の素体メッシュ・体型ターゲット・骨格から、アプリで使う 3D データ（glb）を作る。
//
//   sh tools/body/fetch-makehuman.sh        # 素体データを取ってくる（初回だけ）
//   node tools/body/build.mjs               # → src/body/assets/human.glb
//
// 作るもの：
// - body：肌のメッシュ。腕を体の横に下ろしたポーズにしてある
// - tights：体にぴったりの「タイツ」メッシュ（服の元になる）
// - skirt：スカートの元になるメッシュ
// どれも、男女・体重で変わる形を「モーフ」（頂点の差分）として持つ。
// 頂点の色（COLOR_0）に、その頂点が 胴・腕・脚・頭 のどれにどれだけ属するか（骨の重み）を入れてある。
// 単位は身長＝1、床が y=0、顔が +z を向く。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = process.argv[2] ?? path.join(here, ".cache/makehuman/makehuman/data");
const outFile = process.argv[3] ?? path.join(here, "../../src/body/assets/human.glb");

// ---------- 読み込み ----------
function parseObj(file) {
  const V = [];
  const groups = new Map();
  let g = "";
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      V.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith("g ")) {
      g = line.slice(2).trim();
      if (!groups.has(g)) groups.set(g, []);
    } else if (line.startsWith("f ")) {
      groups.get(g).push(line.slice(2).trim().split(/\s+/).map((t) => parseInt(t.split("/")[0], 10) - 1));
    }
  }
  return { V: new Float64Array(V), groups };
}

function loadTarget(name) {
  const file = path.join(data, "targets", name + ".target");
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const p = line.trim().split(/\s+/);
    out.push([parseInt(p[0], 10), +p[1], +p[2], +p[3]]);
  }
  return out;
}

const { V: BASE, groups } = parseObj(path.join(data, "3dobjs/base.obj"));
const N = BASE.length / 3;
const skel = JSON.parse(fs.readFileSync(path.join(data, "rigs/default.mhskel"), "utf8"));
const weightsFile = JSON.parse(fs.readFileSync(path.join(data, "rigs", skel.weights_file), "utf8")).weights;

// ---------- 体型（MakeHuman のマクロターゲットの合成） ----------
// 年齢は大人（young）、筋肉は普通、人種はアジア系に固定。性別と体重だけを動かす。
function shape(targets) {
  const out = new Float64Array(BASE);
  for (const [name, w] of targets) {
    if (!w) continue;
    for (const [i, dx, dy, dz] of loadTarget(name)) {
      out[i * 3] += dx * w;
      out[i * 3 + 1] += dy * w;
      out[i * 3 + 2] += dz * w;
    }
  }
  return out;
}
const U = (g, w) => `macrodetails/universal-${g}-young-averagemuscle-${w}weight`;
const E = (g) => `macrodetails/asian-${g}-young`;
const SHAPES = {
  base: shape([
    [U("female", "average"), 0.5],
    [U("male", "average"), 0.5],
    [E("female"), 0.5],
    [E("male"), 0.5],
  ]),
  female: shape([
    [U("female", "average"), 1],
    [E("female"), 1],
  ]),
  male: shape([
    [U("male", "average"), 1],
    [E("male"), 1],
  ]),
  femaleHeavy: shape([
    [U("female", "max"), 1],
    [E("female"), 1],
  ]),
  femaleThin: shape([
    [U("female", "min"), 1],
    [E("female"), 1],
  ]),
  maleHeavy: shape([
    [U("male", "max"), 1],
    [E("male"), 1],
  ]),
  maleThin: shape([
    [U("male", "min"), 1],
    [E("male"), 1],
  ]),
};

// ---------- 骨格・ポーズ ----------
const children = new Map();
for (const [name, b] of Object.entries(skel.bones)) {
  if (!children.has(b.parent)) children.set(b.parent, []);
  children.get(b.parent).push(name);
}
const subtree = (bone) => [bone, ...(children.get(bone) ?? []).flatMap(subtree)];

/** 骨の重み：頂点ごとの [骨, 重み] の一覧（合計が1になるようにそろえる） */
const vertexWeights = Array.from({ length: N }, () => []);
for (const [bone, list] of Object.entries(weightsFile)) for (const [i, w] of list) vertexWeights[i].push([bone, w]);
for (const list of vertexWeights) {
  const sum = list.reduce((s, [, w]) => s + w, 0) || 1;
  for (const e of list) e[1] /= sum;
}

const centroid = (P, idx) => {
  const c = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) c[k] += P[i * 3 + k];
  return c.map((v) => v / idx.length);
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};
/** a を b に向ける回転（四元数） */
function fromUnitVectors(a, b) {
  const c = cross(a, b);
  const q = [c[0], c[1], c[2], 1 + dot(a, b)];
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
}
function rotate(q, v) {
  const [x, y, z, w] = q;
  const u = [x, y, z];
  const t = cross(u, v).map((c) => c * 2);
  return add(add(v, t.map((c) => c * w)), cross(u, t));
}
const rad = (d) => (d * Math.PI) / 180;

/** 腕を体の横に下ろす。骨ごとの変換（支点と回転）を順に作る */
function armPose(P) {
  const J = (n) => centroid(P, skel.joints[n]);
  const transforms = []; // { bones:Set, pivot, q }（この順に適用）
  for (const side of ["L", "R"]) {
    const sx = side === "L" ? 1 : -1;
    const sh = J(`upperarm01.${side}____head`);
    let el = J(`lowerarm01.${side}____head`);
    let wr = J(`wrist.${side}____head`);
    // 上腕：体から 12° 開いて下ろす
    const q1 = fromUnitVectors(norm(sub(el, sh)), norm([sx * Math.sin(rad(12)), -Math.cos(rad(12)), 0]));
    transforms.push({ bones: new Set(subtree(`upperarm01.${side}`)), pivot: sh, q: q1 });
    el = add(rotate(q1, sub(el, sh)), sh);
    wr = add(rotate(q1, sub(wr, sh)), sh);
    // 前腕：もう少し開き、少しだけ前へ
    const q2 = fromUnitVectors(norm(sub(wr, el)), norm([sx * Math.sin(rad(17)), -Math.cos(rad(17)), 0.12]));
    transforms.push({ bones: new Set(subtree(`lowerarm01.${side}`)), pivot: el, q: q2 });
  }
  return transforms;
}

/** 骨の重みで頂点を動かす（リニアブレンドスキニング） */
function pose(P) {
  const transforms = armPose(P);
  const out = new Float64Array(P.length);
  const cache = new Map();
  const moved = (bone, v) => {
    let p = v;
    for (const t of transforms) if (t.bones.has(bone)) p = add(rotate(t.q, sub(p, t.pivot)), t.pivot);
    return p;
  };
  for (let i = 0; i < N; i++) {
    const v = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const acc = [0, 0, 0];
    for (const [bone, w] of vertexWeights[i]) {
      const p = moved(bone, v);
      acc[0] += p[0] * w;
      acc[1] += p[1] * w;
      acc[2] += p[2] * w;
    }
    out.set(acc, i * 3);
  }
  cache.clear();
  return out;
}

// ---------- 部位の重み（胴・腕・脚・頭。残りが首） ----------
const PARTS = ["torso", "arm", "leg", "head"];
function partOf(bone) {
  if (/^neck0[123]$/.test(bone)) return "neck";
  if (/^(head|jaw|eye\.|levator|oculi|orbicularis|oris|risorius|special|tongue)/.test(bone)) return "head";
  if (/^(shoulder01|upperarm|lowerarm|wrist|metacarpal|finger)/.test(bone)) return "arm";
  if (/^(upperleg|lowerleg|foot|toe)/.test(bone)) return "leg";
  return "torso";
}
const partWeights = new Float32Array(N * 4);
for (let i = 0; i < N; i++) {
  for (const [bone, w] of vertexWeights[i]) {
    const k = PARTS.indexOf(partOf(bone));
    if (k >= 0) partWeights[i * 4 + k] += w;
  }
}

// ---------- ポーズをつけて、身長1・床 y=0 にそろえる ----------
const bodyFaces = groups.get("body");
const bodyVerts = [...new Set(bodyFaces.flat())];
const posed = Object.fromEntries(Object.entries(SHAPES).map(([k, P]) => [k, pose(P)]));
let ground = Infinity;
let top = -Infinity;
for (const i of bodyVerts) {
  ground = Math.min(ground, posed.base[i * 3 + 1]);
  top = Math.max(top, posed.base[i * 3 + 1]);
}
const scale = 1 / (top - ground);
for (const P of Object.values(posed)) {
  for (let i = 0; i < N; i++) {
    P[i * 3] *= scale;
    P[i * 3 + 1] = (P[i * 3 + 1] - ground) * scale;
    P[i * 3 + 2] *= scale;
  }
}

// 目印になる関節の位置（体型ごと）
const JOINTS = [
  "head____tail",
  "head____head",
  "jaw____tail",
  "neck01____head",
  "eye.L____head",
  "eye.R____head",
  "clavicle.L____head",
  "upperarm01.L____head",
  "upperarm01.R____head",
  "lowerarm01.L____head",
  "lowerarm01.R____head",
  "wrist.L____head",
  "wrist.R____head",
  "finger3-3.L____tail",
  "finger3-3.R____tail",
  "spine01____head",
  "spine02____head",
  "spine03____head",
  "spine04____head",
  "root____head",
  "upperleg01.L____head",
  "upperleg01.R____head",
  "lowerleg01.L____head",
  "lowerleg01.R____head",
  "foot.L____head",
  "foot.R____head",
  "foot.L____tail",
  "foot.R____tail",
  "toe3-3.L____tail",
  "toe3-3.R____tail",
];
const landmarks = {};
for (const [k, P] of Object.entries(posed)) {
  const j = {};
  for (const name of JOINTS) j[name] = centroid(P, skel.joints[name]).map((v) => +v.toFixed(5));
  let t = -Infinity;
  let heelZ = Infinity;
  let toeZ = -Infinity;
  for (const i of bodyVerts) {
    t = Math.max(t, P[i * 3 + 1]);
    if (P[i * 3 + 1] < 0.02) {
      heelZ = Math.min(heelZ, P[i * 3 + 2]);
      toeZ = Math.max(toeZ, P[i * 3 + 2]);
    }
  }
  j.top = [0, +t.toFixed(5), 0];
  j.foot = [+heelZ.toFixed(5), +toeZ.toFixed(5)];
  landmarks[k] = j;
}

// ---------- glb に書き出す ----------
const MORPHS = ["female", "male", "femaleHeavy", "femaleThin", "maleHeavy", "maleThin"];
const bin = [];
let binLength = 0;
const bufferViews = [];
const accessors = [];
function pushView(buf, target) {
  while (binLength % 4) {
    bin.push(new Uint8Array(1));
    binLength++;
  }
  const view = { buffer: 0, byteOffset: binLength, byteLength: buf.byteLength };
  if (target) view.target = target;
  bin.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  binLength += buf.byteLength;
  bufferViews.push(view);
  return bufferViews.length - 1;
}
function accessor(buf, componentType, type, count, opts = {}) {
  const a = { bufferView: pushView(buf, opts.target), componentType, type, count };
  if (opts.normalized) a.normalized = true;
  if (opts.minmax) {
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const min = Array(n).fill(Infinity);
    const max = Array(n).fill(-Infinity);
    for (let i = 0; i < count; i++)
      for (let k = 0; k < n; k++) {
        min[k] = Math.min(min[k], buf[i * n + k]);
        max[k] = Math.max(max[k], buf[i * n + k]);
      }
    a.min = min;
    a.max = max;
  }
  accessors.push(a);
  return accessors.length - 1;
}

const meshes = [];
const nodes = [];
function emit(name, group) {
  const faces = groups.get(group);
  const used = [...new Set(faces.flat())];
  const local = new Map(used.map((v, i) => [v, i]));
  const idx = [];
  for (const f of faces) {
    for (let k = 1; k + 1 < f.length; k++) idx.push(local.get(f[0]), local.get(f[k]), local.get(f[k + 1]));
  }
  const pos = new Float32Array(used.length * 3);
  const col = new Uint8Array(used.length * 4);
  used.forEach((v, i) => {
    pos.set(posed.base.subarray(v * 3, v * 3 + 3), i * 3);
    for (let k = 0; k < 4; k++) col[i * 4 + k] = Math.round(Math.min(1, partWeights[v * 4 + k]) * 255);
  });
  const primitive = {
    attributes: {
      POSITION: accessor(pos, 5126, "VEC3", used.length, { minmax: true, target: 34962 }),
      COLOR_0: accessor(col, 5121, "VEC4", used.length, { normalized: true, target: 34962 }),
    },
    indices: accessor(used.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), used.length > 65535 ? 5125 : 5123, "SCALAR", idx.length, { target: 34963 }),
    mode: 4,
    targets: MORPHS.map((m) => {
      const d = new Float32Array(used.length * 3);
      used.forEach((v, i) => {
        for (let k = 0; k < 3; k++) d[i * 3 + k] = posed[m][v * 3 + k] - posed.base[v * 3 + k];
      });
      return { POSITION: accessor(d, 5126, "VEC3", used.length, { minmax: true, target: 34962 }) };
    }),
  };
  meshes.push({ name, primitives: [primitive], extras: { targetNames: MORPHS } });
  nodes.push({ name, mesh: meshes.length - 1 });
  return { verts: used.length, tris: idx.length / 3 };
}
const stats = { body: emit("body", "body"), tights: emit("tights", "helper-tights"), skirt: emit("skirt", "helper-skirt") };

const gltf = {
  asset: { version: "2.0", generator: "freedom-closet tools/body/build.mjs", copyright: "Base mesh, targets and rig: MakeHuman (CC0, makehumancommunity.org)" },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i), extras: { morphs: MORPHS, parts: PARTS, landmarks } }],
  nodes,
  meshes,
  accessors,
  bufferViews,
  buffers: [{ byteLength: binLength }],
};
while (binLength % 4) {
  bin.push(new Uint8Array(1));
  binLength++;
}
gltf.buffers[0].byteLength = binLength;
let json = Buffer.from(JSON.stringify(gltf));
while (json.length % 4) json = Buffer.concat([json, Buffer.from(" ")]);
const binBuf = Buffer.concat(bin.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength)));
const header = Buffer.alloc(12);
header.write("glTF", 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binBuf.length, 8);
const chunk = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
};
const raw = outFile.replace(/\.glb$/, ".raw.glb");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(raw, Buffer.concat([header, chunk(json.length, 0x4e4f534a), json, chunk(binBuf.length, 0x004e4942), binBuf]));

// meshoptimizer（gltfpack）で小さくする。-kn で部位ごとのメッシュを別々のまま残し、-ke で目印の位置（extras）を残す
const gltfpack = path.join(here, "../../node_modules/.bin/gltfpack");
execFileSync(gltfpack, ["-i", raw, "-o", outFile, "-cc", "-kn", "-ke"], { stdio: "inherit" });
fs.unlinkSync(raw);
console.log(stats, `${(fs.statSync(outFile).size / 1024).toFixed(0)} KB → ${path.relative(process.cwd(), outFile)}`);
