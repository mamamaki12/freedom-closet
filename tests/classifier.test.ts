import { describe, expect, it } from "vitest";
import {
  bankFromJson,
  classifyEmbedding,
  decodeVectors,
  DEFAULT_LOCAL_MODEL,
  encodeVectors,
  LABELS,
  normalize,
  PATTERN_PROMPTS,
  PATTERN_TEMPLATES,
  patternPrompts,
  scorePrompts,
  softmax,
  TYPE_TEMPLATES,
  typePrompts,
  type Banks,
  type PromptBank,
  type TextEmbeddingsJson,
} from "../src/ai/local/classifier";
import { mergeAnalysis } from "../src/ai/local/index";
import bundled from "../src/ai/local/textEmbeddings.json";

const json = bundled as TextEmbeddingsJson;

describe("同梱の説明文の数値（textEmbeddings.json）", () => {
  it("いまの言い方・ひな型・モデルと一致している（違っていたら npm run ai:embeddings で作り直す）", () => {
    const types = bankFromJson(json, "types", typePrompts(), TYPE_TEMPLATES, DEFAULT_LOCAL_MODEL);
    const patterns = bankFromJson(json, "patterns", patternPrompts(), PATTERN_TEMPLATES, DEFAULT_LOCAL_MODEL);
    expect(types).not.toBeNull();
    expect(patterns).not.toBeNull();
    expect(types!.vectors).toHaveLength(typePrompts().length);
    expect(patterns!.vectors).toHaveLength(patternPrompts().length);
    expect(json.dim).toBe(512);
  });
  it("数値は長さ1に正規化されている", () => {
    const types = bankFromJson(json, "types", typePrompts(), TYPE_TEMPLATES, DEFAULT_LOCAL_MODEL)!;
    for (const v of types.vectors) expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 3);
  });
  it("言い方が変わっていたら使わない（端末で計算し直す）", () => {
    expect(bankFromJson(json, "types", [...typePrompts(), "a kimono"], TYPE_TEMPLATES, DEFAULT_LOCAL_MODEL)).toBeNull();
    expect(bankFromJson(json, "types", typePrompts(), ["a photo of {}"], DEFAULT_LOCAL_MODEL)).toBeNull();
    expect(bankFromJson(json, "types", typePrompts(), TYPE_TEMPLATES, "Xenova/clip-vit-base-patch16")).toBeNull();
  });
});

describe("encodeVectors / decodeVectors", () => {
  it("int16 に量子化しても誤差は 1/32767 以内", () => {
    const vectors = [normalize([0.3, -0.4, 0.5, 0.1]), normalize([1, 0, 0, 0])];
    const back = decodeVectors(encodeVectors(vectors), 4);
    expect(back).toHaveLength(2);
    vectors.forEach((v, i) => v.forEach((x, j) => expect(Math.abs(back[i][j] - x)).toBeLessThan(1 / 32767)));
  });
});

/** テスト用の小さな説明文の数値。各言い方を別々の方向のベクトルにする */
function fakeBank(prompts: string[], dim: number): PromptBank {
  const vectors = prompts.map((_, i) => {
    const v = new Float32Array(dim);
    v[i % dim] = 1;
    return v;
  });
  return { prompts, templates: ["{}"], vectors };
}

describe("scorePrompts / classifyEmbedding", () => {
  it("softmax は合計1で、大きい値ほど高い", () => {
    const p = softmax([1, 2, 3]);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1);
    expect(p[2]).toBeGreaterThan(p[1]);
  });
  it("写真の数値に一番近い言い方が一番高い点数になる", () => {
    const bank = fakeBank(["a", "b", "c"], 3);
    const r = scorePrompts(normalize([0.9, 0.1, 0]), bank);
    expect(r[0].label).toBe("a");
    expect(r[0].score).toBeGreaterThan(r[1].score);
    expect(r.reduce((s, x) => s + x.score, 0)).toBeCloseTo(1);
  });
  it("種類と柄の両方を、同じ写真の数値から出す", () => {
    const dim = Math.max(typePrompts().length, patternPrompts().length);
    const banks: Banks = { types: fakeBank(typePrompts(), dim), patterns: fakeBank(patternPrompts(), dim) };
    // "jeans" の方向に強く寄せる
    const image = new Float32Array(dim);
    image[typePrompts().indexOf("jeans")] = 1;
    const r = classifyEmbedding(normalize(image), banks);
    expect(r.types[0].label.subType).toBe("デニム");
    expect(r.types).toHaveLength(LABELS.length);
    expect(r.patterns).toHaveLength(PATTERN_PROMPTS.length);
  });
});

describe("mergeAnalysis：服でないもの", () => {
  const palette = { colors: [{ name: "black" as const, hex: "#111111", rgb: [17, 17, 17] as [number, number, number], lab: [5, 0, 0], share: 1 }], multiColor: false };
  it("1位が「服ではないもの」なら、種類は分からないとして色だけ返す", () => {
    const other = LABELS.find((l) => l.category === null)!;
    const knit = LABELS.find((l) => l.subType === "ニット")!;
    const r = mergeAnalysis(
      { types: [{ label: other, score: 0.6 }, { label: knit, score: 0.3 }], patterns: [{ pattern: "solid", score: 0.9 }] },
      palette,
    );
    expect(r.category).toBeNull();
    expect(r.subType).toBeNull();
    expect(r.color).toBe("black");
    expect(r.confidence).toBe(0);
    expect(r.warning).toContain("服ではないもの");
    // 候補には服の種類だけを入れる
    expect(r.candidates.map((c) => c.subType)).toEqual(["ニット"]);
  });
  it("服が1位なら、これまでどおり種類を返す", () => {
    const other = LABELS.find((l) => l.category === null)!;
    const knit = LABELS.find((l) => l.subType === "ニット")!;
    const r = mergeAnalysis(
      { types: [{ label: knit, score: 0.7 }, { label: other, score: 0.2 }], patterns: [{ pattern: "solid", score: 0.9 }] },
      palette,
    );
    expect(r.category).toBe("tops");
    expect(r.subType).toBe("ニット");
    expect(r.confidence).toBeCloseTo(0.7);
  });
});
