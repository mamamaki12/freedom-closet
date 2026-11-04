// どのAIを使うかを決める場所。画面は getAI() で受け取ったものだけを使う。
import { ClaudeAI } from "./claude";
import { LocalAI } from "./local";
import type { AIProviderId, ClosetAI } from "./types";

export type { AIProviderId, ClosetAI } from "./types";

export interface AISettings {
  provider: AIProviderId;
  /** Claude が失敗したとき（サーバー停止・通信エラーなど）に端末内AIで続けるか */
  fallbackToLocal: boolean;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: import.meta.env.VITE_AI_PROVIDER === "claude" ? "claude" : "local",
  fallbackToLocal: true,
};

/** primary が失敗したら fallback で同じ処理をやり直す */
export function withFallback(primary: ClosetAI, fallback: ClosetAI, onFallback?: (e: unknown) => void): ClosetAI {
  const run = async <T>(fn: (ai: ClosetAI) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    try {
      return await fn(primary);
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw e;
      onFallback?.(e);
      return fn(fallback);
    }
  };
  return {
    id: primary.id,
    label: primary.label,
    sendsPhotosOffDevice: primary.sendsPhotosOffDevice,
    prepare: () => primary.prepare?.(),
    analyzeGarment: (photo, o) => run((ai) => ai.analyzeGarment(photo, o), o?.signal),
    suggestOutfits: (input, o) => run((ai) => ai.suggestOutfits(input, o), o?.signal),
    suggestPurchases: (input, o) => run((ai) => ai.suggestPurchases(input, o), o?.signal),
  };
}

export function createAI(settings: AISettings, onFallback?: (e: unknown) => void): ClosetAI {
  const local = new LocalAI(import.meta.env.VITE_LOCAL_MODEL || undefined);
  if (settings.provider === "local") return local;
  const claude = new ClaudeAI(import.meta.env.VITE_AI_API_BASE ?? "");
  return settings.fallbackToLocal ? withFallback(claude, local, onFallback) : claude;
}
