// 中継サーバーの守り（server/guard.ts・server/app.ts）。Claude は呼ばず、代わりの処理で確かめる。
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRelay, type Route } from "../server/app";
import {
  accessCodeMatches,
  clientKey,
  configFromEnv,
  DailyLimit,
  isAllowedOrigin,
  isJsonContentType,
  parseOrigins,
  RateLimiter,
  type RelayConfig,
} from "../server/guard";

describe("guard", () => {
  it("ALLOWED_ORIGIN はカンマ区切りで、末尾の / は無視する", () => {
    expect(parseOrigins(" https://a.example/, https://b.example ,")).toEqual(["https://a.example", "https://b.example"]);
    expect(parseOrigins(undefined)).toEqual([]);
  });

  it("受け付けるオリジン：一覧にあるものだけ。一覧が空なら localhost だけ", () => {
    const pages = ["https://mamamaki12.github.io"];
    expect(isAllowedOrigin("https://mamamaki12.github.io", pages)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", pages)).toBe(false);
    expect(isAllowedOrigin("http://localhost:5173", pages)).toBe(false);
    expect(isAllowedOrigin("http://localhost:5173", [])).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:4173", [])).toBe(true);
    expect(isAllowedOrigin("http://[::1]:5173", [])).toBe(true);
    expect(isAllowedOrigin("https://evil.example", [])).toBe(false);
    // DNS の付け替えで localhost に向けても、オリジンはそのサイトの名前のまま
    expect(isAllowedOrigin("http://localhost.evil.example:8787", [])).toBe(false);
    expect(isAllowedOrigin("null", [])).toBe(false);
    // ブラウザ以外（curl など）は Origin を付けない。ここでは断れないので合言葉と回数で守る
    expect(isAllowedOrigin(undefined, pages)).toBe(true);
  });

  it("JSON だけを受け付ける（ほかのサイトが下準備なしで送れる形は断る）", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/plain;charset=UTF-8")).toBe(false);
    expect(isJsonContentType("application/x-www-form-urlencoded")).toBe(false);
    expect(isJsonContentType("multipart/form-data; boundary=x")).toBe(false);
    expect(isJsonContentType("application/jsonp")).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });

  it("回数を数える相手：プロキシの後ろでは右端のアドレス（左側は送る側が書き換えられる）", () => {
    expect(clientKey({}, "203.0.113.5", 0)).toBe("203.0.113.5");
    expect(clientKey({ "x-forwarded-for": "1.1.1.1" }, "10.0.0.1", 0)).toBe("10.0.0.1");
    expect(clientKey({ "x-forwarded-for": "1.1.1.1, 203.0.113.5" }, "10.0.0.1", 1)).toBe("203.0.113.5");
    expect(clientKey({ "x-forwarded-for": "203.0.113.5, 10.1.1.1" }, "10.0.0.1", 2)).toBe("203.0.113.5");
    expect(clientKey({}, "10.0.0.1", 1)).toBe("10.0.0.1");
    expect(clientKey({}, "::ffff:203.0.113.5", 0)).toBe("203.0.113.5");
    // IPv6 は /64 ごとにまとめる（1台で末尾を変え続けて制限をすり抜けられないように）
    expect(clientKey({}, "2001:db8:1:2:aaaa::1", 0)).toBe(clientKey({}, "2001:db8:1:2:bbbb:cccc:dddd:eeee", 0));
    expect(clientKey({}, "2001:db8:1:2::1", 0)).not.toBe(clientKey({}, "2001:db8:1:3::1", 0));
  });

  it("合言葉", () => {
    expect(accessCodeMatches(undefined, "")).toBe(true);
    expect(accessCodeMatches(undefined, "secret")).toBe(false);
    expect(accessCodeMatches("secreT", "secret")).toBe(false);
    expect(accessCodeMatches("secret", "secret")).toBe(true);
    expect(accessCodeMatches(["secret", "secret"], "secret")).toBe(false);
  });

  it("回数制限：枠の時間が過ぎたら戻る。覚える相手の数には上限がある", () => {
    let t = 0;
    const limiter = new RateLimiter(2, 1000, () => t, 3);
    expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterSec: 1 });
    expect(limiter.take("b").ok).toBe(true);
    t = 1000;
    expect(limiter.take("a").ok).toBe(true);
    for (const k of ["c", "d", "e", "f"]) limiter.take(k);
    expect((limiter as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(3);
    expect(new RateLimiter(0, 1000).take("x").ok).toBe(true);
  });

  it("1日の上限は日本時間の0時に戻る", () => {
    let t = Date.parse("2026-11-04T14:59:00Z"); // 日本時間 23:59
    const daily = new DailyLimit(2, () => t);
    expect(daily.take()).toBe(true);
    expect(daily.take()).toBe(true);
    expect(daily.take()).toBe(false);
    t = Date.parse("2026-11-04T15:00:00Z"); // 日本時間 翌日 0:00
    expect(daily.take()).toBe(true);
  });

  it("環境変数の初期値", () => {
    expect(configFromEnv({})).toEqual({ allowedOrigins: [], accessCode: "", trustProxy: 0, perIpPer10Min: 120, claudePerDay: 300 });
    expect(configFromEnv({ RATE_LIMIT_PER_10MIN: "abc", CLAUDE_DAILY_LIMIT: "0", TRUST_PROXY: "1", RELAY_ACCESS_CODE: " x " })).toMatchObject({
      perIpPer10Min: 120,
      claudePerDay: 0,
      trustProxy: 1,
      accessCode: "x",
    });
  });
});

// ---- サーバー全体（代わりの処理を入れて、実際に HTTP で呼ぶ）----

const base: RelayConfig = { allowedOrigins: [], accessCode: "", trustProxy: 0, perIpPer10Min: 0, claudePerDay: 0 };
let server: Server | undefined;

afterEach(async () => {
  const s = server;
  server = undefined;
  if (!s) return;
  s.closeAllConnections();
  await new Promise((r) => s.close(r));
});

async function start(config: Partial<RelayConfig> = {}) {
  const claude = vi.fn(async (input: { text: string }) => ({ echo: input.text }));
  const photos = vi.fn(async () => ({ photos: [] }));
  const routes: Record<string, Route> = {
    "/api/ai/outfits": { schema: z.object({ text: z.string().max(50) }), handle: claude as Route["handle"], maxBody: 1024, claude: true },
    "/api/looks/photos": { schema: z.object({}), handle: photos as Route["handle"], maxBody: 1024, claude: false },
  };
  server = createRelay({ ...base, ...config }, routes, () => undefined);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; json: { error?: string } & Record<string, unknown> }>(
      (resolve, reject) => {
        const req = request(
          { host: "127.0.0.1", port, path, method: init.method ?? "POST", headers: { "content-type": "application/json", ...init.headers } },
          (res) => {
            let text = "";
            res.on("data", (c) => (text += c));
            res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, json: text ? JSON.parse(text) : {} }));
          },
        );
        req.on("error", reject);
        req.end(init.body ?? JSON.stringify({ text: "hi" }));
      },
    );
  return { call, claude, photos };
}

describe("中継サーバー", () => {
  it("ふつうに呼べる", async () => {
    const { call, claude } = await start();
    const r = await call("/api/ai/outfits", { headers: { origin: "http://localhost:5173" } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ echo: "hi" });
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(claude).toHaveBeenCalledOnce();
    expect((await call("/api/health", { method: "GET" })).status).toBe(200);
  });

  it("text/plain で送られたもの（ほかのサイトが下準備なしで送れる形）は Claude を呼ばずに断る", async () => {
    const { call, claude } = await start();
    const r = await call("/api/ai/outfits", { headers: { "content-type": "text/plain;charset=UTF-8", origin: "http://localhost:5173" } });
    expect(r.status).toBe(415);
    expect(claude).not.toHaveBeenCalled();
  });

  it("ほかのサイトのページからは使えない（オリジンが違う）", async () => {
    const { call, claude } = await start({ allowedOrigins: ["https://mamamaki12.github.io"] });
    const r = await call("/api/ai/outfits", { headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await call("/api/ai/outfits", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(pre.status).toBe(403);
    expect(claude).not.toHaveBeenCalled();

    const ok = await call("/api/ai/outfits", { method: "OPTIONS", headers: { origin: "https://mamamaki12.github.io" } });
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe("https://mamamaki12.github.io");
    expect(String(ok.headers["access-control-allow-headers"])).toContain("x-access-code");
  });

  it("合言葉を決めたら、合言葉がないか違うときは断る（日本語の合言葉も使える）", async () => {
    const { call, claude } = await start({ accessCode: "ひみつの合言葉" });
    expect((await call("/api/ai/outfits")).json.error).toContain("必要");
    const wrong = await call("/api/ai/outfits", { headers: { "x-access-code": encodeURIComponent("ちがう") } });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error).toContain("違います");
    expect(claude).not.toHaveBeenCalled();
    const ok = await call("/api/ai/outfits", { headers: { "x-access-code": encodeURIComponent("ひみつの合言葉") } });
    expect(ok.status).toBe(200);
  });

  it("1つのアドレスから短い時間に何度も呼ばれたら休む（合言葉の総当たりも数える）", async () => {
    const { call, claude } = await start({ perIpPer10Min: 2, accessCode: "x" });
    expect((await call("/api/ai/outfits", { headers: { "x-access-code": "bad" } })).status).toBe(401);
    expect((await call("/api/ai/outfits", { headers: { "x-access-code": "x" } })).status).toBe(200);
    const r = await call("/api/ai/outfits", { headers: { "x-access-code": "x" } });
    expect(r.status).toBe(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect(claude).toHaveBeenCalledTimes(1);
  });

  it("Claude の1日の上限を超えたら Claude を呼ばない（写真検索は別）", async () => {
    const { call, claude, photos } = await start({ claudePerDay: 1 });
    expect((await call("/api/ai/outfits")).status).toBe(200);
    const r = await call("/api/ai/outfits");
    expect(r.status).toBe(429);
    expect(r.json.error).toContain("上限");
    expect(claude).toHaveBeenCalledTimes(1);
    expect((await call("/api/looks/photos", { body: "{}" })).status).toBe(200);
    expect(photos).toHaveBeenCalledOnce();
  });

  it("形の違うデータ・大きすぎるデータは Claude に渡さない", async () => {
    const { call, claude } = await start({ claudePerDay: 1 });
    expect((await call("/api/ai/outfits", { body: "not json" })).status).toBe(400);
    expect((await call("/api/ai/outfits", { body: JSON.stringify({ text: "x".repeat(60) }) })).status).toBe(400);
    expect((await call("/api/ai/outfits", { body: JSON.stringify({ text: "x".repeat(2000) }) })).status).toBe(413);
    expect((await call("/api/nothing")).status).toBe(404);
    expect((await call("/api/ai/outfits", { method: "GET" })).status).toBe(404);
    expect(claude).not.toHaveBeenCalled();
    // 断ったリクエストは1日の上限に数えない
    expect((await call("/api/ai/outfits")).status).toBe(200);
  });
});
