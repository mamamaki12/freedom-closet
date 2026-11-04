// 靴の3Dの型（Materials Variants Shoe を作り直したもの）の読み込みと、足に合わせた置き方
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Layers } from "../src/body/garments";
import { fitShoe, parseShoe, shoeLift, type FootFit, type ShoeModel } from "../src/body/shoe";

async function load(): Promise<ShoeModel> {
  const buf = readFileSync(new URL("../src/body/assets/shoe.glb", import.meta.url));
  return parseShoe(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
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

  it("高さの変え方：履き口より上は低く、革靴は底を薄くする", () => {
    const sneakers = shoeLift("sneakers");
    const leather = shoeLift("leather");
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
