// run.ts の出力を採点する：写真から出す胸囲などの目安（src/body/sizes.ts）と、実測値（BodyM）とのずれ。
// 比べるもの：
//   - 目安（体重あり／なし）
//   - 3Dの体型（calibrateScan の前と後）：胴・脚の輪切りのだ円の周を、測った高さで取り出したもの
//   - 「前のやり方」の3Dの体型（--before に、前のコードで run.ts を走らせた JSONL を渡したとき）
// 使い方: npx tsx tools/body-eval/score.ts <run.jsonl> [--before old.jsonl]
import { readFileSync } from "node:fs";
import { defaultScan } from "../../src/body/measure";
import { calibrateScan, ellipse, estimateSizes, SIZE_KEYS, type SizeKey } from "../../src/body/sizes";
import type { BodyScan } from "../../src/body/types";
import type { Profile } from "../../src/domain/profile";

interface Row {
  subject: string;
  profile: Profile;
  gt: Record<string, number>;
  scan?: BodyScan;
}
const GT: Record<SizeKey, string> = { chest: "chest", waist: "waist", hip: "hip", thigh: "thigh", calf: "calf", shoulder: "shoulder-breadth" };

const args = process.argv.slice(2);
const load = (p: string): Row[] => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rows = load(args[0]);
const beforeIdx = args.indexOf("--before");
const before = beforeIdx >= 0 ? new Map(load(args[beforeIdx + 1]).map((r) => [r.subject, r])) : undefined;

function stats(pairs: [number, number][]) {
  const n = pairs.length;
  const mae = pairs.reduce((s, [p, g]) => s + Math.abs(p - g), 0) / n;
  const bias = (pairs.reduce((s, [p, g]) => s + (p - g) / g, 0) / n) * 100;
  const mp = pairs.reduce((s, [p]) => s + p, 0) / n;
  const mg = pairs.reduce((s, [, g]) => s + g, 0) / n;
  const cov = pairs.reduce((s, [p, g]) => s + (p - mp) * (g - mg), 0);
  const vp = pairs.reduce((s, [p]) => s + (p - mp) ** 2, 0);
  const vg = pairs.reduce((s, [, g]) => s + (g - mg) ** 2, 0);
  return { n, mae, bias, r: cov / Math.sqrt(vp * vg) };
}
const fmt = (s: ReturnType<typeof stats>) => `${s.mae.toFixed(1).padStart(5)}cm (${s.bias >= 0 ? "+" : ""}${s.bias.toFixed(1)}%, r=${s.r.toFixed(2)})`;

/** 3Dの体型の「周」：輪切りのだ円を、その高さで取り出す（体型の太さがどれだけ合っているかの目安） */
function bodyGirths(scan: BodyScan, h: number): Partial<Record<SizeKey, number>> {
  const at = (y: number) => {
    const t = scan.torso;
    if (y <= t[0].y) return ellipse(t[0].width, t[0].depth);
    for (let i = 1; i < t.length; i++) {
      if (y <= t[i].y) {
        const k = (y - t[i - 1].y) / (t[i].y - t[i - 1].y);
        return ellipse(t[i - 1].width + (t[i].width - t[i - 1].width) * k, t[i - 1].depth + (t[i].depth - t[i - 1].depth) * k);
      }
    }
    const l = t[t.length - 1];
    return ellipse(l.width, l.depth);
  };
  const m = scan.marks;
  const T = scan.torso.map((t) => ellipse(t.width, t.depth));
  const L = scan.legs.map((l) => ellipse(l.width, l.depth));
  return {
    // 写真で測った値がない（前のやり方）ときは、上の4段の最大・真ん中の最小・下の最大
    chest: (m ? at(m.chest.y) : Math.max(...T.slice(0, 4))) * h,
    waist: (m ? at(m.waist.y) : Math.min(...T.slice(2, 8))) * h,
    hip: (m ? at(m.hip.y) : Math.max(...T.slice(5))) * h,
    thigh: L[1] * h,
    calf: Math.max(...L.slice(3, 7)) * h,
    shoulder: scan.shoulder.width * h,
  };
}

const table: string[][] = [["", ...SIZE_KEYS]];
function addRow(label: string, pick: (r: Row) => Partial<Record<SizeKey, number>> | undefined, src = rows) {
  const out = [label];
  for (const key of SIZE_KEYS) {
    const pairs: [number, number][] = [];
    for (const r of src) {
      const v = pick(r)?.[key];
      if (v !== undefined && Number.isFinite(v)) pairs.push([v, r.gt[GT[key]]]);
    }
    out.push(pairs.length ? fmt(stats(pairs)) : "-");
  }
  table.push(out);
}
const ok = rows.filter((r) => r.scan);
const sizes = (r: Row, p: Profile) => Object.fromEntries((estimateSizes(r.scan!, p) ?? []).map((e) => [e.key, e.cm]));
addRow("目安（写真＋身長・体重）", (r) => sizes(r, r.profile), ok);
addRow("目安（写真＋身長だけ）", (r) => sizes(r, { ...r.profile, weightKg: undefined }), ok);
addRow("3Dの体型（合わせる前）", (r) => bodyGirths(r.scan!, r.profile.heightCm!), ok);
addRow("3Dの体型（合わせた後）", (r) => bodyGirths(calibrateScan(r.scan!, r.profile), r.profile.heightCm!), ok);
addRow("標準体型（身長・体重だけ）", (r) => bodyGirths(defaultScan(r.profile), r.profile.heightCm!), ok);
if (before) {
  const old = ok.map((r) => before.get(r.subject)).filter((r): r is Row => !!r?.scan);
  addRow("前のやり方の3Dの体型", (r) => bodyGirths(r.scan!, r.profile.heightCm!), old);
}
console.log(`${args[0].split("/").pop()}: ${ok.length}/${rows.length}人（平均のずれ、かたより、相関）`);
for (const row of table) console.log(row.map((c, i) => (i === 0 ? c.padEnd(18, "　") : c.padStart(26))).join(""));
