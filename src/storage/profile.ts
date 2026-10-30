import type { Profile } from "../domain/profile";

const KEY = "freedom-closet:profile";

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {
    // 保存できない環境では空で動かす
  }
  return {};
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 保存できなくても、この画面を開いている間は使える
  }
}
