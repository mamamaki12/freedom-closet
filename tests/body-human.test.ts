// 3D の人体モデル（MakeHuman 由来）の読み込みと、体型への当てはめ、服の切り出し
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { garmentPieces } from "../src/body/garments";
import { blendFor, fitHuman, parseHuman, type Human } from "../src/body/human";
import { defaultScan } from "../src/body/measure";
import type { LookShape } from "../src/domain/look";

async function load(): Promise<Human> {
  const buf = readFileSync(
    new URL("../src/body/assets/human.glb", import.meta.url),
  );
  return parseHuman(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}
const finite = (a: Float32Array) => {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
};
const yRange = (a: Float32Array) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < a.length; i += 3) {
    lo = Math.min(lo, a[i]);
    hi = Math.max(hi, a[i]);
  }
  return [lo, hi];
};

describe("人体モデル", () => {
  it("glb を読めて、体・タイツ・スカートのメッシュと目印がそろっている", async () => {
    const h = await load();
    for (const mesh of [h.body, h.tights, h.skirt]) {
      expect(mesh.position.length).toBeGreaterThan(0);
      expect(mesh.index.length % 3).toBe(0);
      expect(mesh.morphs.length).toBe(6);
      expect(finite(mesh.position)).toBe(true);
    }
    // 床が 0、頭のてっぺんが 1
    const [lo, hi] = yRange(h.body.position);
    expect(lo).toBeCloseTo(0, 2);
    expect(hi).toBeCloseTo(1, 2);
    expect(h.landmarks.base["head____head"]).toBeDefined();
    expect(Object.keys(h.landmarks)).toContain("maleHeavy");
  }, 30000);

  it("身長・体重から体型の混ぜ方を決める（重いほど太い形が強くなる）", () => {
    const light = blendFor({ heightCm: 170, weightKg: 50, fit: "mens" });
    const heavy = blendFor({ heightCm: 170, weightKg: 95, fit: "mens" });
    expect(heavy.maleHeavy).toBeGreaterThan(light.maleHeavy);
    expect(light.maleThin).toBeGreaterThan(heavy.maleThin);
    const w = blendFor({ fit: "womens" });
    expect(w.female).toBeGreaterThan(w.male);
  });

  it("標準体型（写真なし）に当てはめると、目印が上から順に並び、座標が壊れない", async () => {
    const h = await load();
    for (const profile of [
      { heightCm: 172, weightKg: 65, fit: "mens" as const },
      { heightCm: 158, weightKg: 75, fit: "womens" as const },
      {},
    ]) {
      const fit = fitHuman(h, defaultScan(profile), profile, { warp: false });
      const m = fit.marks;
      expect(finite(fit.body)).toBe(true);
      expect(finite(fit.tights)).toBe(true);
      expect(finite(fit.skirt)).toBe(true);
      expect(m.topY).toBeGreaterThan(m.shoulderY);
      expect(m.shoulderY).toBeGreaterThan(m.chestY);
      expect(m.chestY).toBeGreaterThan(m.waistY);
      expect(m.waistY).toBeGreaterThan(m.crotchY);
      expect(m.crotchY).toBeGreaterThan(m.ankleY);
      expect(m.ankleY).toBeGreaterThan(0);
      // 腕は肩→ひじ→手首の順に下がる
      for (const s of [0, 1]) {
        expect(m.shoulder[s][1]).toBeGreaterThan(m.elbow[s][1]);
        expect(m.elbow[s][1]).toBeGreaterThan(m.wrist[s][1]);
        expect(m.foot[s].toeZ).toBeGreaterThan(m.foot[s].heelZ);
      }
    }
  }, 30000);

  it("写真で測った体型（仮の採寸）に変形しても座標が壊れず、背の高さは 1 のまま", async () => {
    const h = await load();
    const profile = { heightCm: 165, weightKg: 58, fit: "womens" as const };
    const fit = fitHuman(h, defaultScan(profile), profile, { warp: true });
    expect(finite(fit.body)).toBe(true);
    const [lo, hi] = yRange(fit.body);
    expect(lo).toBeCloseTo(0, 1);
    expect(hi).toBeCloseTo(1, 1);
  }, 30000);
});

describe("服の切り出し", () => {
  const shapes: LookShape[] = [
    { kind: "top", sleeve: "short", hem: "normal" },
    { kind: "top", sleeve: "long", hem: "long" },
    { kind: "top", sleeve: "none", hem: "short" },
    { kind: "outer", length: "short", puffy: true },
    { kind: "outer", length: "long", puffy: false },
    { kind: "dress", sleeve: "long", length: "knee" },
    { kind: "skirt", length: "mini" },
    { kind: "pants", width: "wide", length: "full" },
    { kind: "pants", width: "slim", length: "short" },
  ];
  it("どの形でも面があり、座標と模様の位置が壊れない", async () => {
    const h = await load();
    const profile = { heightCm: 172, weightKg: 65, fit: "mens" as const };
    const fit = fitHuman(h, defaultScan(profile), profile, { warp: false });
    for (const shape of shapes) {
      const pieces = garmentPieces(h, fit, shape, { bodyU: [0.2, 0.8] });
      expect(pieces.length, shape.kind).toBeGreaterThan(0);
      for (const p of pieces) {
        const pos = p.geometry.getAttribute("position").array as Float32Array;
        const uv = p.geometry.getAttribute("uv").array as Float32Array;
        const nrm = p.geometry.getAttribute("normal").array as Float32Array;
        expect(pos.length).toBeGreaterThan(0);
        expect(finite(pos)).toBe(true);
        expect(finite(uv)).toBe(true);
        expect(finite(nrm)).toBe(true);
        expect(p.geometry.groups.length).toBe(2);
      }
    }
    // 上下に分かれる服は 2 枚
    expect(
      garmentPieces(h, fit, { kind: "dress", sleeve: "none", length: "long" })
        .length,
    ).toBe(2);
  }, 60000);
});
