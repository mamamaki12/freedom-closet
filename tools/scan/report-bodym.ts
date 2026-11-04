// 開発用：eval-bodym.mjs の結果（JSON）と、BodyM の巻き尺の実測値を比べて誤差を出す。
//   npx tsx tools/scan/report-bodym.ts 結果.json [--front-only] [--levels]
// --front-only：横の写真を使わず、正面だけで厚みを見積もったときの誤差
// --levels：胴・脚の段ごとの誤差（どの段が胸・ウエスト・ヒップに当たるかを調べる）
import { readFileSync } from "node:fs";
import { buildScan, type FrontMeasure, type measureSide } from "../../src/body/measure";
import { estimateMeasurements, type Measurements } from "../../src/body/measurements";
import type { BodyScan } from "../../src/body/types";

interface Row {
  photo: string;
  gender: string;
  height: number;
  weight: number;
  truth: Record<string, string>;
  front?: FrontMeasure;
  side?: ReturnType<typeof measureSide>;
  scan?: BodyScan;
  maskIoU?: { front: number; side?: number };
  error?: string;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("使い方: npx tsx tools/scan/report-bodym.ts 結果.json [--front-only] [--levels]");
  process.exit(2);
}
const frontOnly = args.includes("--front-only");
const rows = Object.values(JSON.parse(readFileSync(file, "utf8")) as Record<string, Row>);
const ok = rows.filter((r) => r.scan && r.front);
console.log(`${rows.length} 人中 ${ok.length} 人を読み取れた（失敗 ${rows.length - ok.length}）${frontOnly ? "／正面だけで見積もり" : ""}`);
for (const r of rows.filter((r) => r.error)) console.log(`  失敗 ${r.photo}: ${r.error}`);

/** 実測の項目 → こちらの見積もりの項目 */
const PAIRS: [string, keyof Measurements][] = [
  ["chest", "chest"],
  ["waist", "waist"],
  ["hip", "hip"],
  ["thigh", "thigh"],
  ["calf", "calf"],
  ["bicep", "bicep"],
  ["wrist", "wrist"],
  ["shoulder-breadth", "shoulder"],
  ["shoulder-to-crotch", "shoulderToCrotch"],
  ["leg-length", "legLength"],
  ["arm-length", "armLength"],
];

const stats = (errs: number[]) => {
  const n = errs.length;
  const mean = errs.reduce((s, e) => s + e, 0) / n;
  const mae = errs.reduce((s, e) => s + Math.abs(e), 0) / n;
  const sorted = [...errs].sort((a, b) => a - b);
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))];
  return { mean, mae, p90 };
};

const scans = ok.map((r) => ({ r, scan: frontOnly ? buildScan(r.front!, undefined, 1) : r.scan! }));
console.log("\n項目               平均のずれ   平均の誤差  誤差の90%点  （cm、実測との差。ずれ＋は太め・長め）");
const summary: Record<string, number> = {};
for (const [truthKey, ourKey] of PAIRS) {
  const errs: number[] = [];
  const pct: number[] = [];
  for (const { r, scan } of scans) {
    const t = Number(r.truth[truthKey]);
    if (!t) continue;
    const est = estimateMeasurements(scan, r.height)[ourKey];
    errs.push(est - t);
    pct.push(((est - t) / t) * 100);
  }
  const s = stats(errs);
  const p = stats(pct);
  summary[ourKey] = s.mae;
  console.log(`${truthKey.padEnd(18)} ${s.mean.toFixed(1).padStart(8)}cm ${s.mae.toFixed(1).padStart(8)}cm ${s.p90.toFixed(1).padStart(8)}cm   （${p.mean.toFixed(1)}% / ${p.mae.toFixed(1)}%）`);
}
if (ok.some((r) => r.maskIoU)) {
  const f = ok.map((r) => r.maskIoU!.front);
  const s = ok.map((r) => r.maskIoU!.side).filter((x): x is number => x !== undefined);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`\n切り抜きの一致（IoU）: 正面 ${avg(f).toFixed(3)}（最低 ${Math.min(...f).toFixed(3)}）横 ${avg(s).toFixed(3)}（最低 ${Math.min(...s).toFixed(3)}）`);
}

if (args.includes("--levels")) {
  // 段ごとの周囲（楕円）と実測の比
  const circ = (w: number, d: number) => {
    const a = w / 2;
    const b = d / 2;
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  };
  console.log("\n胴の段ごとの周囲 ÷ 実測（平均）：");
  const n = scans[0].scan.torso.length;
  for (const key of ["chest", "waist", "hip"]) {
    const line = Array.from({ length: n }, (_, i) => {
      const ratios = scans.map(({ r, scan }) => (circ(scan.torso[i].width, scan.torso[i].depth) * r.height) / Number(r.truth[key]));
      return (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2);
    });
    console.log(`  ${key.padEnd(6)} ${line.join(" ")}`);
  }
  console.log("脚の段ごとの周囲 ÷ 実測（平均）：");
  const m = scans[0].scan.legs.length;
  for (const key of ["thigh", "calf", "ankle"]) {
    const line = Array.from({ length: m }, (_, i) => {
      const ratios = scans.map(({ r, scan }) => (circ(scan.legs[i].width, scan.legs[i].depth) * r.height) / Number(r.truth[key]));
      return (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2);
    });
    console.log(`  ${key.padEnd(6)} ${line.join(" ")}`);
  }
  console.log("高さの割合（平均）：");
  const avg = (f: (s: BodyScan, r: Row) => number) => (scans.reduce((a, { r, scan }) => a + f(scan, r), 0) / scans.length).toFixed(3);
  console.log(`  肩 ${avg((s) => s.shoulder.y)}  股 ${avg((s) => s.crotchY)}  足首 ${avg((s) => s.ankleY)}  胴の最上段 ${avg((s) => s.torso[0].y)}`);
  console.log(`  実測 shoulder-to-crotch/身長 ${avg((_, r) => Number(r.truth["shoulder-to-crotch"]) / r.height)}  leg-length/身長 ${avg((_, r) => Number(r.truth["leg-length"]) / r.height)}  arm-length/身長 ${avg((_, r) => Number(r.truth["arm-length"]) / r.height)}  shoulder-breadth/身長 ${avg((_, r) => Number(r.truth["shoulder-breadth"]) / r.height)}`);
  console.log(`  こちら 肩→股 ${avg((s) => s.crotchY - s.shoulder.y)}  股→床 ${avg((s) => 1 - s.crotchY)}  腕 ${avg((s) => s.arm.length)}  肩幅 ${avg((s) => s.shoulder.width)}`);
}
