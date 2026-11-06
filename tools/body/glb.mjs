// 靴・ブーツの 3D データを作るスクリプト（build-shoe.mjs・build-boot.mjs）で使う、glTF の読み書き。
import fs from "node:fs";
import path from "node:path";

/** glTF（.gltf と .bin）を読み、accessor の中身を型つき配列で取り出せるようにする（byteStride にも対応） */
export function readGltf(dir, file) {
  const gltf = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const bin = fs.readFileSync(path.join(dir, gltf.buffers[0].uri));
  const accessor = (i) => {
    const a = gltf.accessors[i];
    const bv = gltf.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
    const size = T.BYTES_PER_ELEMENT;
    const stride = bv.byteStride ?? n * size;
    const view = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
    const out = new T(a.count * n);
    const get =
      T === Float32Array
        ? (o) => view.getFloat32(o, true)
        : T === Uint32Array
          ? (o) => view.getUint32(o, true)
          : (o) => view.getUint16(o, true);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get(i * stride + k * size);
    return out;
  };
  return { gltf, accessor };
}

/** 配列（x, y, z の並び）の最小・最大 */
export function bounds(a) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], a[i + k]);
      hi[k] = Math.max(hi[k], a[i + k]);
    }
  return { min: lo, max: hi };
}

/** glTF の JSON と、bufferView ごとの中身（型つき配列）から glb を作る */
export function glb(json, chunks) {
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

/** 形（位置・向き・模様の座標・三角形）だけの glb の JSON（材質は1つ、模様なし） */
export function meshJson(name, copyright, count, pos, index) {
  return {
    asset: { version: "2.0", generator: `freedom-closet build-${name}.mjs`, copyright },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    materials: [{ name, pbrMetallicRoughness: { metallicFactor: 0 } }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", ...bounds(pos) },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count, type: "VEC2" },
      { bufferView: 3, componentType: index instanceof Uint16Array ? 5123 : 5125, count: index.length, type: "SCALAR" },
    ],
  };
}
