// 端末内AIの種類判定を、公開データセット clothing-dataset-small（GitHub の alexeygrigorev/clothing-dataset-small）の
// 写真で採点する。アプリと同じ classifyGarment を Node で動かす（写真側のモデルは Hugging Face から取得、約88MB）。
//
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/alexeygrigorev/clothing-dataset-small /tmp/clothing
//   git -C /tmp/clothing sparse-checkout set test
//   npx tsx scripts/eval-local-ai.ts /tmp/clothing/test
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyGarment, DEFAULT_LOCAL_MODEL } from "../src/ai/local/classifier";
import type { Category } from "../src/domain/types";

const dir = process.argv[2];
if (!dir) {
  console.error("使い方: npx tsx scripts/eval-local-ai.ts <種類ごとのフォルダーがあるディレクトリ>");
  process.exit(2);
}
const modelId = process.env.VITE_LOCAL_MODEL || DEFAULT_LOCAL_MODEL;

/** データセットの種類 → アプリで正解とみなす category（hat は服ではないので「分からない」= null が正解） */
const EXPECT: Record<string, Category | null> = {
  dress: "onepiece",
  longsleeve: "tops",
  outwear: "outer",
  pants: "bottoms",
  shirt: "tops",
  shoes: "shoes",
  shorts: "bottoms",
  skirt: "bottoms",
  "t-shirt": "tops",
  hat: null,
};

let total = 0;
let correct = 0;
let elapsed = 0;
const rows: string[] = [];
for (const cls of readdirSync(dir).sort()) {
  const folder = join(dir, cls);
  if (!statSync(folder).isDirectory() || !(cls in EXPECT)) continue;
  const files = readdirSync(folder).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  let ok = 0;
  const top = new Map<string, number>();
  for (const f of files) {
    const blob = new Blob([readFileSync(join(folder, f))], { type: "image/jpeg" });
    const t0 = performance.now();
    const r = await classifyGarment(blob, modelId);
    elapsed += performance.now() - t0;
    const best = r.types[0].label;
    if (best.category === EXPECT[cls]) ok++;
    top.set(best.subType, (top.get(best.subType) ?? 0) + 1);
  }
  total += files.length;
  correct += ok;
  const common = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
  rows.push(`${cls.padEnd(11)} ${String(files.length).padStart(3)}枚  正解 ${((ok / files.length) * 100).toFixed(0).padStart(3)}%  上位: ${common}`);
}
console.log(rows.join("\n"));
console.log(`\n合計 ${total} 枚、種類（category）の正解率 ${((correct / total) * 100).toFixed(1)}%（帽子は「分からない」が正解）`);
console.log(`1枚あたり ${(elapsed / total).toFixed(0)} ms（この環境の CPU、初回のモデル読み込みは除く）`);
