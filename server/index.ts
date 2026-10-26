// Claude API の中継サーバー。アプリ（ブラウザ）からの依頼を受けて Claude を呼ぶ。
// 起動：ANTHROPIC_API_KEY=... npm run dev:server
import Anthropic from "@anthropic-ai/sdk";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { z } from "zod";
import { analyzeRequestSchema, lookPhotosRequestSchema, outfitsRequestSchema, purchasesRequestSchema } from "../src/ai/schemas";
import { analyzeGarment, ClaudeRefusalError, suggestOutfits, suggestPurchases } from "./claude";
import { PhotosNotConfiguredError, PhotosUpstreamError, searchLookPhotos } from "./photos";

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const MAX_BODY = 10 * 1024 * 1024;

const routes: Record<string, { schema: z.ZodType; handle: (input: never) => Promise<unknown> }> = {
  "/api/ai/analyze": { schema: analyzeRequestSchema, handle: analyzeGarment },
  "/api/ai/outfits": { schema: outfitsRequestSchema, handle: suggestOutfits },
  "/api/ai/purchases": { schema: purchasesRequestSchema, handle: suggestPurchases },
  "/api/looks/photos": { schema: lookPhotosRequestSchema, handle: (input) => searchLookPhotos(input) },
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new RangeError("too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  if (ALLOWED_ORIGIN) {
    res.setHeader("access-control-allow-origin", ALLOWED_ORIGIN);
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.setHeader("vary", "origin");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method === "GET" && req.url === "/api/health") return send(res, 200, { ok: true });

  const route = req.url ? routes[req.url] : undefined;
  if (!route || req.method !== "POST") return send(res, 404, { error: "見つかりません" });

  let input: unknown;
  try {
    input = route.schema.parse(await readJson(req));
  } catch (e) {
    return send(res, e instanceof RangeError ? 413 : 400, { error: "送られたデータの形が正しくありません" });
  }

  try {
    send(res, 200, await route.handle(input as never));
  } catch (e) {
    if (e instanceof ClaudeRefusalError) return send(res, 422, { error: e.message });
    if (e instanceof PhotosNotConfiguredError) return send(res, 503, { error: "写真検索は使えるように設定されていません" });
    if (e instanceof PhotosUpstreamError) {
      console.error(e.message);
      return send(res, 502, { error: "写真サイトに接続できませんでした" });
    }
    if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: "混み合っています。少し待ってからもう一度試してください" });
    if (e instanceof Anthropic.AuthenticationError) {
      console.error("ANTHROPIC_API_KEY を確認してください");
      return send(res, 500, { error: "サーバーの設定に問題があります" });
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`Claude API error ${e.status}:`, e.message);
      return send(res, 502, { error: "Claudeに接続できませんでした" });
    }
    console.error(e);
    send(res, 500, { error: "サーバーでエラーが起きました" });
  }
});

server.listen(PORT, () => {
  console.log(`Claude中継サーバー: http://localhost:${PORT}（モデル: ${process.env.CLAUDE_MODEL || "claude-opus-5-5"}）`);
});
