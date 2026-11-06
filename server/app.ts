// 中継サーバーのリクエストの受け方（どの道で、どう確かめて、どう答えるか）。起動は index.ts、守りの部品は guard.ts。
import Anthropic from "@anthropic-ai/sdk";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { z } from "zod";
import { ClaudeRefusalError } from "./claude";
import {
  accessCodeMatches,
  clientKey,
  DailyLimit,
  isAllowedOrigin,
  isJsonContentType,
  RateLimiter,
  WINDOW_MS,
  type RelayConfig,
} from "./guard";
import { PhotosNotConfiguredError, PhotosUpstreamError } from "./photos";

export interface Route {
  schema: z.ZodType;
  handle: (input: never) => Promise<unknown>;
  /** 受け取るデータの大きさの上限（バイト） */
  maxBody: number;
  /** Claude を呼ぶ道か（1日の上限に数える） */
  claude: boolean;
}

/** 合言葉を送るヘッダー。日本語の合言葉も送れるよう、アプリは encodeURIComponent してから入れる */
export const ACCESS_CODE_HEADER = "x-access-code";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, maxBody: number): Promise<unknown> {
  if (Number(req.headers["content-length"]) > maxBody) throw new RangeError("too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBody) throw new RangeError("too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createRelay(config: RelayConfig, routes: Record<string, Route>, log: (message: string) => void = console.warn): Server {
  const perIp = new RateLimiter(config.perIpPer10Min, WINDOW_MS);
  const claudeToday = new DailyLimit(config.claudePerDay);
  // 合言葉は encodeURIComponent したものどうしで比べる（アプリが送る形にそろえる）
  const expectedCode = config.accessCode ? encodeURIComponent(config.accessCode) : "";

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const originOk = isAllowedOrigin(origin, config.allowedOrigins);
    res.setHeader("vary", "origin");
    if (origin && originOk) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-headers", `content-type, ${ACCESS_CODE_HEADER}`);
      res.setHeader("access-control-allow-methods", "POST, OPTIONS");
      res.setHeader("access-control-max-age", "600");
    }
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "OPTIONS") return res.writeHead(originOk ? 204 : 403).end();
    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true });

    const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
    if (!route || req.method !== "POST") return send(res, 404, { error: "見つかりません" });

    // ほかのサイトを開いた人のブラウザから、気づかれないうちに呼ばれるのを防ぐ
    if (!originOk) {
      log(`受け付けていないオリジンからのリクエストを断りました: ${origin}（このアプリのURLなら ALLOWED_ORIGIN に入れてください）`);
      return send(res, 403, { error: "このアプリ以外からは使えません" });
    }
    if (!isJsonContentType(req.headers["content-type"])) {
      return send(res, 415, { error: "送られたデータの形が正しくありません" });
    }
    // 合言葉の総当たりも回数制限にかかるよう、先に数える
    const limited = perIp.take(clientKey(req.headers, req.socket.remoteAddress, config.trustProxy));
    if (!limited.ok) {
      res.setHeader("retry-after", String(limited.retryAfterSec));
      return send(res, 429, { error: "短い時間に何度も使われたので、少し休んでいます。しばらく待ってからもう一度試してください" });
    }
    const givenCode = req.headers[ACCESS_CODE_HEADER];
    if (!accessCodeMatches(givenCode, expectedCode)) {
      return send(res, 401, {
        error: givenCode
          ? "中継サーバーの合言葉が違います。設定の「合言葉」を確かめてください"
          : "中継サーバーの合言葉が必要です。設定の「Claude API」の下に入れてください",
      });
    }

    let input: unknown;
    try {
      input = route.schema.parse(await readJson(req, route.maxBody));
    } catch (e) {
      return send(res, e instanceof RangeError ? 413 : 400, { error: "送られたデータの形が正しくありません" });
    }
    if (route.claude && !claudeToday.take()) {
      log("Claude の1日の上限（CLAUDE_DAILY_LIMIT）に達したので、今日はもう Claude を呼びません");
      return send(res, 429, { error: "今日のClaudeの利用回数の上限に達しました。明日まで端末内AIを使ってください" });
    }

    try {
      send(res, 200, await route.handle(input as never));
    } catch (e) {
      if (e instanceof ClaudeRefusalError) return send(res, 422, { error: e.message });
      if (e instanceof PhotosNotConfiguredError) return send(res, 503, { error: "写真検索は使えるように設定されていません" });
      if (e instanceof PhotosUpstreamError) {
        log(e.message);
        return send(res, 502, { error: "写真サイトに接続できませんでした" });
      }
      if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: "混み合っています。少し待ってからもう一度試してください" });
      if (e instanceof Anthropic.AuthenticationError) {
        log("ANTHROPIC_API_KEY を確認してください");
        return send(res, 500, { error: "サーバーの設定に問題があります" });
      }
      if (e instanceof Anthropic.APIError) {
        log(`Claude API error ${e.status}: ${e.message}`);
        return send(res, 502, { error: "Claudeに接続できませんでした" });
      }
      console.error(e);
      send(res, 500, { error: "サーバーでエラーが起きました" });
    }
  });
}
