// Claude API を呼ぶ部分。ブラウザからは直接呼ばず、この中継サーバーだけがAPIキーを持つ。
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import {
  analyzeResultSchema,
  outfitsResultSchema,
  purchasesResultSchema,
  type analyzeRequestSchema,
  type AnalyzeResult,
  type outfitsRequestSchema,
  type OutfitsResult,
  type profileSchema,
  type purchasesRequestSchema,
  type PurchasesResult,
} from "../src/ai/schemas";
import { FIT_LABELS } from "../src/domain/profile";
import { CATEGORY_LABELS, COLOR_NAMES, PURPOSE_LABELS } from "../src/domain/types";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// ANTHROPIC_API_KEY を環境変数から読む
const client = new Anthropic();

export class ClaudeRefusalError extends Error {}

const SYSTEM = `あなたは服のコーディネートを手伝うアシスタントです。
利用者は自分のクローゼットを登録しており、手持ちの服で毎日のコーデを決めたいと思っています。
- 説明は日本語で、専門用語を避け、1文を短くしてください。
- 服の色名は次の英語IDから選びます：${COLOR_NAMES.join(", ")}
- 服の種類（category）：${Object.entries(CATEGORY_LABELS)
  .map(([k, v]) => `${k}=${v}`)
  .join(", ")}`;

async function ask<T>(
  schema: z.ZodType<T>,
  content: Anthropic.Beta.BetaContentBlockParam[] | string,
  effort: "low" | "medium",
): Promise<T> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    thinking: { type: "adaptive" },
    output_config: { effort, format: betaZodOutputFormat(schema) },
    // 安全上の理由で断られたとき、サーバー側で別モデルに自動で切り替える
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal") {
    throw new ClaudeRefusalError("この内容には答えられませんでした");
  }
  if (!response.parsed_output) {
    throw new Error(`Claudeの返答を読み取れませんでした（stop_reason: ${response.stop_reason}）`);
  }
  return response.parsed_output;
}

export async function analyzeGarment(input: z.infer<typeof analyzeRequestSchema>): Promise<AnalyzeResult> {
  return ask(
    analyzeResultSchema,
    [
      { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 } },
      {
        type: "text",
        text: "この写真の服1着について、種類（category と日本語の subType）と、いちばん面積の大きい色（color）を答えてください。背景や床の色は無視してください。",
      },
    ],
    "low",
  );
}

/** 身長・体重・いつものサイズを、提案に使える1段落にする（設定していなければ空） */
function profileText(profile: z.infer<typeof profileSchema>): string {
  if (!profile) return "";
  const parts = [
    profile.heightCm && `身長${profile.heightCm}cm`,
    profile.weightKg && `体重${profile.weightKg}kg`,
    profile.fit && `サイズは${FIT_LABELS[profile.fit]}で見る`,
    profile.usualSize?.tops && `トップスはいつも${profile.usualSize.tops}`,
    profile.usualSize?.bottoms && `ボトムスはいつも${profile.usualSize.bottoms}`,
    profile.usualSize?.shoes && `靴は${profile.usualSize.shoes}`,
  ].filter(Boolean);
  return parts.length ? `\n本人について：${parts.join("、")}。服の size は登録したサイズ（いつものサイズとの違いは着こなしのヒントにする）。体型について否定的なことは書かない。\n` : "";
}

export async function suggestOutfits(input: z.infer<typeof outfitsRequestSchema>): Promise<OutfitsResult> {
  const { closet, request, feedback } = input;
  const text = `手持ちの服（JSON）：
${JSON.stringify(closet)}
${profileText(input.profile)}
条件：
- 必ず使う服のID：${request.mustInclude.length ? request.mustInclude.join(", ") : "なし"}
- 気温：${request.temperatureC ?? "指定なし"}℃
- 目的：${PURPOSE_LABELS[request.purpose]}
- 好み：${request.preference ?? "指定なし"}
- もう見せた組み合わせ（服IDを+でつないだもの。これとは違う案にする）：${request.exclude?.length ? request.exclude.join(" / ") : "なし"}

これまでの評価（liked=true が好き、false が好みじゃない）：
${JSON.stringify(feedback.map((f) => ({ garmentIds: f.garmentIds, liked: f.liked })))}

コーデを3案出してください。
- 手持ちの服のIDだけを使い、同じ種類（category）を1案に2着入れない。
- トップス＋ボトムス、またはワンピースを基本に、気温に応じてアウター、あれば靴を足す。
- 「好みじゃない」と評価された組み合わせは出さず、「好き」の傾向を活かす。
- 3案はなるべく違う服を使う。
- explanation には、色合わせの理由と、袖・裾の扱いなど着こなしのコツを2〜4文で。`;
  return ask(outfitsResultSchema, text, "medium");
}

export async function suggestPurchases(input: z.infer<typeof purchasesRequestSchema>): Promise<PurchasesResult> {
  const { closet, request, feedback } = input;
  const text = `手持ちの服（JSON）：
${JSON.stringify(closet)}
${profileText(input.profile)}
これまでの評価：
${JSON.stringify(feedback.map((f) => ({ garmentIds: f.garmentIds, liked: f.liked })))}

条件：
- 避けたい色：${request.avoidColors.length ? request.avoidColors.join(", ") : "なし"}
- 好み：${request.preference ?? "指定なし"}
- 予算：${request.budgetYen ? `${request.budgetYen}円くらいまで` : "指定なし"}

ユニクロかGUで買える定番の服から、買い足すと手持ちの服とのコーデが増えるものを最大5つ提案してください。
- 特定の商品名や価格は書かず、種類と色で提案する（例：黒のワイドパンツ）。
- 手持ちとほぼ同じ服は避ける。
- searchQuery はユニクロ・GUの検索窓にそのまま入れる短い日本語（例：黒 ワイドパンツ）。
- matchesWith には合わせられる手持ちの服のIDを入れ、newOutfitCount は増えるコーデのおおよその数。
- 本人の身長が分かるときは、似合いやすい丈やシルエットの服を優先し、reason でひとこと触れる。`;
  return ask(purchasesResultSchema, text, "medium");
}
