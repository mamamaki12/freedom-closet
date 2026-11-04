// 開発用：CCP の実写真と、その正解の切り抜きから作ったシルエットを、それぞれ読み取りに通して
// 骨格の点と切り抜きを保存する（tools/scan/eval.html の detectPhoto を使う）。
//   node tools/scan/eval-ccp.mjs <CCPのphotos> <シルエットのフォルダー> <出力.jsonl> [--port 5198]
import { createRequire } from "node:module";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [photos, sils, out] = process.argv.slice(2);
const port = process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "5198";
const done = new Set(existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);
const ids = readdirSync(sils).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort().filter((id) => !done.has(id));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/tools/scan/eval.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
const url = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
for (const id of ids) {
  const row = { id };
  for (const [key, file, type] of [["photo", join(photos, `${id}.jpg`), "image/jpeg"], ["sil", join(sils, `${id}.png`), "image/png"]]) {
    try {
      const r = await page.evaluate((u) => window.detectPhoto(u), url(file, type));
      row[key] = key === "photo" ? r : { landmarks: r.landmarks };
    } catch (e) {
      row[key] = { error: String(e.message ?? e).split("\n")[0] };
    }
  }
  appendFileSync(out, JSON.stringify(row) + "\n");
  console.log(id, row.photo.error ?? "ok", row.sil.error ?? "ok");
}
await browser.close();
