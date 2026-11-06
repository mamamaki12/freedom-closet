// 靴・ブーツの3Dの型（Materials Variants Shoe・Photoscanned Female Ankle Boots を作り直したもの）の読み込みと、
// 足に合わせた置き方。ブーツの筒と脚・パンツのすそ、サンダルのベルト
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { garmentPieces, Layers } from "../src/body/garments";
import { fitHuman, parseHuman, type Human } from "../src/body/human";
import { defaultScan } from "../src/body/measure";
import { fitShoes, STRAP, strapPath, type Figure } from "../src/body/model3d";
import { fitShoe, parseShoe, shoeLift, type FootFit, type ShoeAsset, type ShoeModel } from "../src/body/shoe";

const asset = (file: string) => {
  const buf = readFileSync(new URL("../src/body/assets/" + file, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

async function load(file = "shoe.glb"): Promise<ShoeModel> {
  return parseShoe(asset(file));
}

const range = (a: ArrayLike<number>, k: number, stride = 3) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = k; i < a.length; i += stride) {
    lo = Math.min(lo, a[i]);
    hi = Math.max(hi, a[i]);
  }
  return [lo, hi];
};

/** 足の形（身長＝1。かかと z=-0.02、つま先 z=0.12、まっすぐ前向き） */
function foot(cx: number): FootFit {
  const slices = [];
  for (let k = 0; k < 16; k++) {
    const t = (k + 0.5) / 16;
    slices.push({ z: -0.02 + 0.14 * t, cx, halfW: 0.012 + 0.016 * Math.sin(Math.PI * Math.min(1, t * 1.3)), top: 0.05 - 0.035 * t });
  }
  return { heelZ: -0.02, toeZ: 0.12, slices };
}

/** 三角形の向き（頂点の順で決まる表）が、頂点の向き（normal）とそろっている割合 */
function agreement(pos: ArrayLike<number>, nrm: ArrayLike<number>, index: ArrayLike<number>): number {
  let ok = 0;
  let all = 0;
  for (let f = 0; f < index.length; f += 3) {
    const [a, b, c] = [index[f], index[f + 1], index[f + 2]];
    const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) continue;
    let d = 0;
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) d += n[k] * nrm[v * 3 + k];
    all++;
    if (d > 0) ok++;
  }
  return ok / all;
}

/**
 * 型の底（y < 0.04）の幅が、つま先側（z 0.5〜0.8）から土踏まず（z 0.3〜0.5）へ細るぶんの、内側（+x）と外側（-x）の差。
 * 右足の型なら土踏まずのくびれは内側にあるので正になる
 */
function archSide(P: ArrayLike<number>): number {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    const z = P[i + 2];
    const k = z >= 0.3 && z < 0.5 ? 0 : z >= 0.5 && z < 0.8 ? 1 : -1;
    if (P[i + 1] >= 0.04 || k < 0) continue;
    lo[k] = Math.min(lo[k], P[i]);
    hi[k] = Math.max(hi[k], P[i]);
  }
  return hi[1] - hi[0] - (lo[0] - lo[1]);
}

describe("靴の3Dの型", () => {
  it("glb を読めて、型の向きと大きさがそろっている（かかと z=0・つま先 z=1・床 y=0）", async () => {
    const s = await load();
    expect(s.index.length % 3).toBe(0);
    expect(s.uv.length / 2).toBe(s.position.length / 3);
    const [z0, z1] = range(s.position, 2);
    const [y0] = range(s.position, 1);
    expect(z0).toBeCloseTo(0, 2);
    expect(z1).toBeCloseTo(1, 2);
    expect(y0).toBeCloseTo(0, 2);
    const [u0, u1] = range(s.uv, 0, 2);
    const [v0, v1] = range(s.uv, 1, 2);
    expect(u0).toBeGreaterThanOrEqual(0);
    expect(u1).toBeLessThanOrEqual(1);
    expect(v0).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThanOrEqual(1);
    expect(agreement(s.position, s.normal, s.index)).toBeGreaterThan(0.9);
  }, 30000);

  it("ブーツの型も同じ向きと大きさにそろっていて、筒の口は長さの 0.6 倍くらいの高さ", async () => {
    const s = await load("boot.glb");
    expect(s.index.length % 3).toBe(0);
    expect(s.uv.length / 2).toBe(s.position.length / 3);
    const [z0, z1] = range(s.position, 2);
    const [y0, y1] = range(s.position, 1);
    expect(z0).toBeCloseTo(0, 2);
    expect(z1).toBeCloseTo(1, 2);
    expect(y0).toBeCloseTo(0, 2);
    expect(y1).toBeGreaterThan(0.55);
    expect(y1).toBeLessThan(0.7);
    const [u0, u1] = range(s.uv, 0, 2);
    const [v0, v1] = range(s.uv, 1, 2);
    expect(u0).toBeGreaterThanOrEqual(0);
    expect(u1).toBeLessThanOrEqual(1);
    expect(v0).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThanOrEqual(1);
    expect(agreement(s.position, s.normal, s.index)).toBeGreaterThan(0.9);
  }, 30000);

  it("靴もブーツも右足の型（土踏まずのくびれが +x の側＝足の内側にある）", async () => {
    for (const file of ["shoe.glb", "boot.glb"]) expect(archSide((await load(file)).position), file).toBeGreaterThan(0.015);
  }, 30000);

  it("足の長さにゆとりを足した長さで置き、左足は右足の鏡写しになる", async () => {
    const s = await load();
    const right = fitShoe(s, foot(-0.11), -1);
    const left = fitShoe(s, foot(0.11), 1);
    const rp = right.getAttribute("position").array as Float32Array;
    const lp = left.getAttribute("position").array as Float32Array;
    const [z0, z1] = range(rp, 2);
    expect(z0).toBeLessThan(-0.02);
    expect(z1).toBeGreaterThan(0.12);
    expect(z1 - z0).toBeCloseTo(0.14 + 0.0175, 3);
    const [y0] = range(rp, 1);
    expect(y0).toBeCloseTo(0, 3);
    // 足の幅が収まる
    const [x0, x1] = range(rp, 0);
    expect(x0).toBeLessThan(-0.11 - 0.028);
    expect(x1).toBeGreaterThan(-0.11 + 0.028);
    for (let i = 0; i < rp.length; i += 3) {
      expect(lp[i]).toBeCloseTo(-rp[i], 6);
      expect(lp[i + 1]).toBeCloseTo(rp[i + 1], 6);
      expect(lp[i + 2]).toBeCloseTo(rp[i + 2], 6);
    }
    // 鏡写しにしても、三角形の表と頂点の向きがそろっている（裏返って真っ黒にならない）
    for (const g of [right, left])
      expect(
        agreement(
          g.getAttribute("position").array,
          g.getAttribute("normal").array,
          g.getIndex()!.array,
        ),
      ).toBeGreaterThan(0.9);
  }, 30000);

  it("足が外向きなら、靴も同じ向きに回す", async () => {
    const s = await load();
    const f = foot(-0.11);
    // つま先が 0.02 だけ外（-x）へ向いた足
    f.slices = f.slices.map((sl) => ({ ...sl, cx: sl.cx - ((sl.z + 0.02) / 0.14) * 0.02 }));
    const p = fitShoe(s, f, -1).getAttribute("position").array as Float32Array;
    // つま先側（z が大きい）の頂点ほど -x に寄る
    let front = 0;
    let nf = 0;
    let back = 0;
    let nb = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 2] > 0.09) {
        front += p[i];
        nf++;
      } else if (p[i + 2] < 0.01) {
        back += p[i];
        nb++;
      }
    }
    expect(front / nf).toBeLessThan(back / nb - 0.01);
  }, 30000);

  it("高さの変え方：履き口より上は低く、革靴は底を薄くする。ブーツは変えない", () => {
    const sneakers = shoeLift("sneakers");
    const leather = shoeLift("leather");
    const boots = shoeLift("boots");
    for (let y = 0; y < 0.7; y += 0.05) expect(boots(y)).toBe(y);
    expect(sneakers(0.2)).toBe(0.2);
    expect(sneakers(0.5)).toBeLessThan(0.45);
    expect(leather(0.09)).toBeLessThan(0.05);
    // 上に行くほど高い（形が折り返さない）
    for (let y = 0; y < 0.55; y += 0.01) {
      expect(sneakers(y + 0.01)).toBeGreaterThan(sneakers(y));
      expect(leather(y + 0.01)).toBeGreaterThan(leather(y));
    }
  });
});

/**
 * 三角形の面を高さ h の平らな面で切った切り口（x, z の並び）。三角形ごとの切り口の線分の上に 0.0005 おきに点を置く
 * （大きな三角形の長い線分でも、どの向きにも点があるように）。keep で使う三角形を選ぶ
 */
function cutAt(
  pos: ArrayLike<number>,
  index: ArrayLike<number>,
  h: number,
  keep: (a: number, b: number, c: number) => boolean = () => true,
): number[] {
  const out: number[] = [];
  for (let f = 0; f < index.length; f += 3) {
    const v = [index[f], index[f + 1], index[f + 2]];
    if (!keep(v[0], v[1], v[2])) continue;
    const ends: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const ya = pos[a * 3 + 1] - h;
      const yb = pos[b * 3 + 1] - h;
      if (ya * yb > 0 || ya === yb) continue;
      const t = ya / (ya - yb);
      ends.push(pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t, pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t);
    }
    if (ends.length < 4) continue;
    const n = Math.ceil(Math.hypot(ends[2] - ends[0], ends[3] - ends[1]) / 0.0005);
    for (let j = 0; j <= n; j++)
      out.push(ends[0] + ((ends[2] - ends[0]) * j) / n, ends[1] + ((ends[3] - ends[1]) * j) / n);
  }
  return out;
}

const NS = 36;
const sector = (x: number, z: number, c: [number, number]) =>
  Math.floor(((Math.atan2(z - c[1], x - c[0]) / (Math.PI * 2) + 1) % 1) * NS) % NS;

/** 切り口の点の、中心 c のまわりの向き（NS 等分）ごとのいちばん外の半径（点のない向きは 0） */
function farthest(pts: number[], c: [number, number]): Float32Array {
  const r = new Float32Array(NS);
  for (let i = 0; i < pts.length; i += 2) {
    const k = sector(pts[i], pts[i + 1], c);
    r[k] = Math.max(r[k], Math.hypot(pts[i] - c[0], pts[i + 1] - c[1]));
  }
  return r;
}

describe("ブーツをはかせる", () => {
  // 写真で測った体型（warp）では体重で脚の太さが大きく変わる。身長・体重だけの標準体型も見る
  const bodies = [
    { name: "細い脚", profile: { heightCm: 158, weightKg: 42, fit: "womens" as const }, warp: true },
    { name: "太い脚", profile: { heightCm: 172, weightKg: 100, fit: "mens" as const }, warp: true },
    { name: "標準体型", profile: { heightCm: 165, weightKg: 58, fit: "womens" as const }, warp: false },
  ];

  /**
   * 足首の少し上から筒の口の少し下まで、高さごとに脚の切り口を取り、向きごとに
   * 脚・ブーツ・パンツ（あれば）のいちばん外の半径を比べる。check(脚, ブーツ, パンツの点の半径と向き) を高さ・左右ごとに呼ぶ
   */
  function eachCut(
    human: Human,
    fit: Figure["fit"],
    geos: { getAttribute(n: "position"): { array: ArrayLike<number> }; getIndex(): { array: ArrayLike<number> } | null }[],
    pants: { pos: ArrayLike<number>; index: ArrayLike<number> }[],
    check: (leg: Float32Array, boot: Float32Array, pants: [number, number][]) => void,
  ) {
    const parts = human.body.parts;
    for (const s of [0, 1] as const) {
      const sign = s === 0 ? -1 : 1;
      const P = geos[s].getAttribute("position").array;
      const I = geos[s].getIndex()!.array;
      let top = -Infinity;
      for (let i = 1; i < P.length; i += 3) top = Math.max(top, P[i]);
      const onLeg = (i: number) => parts[i * 4 + 2] >= 0.5 && Math.sign(fit.body[i * 3]) === sign;
      for (let h = fit.marks.foot[s].ankle[1] + 0.02; h < top - 0.004; h += 0.006) {
        const leg = cutAt(fit.body, human.body.index, h, (a, b, c) => onLeg(a) && onLeg(b) && onLeg(c));
        if (!leg.length) continue;
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        for (let i = 0; i < leg.length; i += 2) {
          x0 = Math.min(x0, leg[i]);
          x1 = Math.max(x1, leg[i]);
          z0 = Math.min(z0, leg[i + 1]);
          z1 = Math.max(z1, leg[i + 1]);
        }
        const c: [number, number] = [(x0 + x1) / 2, (z0 + z1) / 2];
        const around: [number, number][] = [];
        for (const p of pants) {
          const pts = cutAt(p.pos, p.index, h);
          for (let i = 0; i < pts.length; i += 2)
            if (Math.sign(pts[i]) === sign) around.push([Math.hypot(pts[i] - c[0], pts[i + 1] - c[1]), sector(pts[i], pts[i + 1], c)]);
        }
        check(farthest(leg, c), farthest(cutAt(P, I, h), c), around);
      }
    }
  }

  it("細い脚でも太い脚でも、脚がブーツの筒の中に収まり、細いパンツのすそは筒の外にかぶさる", async () => {
    const human = await parseHuman(asset("human.glb"));
    const model = await load("boot.glb");
    const slim = { kind: "pants" as const, width: "slim" as const, length: "full" as const };
    for (const { name, profile, warp } of bodies) {
      const fit = fitHuman(human, defaultScan(profile), profile, { warp });
      const fig: Figure = { human, fit, boot: { model } as unknown as ShoeAsset };
      const { geos, room } = fitShoes(fig, model, "boots");
      expect(room, name).toBeDefined();
      const piecesOf = (shoeRoom?: typeof room) =>
        garmentPieces(human, fit, slim, { shoeRoom }).map((p) => ({
          pos: p.geometry.getAttribute("position").array,
          index: p.geometry.getIndex()!.array,
        }));
      // 脚がブーツの外に出ている量・パンツがブーツの中に入っている量の、いちばん大きいもの。
      // ブーツの口のふちは高さがそろっていないので、口の近くでブーツのない向き（ふちより上）は数えない
      let legOut = -Infinity;
      let pantsIn = -Infinity;
      let checked = 0;
      let above = 0;
      eachCut(human, fit, geos, piecesOf(room), (leg, boot, pants) => {
        for (let k = 0; k < NS; k++) {
          if (!leg[k]) continue;
          if (!boot[k]) {
            above++;
            continue;
          }
          checked++;
          legOut = Math.max(legOut, leg[k] - boot[k]);
        }
        for (const [r, k] of pants) pantsIn = Math.max(pantsIn, boot[k] - r);
      });
      expect(checked, name).toBeGreaterThan(200);
      expect(above / checked, name).toBeLessThan(0.05);
      expect(legOut, name).toBeLessThan(0);
      expect(pantsIn, name).toBeLessThan(0.0005);
      // 筒の外側をよけないと、細いパンツはブーツの中に入ってしまう（よける意味がある）
      let without = -Infinity;
      eachCut(human, fit, geos, piecesOf(undefined), (_leg, boot, pants) => {
        for (const [r, k] of pants) without = Math.max(without, boot[k] - r);
      });
      expect(without, name).toBeGreaterThan(0.002);
    }
  }, 60000);

  it("ブーツ以外の靴は筒を広げず、パンツのすそもよけない", async () => {
    const human = await parseHuman(asset("human.glb"));
    const model = await load();
    const { profile, warp } = bodies[1];
    const fit = fitHuman(human, defaultScan(profile), profile, { warp });
    const fig: Figure = { human, fit, shoe: { model } as unknown as ShoeAsset };
    const { geos, room } = fitShoes(fig, model, "sneakers");
    expect(room).toBeUndefined();
    expect(geos.length).toBe(2);
  }, 60000);
});

describe("サンダルのベルト", () => {
  // 足の切り口：底（y=0.01）の上の、幅 0.04・高さ 0.02 の半だ円。x=0.005 のあたりに指のすき間のくぼみ（深さ 0.004）
  const floor = 0.01;
  const arc = (x: number) => floor + 0.02 * Math.sqrt(Math.max(0, 1 - (x / 0.02) ** 2));
  const section: number[] = [];
  for (let k = 0; k <= 80; k++) {
    const x = -0.02 + (0.04 * k) / 80;
    section.push(x, arc(x) - (Math.abs(x - 0.005) < 0.002 ? 0.004 : 0), x, floor);
  }
  const path = strapPath(section, floor);
  /** 通り道の、x での高さ（いちばん上を通るところ） */
  const yAt = (x: number) => {
    let best = -Infinity;
    for (let i = 0; i + 1 < path.length; i++) {
      const [a, b] = [path[i], path[i + 1]];
      if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
      best = Math.max(best, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]));
    }
    return best;
  };

  it("足の上を、くぼみに入らずに通り、両はしは底の中に入る", () => {
    expect(path.length).toBeGreaterThan(10);
    expect(path[0][1]).toBeLessThan(floor);
    expect(path[path.length - 1][1]).toBeLessThan(floor);
    // 足の上側のどの点よりも、ベルトの厚みの半分以上は上を通る
    for (let x = -0.018; x <= 0.018; x += 0.001) expect(yAt(x)).toBeGreaterThan(arc(x) + STRAP.thick / 2);
    // 指のすき間のくぼみには沈まない（くぼみのない形の上を通る）
    expect(yAt(0.005)).toBeGreaterThan(arc(0.005) + STRAP.thick / 2);
  });

  it("角が丸く、なめらかに曲がる", () => {
    let worst = 0;
    for (let i = 1; i + 1 < path.length; i++) {
      const a = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]);
      const b = Math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0]);
      let d = Math.abs(b - a);
      if (d > Math.PI) d = Math.PI * 2 - d;
      worst = Math.max(worst, d);
    }
    expect(worst).toBeLessThan((25 * Math.PI) / 180);
  });
});

describe("重ね着", () => {
  it("上に着る服を、下に着た服より外へ出す（下の服がない高さは動かさない）", () => {
    const layers = new Layers(() => 0);
    // 半径 0.1 の筒（y 0.4〜0.6）を下に着た服として覚える
    const pos: number[] = [];
    const index: number[] = [];
    const N = 24;
    for (let k = 0; k <= N; k++)
      for (const y of [0.4, 0.6]) {
        const a = (k / N) * Math.PI * 2;
        pos.push(Math.cos(a) * 0.1, y, Math.sin(a) * 0.1);
      }
    for (let k = 0; k < N; k++) {
      const a = k * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    layers.add(new Float32Array(pos), index, () => true);
    const p = new Float32Array([0.09, 0.5, 0, 0, 0.5, 0.2, 0.09, 0.8, 0]);
    layers.push(p, [0, 1, 2]);
    // 内側にあった点は外へ（0.1 + すき間）
    expect(Math.hypot(p[0], p[2])).toBeGreaterThanOrEqual(0.1);
    // もともと外にあった点と、下の服のない高さの点はそのまま
    expect(p[5]).toBeCloseTo(0.2, 6);
    expect(p[6]).toBeCloseTo(0.09, 6);
  });
});
