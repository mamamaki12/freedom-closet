// 開発用：Amazon の体型データ BodyM（実在の人の正面・横のシルエットと、巻き尺の実測値）で、
// 体の写真の読み取り（src/body）の誤差を測る。
//
//   データ（S3 から直接取れる。testA 87人・testB 400人）：
//     https://amazon-bodym.s3.amazonaws.com/{testA,testB}/{hwg_metadata,measurements,subject_to_photo_map}.csv
//     https://amazon-bodym.s3.amazonaws.com/{testA,testB}/{mask,mask_left}/<photo_id>.png
//   使い方：
//     npx vite --port 5198 &
//     node tools/scan/eval-bodym.mjs <データのフォルダー> [--out 結果.json] [--limit N] [--gt-mask] [--port 5198] [--jobs 2]
//   Playwright（headless Chromium）が必要。結果の JSON は 1人ずつ追記するので、途中で止めても続きから再開できる。
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("使い方: node tools/scan/eval-bodym.mjs <BodyM のフォルダー> [--out 結果.json] [--limit N] [--gt-mask] [--port 5198] [--jobs 2]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const out = opt("out", join(dir, "results.json"));
const limit = Number(opt("limit", 0)) || Infinity;
const port = opt("port", "5198");
const jobs = Number(opt("jobs", 2));
const gtMask = flag("gt-mask");

const csv = (name) => {
  const [head, ...rows] = readFileSync(join(dir, name), "utf8").trim().split(/\r?\n/);
  const keys = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v])));
};
const meta = csv("hwg_metadata.csv");
const measurements = Object.fromEntries(csv("measurements.csv").map((m) => [m.subject_id, m]));
const photos = {};
for (const { subject_id, photo_id } of csv("subject_to_photo_map.csv")) (photos[subject_id] ??= []).push(photo_id);

const results = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

const subjects = meta
  .filter((m) => measurements[m.subject_id] && (photos[m.subject_id] ?? []).length)
  .slice(0, limit)
  .filter((m) => !results[m.subject_id]);
console.log(`${subjects.length} 人を読み取ります（済み ${Object.keys(results).length} 人）`);

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
async function worker(list) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page:", e.message));
  await page.goto(`http://localhost:${port}/tools/scan/eval.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  for (const m of list) {
    const id = m.subject_id;
    // 正面と横の両方があるいちばん最初の写真
    const pid = photos[id].find((p) => existsSync(join(dir, "mask", `${p}.png`)) && existsSync(join(dir, "mask_left", `${p}.png`)));
    if (!pid) continue;
    const t0 = Date.now();
    try {
      const r = await page.evaluate(
        (req) => window.scanPair(req),
        { front: dataUrl(join(dir, "mask", `${pid}.png`)), side: dataUrl(join(dir, "mask_left", `${pid}.png`)), recolor: { fg: [70, 55, 50], bg: [235, 235, 235] }, useImageAsMask: gtMask },
      );
      results[id] = { photo: pid, gender: m.gender, height: Number(m.height_cm), weight: Number(m.weight_kg), truth: measurements[id], ...r };
      console.log(`${id.slice(0, 8)} ${m.gender} ${m.height_cm}cm ${m.weight_kg}kg  IoU 正面 ${r.maskIoU?.front?.toFixed(3)} 横 ${r.maskIoU?.side?.toFixed(3)}  ${Date.now() - t0}ms`);
    } catch (e) {
      results[id] = { photo: pid, gender: m.gender, height: Number(m.height_cm), weight: Number(m.weight_kg), truth: measurements[id], error: String(e.message ?? e) };
      console.log(`${id.slice(0, 8)} 失敗: ${String(e.message ?? e).split("\n")[0]}`);
    }
    writeFileSync(out, JSON.stringify(results));
  }
  await page.close();
}
const lists = Array.from({ length: jobs }, (_, j) => subjects.filter((_, i) => i % jobs === j));
await Promise.all(lists.map(worker));
await browser.close();
console.log(`書き出しました: ${out}`);
