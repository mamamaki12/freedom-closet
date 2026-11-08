// 中継サーバーの守り。オーナーの Claude（料金がかかる）と Pexels の利用枠を、知らない人やほかのサイトに使われないようにする。
// - Origin：ほかのサイトを開いた人のブラウザから勝手に呼ばせない（受け付けるのはこのアプリのオリジンだけ）
// - Content-Type：application/json だけ（ほかのサイトが下準備なしで送れる text/plain などは断る）
// - 合言葉：RELAY_ACCESS_CODE を決めると、アプリの設定に同じ合言葉を入れた端末だけが使える
// - 回数：1つのIPアドレスから10分あたり何回まで、Claude は1日（日本時間）に合計何回まで
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export interface RelayConfig {
  /** 受け付けるアプリのオリジン（ALLOWED_ORIGIN、カンマ区切り）。空なら開発用に、この端末の中（localhost）のページだけ */
  allowedOrigins: string[];
  /** 合言葉（RELAY_ACCESS_CODE）。空なら確かめない */
  accessCode: string;
  /** 前にいるプロキシの数（TRUST_PROXY。Cloud Run・Render などは 1）。0 なら接続元のアドレスをそのまま使う */
  trustProxy: number;
  /** 1つのIPアドレスから10分間に受ける回数（RATE_LIMIT_PER_10MIN）。0 は制限なし */
  perIpPer10Min: number;
  /** Claude を呼ぶ回数の1日の合計（CLAUDE_DAILY_LIMIT）。0 は制限なし */
  claudePerDay: number;
}

export const WINDOW_MS = 10 * 60 * 1000;

function count(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): RelayConfig {
  return {
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGIN),
    accessCode: (env.RELAY_ACCESS_CODE ?? "").trim(),
    trustProxy: count(env.TRUST_PROXY, 0),
    perIpPer10Min: count(env.RATE_LIMIT_PER_10MIN, 120),
    claudePerDay: count(env.CLAUDE_DAILY_LIMIT, 300),
  };
}

/** 「https://a.example, https://b.example/」を、末尾の / を除いた一覧にする */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * このリクエストを受けてよいか（ブラウザが付ける Origin で見る）。
 * - Origin なし：ブラウザ以外（curl など）。Origin では断れないので、合言葉と回数制限で守る
 * - 一覧（ALLOWED_ORIGIN）にあるオリジン
 * - 一覧が空（開発中）なら、この端末の中のページ（localhost）だけ
 */
export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (origin === undefined) return true;
  if (allowed.length > 0) return allowed.includes(origin);
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function isJsonContentType(value: string | undefined): boolean {
  return !!value && /^application\/json\s*(;|$)/i.test(value.trim());
}

/** IPv6 は1台の端末が /64 の中のアドレスを自由に使えるので、/64 ごとにまとめて数える */
function rateKey(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.replace(/%.*$/, "").toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * 回数を数える相手（接続元のIPアドレス）。プロキシの後ろでは、プロキシが X-Forwarded-For の右端に足したアドレスを使う
 * （左側は送る側が自由に書けるので、そこを信じると回数制限をすり抜けられる）
 */
export function clientKey(headers: IncomingHttpHeaders, remoteAddress: string | undefined, trustProxy: number): string {
  if (trustProxy > 0) {
    const raw = headers["x-forwarded-for"];
    const list = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = list[list.length - trustProxy];
    if (ip) return rateKey(ip);
  }
  return rateKey(remoteAddress ?? "unknown");
}

/** 合言葉が合っているか。かかる時間から推測されないよう、同じ長さのハッシュどうしで比べる */
export function accessCodeMatches(given: string | string[] | undefined, expected: string): boolean {
  if (!expected) return true;
  if (typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** 時間の枠ごとに回数を数える。覚える相手の数に上限を付けて、メモリを使いすぎないようにする */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** 1回使う。上限を超えていたら、次に使えるまでの秒数を返す */
  take(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
    if (this.limit <= 0) return { ok: true };
    const t = this.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.delete(key);
      if (this.hits.size >= this.maxKeys) this.prune(t);
      entry = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, entry);
    }
    if (entry.count >= this.limit) return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - t) / 1000) };
    entry.count++;
    return { ok: true };
  }

  private prune(t: number) {
    for (const [k, e] of this.hits) if (e.resetAt <= t) this.hits.delete(k);
    // それでも多いとき（アドレスを変えながら送られたとき）は古いものから忘れる
    while (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
  }
}

/** 日本時間の1日ごとの合計回数 */
export class DailyLimit {
  private day = "";
  private used = 0;

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    if (this.limit <= 0) return true;
    const day = new Date(this.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}
