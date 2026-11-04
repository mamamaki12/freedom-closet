// 3Dのマネキン（人体メッシュ）に服を着せる（three.js）。
// 体型は BodyScan（輪切りの寸法）、男女・体重の大まかな形は Profile から。単位は身長＝1、床が y=0。
import * as THREE from "three";
import type { LookShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import { garmentPieces, Layers, underwear, type ShoeRoom, type SwatchMatch, type UvMode } from "./garments";
import { fitHuman, loadHuman, type Fitted, type Human, type V3 } from "./human";
import { fitShoe, shoeLift, shoeMaterial, type ShoeAsset, type ShoeLook, type ShoeModel } from "./shoe";
import type { BodyScan } from "./types";

export { Layers };

export { THREE };

/** 体型に合わせて変形ずみの人体 */
export interface Figure {
  human: Human;
  fit: Fitted;
  /** 靴の3Dの型（読み込めたときだけ。ないときは足の形から作る） */
  shoe?: ShoeAsset;
  /** ブーツの3Dの型（同じく、読み込めたときだけ） */
  boot?: ShoeAsset;
  /** はかせたブーツの筒の外側（ブーツをはかせたあとだけ。パンツのすそをかぶせるのに使う） */
  shoeRoom?: ShoeRoom;
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
  /** 生地の見本を、写真（whole）の柄に重ねるための対応（脇で写真から見本へ切り替えるところで柄がずれないように） */
  swatchMatch?: SwatchMatch;
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
  const tiled = (t: THREE.Texture) => {
    const c = t.clone();
    c.needsUpdate = true;
    // そのまま敷き詰める（見本はつなぎ目なくくり返せる模様にしてある。折り返すと柄が左右対称に映る）
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    return c;
  };
  let map: THREE.Texture | undefined;
  if (base) {
    if (kind === "whole") {
      map = base.clone();
      map.needsUpdate = true;
      map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    } else map = tiled(base);
  }
  // 布のつやは生地の色にする（白いつやだと、黒や紺の服が白っぽくかすんで見える）
  const mat = new THREE.MeshPhysicalMaterial({
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
  if (kind === "whole" && map && paint.swatch) blendSwatch(mat, tiled(paint.swatch));
  return mat;
}

/**
 * 写真1枚の材質に、生地の見本を混ぜる。頂点の photoFade の割合で、写真から見本（座標は頂点の swatchUv）に切り替える
 * （cutPiece の photoFade）。脇で写真が背中の見本へ継ぎ目なくつながり、写真の脇に写った袖や影も見えなくなる。
 * この2つを持たない形では photoFade が 0 になり、写真のまま
 */
function blendSwatch(mat: THREE.MeshPhysicalMaterial, swatch: THREE.Texture) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.swatchMap = { value: swatch };
    const vary = "varying vec2 vSwatchUv;\nvarying float vPhotoFade;\n";
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <uv_pars_vertex>",
        `#include <uv_pars_vertex>\nattribute vec2 swatchUv;\nattribute float photoFade;\n${vary}`,
      )
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvSwatchUv = swatchUv;\nvPhotoFade = photoFade;");
    const cloth = "texture2D( swatchMap, vSwatchUv )";
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_pars_fragment>", `#include <map_pars_fragment>\nuniform sampler2D swatchMap;\n${vary}`)
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP\n\tdiffuseColor *= mix( texture2D( map, vMapUv ), ${cloth}, vPhotoFade );\n#endif`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        THREE.ShaderChunk.lights_physical_fragment.replace(
          "texture2D( sheenColorMap, vSheenColorMapUv ).rgb",
          `mix( texture2D( sheenColorMap, vSheenColorMapUv ).rgb, ${cloth}.rgb, vPhotoFade )`,
        ),
      );
  };
  mat.customProgramCacheKey = () => "blend-swatch";
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

/** 靴の種類ごとの、本物の靴の3Dの型（読み込めていなければ undefined。サンダルは足の形から作る） */
function shoeAsset(fig: Figure, style: ShoeStyle): ShoeAsset | undefined {
  return style === "boots" ? fig.boot : style === "sandals" ? undefined : fig.shoe;
}

/** 体の頂点の位置。靴をはくときは、足を少し小さくして靴から出ないようにする */
function tuckFeet(fig: Figure, style: ShoeStyle | undefined): Float32Array {
  const { human, fit } = fig;
  const pos = new Float32Array(fit.body);
  if (!style) return pos;
  const m = fit.marks;
  const asset = !!shoeAsset(fig, style);
  const feet = asset || style === "sandals" ? [measureFoot(fig, -1), measureFoot(fig, 1)] : [];
  const sandal = shoeSpec("sandals");
  for (let i = 0; i < pos.length / 3; i++) {
    if (human.body.parts[i * 4 + 2] < 0.5) continue;
    const y = pos[i * 3 + 1];
    const s = pos[i * 3] < 0 ? 0 : 1;
    const f = m.foot[s];
    if (style === "sandals") {
      // サンダルは足が見えるので小さくせず、足の裏を中敷きの上にのせる（すねまでの間で少しずつ縮める）
      const top = f.ankle[1] + 0.05;
      if (y > top) continue;
      const fs = feet[s];
      const t = clamp((pos[i * 3 + 2] - fs.heelZ) / Math.max(1e-3, fs.toeZ - fs.heelZ), 0, 1);
      pos[i * 3 + 1] = y + (sandal.sole(t) + FOOTBED) * (1 - y / top);
      continue;
    }
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
      const sole = style === "leather" ? 0.006 : 0.012;
      pos[i * 3 + 1] = y * (1 - 0.25 * w) + sole * w;
      pos[i * 3 + 2] = f.ankle[2] + (pos[i * 3 + 2] - f.ankle[2]) * (1 - 0.08 * w);
      continue;
    }
    const k = 0.9;
    pos[i * 3] = f.ankle[0] + (pos[i * 3] - f.ankle[0]) * k;
    pos[i * 3 + 1] = y * 0.92 + 0.004;
    pos[i * 3 + 2] = f.ankle[2] + (pos[i * 3 + 2] - f.ankle[2]) * k;
  }
  return pos;
}

/** マネキン本体（肌・目・下着がわりの薄い一枚）。靴をはくときは足を少し小さくして靴から出ないようにする */
export function buildBody(fig: Figure, opts: { shoes?: ShoeStyle }): THREE.Group {
  const { human, fit } = fig;
  const g = new THREE.Group();
  const pos = tuckFeet(fig, opts.shoes);
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

/** ブーツの筒の外側と脚とのすき間（革の厚みを含む。身長＝1。0.004 ≈ 7mm） */
const SHAFT_GAP = 0.004;
/** 筒の外側の面とみなす幅（いちばん外の点からこの幅の内側まで。ひもや引き手の出っぱりを外側の面と取り違えないように） */
const SHAFT_SKIN = 0.004;
/** 筒の内張りや細いみぞ（ファスナーなど）の底と、脚とのすき間（0.0015 ≈ 2.5mm） */
const SHAFT_LINING = 0.0015;

/** 切り口の線分の上に点を置く間隔（身長＝1。0.0015 ≈ 2.5mm） */
const CUT_SPACING = 0.0015;

/**
 * 三角形の面を、axis の座標が y0 + k·step（k = 0〜n-1）の平らな面で切った切り口の点。
 * axis が 1（高さ）なら x, z の並び、2（前後）なら x, y の並び。三角形ごとの切り口の線分の上にも
 * CUT_SPACING おきに点を置く（大きな三角形の長い線分でも、どの向きにも点があるように）。keep で使う三角形を選ぶ
 */
function slices(
  pos: ArrayLike<number>,
  index: ArrayLike<number>,
  y0: number,
  step: number,
  n: number,
  keep: (a: number, b: number, c: number) => boolean = () => true,
  axis: 1 | 2 = 1,
): number[][] {
  const other = axis === 1 ? 2 : 1;
  const out = Array.from({ length: n }, () => [] as number[]);
  const ends: number[] = [];
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f];
    const b = index[f + 1];
    const c = index[f + 2];
    const ya = pos[a * 3 + axis];
    const yb = pos[b * 3 + axis];
    const yc = pos[c * 3 + axis];
    const k0 = Math.max(0, Math.ceil((Math.min(ya, yb, yc) - y0) / step));
    const k1 = Math.min(n - 1, Math.floor((Math.max(ya, yb, yc) - y0) / step));
    if (k0 > k1 || !keep(a, b, c)) continue;
    for (let k = k0; k <= k1; k++) {
      const h = y0 + k * step;
      ends.length = 0;
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const yu = pos[u * 3 + axis];
        const yv = pos[v * 3 + axis];
        if ((yu - h) * (yv - h) > 0 || yu === yv) continue;
        const t = (h - yu) / (yv - yu);
        ends.push(
          pos[u * 3] + (pos[v * 3] - pos[u * 3]) * t,
          pos[u * 3 + other] + (pos[v * 3 + other] - pos[u * 3 + other]) * t,
        );
      }
      const cut = out[k];
      for (let i = 0; i < ends.length; i++) cut.push(ends[i]);
      if (ends.length < 4) continue;
      const m = Math.floor(Math.hypot(ends[2] - ends[0], ends[3] - ends[1]) / CUT_SPACING);
      for (let j = 1; j <= m; j++) {
        const t = j / (m + 1);
        cut.push(ends[0] + (ends[2] - ends[0]) * t, ends[1] + (ends[3] - ends[1]) * t);
      }
    }
  }
  return out;
}

/**
 * 型の切り口（x, z の並び）の、中心 c のまわりの向きごとの半径。far はいちばん外の点（ひもや引き手の出っぱりも含む）、
 * outer は外側の面：いちばん外の点から SHAFT_SKIN の内側までにある点のうち、いちばん内のもの
 * （出っぱりを外側の面と取り違えないように）。点のない向きは 0
 */
function outerRadius(B: number[], c: [number, number], ns: number): { far: Float32Array; outer: Float32Array } {
  const sectorOf = (x: number, z: number) =>
    Math.floor(((Math.atan2(z - c[1], x - c[0]) / (Math.PI * 2) + 1) % 1) * ns) % ns;
  const far = new Float32Array(ns);
  const dist = new Float32Array(B.length / 2);
  const sec = new Int32Array(B.length / 2);
  for (let i = 0; i < B.length; i += 2) {
    const k = sectorOf(B[i], B[i + 1]);
    const r = Math.hypot(B[i] - c[0], B[i + 1] - c[1]);
    dist[i / 2] = r;
    sec[i / 2] = k;
    far[k] = Math.max(far[k], r);
  }
  const outer = Float32Array.from(far);
  for (let j = 0; j < dist.length; j++)
    if (dist[j] >= far[sec[j]] - SHAFT_SKIN) outer[sec[j]] = Math.min(outer[sec[j]], dist[j]);
  return { far, outer };
}

/** はかせたブーツの筒（高さ y0 + b·step ごとの脚の中心と、まわりの向き ns 等分ごとの、出っぱりも含めた外側の半径） */
interface Shaft {
  y0: number;
  step: number;
  nb: number;
  ns: number;
  center: [number, number][];
  outer: Float32Array;
  top: number;
}

/** パンツとブーツの筒とのすき間（身長＝1。0.002 ≈ 3mm） */
const PANTS_GAP = 0.002;

/**
 * パンツのすそをかぶせるための、ブーツの筒の外側。筒の口より上は、布が口のふちから少しずつ脚へ戻るように、
 * 高さとともに小さくする
 */
function shoeRoomOf(shafts: Map<1 | -1, Shaft>): ShoeRoom {
  return (x, y, z) => {
    const sh = shafts.get(x < 0 ? -1 : 1);
    if (!sh || y < sh.y0 || y > sh.top + 0.05) return undefined;
    const f = clamp((Math.min(y, sh.top) - sh.y0) / sh.step, 0, sh.nb - 1);
    const b = Math.min(sh.nb - 2, Math.floor(f));
    const u = f - b;
    const C = sh.center;
    const c: [number, number] = [lerp(C[b][0], C[b + 1][0], u), lerp(C[b][1], C[b + 1][1], u)];
    const sf = ((Math.atan2(z - c[1], x - c[0]) / (Math.PI * 2) + 1) % 1) * sh.ns - 0.5;
    const k = Math.floor(sf);
    const v = sf - k;
    const at = (bb: number, kk: number) => sh.outer[bb * sh.ns + (((kk % sh.ns) + sh.ns) % sh.ns)];
    let r = lerp(lerp(at(b, k), at(b, k + 1), v), lerp(at(b + 1, k), at(b + 1, k + 1), v), u) + PANTS_GAP;
    if (y > sh.top) r -= (y - sh.top) * 0.35;
    return [c[0], c[1], r];
  };
}

/**
 * ブーツの筒を、脚が中に収まるように広げる。高さごとに脚と型の切り口を取り、脚のまわりの向きごとに、
 * 型の外側の面が脚の外側よりすき間ぶん外にあるかを調べて、足りないところだけ脚の中心から外へ押し広げる。
 * 型の内側の面（内張り）は写真から作ったもので本物より細いことがあるので、広げる量には使わず、
 * 脚の中に入っている点を脚の外側まで出すだけにする（細いみぞの底も同じ。すき間から脚が見えないように）。
 * 足首より下（足に合わせて置いたところ）はそのまま。body は足を靴に収めたあとの体の頂点
 */
function fitShaft(
  geo: THREE.BufferGeometry,
  fig: Figure,
  side: 1 | -1,
  body: Float32Array,
): Shaft | undefined {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const P = p.array as Float32Array;
  const ankle = fig.fit.marks.foot[side < 0 ? 0 : 1].ankle;
  let top = -Infinity;
  for (let i = 0; i < p.count; i++) top = Math.max(top, P[i * 3 + 1]);
  const y0 = ankle[1] - 0.004;
  const STEP = 0.004;
  const NB = Math.max(2, Math.ceil((top - y0) / STEP) + 1);
  const NS = 24;
  const parts = fig.human.body.parts;
  const onLeg = (i: number) => parts[i * 4 + 2] >= 0.5 && Math.sign(body[i * 3]) === side;
  const legCut = slices(body, fig.human.body.index, y0, STEP, NB, (a, b, c) => onLeg(a) && onLeg(b) && onLeg(c));
  const bootCut = slices(P, geo.index!.array, y0, STEP, NB);
  // 脚の切り口の中心（切り口のない高さは、となりの高さのもの）
  const center: ([number, number] | undefined)[] = legCut.map((pts) => {
    if (!pts.length) return undefined;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]);
      x1 = Math.max(x1, pts[i]);
      z0 = Math.min(z0, pts[i + 1]);
      z1 = Math.max(z1, pts[i + 1]);
    }
    return [(x0 + x1) / 2, (z0 + z1) / 2];
  });
  const firstC = center.find((c) => c);
  if (!firstC) return undefined;
  for (let b = 0; b < NB; b++) center[b] ??= center[b - 1] ?? firstC;
  const C = center as [number, number][];
  const sectorOf = (x: number, z: number, c: [number, number]) =>
    ((Math.atan2(z - c[1], x - c[0]) / (Math.PI * 2) + 1) % 1) * NS;
  // 高さ・向きごとの広げる割合（1 より小さくはしない）と、脚のいちばん外の半径
  let scale = new Float32Array(NB * NS).fill(1);
  const legRs = new Float32Array(NB * NS);
  for (let b = 0; b < NB; b++) {
    const legR = legRs.subarray(b * NS, (b + 1) * NS);
    const c = C[b];
    const L = legCut[b];
    for (let i = 0; i < L.length; i += 2) {
      const k = Math.floor(sectorOf(L[i], L[i + 1], c)) % NS;
      legR[k] = Math.max(legR[k], Math.hypot(L[i] - c[0], L[i + 1] - c[1]));
    }
    const { outer } = outerRadius(bootCut[b], c, NS);
    for (let k = 0; k < NS; k++)
      if (legR[k] > 0 && outer[k] > 1e-4)
        scale[b * NS + k] = Math.max(1, (legR[k] + SHAFT_GAP) / outer[k]);
  }
  // 向き・高さのとなりとならして、型が波打たないようにする（押し広げが足りなくならないよう、元との大きいほう）
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(NB * NS);
    const at = (bb: number, kk: number) => scale[clamp(bb, 0, NB - 1) * NS + ((kk + NS) % NS)];
    for (let b = 0; b < NB; b++)
      for (let k = 0; k < NS; k++) {
        const avg = (at(b, k) * 4 + at(b, k - 1) * 2 + at(b, k + 1) * 2 + at(b - 1, k) + at(b + 1, k)) / 10;
        next[b * NS + k] = Math.max(avg, at(b, k));
      }
    scale = next;
  }
  const lerpC = (y: number): [number, number, number] => {
    const f = clamp((y - y0) / STEP, 0, NB - 1);
    const b = Math.min(NB - 2, Math.floor(f));
    return [b, f - b, 0];
  };
  for (let i = 0; i < p.count; i++) {
    const y = P[i * 3 + 1];
    // 足首のところから少しずつ（足に合わせたところとなめらかにつなぐ）
    const w = smoothstep((y - y0) / 0.016);
    if (w <= 0) continue;
    const [b, u] = lerpC(y);
    const c: [number, number] = [lerp(C[b][0], C[b + 1][0], u), lerp(C[b][1], C[b + 1][1], u)];
    const x = P[i * 3];
    const z = P[i * 3 + 2];
    const sf = sectorOf(x, z, c) - 0.5;
    const k = Math.floor(sf);
    const v = sf - k;
    const grid = (a: Float32Array) => {
      const at = (bb: number, kk: number) => a[bb * NS + (((kk % NS) + NS) % NS)];
      return lerp(lerp(at(b, k), at(b, k + 1), v), lerp(at(b + 1, k), at(b + 1, k + 1), v), u);
    };
    let kk = 1 + (grid(scale) - 1) * w;
    // 内張りや細いみぞ（ファスナーなど）の底が脚の中に入ると、すき間から脚が見えるので、脚の外側まで出す
    const r = Math.hypot(x - c[0], z - c[1]);
    const need = grid(legRs) + SHAFT_LINING;
    if (r > 1e-6 && r * kk < need) kk = lerp(kk, need / r, w);
    if (kk <= 1) continue;
    P[i * 3] = c[0] + (x - c[0]) * kk;
    P[i * 3 + 2] = c[1] + (z - c[1]) * kk;
  }
  p.needsUpdate = true;
  // 仕上がった筒の外側（パンツのすそをかぶせるのに使う。ひもの結び目や引き手も布の下に隠れるように、
  // いちばん外の点を、となりの向きとの大きいほうにする）
  // 切り口のほか、頂点も上下の高さに入れる（細い出っぱりが切り口の高さのあいだにあっても隠れるように）
  const cut = slices(P, geo.index!.array, y0, STEP, NB);
  const far = new Float32Array(NB * NS);
  for (let b = 0; b < NB; b++) far.set(outerRadius(cut[b], C[b], NS).far, b * NS);
  for (let i = 0; i < p.count; i++) {
    const y = P[i * 3 + 1];
    if (y < y0 - STEP) continue;
    const f = (y - y0) / STEP;
    for (const b of [Math.floor(f), Math.ceil(f)]) {
      if (b < 0 || b >= NB) continue;
      const c = C[b];
      const k = Math.floor(sectorOf(P[i * 3], P[i * 3 + 2], c)) % NS;
      far[b * NS + k] = Math.max(far[b * NS + k], Math.hypot(P[i * 3] - c[0], P[i * 3 + 2] - c[1]));
    }
  }
  const outer = new Float32Array(NB * NS);
  for (let b = 0; b < NB; b++)
    for (let k = 0; k < NS; k++)
      outer[b * NS + k] = Math.max(far[b * NS + k], far[b * NS + ((k + 1) % NS)], far[b * NS + ((k + NS - 1) % NS)]);
  return { y0, step: STEP, nb: NB, ns: NS, center: C, outer, top };
}

/** サンダルのベルトの寸法（身長＝1）：幅の半分・厚み・足とのすき間 */
export const STRAP = { halfW: 0.009, thick: 0.0026, gap: 0.0006 };
/** サンダルの中敷き（底の上の薄い一枚）の厚み */
const FOOTBED = 0.0014;

/**
 * サンダルのベルトの通り道（z の平らな面の上の x, y）。足の切り口（中敷きより上）の凸包（輪ゴムをかけた形）の上側を、
 * ベルトの厚みの半分とすき間ぶん外へずらし、角を丸める。本物のベルトと同じく、足の指のすき間やくぼみには入らない。
 * 両はしは底の中までのばす
 */
export function strapPath(section: number[], floor: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < section.length; i += 2)
    if (section[i + 1] >= floor - 0.001) pts.push([section[i], section[i + 1]]);
  if (pts.length < 3) return [];
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  // 凸包の上側（左から右へ）
  const hull: [number, number][] = [];
  for (const q of pts) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], q) >= 0) hull.pop();
    hull.push(q);
  }
  // 両はしから底の中へまっすぐ下ろす
  const sink = floor - 0.003;
  const chain: [number, number][] = [[hull[0][0], sink], ...hull, [hull[hull.length - 1][0], sink]];
  // 外へずらす（となりの辺の外向きの向きの平均）
  const off = STRAP.gap + STRAP.thick / 2;
  const edgeN = (i: number): [number, number] => {
    const dx = chain[i + 1][0] - chain[i][0];
    const dy = chain[i + 1][1] - chain[i][1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  let path: [number, number][] = chain.map((q, i) => {
    const a = edgeN(Math.max(0, i - 1));
    const b = edgeN(Math.min(chain.length - 2, i));
    let nx = a[0] + b[0];
    let ny = a[1] + b[1];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    return [q[0] + nx * off, q[1] + ny * off];
  });
  // 角を丸める（Chaikin の角切り。両はしはそのまま）
  for (let pass = 0; pass < 3; pass++) {
    const next: [number, number][] = [path[0]];
    for (let i = 0; i < path.length - 1; i++) {
      const [p, q] = [path[i], path[i + 1]];
      next.push([lerp(p[0], q[0], 0.25), lerp(p[1], q[1], 0.25)], [lerp(p[0], q[0], 0.75), lerp(p[1], q[1], 0.75)]);
    }
    next.push(path[path.length - 1]);
    path = next;
  }
  return path;
}

/** 通り道（z = z0 の面の上）に沿った、角の丸い平たい帯。幅は z の向き */
function strapTube(path: [number, number][], z0: number, halfW: number, thick: number): THREE.BufferGeometry {
  const M = 16;
  const e = 2 / 5;
  const sgnPow = (v: number) => Math.sign(v) * Math.abs(v) ** e;
  const pos: number[] = [];
  const idx: number[] = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    // 帯の厚みの向き（通り道に垂直。上を通るときに上を向く側）
    const nx = -ty;
    const ny = tx;
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2;
      const u = sgnPow(Math.cos(th)) * (thick / 2);
      const w = sgnPow(Math.sin(th)) * halfW;
      pos.push(path[i][0] + nx * u, path[i][1] + ny * u, z0 + w);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < M; j++) {
      const a = i * M + j;
      const b = i * M + ((j + 1) % M);
      idx.push(a, a + M, b, b, a + M, b + M);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 靴の3Dの型を両足（右・左の順）に合わせて置く。ブーツは筒を脚の太さに合わせて広げ（足を靴に収めたあとの脚）、
 * パンツのすそをかぶせるための筒の外側（room）も返す
 */
export function fitShoes(
  fig: Figure,
  model: ShoeModel,
  look: ShoeLook,
): { geos: THREE.BufferGeometry[]; room?: ShoeRoom } {
  const body = look === "boots" ? tuckFeet(fig, "boots") : undefined;
  const shafts = new Map<1 | -1, Shaft>();
  const geos = ([-1, 1] as const).map((side) => {
    const geo = fitShoe(model, measureFoot(fig, side), side, shoeLift(look));
    const shaft = body && fitShaft(geo, fig, side, body);
    if (shaft) shafts.set(side, shaft);
    return geo;
  });
  return { geos, room: shafts.size ? shoeRoomOf(shafts) : undefined };
}

/** 靴。足の形を体のメッシュから測って作る。ブーツの筒はタイツの脚の部分を使う */
function buildShoes(
  fig: Figure,
  shape: Extract<LookShape, { kind: "shoes" }>,
  paint: Paint,
): THREE.Group {
  const g = new THREE.Group();
  const style = shape.style;
  const asset = shoeAsset(fig, style);
  if (asset) {
    // スニーカー・革靴・ブーツは本物の靴の3Dの型を、足の長さ・幅・向きに合わせて置く（革靴は底を薄く、表面を革に）
    const look = style === "leather" ? "leather" : style === "boots" ? "boots" : "sneakers";
    const mat = shoeMaterial(asset, paint.tone ?? paint.color, look);
    const { geos, room } = fitShoes(fig, asset.model, look);
    for (const geo of geos) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      g.add(m);
    }
    fig.shoeRoom = room;
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
  const sandals = style === "sandals";
  const soleMat = new THREE.MeshStandardMaterial({
    // サンダルの底はベルトと同じ色の仲間（少し濃く）。ほかは靴の種類ごとの色
    color: sandals ? base.clone().lerp(new THREE.Color("#3a3330"), 0.35) : spec.soleColor,
    roughness: style === "sneakers" ? 0.65 : sandals ? 0.8 : 0.5,
    metalness: 0,
  });
  // サンダルの中敷き：ベルトの色を少し明るく、くすませた色
  const bedMat = sandals
    ? new THREE.MeshStandardMaterial({
        color: base.clone().lerp(new THREE.Color("#d9cfc0"), 0.18),
        roughness: 0.9,
        metalness: 0,
      })
    : undefined;
  // サンダルのベルトは、足を中敷きの上にのせたあとの足に沿わせる
  const feet = sandals ? tuckFeet(fig, style) : undefined;
  const parts = fig.human.body.parts;
  const onFoot = (i: number, s: 0 | 1) =>
    parts[i * 4 + 2] >= 0.5 &&
    (feet![i * 3] < 0 ? 0 : 1) === s &&
    feet![i * 3 + 1] < fig.fit.marks.foot[s].ankle[1] + 0.02;
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
        // サンダルの底は角を少し立てる（ふちの厚みが見えるように）
        power: sandals ? 4.5 : 3.2,
        capStart: true,
        capEnd: true,
      }),
      soleMat,
    );
    if (style === "sandals") {
      // 底の上に中敷き（少し明るい色）を重ね、ベルトを2本、足の甲に沿わせてわたす
      const bed = soleStations(fs, spec).map((st) => ({
        ...st,
        c: [st.c[0], st.rz * 2 + FOOTBED / 2 - 0.0006, st.c[2]] as V3,
        rx: Math.max(0.002, st.rx - 0.0022),
        rz: FOOTBED / 2,
      }));
      add(loft(bed, { power: 6, capStart: true, capEnd: true }), bedMat!);
      const sideIdx = side < 0 ? 0 : 1;
      for (const t of [0.45, 0.66]) {
        const f = footAt(fs, t);
        const floor = spec.sole(t) + FOOTBED;
        // ベルトの幅のぶん、前・まん中・後ろで足を切って、いちばん外を通す
        const section: number[] = [];
        for (const dz of [-STRAP.halfW, 0, STRAP.halfW])
          section.push(
            ...slices(
              feet!,
              fig.human.body.index,
              f.z + dz,
              1,
              1,
              (a, b, c) => onFoot(a, sideIdx) && onFoot(b, sideIdx) && onFoot(c, sideIdx),
              2,
            )[0],
          );
        const path = strapPath(section, floor);
        if (path.length >= 2) add(strapTube(path, f.z, STRAP.halfW, STRAP.thick), upperMat);
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
      swatchMatch: paint.swatchMatch,
      shoeRoom: fig.shoeRoom,
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
