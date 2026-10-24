import { DEFAULT_AI_SETTINGS, type AISettings } from "../ai";

const KEY = "freedom-closet:ai-settings";

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_AI_SETTINGS, ...(JSON.parse(raw) as Partial<AISettings>) };
  } catch {
    // 保存できない環境（プライベートモードなど）では初期値で動かす
  }
  return DEFAULT_AI_SETTINGS;
}

export function saveAISettings(s: AISettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 保存できなくても、この画面を開いている間は使える
  }
}
