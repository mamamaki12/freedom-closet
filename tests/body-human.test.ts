// 3D の人体モデル（MakeHuman 由来）の読み込みと、体型への当てはめ、服の切り出し
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { garmentPieces } from "../src/body/garments";
import { blendFor, fitHuman, parseHuman, type Human } from "../src/body/human";
import { defaultScan } from "../src/body/measure";
import type { LookShape } from "../src/domain/look";
import type * as THREE from "three";

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
    { kind: "outer", length: "short", puffy: true, sleeve: "long" },
    { kind: "outer", length: "long", puffy: false, sleeve: "long" },
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
        // 材質の区分は 前（写真1枚）・背中など（生地の見本）・袖（袖の見本）の 3 つで、面をすべて含む
        expect(p.geometry.groups.length).toBe(3);
        const faces = p.geometry.groups.reduce((a, g) => a + g.count, 0);
        expect(faces).toBe(p.geometry.getIndex()!.count);
      }
    }
    // 上下に分かれる服は、写真を貼る布が 2 枚（えりぐりのふちは別に付く）
    expect(
      garmentPieces(h, fit, { kind: "dress", sleeve: "none", length: "long" }).filter(
        (p) => p.geometry.groups[0].count > 0,
      ).length,
    ).toBe(2);
  }, 60000);

  it("前の写真は脇に向かって生地の見本に切り替わり、背中の見本と継ぎ目なくつながる", async () => {
    const h = await load();
    const profile = { heightCm: 172, weightKg: 65, fit: "mens" as const };
    const fit = fitHuman(h, defaultScan(profile), profile, { warp: false });
    const m = fit.marks;
    const match = { at: [0.35, 0.4] as [number, number], tileAt: [0.5, 0.5] as [number, number], size: [0.15, 0.12] as [number, number] };
    const top = (bodyU: [number, number], sleeve: "short" | "long") =>
      garmentPieces(h, fit, { kind: "top", sleeve, hem: "normal", neck: "crew" }, { bodyU, swatchMatch: match })[0].geometry;
    const geo = top([0.2, 0.8], "short");
    const pos = geo.getAttribute("position").array as Float32Array;
    const uv = geo.getAttribute("uv").array as Float32Array;
    const fade = geo.getAttribute("photoFade").array as Float32Array;
    const sw = geo.getAttribute("swatchUv").array as Float32Array;
    const idx = geo.getIndex()!.array;
    const [front, back] = geo.groups;
    const inGroup = (g: { start: number; count: number }) => {
      const set = new Set<number>();
      for (let k = g.start; k < g.start + g.count; k++) set.add(idx[k]);
      return set;
    };
    const fv = inGroup(front);
    const bv = inGroup(back);
    // 前のまん中は写真のまま、真横は見本だけ
    let center = 0;
    let side = 0;
    for (const v of fv) {
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const a = Math.atan2(Math.abs(x), pos[v * 3 + 2] - m.torsoCz(y)) / (Math.PI / 2);
      if (a < 0.4) {
        expect(fade[v]).toBe(0);
        center++;
      }
      if (a > 0.97) {
        expect(fade[v]).toBeCloseTo(1, 5);
        side++;
      }
    }
    expect(center).toBeGreaterThan(50);
    expect(side).toBeGreaterThan(20);
    // 前と背中の境目（同じ位置の頂点）で、前の見本の座標が背中の見本の座標と同じ
    const backUv = new Map<string, [number, number]>();
    const key = (v: number) => `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`;
    for (const v of bv) {
      backUv.set(key(v), [uv[v * 2], uv[v * 2 + 1]]);
      expect(fade[v]).toBe(0);
    }
    let shared = 0;
    for (const v of fv) {
      const b = backUv.get(key(v));
      if (!b) continue;
      shared++;
      expect(fade[v]).toBeCloseTo(1, 5);
      expect(sw[v * 2]).toBeCloseTo(b[0], 4);
      expect(sw[v * 2 + 1]).toBeCloseTo(b[1], 4);
    }
    expect(shared).toBeGreaterThan(20);
    // 写真が見えているところでは、見本は写真の柄に重なる：写真の座標 at のところが見本の座標 tileAt で、
    // 見本1枚が写真の座標で size の大きさ
    let checked = 0;
    for (const v of fv) {
      if (fade[v] > 0) continue;
      checked++;
      for (let e = 0; e < 2; e++)
        expect(sw[v * 2 + e]).toBeCloseTo(match.tileAt[e] + (uv[v * 2 + e] - match.at[e]) / match.size[e], 4);
    }
    expect(checked).toBeGreaterThan(50);
    // ハンガーにかけた写真（胴の範囲が服の幅いっぱい）の長袖は、写真の左右のはし（垂れた袖）も見本にする
    const meanFade = (g: THREE.BufferGeometry) => {
      const f = g.getAttribute("photoFade").array as Float32Array;
      const vs = inGroup(g.groups[0]);
      let t = 0;
      for (const v of vs) t += f[v];
      return t / vs.size;
    };
    expect(meanFade(top([0.02, 0.98], "long"))).toBeGreaterThan(meanFade(top([0.02, 0.98], "short")) + 0.05);
    // 上下2枚に分かれる服は、背中の見本の当て方が上下で同じ（模様が腰でずれない）
    const dress = garmentPieces(h, fit, { kind: "dress", sleeve: "long", length: "knee" }, { bodyU: [0.2, 0.8], swatchMatch: match })
      .filter((p) => p.body === "whole")
      .map((p) => p.geometry.userData.swatchPlane);
    expect(dress.length).toBe(2);
    expect(dress[0]).toBeDefined();
    expect(dress[1]).toEqual(dress[0]);
  }, 60000);

  it("ベストは袖がない", async () => {
    const h = await load();
    const profile = { heightCm: 172, weightKg: 65, fit: "mens" as const };
    const fit = fitHuman(h, defaultScan(profile), profile, { warp: false });
    const m = fit.marks;
    // 袖（材質 2）の頂点のいちばん下：ベストは袖ぐりまで、長袖は手首まで
    const sleeveBottom = (sleeve: "none" | "long") => {
      const geo = garmentPieces(h, fit, { kind: "outer", length: "short", puffy: true, sleeve })[0].geometry;
      const pos = geo.getAttribute("position").array as Float32Array;
      const idx = geo.getIndex()!.array;
      const g = geo.groups[2];
      let lo = Infinity;
      for (let k = g.start; k < g.start + g.count; k++) lo = Math.min(lo, pos[idx[k] * 3 + 1]);
      return lo;
    };
    expect(sleeveBottom("none")).toBeGreaterThan(m.chestY - 0.05);
    expect(sleeveBottom("long")).toBeLessThan(m.chestY - 0.2);
  }, 60000);

  it("えりの形ごとに、首のまわりを囲むえりができる", async () => {
    const h = await load();
    const profile = { heightCm: 172, weightKg: 65, fit: "mens" as const };
    const fit = fitHuman(h, defaultScan(profile), profile, { warp: false });
    const m = fit.marks;
    const necks = ["crew", "v", "plain", "collar", "stand", "hood"] as const;
    const height: Record<string, number> = {};
    for (const neck of necks) {
      const pieces = garmentPieces(h, fit, { kind: "top", sleeve: "short", hem: "normal", neck });
      expect(pieces.length, neck).toBe(2);
      const body = pieces[0].geometry.getAttribute("position").array as Float32Array;
      const pos = pieces[1].geometry.getAttribute("position").array as Float32Array;
      expect(finite(pos), neck).toBe(true);
      // 首のまわりを1周する（向きの 12 区切りのどれにも点がある）
      const seen = new Set<number>();
      let top = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        const a = Math.atan2(pos[i], pos[i + 2] - m.neckCz);
        seen.add(Math.floor(((a + Math.PI) / (2 * Math.PI)) * 12) % 12);
        top = Math.max(top, pos[i + 1]);
        expect(pos[i + 1], neck).toBeGreaterThan(m.chestY - 0.12);
      }
      expect(seen.size, neck).toBe(12);
      let clothTop = -Infinity;
      for (let i = 1; i < body.length; i += 3) clothTop = Math.max(clothTop, body[i]);
      height[neck] = top - clothTop;
    }
    // リブやふちの折り返しは低く、シャツのえり・立ちえり・フードは首に沿って立つ
    expect(height.crew).toBeLessThan(0.006);
    expect(height.plain).toBeLessThan(0.004);
    expect(height.collar).toBeGreaterThan(0.01);
    expect(height.stand).toBeGreaterThan(0.015);
    expect(height.hood).toBeGreaterThan(0.015);
  }, 60000);
});
