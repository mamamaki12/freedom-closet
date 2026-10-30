// 体型（BodyScan）から3Dのマネキンを作り、服を着せる（three.js）。
// 体も服も「輪切りの楕円を積み重ねた形」で作る。身長を1とした大きさで、床が y=0。
import * as THREE from "three";
import type { LookShape } from "../domain/look";
import type { BodyScan } from "./types";

type V3 = [number, number, number];
interface Station {
  c: V3;
  /** 左右・前後の半径 */
  rx: number;
  rz: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const SEG = 32;

/**
 * 楕円の輪を順につないだ筒。輪は進む向きに直角に置く。
 * u は前(0.5)を中心に一周、v は最初の輪(0)から最後の輪(1)まで。
 */
function loft(stations: Station[], opts: { power?: number; capStart?: boolean; capEnd?: boolean } = {}): THREE.BufferGeometry {
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
    const d = new THREE.Vector3(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]).normalize();
    // 輪の横向き(n1)と前向き(n2)。前向きはなるべく +z にそろえる
    let n1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1));
    if (n1.lengthSq() < 1e-6) n1 = new THREE.Vector3(1, 0, 0);
    n1.normalize();
    if (n1.x < 0) n1.negate();
    const n2 = new THREE.Vector3().crossVectors(n1, d).normalize();
    if (n2.z < 0 || (Math.abs(n2.z) < 1e-6 && n2.y > 0)) n2.negate();
    for (let j = 0; j <= SEG; j++) {
      const th = Math.PI + (j / SEG) * Math.PI * 2; // 後ろから始めて、前が真ん中
      const a = sgnPow(Math.sin(th)) * s.rx;
      const b = sgnPow(Math.cos(th)) * s.rz;
      pos.push(s.c[0] + n1.x * a + n2.x * b, s.c[1] + n1.y * a + n2.y * b, s.c[2] + n1.z * a + n2.z * b);
      uv.push(j / SEG, n > 1 ? i / (n - 1) : 0);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j;
      const b = a + SEG + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const cap = (i: number, flip: boolean) => {
    const s = stations[i];
    const center = pos.length / 3;
    pos.push(...s.c);
    uv.push(0.5, i === 0 ? 0 : 1);
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j;
      if (flip) idx.push(center, a + 1, a);
      else idx.push(center, a, a + 1);
    }
  };
  if (opts.capStart) cap(0, false);
  if (opts.capEnd) cap(n - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 頭から測った高さ(0〜1)を、床からの高さに */
const Y = (fromTop: number) => 1 - fromTop;

/** 胴の形を、測った輪切りから好きな高さで取り出す。股より下は脚をまとめて包む形（コート・スカート用） */
function torsoAt(scan: BodyScan, y: number): { w: number; d: number } {
  const t = scan.torso;
  if (y <= t[0].y) {
    // 肩のあたり：肩幅に向かって少し広がり、首に向かって細くなる
    const k = Math.min(1, (t[0].y - y) / Math.max(0.01, t[0].y - scan.shoulder.y));
    return { w: lerp(t[0].width, scan.shoulder.width * 0.9, k), d: lerp(t[0].depth, t[0].depth * 0.82, k) };
  }
  for (let i = 1; i < t.length; i++) {
    if (y <= t[i].y) {
      const k = (y - t[i - 1].y) / (t[i].y - t[i - 1].y);
      return { w: lerp(t[i - 1].width, t[i].width, k), d: lerp(t[i - 1].depth, t[i].depth, k) };
    }
  }
  const last = t[t.length - 1];
  const legsW = scan.legGap + (scan.legs[0]?.width ?? 0.1);
  return { w: Math.max(last.width, legsW), d: last.depth };
}

/** 肩の少し上から、上の輪切りを返す（首へのつながり） */
function shoulderTop(scan: BodyScan, inflate: number): Station[] {
  const t0 = scan.torso[0];
  const sy = Y(scan.shoulder.y);
  // 肩から首へ、なで肩のようになだらかに細くする
  return [
    { c: [0, sy + 0.004, 0], rx: scan.shoulder.width * 0.43 + inflate, rz: t0.depth * 0.42 + inflate },
    { c: [0, sy + 0.012, 0], rx: scan.shoulder.width * 0.36 + inflate, rz: t0.depth * 0.38 + inflate },
    { c: [0, sy + 0.019, 0], rx: scan.shoulder.width * 0.25 + inflate, rz: t0.depth * 0.32 + inflate },
    { c: [0, sy + 0.024, 0], rx: scan.neck.width * 0.75 + inflate, rz: scan.neck.width * 0.7 + inflate },
  ];
}

/** 胴の筒。top〜bottom は頭からの高さ。flare は股より下で広がる量 */
function torsoStations(scan: BodyScan, top: number, bottom: number, inflate: number, flare = 0): Station[] {
  const out: Station[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const y = lerp(bottom, top, i / steps);
    const { w, d } = torsoAt(scan, y);
    const below = Math.max(0, y - scan.crotchY);
    out.push({ c: [0, Y(y), 0.004], rx: w / 2 + inflate + below * flare, rz: d / 2 + inflate + below * flare * 0.6 });
  }
  return out;
}

/** 腕の点（肩→ひじ→手首） */
function armPoints(scan: BodyScan, side: 1 | -1): V3[] {
  const L = scan.arm.length;
  const angle = (9 * Math.PI) / 180; // 少しだけ体から離す
  const s: V3 = [side * (scan.shoulder.width / 2 - scan.arm.upper * 0.6), Y(scan.shoulder.y) - 0.006, 0];
  const dir: V3 = [side * Math.sin(angle), -Math.cos(angle), 0.02];
  const at = (k: number): V3 => [s[0] + dir[0] * L * k, s[1] + dir[1] * L * k, s[2] + dir[2] * L * k];
  return [s, at(0.5), at(1)];
}

function armStations(scan: BodyScan, side: 1 | -1, upTo: number, inflate: number): Station[] {
  const [s, e, w] = armPoints(scan, side);
  const out: Station[] = [];
  // 肩の上は丸く閉じる（四角い角が出ないように）
  const dir = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
  for (const [k, rr] of [
    [-0.09, 0.25],
    [-0.06, 0.5],
    [-0.03, 0.66],
  ]) {
    const r = scan.arm.upper * rr + inflate * (rr + 0.3);
    out.push({ c: [s[0] + dir[0] * k * 2 - Math.sign(dir[0]) * 0.004, s[1] + dir[1] * k * 2, s[2]], rx: r, rz: r * 1.05 });
  }
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const k = (i / steps) * upTo;
    const p: V3 = k <= 0.5 ? (s.map((v, j) => lerp(v, e[j], k * 2)) as V3) : (e.map((v, j) => lerp(v, w[j], (k - 0.5) * 2)) as V3);
    // 肩の付け根は丸く太め（胴とのつなぎ目を隠す）
    const r = k < 0.12 ? lerp(scan.arm.upper * 0.7, scan.arm.upper * 0.5, k / 0.12) : k <= 0.5 ? scan.arm.upper / 2 : lerp(scan.arm.upper * 0.42, scan.arm.wrist / 2, (k - 0.5) * 2);
    out.push({ c: p, rx: r + inflate, rz: r * 1.05 + inflate });
  }
  return out;
}

function legStations(scan: BodyScan, side: 1 | -1, from: number, to: number, inflate: (t: number) => number): Station[] {
  const x = (side * scan.legGap) / 2;
  const out: Station[] = [];
  const legs = scan.legs;
  const at = (t: number) => {
    for (let i = 1; i < legs.length; i++) {
      if (t <= legs[i].t) {
        const k = (t - legs[i - 1].t) / (legs[i].t - legs[i - 1].t);
        return { w: lerp(legs[i - 1].width, legs[i].width, k), d: lerp(legs[i - 1].depth, legs[i].depth, k) };
      }
    }
    return { w: legs[legs.length - 1].width, d: legs[legs.length - 1].depth };
  };
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = lerp(from, to, i / steps);
    const { w, d } = at(Math.max(0, t));
    const y = lerp(scan.crotchY, scan.ankleY, t);
    out.push({ c: [x * (t < 0 ? 0.9 : 1), Y(y), 0], rx: w / 2 + inflate(t), rz: d / 2 + inflate(t) });
  }
  return out;
}

function footStations(scan: BodyScan, side: 1 | -1, inflate: number, height = 1): Station[] {
  const x = (side * scan.legGap) / 2;
  const ankle = scan.legs[scan.legs.length - 1];
  const w = ankle.width * 1.25;
  const h = Y(scan.ankleY);
  return [
    { c: [x, h * 0.5 * height + 0.004, -0.03], rx: w * 0.4 + inflate, rz: h * 0.4 * height + inflate },
    { c: [x, h * 0.45 * height + 0.004, 0.0], rx: w * 0.5 + inflate, rz: h * 0.45 * height + inflate },
    { c: [x * 1.02, h * 0.3 * height + 0.004, 0.06], rx: w * 0.55 + inflate, rz: h * 0.3 * height + inflate },
    { c: [x * 1.04, h * 0.18 + 0.004, 0.11], rx: w * 0.42 + inflate, rz: h * 0.18 + inflate },
  ];
}

/** 服や体の材質 */
export interface Paint {
  color: string;
  /** 服の写真から作った模様（1枚の布として貼る） */
  whole?: THREE.Texture;
  /** 生地を敷き詰める模様（袖・パンツ用） */
  swatch?: THREE.Texture;
}

function material(paint: Paint, kind: "whole" | "swatch", repeat: [number, number] = [2, 3]): THREE.MeshStandardMaterial {
  const base = kind === "whole" ? paint.whole : paint.swatch;
  let map: THREE.Texture | undefined;
  if (base) {
    map = base.clone();
    map.needsUpdate = true;
    if (kind === "whole") {
      // 前半分に写真1枚、後ろは左右反転してつなぐ
      map.wrapS = THREE.MirroredRepeatWrapping;
      map.repeat.set(2, 1);
      map.offset.set(-0.5, 0);
    } else {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(...repeat);
    }
  }
  return new THREE.MeshStandardMaterial({
    color: map ? "#ffffff" : paint.color,
    map,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

const SKIN = new THREE.MeshStandardMaterial({ color: "#e6dccf", roughness: 0.55, metalness: 0 });

/** 服を着ていないマネキン */
export function buildBody(scan: BodyScan): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material = SKIN) => g.add(new THREE.Mesh(geo, mat));
  // 胴は股の少し下で、脚の付け根に向かって丸く閉じる
  const last = scan.torso[scan.torso.length - 1];
  const hipEnd: Station = { c: [0, Y(scan.crotchY) - 0.012, 0], rx: last.width * 0.38, rz: last.depth * 0.36 };
  add(loft([hipEnd, ...torsoStations(scan, scan.torso[0].y - 0.01, scan.crotchY - 0.004, 0), ...shoulderTop(scan, 0)], { power: 2.3, capStart: true, capEnd: true }));
  // 首と頭
  const chinY = Y(scan.head.height);
  add(
    loft(
      [
        { c: [0, Y(scan.shoulder.y) + 0.01, -0.004], rx: scan.neck.width / 2, rz: scan.neck.width / 2 },
        { c: [0, chinY + 0.01, 0], rx: scan.neck.width * 0.47, rz: scan.neck.width * 0.5 },
      ],
      {},
    ),
  );
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), SKIN);
  head.scale.set(scan.head.width, scan.head.height * 1.02, scan.head.depth);
  head.position.set(0, Y(scan.head.height / 2), 0.004);
  g.add(head);
  for (const side of [-1, 1] as const) {
    add(loft(armStations(scan, side, 1, 0), { capStart: true }));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), SKIN);
    const w = armPoints(scan, side)[2];
    hand.scale.set(scan.arm.wrist * 1.1, scan.head.height * 0.55, scan.arm.wrist * 0.55);
    hand.position.set(w[0], w[1] - scan.head.height * 0.25, w[2]);
    g.add(hand);
    add(loft(legStations(scan, side, -0.06, 1, () => 0), {}));
    add(loft(footStations(scan, side, 0), { capStart: true, capEnd: true }));
  }
  return g;
}

/** 体型に合わせて服1着の形を作る */
export function buildGarment(scan: BodyScan, shape: LookShape, paint: Paint): THREE.Group {
  const g = new THREE.Group();
  const waistY = scan.torso[Math.floor(scan.torso.length * 0.45)].y;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => g.add(new THREE.Mesh(geo, mat));
  const body = (top: number, bottom: number, inflate: number, flare = 0) =>
    add(loft([...torsoStations(scan, top, bottom, inflate, flare), ...shoulderTop(scan, inflate)], { power: 2.3 }), material(paint, "whole"));
  const sleeves = (upTo: number, inflate: number) => {
    if (upTo <= 0) return;
    for (const side of [-1, 1] as const) add(loft(armStations(scan, side, upTo, inflate)), material(paint, "swatch", [2, 2]));
  };
  const top0 = scan.torso[0].y - 0.012;

  switch (shape.kind) {
    case "top": {
      const hem = shape.hem === "short" ? waistY : shape.hem === "long" ? scan.crotchY + 0.07 : scan.crotchY - 0.015;
      // パンツ・スカート（0.006）よりはっきり外側にして、裾を出して着ている形にする（近すぎるとちらつく）
      body(top0, hem, 0.013, 0.4);
      sleeves(shape.sleeve === "none" ? 0 : shape.sleeve === "short" ? 0.3 : 0.96, 0.011);
      break;
    }
    case "outer": {
      const hem = shape.length === "short" ? scan.crotchY + 0.01 : shape.length === "middle" ? scan.crotchY + 0.17 : scan.crotchY + 0.3;
      const inflate = shape.puffy ? 0.03 : 0.016;
      body(top0, hem, inflate, 0.25);
      sleeves(1, inflate + 0.004);
      break;
    }
    case "dress": {
      const hem = shape.length === "long" ? scan.crotchY + 0.36 : scan.crotchY + 0.2;
      body(top0, hem, 0.007, 0.35);
      sleeves(shape.sleeve === "none" ? 0 : shape.sleeve === "short" ? 0.3 : 0.96, 0.008);
      break;
    }
    case "skirt": {
      const hem = shape.length === "mini" ? scan.crotchY + 0.08 : shape.length === "knee" ? scan.crotchY + 0.22 : scan.crotchY + 0.4;
      add(loft(torsoStations(scan, waistY, hem, 0.006, 0.35), { power: 2.2 }), material(paint, "whole"));
      break;
    }
    case "pants": {
      const to = shape.length === "short" ? 0.28 : 0.985;
      const extra = (t: number) =>
        shape.width === "wide" ? 0.012 + Math.max(0, t) * 0.03 : shape.width === "slim" ? 0.004 : 0.007 + Math.max(0, t) * 0.006;
      add(loft(torsoStations(scan, waistY, scan.crotchY + 0.02, 0.006), { power: 2.3 }), material(paint, "swatch", [3, 1]));
      for (const side of [-1, 1] as const) add(loft(legStations(scan, side, -0.06, to, extra)), material(paint, "swatch", [2, 4]));
      break;
    }
    case "shoes": {
      const mat = material(paint, "whole");
      for (const side of [-1, 1] as const) {
        add(loft(footStations(scan, side, 0.006, shape.style === "boots" ? 1.1 : 1), { capStart: true, capEnd: true }), mat);
        if (shape.style === "boots") add(loft(legStations(scan, side, 0.62, 1, () => 0.007)), mat);
      }
      break;
    }
  }
  return g;
}

export { THREE };
