// 説明文（プロンプト）を CLIP の文章側モデルで数値にして src/ai/local/textEmbeddings.json に保存する。
// 端末ではこのファイルを読むだけなので、文章側のモデルのダウンロードも、写真ごとの文章の計算もいらない。
//
//   npx tsx scripts/text-embeddings.ts          言い方（src/ai/local/classifier.ts の LABELS など）を変えたら作り直す
//   npx tsx scripts/text-embeddings.ts --check  いまのファイルがモデルの計算と合っているか確かめる（CI で実行）
//
// モデルは Hugging Face からダウンロードする（文章側 fp32 で約254MB。初回だけ）。
import { AutoTokenizer, CLIPTextModelWithProjection } from "@huggingface/transformers";
import { readFileSync, writeFileSync } from "node:fs";
import {
  DEFAULT_LOCAL_MODEL,
  decodeVectors,
  encodeVectors,
  fillTemplate,
  LOGIT_SCALE,
  normalize,
  PATTERN_TEMPLATES,
  patternPrompts,
  QUANT_SCALE,
  TYPE_TEMPLATES,
  typePrompts,
  type BankJson,
  type TextEmbeddingsJson,
} from "../src/ai/local/classifier";

const OUT = new URL("../src/ai/local/textEmbeddings.json", import.meta.url);
const modelId = process.env.VITE_LOCAL_MODEL || DEFAULT_LOCAL_MODEL;
const check = process.argv.includes("--check");

type Embeds = { dims: number[]; type: string; data: ArrayLike<number>; to(type: string): { data: ArrayLike<number> } };

console.log(`モデル ${modelId} の文章側を読み込みます…`);
const tokenizer = await AutoTokenizer.from_pretrained(modelId);
const model = await CLIPTextModelWithProjection.from_pretrained(modelId, { dtype: "fp32" });

/** ひな型ごとに正規化して平均し、もう一度正規化（classifier.ts の computeBanks と同じ） */
async function embed(prompts: string[], templates: string[]): Promise<Float32Array[]> {
  let sums: Float32Array[] | undefined;
  for (const t of templates) {
    const inputs = tokenizer(
      prompts.map((p) => fillTemplate(t, p)),
      { padding: true, truncation: true },
    );
    const { text_embeds } = (await model(inputs)) as unknown as { text_embeds: Embeds };
    const dim = text_embeds.dims[1];
    const data = (text_embeds.type === "float32" ? text_embeds : text_embeds.to("float32")).data;
    sums ??= prompts.map(() => new Float32Array(dim));
    prompts.forEach((_, i) => {
      const row = normalize(Array.from({ length: dim }, (_, j) => data[i * dim + j]));
      for (let j = 0; j < dim; j++) sums![i][j] += row[j];
    });
  }
  return (sums ?? []).map(normalize);
}

const types = await embed(typePrompts(), TYPE_TEMPLATES);
const patterns = await embed(patternPrompts(), PATTERN_TEMPLATES);
const dim = types[0].length;
const bank = (prompts: string[], templates: string[], vectors: Float32Array[]): BankJson => ({ templates, prompts, data: encodeVectors(vectors, QUANT_SCALE) });
const fresh: TextEmbeddingsJson = {
  model: modelId,
  dim,
  scale: QUANT_SCALE,
  logitScale: LOGIT_SCALE,
  types: bank(typePrompts(), TYPE_TEMPLATES, types),
  patterns: bank(patternPrompts(), PATTERN_TEMPLATES, patterns),
};

if (!check) {
  writeFileSync(OUT, JSON.stringify(fresh, null, 1) + "\n");
  console.log(`書き出しました: ${OUT.pathname}（種類 ${types.length} 文、柄 ${patterns.length} 文、${dim} 次元）`);
} else {
  const current = JSON.parse(readFileSync(OUT, "utf8")) as TextEmbeddingsJson;
  let ok = true;
  for (const key of ["types", "patterns"] as const) {
    const a = current[key];
    const b = fresh[key];
    if (current.model !== fresh.model || JSON.stringify(a.prompts) !== JSON.stringify(b.prompts) || JSON.stringify(a.templates) !== JSON.stringify(b.templates)) {
      console.error(`${key}: 言い方・ひな型・モデルが textEmbeddings.json と違います。npx tsx scripts/text-embeddings.ts で作り直してください`);
      ok = false;
      continue;
    }
    const va = decodeVectors(a.data, current.dim, current.scale);
    const vb = decodeVectors(b.data, fresh.dim, fresh.scale);
    const cos = va.map((u, i) => u.reduce((s, x, j) => s + x * vb[i][j], 0));
    const min = Math.min(...cos);
    const worst = cos.indexOf(min);
    console.log(`${key}: ${va.length} 文、コサイン類似度 最小 ${min.toFixed(5)}（${a.prompts[worst]}）平均 ${(cos.reduce((s, c) => s + c, 0) / cos.length).toFixed(5)}`);
    if (min < 0.995) {
      console.error(`${key}: 同梱の数値がモデルの計算と合いません`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log("OK: 同梱の説明文の数値はモデルの計算と一致しています");
}
